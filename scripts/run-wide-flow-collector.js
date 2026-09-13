#!/usr/bin/env node
"use strict";

// scripts/run-wide-flow-collector.js (2026-09-13)
//
// WHY THIS EXISTS
// ---------------
// Measured on 27 symbols over a full year of 4h bars: raw returns have their
// first eigenvalue carrying 68.4% of variance and an effective dimensionality
// of 2.12. Twenty-seven symbols are two bets. That single number explains the
// whole v1..v8 record — a book with net market exposure cannot reach
// significance no matter how long it runs, which is why v7 computes 18 years
// to t=1.96.
//
// Demeaning the cross-section moves effective dimensionality to 15.47. Breadth
// enters the fundamental law as a square root, so the only untried lever left
// is the width of the universe itself. 27 names is small; there are 528 USDT
// perpetuals trading.
//
// WHAT MUST BE BANKED, AND WHAT MUST NOT
// --------------------------------------
// Klines and funding rates page back years on demand, so collecting them is
// pointless. The /futures/data endpoints — open interest, what the largest
// accounts hold, what the crowd holds, which side crosses the spread — serve
// roughly 30 DAYS and no more, whatever period is requested. Anything not
// written down today is gone permanently. That asymmetry is the entire reason
// to collect wide now and filter narrow later: filtering at analysis time is
// free, and un-collecting is impossible.
//
// LIQUIDITY IS BANKED TOO, AND THAT IS NOT OPTIONAL. Filtering a historical
// cross-section by today's turnover is look-ahead: it keeps the names that
// survived and grew. So every cycle also writes a universe snapshot with each
// symbol's 24h quote volume AS OF THAT MOMENT, which is what a later study has
// to filter on.
//
// SEPARATE FROM v5 BY DESIGN
// --------------------------
// v5_flow_history.jsonl is the only input v7 has. This collector writes its own
// ledger and never touches v5's, because a bug here must not be able to damage
// a running lane.
//
// It also shares v5's IP. A rate-limit ban would take v5 down with it, so this
// aborts the entire run on the first 429/418 rather than retrying into a block,
// and holds a hard request budget. /futures/data returns no weight header, so
// the limit cannot be read back — pacing is deliberately conservative and the
// measured burst tolerance is not used as a target.
//
// Dedupe is by a per-series cursor rather than v5's set of every id. v5 reloads
// every row each run, which is fine for 24 symbols and would be 4.6M rows a
// year here. The API only ever serves a rolling window forward, so the high
// water mark per (symbol, endpoint) is sufficient.
//
// Read-only public market data: no keys, no orders, nothing at risk.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEDGER = path.join(ROOT, "ops/runtime/wide_flow_history.jsonl");
const UNIVERSE = path.join(ROOT, "ops/runtime/wide_universe_history.jsonl");
const CURSOR = path.join(ROOT, "ops/runtime/wide_flow_cursor.json");
const HEARTBEAT = path.join(ROOT, "ops/daily/wide_flow_collector_latest.json");
const F = "https://fapi.binance.com";

const PERIOD = "4h";
const LIMIT = 500;
const CONCURRENCY = 4;
const DELAY_MS = 40;
const REQUEST_BUDGET = 4000;   // hard stop well above one full sweep
const MAX_RETRIES = 2;

