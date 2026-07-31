#!/usr/bin/env node
"use strict";

// scripts/analyze-v4-edge-classes.js (2026-08-01)
//
// Before writing a "v4", measure whether any UNTESTED edge class exists.
// Everything v3 measured was time-series momentum / breakout on 15m, plus
// daily TSMOM (all negative recently). Two axes were never measured at all:
//
//   A. MEAN REVERSION — v3 doctrine banned it by assumption
//      ("PULLBACK_RECLAIM 전면 비활성화") and never tested it. Contrarian
//      signal = -sign(trailing N-day return).
//   B. CROSS-SECTIONAL momentum — rank symbols against EACH OTHER (long the
//      strongest, short the weakest), a different factor from TSMOM and a
//      documented crypto effect. Market-neutral by construction.
//
// Same honesty rules as every prior study: costs charged on position
// CHANGES only, three parameterisations per class (no cherry-picking),
// first/second time-half split, and buy&hold as the benchmark. A positive
// result here would justify building v4; a negative one closes the last
// unmeasured door.

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AAVEUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "AXSUSDT"];
const ROUND_TRIP_COST = 0.0014; // 0.14% round trip (taker + slippage)
const LOOKBACKS = [3, 7, 14];   // short horizons: where reversion lives

async function fetchDaily(sym) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1000`);
  if (!res.ok) throw new Error(`${sym} HTTP ${res.status}`);
  return (await res.json()).map((r) => ({ t: r[0], close: Number(r[4]) })).filter((r) => Number.isFinite(r.close));
}

function stats(rets) {
  const n = rets.length;
  if (!n) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / n) || 1e-9;
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return {
    ann_pct: +((Math.exp(Math.log(Math.max(eq, 1e-9)) / (n / 365)) - 1) * 100).toFixed(1),
    sharpe: +((mean / sd) * Math.sqrt(365)).toFixed(2),
    mdd_pct: +(mdd * 100).toFixed(1),
    days: n,
  };
}
const show = (label, s) => console.log(`  ${label.padEnd(10)} ann=${String(s ? s.ann_pct : "-").padStart(7)}%  sharpe=${String(s ? s.sharpe : "-").padStart(5)}  maxDD=${String(s ? s.mdd_pct : "-").padStart(6)}%`);

function halves(rets) {
  const h = Math.floor(rets.length / 2);
  return [rets.slice(0, h), rets.slice(h)];
}

// Per-symbol signal strategy → portfolio daily returns.
// signalFn(closes, i, lb) -> desired position in {-1,0,1}
function runPerSymbol(bySym, lb, signalFn) {
  const series = [];
  for (const closes of bySym.values()) {
    if (closes.length < lb + 60) continue;
    const rets = [];
    let pos = 0;
    for (let i = lb; i < closes.length - 1; i += 1) {
      const want = signalFn(closes, i, lb);
      const changed = want !== pos;
      pos = want;
      rets.push(pos * (closes[i + 1] / closes[i] - 1) - (changed ? ROUND_TRIP_COST : 0));
    }
    series.push(rets);
  }
  const minLen = Math.min(...series.map((s) => s.length));
  const port = [];
  for (let i = 0; i < minLen; i += 1) {
    const vals = series.map((s) => s[s.length - minLen + i]);
    port.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return port;
}

// Cross-sectional: rank by trailing return, long top third / short bottom third.
function runCrossSectional(bySym, lb) {
  const syms = [...bySym.keys()].filter((s) => bySym.get(s).length >= lb + 60);
  const minLen = Math.min(...syms.map((s) => bySym.get(s).length));
  const closes = new Map(syms.map((s) => [s, bySym.get(s).slice(-minLen)]));
  const k = Math.max(1, Math.floor(syms.length / 3));
  const port = [];
  let prev = new Map(syms.map((s) => [s, 0]));
  for (let i = lb; i < minLen - 1; i += 1) {
    const ranked = syms
      .map((s) => ({ s, mom: closes.get(s)[i] / closes.get(s)[i - lb] - 1 }))
      .sort((a, b) => b.mom - a.mom);
    const want = new Map(syms.map((s) => [s, 0]));
    ranked.slice(0, k).forEach((r) => want.set(r.s, 1));
    ranked.slice(-k).forEach((r) => want.set(r.s, -1));
    let dayRet = 0;
    for (const s of syms) {
      const p = want.get(s);
      const changed = p !== prev.get(s);
      dayRet += (p * (closes.get(s)[i + 1] / closes.get(s)[i] - 1) - (changed ? ROUND_TRIP_COST : 0)) / (2 * k);
    }
    prev = want;
    port.push(dayRet);
  }
  return port;
}

async function main() {
  const bySym = new Map();
  for (const s of SYMS) {
    try { bySym.set(s, (await fetchDaily(s)).map((r) => r.close)); } catch (e) { console.error(`skip ${s}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`symbols: ${bySym.size}, cost/round-trip: ${(ROUND_TRIP_COST * 100).toFixed(2)}%\n`);

  console.log("################ A. MEAN REVERSION (contrarian) — never measured by v3 ################");
  for (const lb of LOOKBACKS) {
    const port = runPerSymbol(bySym, lb, (c, i, l) => -Math.sign(c[i] - c[i - l]) || 0);
    const [h1, h2] = halves(port);
    console.log(`--- lookback ${lb}d ---`);
    show("FULL", stats(port)); show("1st half", stats(h1)); show("2nd half", stats(h2));
  }

  console.log("\n################ B. CROSS-SECTIONAL momentum (long strong / short weak) ################");
  for (const lb of LOOKBACKS) {
    const port = runCrossSectional(bySym, lb);
    const [h1, h2] = halves(port);
    console.log(`--- lookback ${lb}d ---`);
    show("FULL", stats(port)); show("1st half", stats(h1)); show("2nd half", stats(h2));
  }

  console.log("\n################ C. CROSS-SECTIONAL reversal (long weak / short strong) ################");
  for (const lb of LOOKBACKS) {
    const port = runCrossSectional(bySym, lb).map((r) => -r); // mirror, costs already charged
    const [h1, h2] = halves(port);
    console.log(`--- lookback ${lb}d (mirror; note: costs were charged on the long-strong leg) ---`);
    show("FULL", stats(port)); show("2nd half", stats(h2));
  }

  // benchmark
  const closesAll = [...bySym.values()];
  const minLen = Math.min(...closesAll.map((c) => c.length)) - 1;
  const bh = [];
  for (let i = 1; i < minLen; i += 1) {
    const vals = closesAll.map((c) => c[c.length - minLen + i] / c[c.length - minLen + i - 1] - 1);
    bh.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  console.log("\n################ BENCHMARK: equal-weight buy & hold ################");
  show("FULL", stats(bh)); show("2nd half", stats(halves(bh)[1]));
}

main().catch((e) => { console.error(e); process.exit(1); });
