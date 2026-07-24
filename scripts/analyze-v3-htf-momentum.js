#!/usr/bin/env node
"use strict";

// scripts/analyze-v3-htf-momentum.js (2026-07-24)
//
// Research: does the momentum edge survive on the DAILY timeframe, where the
// cost-in-R is ~4x smaller than v3's 15m lane? Classic TSMOM, deliberately
// unfitted: position = sign of trailing N-day return, held until the sign
// flips; round-trip cost (0.14% taker+slip) charged ONLY on flip days.
// Three standard lookbacks (14/30/90) are all reported — robustness across
// them matters, cherry-picking the best is forbidden. First/second time
// halves reported for regime honesty. Benchmark: buy & hold.
//
// ~1000 daily candles (≈2.7y: 2023 chop → 2024 bull → 2025-26) per symbol,
// equal-weight portfolio across the v3 universe.

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AAVEUSDT", "SUIUSDT", "DOGEUSDT", "TIAUSDT", "ARBUSDT"];
const UNIQ = [...new Set(SYMS)];
const ROUND_TRIP_COST = 0.0014; // 0.14% — taker both ways + slippage
const LOOKBACKS = [14, 30, 90];

async function fetchDaily(sym) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1000`);
  if (!res.ok) throw new Error(`${sym} HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map((r) => ({ t: r[0], close: Number(r[4]) })).filter((r) => Number.isFinite(r.close));
}

// daily strategy returns for one symbol at one lookback
function tsmomReturns(closes, lookback) {
  const out = []; // {ret, flipped}
  let pos = 0;
  for (let i = lookback; i < closes.length - 1; i += 1) {
    const sig = Math.sign(closes[i] - closes[i - lookback]) || 0;
    const flipped = sig !== pos;
    pos = sig;
    const dayRet = closes[i + 1] / closes[i] - 1;
    out.push({ ret: pos * dayRet - (flipped ? ROUND_TRIP_COST : 0), flipped });
  }
  return out;
}

function stats(dailyRets) {
  const n = dailyRets.length;
  if (!n) return null;
  const mean = dailyRets.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(dailyRets.reduce((s, x) => s + (x - mean) ** 2, 0) / n) || 1e-9;
  let eq = 1, peak = 1, mdd = 0;
  for (const r of dailyRets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return {
    ann_ret_pct: +((Math.exp(Math.log(eq) / (n / 365)) - 1) * 100).toFixed(1),
    sharpe: +((mean / sd) * Math.sqrt(365)).toFixed(2),
    max_dd_pct: +(mdd * 100).toFixed(1),
    days: n,
  };
}

async function main() {
  const bySym = new Map();
  for (const s of UNIQ) {
    try { bySym.set(s, await fetchDaily(s)); } catch (e) { console.error(`skip ${s}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 120));
  }

  for (const lb of LOOKBACKS) {
    // align portfolio by date: collect each symbol's daily strategy return keyed by index-from-end
    const series = [];
    for (const [sym, rows] of bySym) {
      const closes = rows.map((r) => r.close);
      if (closes.length < lb + 50) continue;
      series.push({ sym, rets: tsmomReturns(closes, lb) });
    }
    const minLen = Math.min(...series.map((s) => s.rets.length));
    const port = [];
    for (let i = 0; i < minLen; i += 1) {
      const vals = series.map((s) => s.rets[s.rets.length - minLen + i].ret);
      port.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    const half = Math.floor(port.length / 2);
    const flipsPerYear = series.length
      ? +(series.reduce((s, x) => s + x.rets.filter((r) => r.flipped).length / (x.rets.length / 365), 0) / series.length).toFixed(0)
      : 0;
    console.log(`\n===== TSMOM lookback ${lb}d — equal-weight ${series.length} symbols, cost-charged on flips (${flipsPerYear} flips/yr avg) =====`);
    console.log(`  FULL   ${JSON.stringify(stats(port))}`);
    console.log(`  1st半  ${JSON.stringify(stats(port.slice(0, half)))}`);
    console.log(`  2nd半  ${JSON.stringify(stats(port.slice(half)))}`);
  }

  // benchmark
  const bh = [];
  {
    const closesAll = [...bySym.values()].map((rows) => rows.map((r) => r.close));
    const minLen = Math.min(...closesAll.map((c) => c.length)) - 1;
    for (let i = 0; i < minLen; i += 1) {
      const vals = closesAll.map((c) => c[c.length - minLen + i] / c[c.length - minLen + i - 1] - 1);
      bh.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }
  console.log(`\n===== benchmark: equal-weight BUY & HOLD =====`);
  console.log(`  FULL   ${JSON.stringify(stats(bh))}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