const ENDPOINTS = [
  { key: "oi", p: "openInterestHist",
    pick: (r) => ({ oi: num(r.sumOpenInterest), oi_value: num(r.sumOpenInterestValue) }) },
  { key: "top_pos", p: "topLongShortPositionRatio",
    pick: (r) => ({ top_long: num(r.longAccount), top_ratio: num(r.longShortRatio) }) },
  { key: "top_acct", p: "topLongShortAccountRatio",
    pick: (r) => ({ topacct_long: num(r.longAccount), topacct_ratio: num(r.longShortRatio) }) },
  { key: "global_acct", p: "globalLongShortAccountRatio",
    pick: (r) => ({ retail_long: num(r.longAccount), retail_ratio: num(r.longShortRatio) }) },
  { key: "taker", p: "takerlongshortRatio",
    pick: (r) => ({ taker_ratio: num(r.buySellRatio), taker_buy: num(r.buyVol), taker_sell: num(r.sellVol) }) },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

let requests = 0;
let blocked = null;   // set to the offending status the moment one appears

async function getJson(url, attempt = 0) {
  if (blocked) throw new Error(`ABORTED_${blocked}`);
  if (requests >= REQUEST_BUDGET) throw new Error("REQUEST_BUDGET_EXHAUSTED");
  requests += 1;
  const res = await fetch(url);
  if (res.status === 429 || res.status === 418) {
    // Do not retry into a block. One is enough to stop everything, because the
    // v5 collector shares this IP and losing it costs v7 its only input.
    blocked = res.status;
    throw new Error(`RATE_LIMITED_${res.status}`);
  }
  if (!res.ok) {
    if (attempt < MAX_RETRIES) {
      await sleep(400 * (attempt + 1));
      return getJson(url, attempt + 1);
    }
    throw new Error(`HTTP_${res.status}`);
  }
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error("NOT_AN_ARRAY");
  return j;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCursor() {
  try {
    const j = JSON.parse(fs.readFileSync(CURSOR, "utf8"));
    return j && typeof j === "object" && j.series ? j.series : {};
  } catch (_) {
    return rebuildCursorFromLedger();
  }
}

// One-time recovery if the cursor file is lost: the ledger is the source of
// truth and a full pass over it is acceptable once.
function rebuildCursorFromLedger() {
  const series = {};
  if (!fs.existsSync(LEDGER)) return series;
  for (const line of fs.readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      const id = `${r.symbol}|${r.key}`;
      if (!(series[id] >= r.ts)) series[id] = r.ts;
    } catch (_) { /* a torn final line must not stop the run */ }
  }
  return series;
}

// The oldest row ever banked. State, so it lives in the cursor — an earlier
// version read it back from the HEARTBEAT, which is a report, and a single bad
// value written there became permanent: every later run carried it forward and
// reported 0.2 days for a ledger holding 31.
//
// Seeded from the ledger only when the cursor has no value, which is once.
function loadEarliestMs() {
  try {
    const j = JSON.parse(fs.readFileSync(CURSOR, "utf8"));
    if (Number.isFinite(j.earliest_ms)) return j.earliest_ms;
  } catch (_) { /* fall through to the seed scan */ }
  if (!fs.existsSync(LEDGER)) return null;
  let min = null;
  for (const line of fs.readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const ts = JSON.parse(line).ts;
      if (Number.isFinite(ts) && (min === null || ts < min)) min = ts;
    } catch (_) { /* a torn final line must not stop the run */ }
  }
  return min;
}

