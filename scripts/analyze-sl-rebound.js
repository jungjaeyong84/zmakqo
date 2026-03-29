#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const EXCHANGE = "BINANCEFUT";
const TF = "60m";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMs(v) {
  const n = toNum(v);
  if (Number.isFinite(n)) return n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function parseLeverage(fill, fallback = 2) {
  const cands = [
    fill.leverage_applied,
    fill.applied_leverage,
    fill.external_leverage,
    fill.futures_leverage,
  ];
  for (const v of cands) {
    const n = toNum(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const txt = String(fill.leverage_reason || "");
  const m = txt.match(/(\d+(?:\.\d+)?)x/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function normalizeSymbol(fill) {
  return String(fill.symbol || fill.symbol_or_pair_id || fill.market || "")
    .toUpperCase()
    .replace(/\.P$/i, "");
}

async function fetchRecentSlFills(days = 21, limit = 120000) {
  const db = getFirestore();
  const fromMs = Date.now() - days * DAY_MS;
  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(limit).get();
  const out = [];
  snap.forEach((d) => {
    const x = { id: d.id, ...d.data() };
    if (!isLiveDocForExchange(EXCHANGE, x)) return;
    const ex = String(x.exchange || "").toUpperCase();
    if (!ex.includes("BINANCE")) return;
    if (String(x.tf || "").toLowerCase() !== TF) return;
    const ev = String(x.event || "").toUpperCase();
    if (!ev.startsWith("EXIT_SL_1.5P")) return;
    const ms = toMs(x.exec_bar_close_time_utc_ms) ?? toMs(x.created_at);
    if (!Number.isFinite(ms) || ms < fromMs) return;
    const px = toNum(x.exec_price);
    if (!Number.isFinite(px) || px <= 0) return;
    const side = String(x.side || "").toUpperCase();
    if (side !== "SELL" && side !== "BUY") return;
    const symbol = normalizeSymbol(x);
    if (!symbol) return;
    out.push({
      id: d.id,
      symbol,
      side,
      ms,
      stopPx: px,
      lev: parseLeverage(x, 2),
    });
  });
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

async function fetchKlines(symbol, startMs, endMs) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=1500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KLINES_HTTP_${res.status}_${symbol}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((k) => ({ closeTime: toNum(k[6]), close: toNum(k[4]) }))
    .filter((k) => Number.isFinite(k.closeTime) && Number.isFinite(k.close))
    .sort((a, b) => a.closeTime - b.closeTime);
}

function analyzeOne(fill, bars, horizonMs) {
  const L = Math.max(1, Number(fill.lev) || 2);
  const s1 = 0.015 / L; // current stop
  const s2 = 0.02 / L;  // proposed stop
  const stop = fill.stopPx;

  // Long stopped (SELL): price had fallen. Need rebound to entry before deeper fail.
  if (fill.side === "SELL") {
    const entryPx = stop / (1 - s1);
    const failPx = entryPx * (1 - s2);
    const until = fill.ms + horizonMs;
    for (const b of bars) {
      if (b.closeTime <= fill.ms) continue;
      if (b.closeTime > until) break;
      if (b.close <= failPx) return { outcome: "would_fail_at_2", entryPx, failPx };
      if (b.close >= entryPx) return { outcome: "recover_to_be", entryPx, failPx };
    }
    return { outcome: "no_recovery_in_horizon", entryPx, failPx };
  }

  // Short stopped (BUY): price had risen. Need drop to entry before deeper fail.
  const entryPx = stop / (1 + s1);
  const failPx = entryPx * (1 + s2);
  const until = fill.ms + horizonMs;
  for (const b of bars) {
    if (b.closeTime <= fill.ms) continue;
    if (b.closeTime > until) break;
    if (b.close >= failPx) return { outcome: "would_fail_at_2", entryPx, failPx };
    if (b.close <= entryPx) return { outcome: "recover_to_be", entryPx, failPx };
  }
  return { outcome: "no_recovery_in_horizon", entryPx, failPx };
}

async function main() {
  const days = Math.max(7, Number(process.argv[2] || 21));
  const horizonHours = Math.max(1, Number(process.argv[3] || 8));
  const horizonMs = horizonHours * HOUR_MS;
  const slFills = await fetchRecentSlFills(days, 120000);
  if (!slFills.length) {
    console.log(JSON.stringify({ ok: false, reason: "NO_SL_FILLS", days }, null, 2));
    return;
  }

  const symbols = Array.from(new Set(slFills.map((x) => x.symbol)));
  const minMs = slFills[0].ms - 2 * HOUR_MS;
  const maxMs = slFills[slFills.length - 1].ms + horizonMs + 2 * HOUR_MS;
  const barsBySymbol = new Map();
  for (const s of symbols) {
    barsBySymbol.set(s, await fetchKlines(s, minMs, maxMs));
  }

  let recover = 0;
  let fail2 = 0;
  let noRec = 0;
  const bySymbol = {};
  for (const f of slFills) {
    const bars = barsBySymbol.get(f.symbol) || [];
    const a = analyzeOne(f, bars, horizonMs);
    if (a.outcome === "recover_to_be") recover += 1;
    else if (a.outcome === "would_fail_at_2") fail2 += 1;
    else noRec += 1;
    if (!bySymbol[f.symbol]) bySymbol[f.symbol] = { n: 0, recover_to_be: 0, would_fail_at_2: 0, no_recovery_in_horizon: 0 };
    bySymbol[f.symbol].n += 1;
    bySymbol[f.symbol][a.outcome] += 1;
  }

  const total = slFills.length;
  console.log(JSON.stringify({
    ok: true,
    scope: { exchange: EXCHANGE, tf: TF, days, horizon_hours: horizonHours, samples: total, symbols: symbols.length },
    summary: {
      recover_to_be: recover,
      would_fail_at_2: fail2,
      no_recovery_in_horizon: noRec,
      recover_rate: total ? recover / total : null,
      fail2_rate: total ? fail2 / total : null,
    },
    by_symbol: bySymbol,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

