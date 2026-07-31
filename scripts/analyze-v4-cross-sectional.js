#!/usr/bin/env node
"use strict";

// scripts/analyze-v4-cross-sectional.js (2026-08-01)
//
// Focused follow-up to analyze-v4-edge-classes.js, fixing a methodological
// flaw and stress-testing the one promising result.
//
// FLAW FIXED: the first pass produced the "reversal" variant by mirroring
// the momentum returns (-r). Because r already had cost SUBTRACTED, the
// mirror ADDS cost back — overstating reversal by 2x the cost drag. Here
// direction is a parameter, so costs are charged correctly in both.
//
// STRESS TESTS added, because a single positive backtest means little:
//   - turnover + realized cost drag (how much edge the fees eat)
//   - cost sensitivity: 0.14% (taker) / 0.09% (maker-first) / 0.30% (harsh)
//   - yearly breakdown (is it one lucky regime or repeatable?)
//   - k sensitivity (top/bottom third vs top/bottom 2)
//   - a shuffled-signal control: same turnover, random ranks. If the real
//     signal is not clearly better than random, the "edge" is noise.

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AAVEUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "AXSUSDT"];

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
  };
}

// direction: +1 = long strong / short weak (momentum), -1 = reversal.
// Costs are charged on |position change| in BOTH directions — correct.
function runXS(closesBySym, { lookback, direction = 1, k = null, costPct = 0.0014, times = null, shuffle = false, seed = 1 }) {
  const syms = [...closesBySym.keys()];
  const minLen = Math.min(...syms.map((s) => closesBySym.get(s).length));
  const C = new Map(syms.map((s) => [s, closesBySym.get(s).slice(-minLen)]));
  const kk = k || Math.max(1, Math.floor(syms.length / 3));
  let rng = seed;
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };

  const port = [];
  const stamps = [];
  let prev = new Map(syms.map((s) => [s, 0]));
  let turnoverSum = 0, costSum = 0, days = 0;

  for (let i = lookback; i < minLen - 1; i += 1) {
    let ranked = syms.map((s) => ({ s, mom: C.get(s)[i] / C.get(s)[i - lookback] - 1 }));
    if (shuffle) ranked = ranked.map((r) => ({ ...r, mom: rand() }));
    ranked.sort((a, b) => b.mom - a.mom);

    const want = new Map(syms.map((s) => [s, 0]));
    ranked.slice(0, kk).forEach((r) => want.set(r.s, direction));
    ranked.slice(-kk).forEach((r) => want.set(r.s, -direction));

    const weight = 1 / (2 * kk);
    let dayRet = 0, dayTurn = 0, dayCost = 0;
    for (const s of syms) {
      const p = want.get(s);
      const delta = Math.abs(p - prev.get(s));
      const c = delta * costPct * weight; // cost proportional to size traded
      dayRet += p * (C.get(s)[i + 1] / C.get(s)[i] - 1) * weight - c;
      dayTurn += delta * weight;
      dayCost += c;
    }
    prev = want;
    port.push(dayRet); turnoverSum += dayTurn; costSum += dayCost; days += 1;
    if (times) stamps.push(times[times.length - minLen + i]);
  }
  return {
    rets: port, stamps,
    turnover_per_day: +(turnoverSum / days).toFixed(3),
    cost_drag_ann_pct: +(costSum / days * 365 * 100).toFixed(1),
  };
}

async function main() {
  const closesBySym = new Map();
  let times = null;
  for (const s of SYMS) {
    try {
      const rows = await fetchDaily(s);
      closesBySym.set(s, rows.map((r) => r.close));
      if (!times || rows.length > times.length) times = rows.map((r) => r.t);
    } catch (e) { console.error(`skip ${s}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`symbols: ${closesBySym.size}\n`);

  console.log("===== 1. DIRECTION, cost charged correctly in both (0.14%) =====");
  for (const lb of [3, 7, 14, 21]) {
    const mom = runXS(closesBySym, { lookback: lb, direction: 1 });
    const rev = runXS(closesBySym, { lookback: lb, direction: -1 });
    const f = (r) => { const s = stats(r.rets); return `ann=${String(s.ann_pct).padStart(7)}% sh=${String(s.sharpe).padStart(5)} dd=${String(s.mdd_pct).padStart(6)}%`; };
    console.log(`  lb=${String(lb).padStart(2)}d  MOMENTUM ${f(mom)}  |  REVERSAL ${f(rev)}   (turnover/day ${mom.turnover_per_day}, cost drag ${mom.cost_drag_ann_pct}%/yr)`);
  }

  console.log("\n===== 2. 14d MOMENTUM — cost sensitivity =====");
  for (const [label, cost] of [["maker-first 0.09%", 0.0009], ["taker 0.14%", 0.0014], ["harsh 0.30%", 0.0030]]) {
    const r = runXS(closesBySym, { lookback: 14, direction: 1, costPct: cost });
    const s = stats(r.rets);
    console.log(`  ${label.padEnd(20)} ann=${String(s.ann_pct).padStart(7)}%  sharpe=${String(s.sharpe).padStart(5)}  (cost drag ${r.cost_drag_ann_pct}%/yr)`);
  }

  console.log("\n===== 3. 14d MOMENTUM — yearly breakdown (one lucky regime?) =====");
  {
    const r = runXS(closesBySym, { lookback: 14, direction: 1, times });
    const byYear = new Map();
    r.rets.forEach((ret, i) => {
      const y = new Date(r.stamps[i] || 0).getUTCFullYear();
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(ret);
    });
    for (const [y, rets] of [...byYear.entries()].sort()) {
      const s = stats(rets);
      console.log(`  ${y}: ann=${String(s.ann_pct).padStart(7)}%  sharpe=${String(s.sharpe).padStart(5)}  n=${rets.length}d`);
    }
  }

  console.log("\n===== 4. 14d MOMENTUM — k sensitivity =====");
  for (const k of [2, 3, 4]) {
    const s = stats(runXS(closesBySym, { lookback: 14, direction: 1, k }).rets);
    console.log(`  top/bottom ${k}: ann=${String(s.ann_pct).padStart(7)}%  sharpe=${String(s.sharpe).padStart(5)}`);
  }

  console.log("\n===== 5. CONTROL: shuffled ranks (same turnover, no information) =====");
  const ctrl = [1, 2, 3, 4, 5].map((seed) => stats(runXS(closesBySym, { lookback: 14, direction: 1, shuffle: true, seed }).rets));
  ctrl.forEach((s, i) => console.log(`  seed ${i + 1}: ann=${String(s.ann_pct).padStart(7)}%  sharpe=${String(s.sharpe).padStart(5)}`));
  const avg = +(ctrl.reduce((a, s) => a + s.ann_pct, 0) / ctrl.length).toFixed(1);
  console.log(`  random average: ${avg}%/yr  <-- the real signal must clearly beat this`);
}

main().catch((e) => { console.error(e); process.exit(1); });