async function fetchUniverse() {
  const info = await getJson(`${F}/fapi/v1/exchangeInfo`).catch(async () => {
    const res = await fetch(`${F}/fapi/v1/exchangeInfo`);
    return res.json();
  });
  const symbols = (info.symbols || info)
    .filter((s) => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT" && s.status === "TRADING")
    .map((s) => s.symbol);
  const t24 = await getJson(`${F}/fapi/v1/ticker/24hr`);
  const vol = new Map(t24.map((r) => [r.symbol, num(r.quoteVolume)]));
  return symbols
    .filter((s) => vol.has(s))
    .map((s) => ({ symbol: s, quote_volume_24h: vol.get(s) }))
    .sort((a, b) => b.quote_volume_24h - a.quote_volume_24h);
}

async function runPool(jobs, worker) {
  let idx = 0;
  const run = async () => {
    while (idx < jobs.length && !blocked) {
      const job = jobs[idx];
      idx += 1;
      await worker(job);
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

async function main() {
  const startedAt = Date.now();
  const series = loadCursor();
  const failures = [];

  let universe = [];
  try {
    universe = await fetchUniverse();
  } catch (e) {
    failures.push(`universe: ${e.message}`);
  }

  // Liquidity as observed now, so a later study can filter without look-ahead.
  //
  // This records the universe that EXISTED, not the subset that was sampled, so
  // it is written before any cap is applied. Throttling collection must not
  // silently narrow the liquidity history too — a later study filtering on a
  // record that was itself truncated would inherit the truncation as a bias.
  const snapTs = Date.now();
  if (universe.length) {
    fs.mkdirSync(path.dirname(UNIVERSE), { recursive: true });
    fs.appendFileSync(
      UNIVERSE,
      universe.map((u) => JSON.stringify({ ts: snapTs, symbol: u.symbol, quote_volume_24h: u.quote_volume_24h })).join("\n") + "\n",
      "utf8"
    );
  }
  const universeFullCount = universe.length;

  // WIDE_FLOW_MAX_SYMBOLS keeps the highest-turnover N. Two uses: a smoke run
  // that proves the row shape before the first sweep writes ~475k rows, and an
  // emergency throttle if this ever has to share the IP more politely.
  const cap = Number(process.env.WIDE_FLOW_MAX_SYMBOLS) || 0;
  if (cap > 0 && universe.length > cap) universe = universe.slice(0, cap);

  const jobs = [];
  for (const u of universe) for (const ep of ENDPOINTS) jobs.push({ symbol: u.symbol, ep });

  const out = [];
  await runPool(jobs, async ({ symbol, ep }) => {
    const id = `${symbol}|${ep.key}`;
    try {
      const rows = await getJson(`${F}/futures/data/${ep.p}?symbol=${symbol}&period=${PERIOD}&limit=${LIMIT}`);
      const high = series[id];
      let localMax = Number.isFinite(high) ? high : -Infinity;
      for (const r of rows) {
        const ts = Number(r.timestamp);
        if (!Number.isFinite(ts)) continue;
        if (Number.isFinite(high) && ts <= high) continue;
        out.push({ symbol, key: ep.key, ts, ...ep.pick(r) });
        if (ts > localMax) localMax = ts;
      }
      if (Number.isFinite(localMax)) series[id] = localMax;
    } catch (e) {
      failures.push(`${symbol}/${ep.key}: ${e.message}`);
    }
  });

  if (out.length) {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    out.sort((a, b) => a.ts - b.ts);
    fs.appendFileSync(LEDGER, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }

  let earliestMs = loadEarliestMs();
  // Loop rather than Math.min(...out) — the first sweep appends ~475k rows and
  // spreading that into arguments overflows the stack.
  for (const r of out) {
    if (Number.isFinite(r.ts) && (earliestMs === null || r.ts < earliestMs)) earliestMs = r.ts;
  }

  fs.mkdirSync(path.dirname(CURSOR), { recursive: true });
  fs.writeFileSync(
    CURSOR,
    JSON.stringify({ updated_at: new Date().toISOString(), earliest_ms: earliestMs, series }, null, 2)
  );

  // Banked span comes from the cursor, not a full ledger scan — the point of
  // the cursor is that this stays O(series) as the ledger grows.
  const tss = Object.values(series).filter(Number.isFinite);
  const maxTs = tss.length ? Math.max(...tss) : null;

  // banked_span_days is the headline number for this whole effort — it says
  // whether the ledger has outgrown the API's ~30 day horizon. It cannot come
  // from the series cursor, which holds the HIGH water mark per series: its
  // minimum is roughly the newest bar. earliestMs above is the real floor.
  const earliest = earliestMs ? new Date(earliestMs).toISOString() : null;

  const summary = {
    generated_at: new Date().toISOString(),
    elapsed_sec: Math.round((Date.now() - startedAt) / 100) / 10,
    requests,
    rate_limited: blocked,
    symbols: universe.length,
    endpoints: ENDPOINTS.length,
    series_tracked: Object.keys(series).length,
    rows_appended: out.length,
    // Kept distinct on purpose: `symbols` is what this run actually collected
    // (after any cap), `universe_size` is what existed. The liquidity snapshot
    // always covers the whole universe, so its row count follows the latter —
    // reporting it as the post-cap number once made a correct write look wrong.
    universe_size: universeFullCount,
    universe_rows_appended: universeFullCount,
    period: PERIOD,
    earliest,
    latest: maxTs ? new Date(maxTs).toISOString() : null,
    banked_span_days: earliest && maxTs
      ? Math.round(((maxTs - Date.parse(earliest)) / 864e5) * 10) / 10
      : 0,
    failures: failures.slice(0, 60),
    failure_count: failures.length,
    ledger: LEDGER,
    universe_ledger: UNIVERSE,
    note: "API serves ~30d of /futures/data; this ledger is the only way that horizon grows. Liquidity is banked per cycle so later filtering is not look-ahead.",
  };
  fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });
  fs.writeFileSync(HEARTBEAT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  // A rate-limit block is not a normal outcome; make it visible to the caller.
  if (blocked) process.exitCode = 1;
}

main().catch((e) => { console.error("WIDE_FLOW_COLLECTOR_FAIL", e && e.stack ? e.stack : String(e)); process.exit(1); });
