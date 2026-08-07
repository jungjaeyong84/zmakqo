#!/usr/bin/env node
"use strict";

// scripts/run-v5-flow-collector.js (2026-08-07)
//
// Binance's /futures/data endpoints are the only public source of positioning
// and order-flow information — open interest, what the largest accounts hold,
// what the retail crowd holds, and which side is crossing the spread. None of
// it is derivable from price.
//
// They return roughly 30 DAYS of history and no more, whatever `period` is
// requested. Verified directly: period=1d with limit=500 returns 31 rows.
//
// That single fact has now killed two studies. The v3 flow study covered 21
// days — one regime — so its IC 0.111 was a lead that could never be
// validated. The v5 composite had to exclude these features entirely, leaving
// it with price transforms and funding.
//
// Thirty days will still be thirty days next month unless something writes
// them down. This does that: it appends the rolling window to an append-only
// ledger every day, so history accumulates going forward even though it cannot
// be recovered backwards. In six months there is a six-month sample; in
// eighteen, enough to survive the controls that killed everything else.
//
// Deliberately dumb. It fetches, dedupes on (symbol, endpoint, timestamp), and
// appends. No signal logic — a collector that also has opinions is a collector
// that gets rewritten every time the opinions change, and the data is the only
// part that cannot be regenerated.
//
// Read-only public market data: no keys, no orders, nothing at risk.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEDGER = path.join(ROOT, "ops/runtime/v5_flow_history.jsonl");
const HEARTBEAT = path.join(ROOT, "ops/daily/v5_flow_collector_latest.json");
const F = "https://fapi.binance.com";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "LTCUSDT", "ATOMUSDT", "FILUSDT", "INJUSDT",
  "SEIUSDT", "GALAUSDT", "SANDUSDT", "AXSUSDT", "AAVEUSDT", "DOTUSDT",
];

// 4h keeps the window ~30 days deep at 180 points while still resolving
// intraday positioning shifts. 1h would only reach ~30 days too, but with 4x
// the rows for the same span.
const PERIOD = "4h";
const LIMIT = 500;

const ENDPOINTS = [
  { key: "oi", url: (s) => `${F}/futures/data/openInterestHist?symbol=${s}&period=${PERIOD}&limit=${LIMIT}`,
    pick: (r) => ({ oi: Number(r.sumOpenInterest), oi_value: Number(r.sumOpenInterestValue) }) },
  { key: "top_pos", url: (s) => `${F}/futures/data/topLongShortPositionRatio?symbol=${s}&period=${PERIOD}&limit=${LIMIT}`,
    pick: (r) => ({ top_long: Number(r.longAccount), top_ratio: Number(r.longShortRatio) }) },
  { key: "global_acct", url: (s) => `${F}/futures/data/globalLongShortAccountRatio?symbol=${s}&period=${PERIOD}&limit=${LIMIT}`,
    pick: (r) => ({ retail_long: Number(r.longAccount), retail_ratio: Number(r.longShortRatio) }) },
  { key: "taker", url: (s) => `${F}/futures/data/takerlongshortRatio?symbol=${s}&period=${PERIOD}&limit=${LIMIT}`,
    pick: (r) => ({ taker_ratio: Number(r.buySellRatio), taker_buy: Number(r.buyVol), taker_sell: Number(r.sellVol) }) },
];

// Existing (symbol|key|timestamp) triples, so re-running never duplicates.
function loadSeen() {
  const seen = new Set();
  if (!fs.existsSync(LEDGER)) return seen;
  for (const line of fs.readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      seen.add(`${r.symbol}|${r.key}|${r.ts}`);
    } catch (_) { /* a torn final line must not stop the run */ }
  }
  return seen;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error("not an array");
  return j;
}

async function main() {
  const seen = loadSeen();
  const before = seen.size;
  const out = [];
  const failures = [];

  for (const sym of SYMBOLS) {
    for (const ep of ENDPOINTS) {
      try {
        const rows = await getJson(ep.url(sym));
        for (const r of rows) {
          const ts = Number(r.timestamp);
          if (!Number.isFinite(ts)) continue;
          const id = `${sym}|${ep.key}|${ts}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ symbol: sym, key: ep.key, ts, ...ep.pick(r) });
        }
      } catch (e) {
        failures.push(`${sym}/${ep.key}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 160));
    }
  }

  if (out.length) {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    out.sort((a, b) => a.ts - b.ts);
    fs.appendFileSync(LEDGER, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }

  // span of what has been banked so far — the number that matters, since the
  // whole point is that it grows past the API's 30-day horizon
  let minTs = Infinity, maxTs = -Infinity;
  if (fs.existsSync(LEDGER)) {
    for (const line of fs.readFileSync(LEDGER, "utf8").split("\n")) {
      if (!line) continue;
      try { const t = JSON.parse(line).ts; if (t < minTs) minTs = t; if (t > maxTs) maxTs = t; } catch (_) {}
    }
  }
  const spanDays = Number.isFinite(minTs) && Number.isFinite(maxTs) ? (maxTs - minTs) / 864e5 : 0;

  const summary = {
    generated_at: new Date().toISOString(),
    rows_appended: out.length,
    rows_total: seen.size,
    rows_before: before,
    symbols: SYMBOLS.length,
    period: PERIOD,
    banked_span_days: Math.round(spanDays * 10) / 10,
    earliest: Number.isFinite(minTs) ? new Date(minTs).toISOString() : null,
    latest: Number.isFinite(maxTs) ? new Date(maxTs).toISOString() : null,
    failures,
    ledger: LEDGER,
    note: "API serves ~30d; this ledger is the only way that horizon grows.",
  };
  fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });
  fs.writeFileSync(HEARTBEAT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
