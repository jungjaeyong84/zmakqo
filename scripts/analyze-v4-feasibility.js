#!/usr/bin/env node
"use strict";

// scripts/analyze-v4-feasibility.js (2026-08-07)
//
// Before building another signal, work out what a signal would have to BE.
//
// 131 directional configurations have now failed, and the v4 cross-sectional
// lane is negative BEFORE costs. Searching harder is not obviously the answer;
// the useful question is whether the structure can pay at all, and if so under
// what holding period. That is answerable without any signal, by measuring the
// ceiling and the floor and seeing how much room is left between them.
//
// THE CEILING is the oracle: at each rebalance, long the k symbols that will
// actually perform best over the next H days and short the k that will do
// worst, using perfect foresight. No real signal can beat this. It is a
// property of the universe's cross-sectional dispersion, and it is measurable.
//
// THE FLOOR is cost: (365/H) rebalances a year, each turning over some
// fraction of the book, each paying fees on both legs.
//
// Between them sits the requirement. A rank-based long/short book that selects
// on a signal correlated ρ with the true ranking captures roughly ρ of the
// oracle spread — approximate, but the right order of magnitude and the
// standard way this is reasoned about. So:
//
//     required IC ≈ (risk_free + target_excess + annual_cost) / oracle_annual
//
// If the required IC lands at 0.4 the search is hopeless: published equity
// factors live at 0.02-0.05, and nothing in 131 attempts here cleared 0.05
// after controls. If it lands at 0.03 the search is merely hard.
//
// The holding period is the variable that matters most, and the two terms move
// against each other with different exponents. Per-period dispersion grows
// like sqrt(H) while the number of rebalances falls like 1/H, so oracle return
// decays like 1/sqrt(H) but cost decays like 1/H. Cost falls faster. Longer
// holds should therefore be structurally favoured — that is a prediction this
// script tests rather than assumes.
//
// Finally the loop is closed: the ICs that real, simple signals actually
// deliver on this same data are measured, so "required" can be compared with
// "achievable" instead of with intuition.

const UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "LTCUSDT", "ATOMUSDT", "FILUSDT", "INJUSDT",
  "SEIUSDT", "GALAUSDT", "SANDUSDT", "AXSUSDT", "AAVEUSDT", "DOTUSDT",
  "WLDUSDT", "TAOUSDT", "ORDIUSDT",
];

const RISK_FREE_PCT = 5;
const TARGET_EXCESS_PCT = 8;        // the v4 criteria bar
const FEE_PER_SIDE_PCT = 0.02;      // maker; a scheduled rebalance can be patient
const TAKER_PER_SIDE_PCT = 0.05;
const HOLD_DAYS = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60];
const DAYS = 730;

async function fetchDaily(sym) {
  const out = [];
  let end = Date.now();
  for (let p = 0; p < 2; p += 1) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1000&endTime=${end}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.unshift(...rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })));
    end = Number(rows[0][0]) - 1;
    await new Promise((r) => setTimeout(r, 120));
  }
  const seen = new Set();
  return out
    .filter((b) => { if (seen.has(b.t)) return false; seen.add(b.t); return Number.isFinite(b.c) && b.c > 0; })
    .sort((a, b) => a.t - b.t)
    .slice(-DAYS);
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 5) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = (n + 1) / 2, my = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return num / (Math.sqrt(dx * dy) || 1e-12);
}

function main(series) {
  const syms = [...series.keys()];
  // align on the shortest history so every period has the same universe
  const len = Math.min(...syms.map((s) => series.get(s).length));
  const px = new Map(syms.map((s) => [s, series.get(s).slice(-len).map((b) => b.c)]));
  const years = len / 365.25;
  console.log(`universe ${syms.length}, aligned history ${len} days (~${years.toFixed(2)} years)`);
  console.log(`fees ${FEE_PER_SIDE_PCT}%/side maker (${TAKER_PER_SIDE_PCT}% taker shown for contrast)`);
  console.log(`bar to clear: risk-free ${RISK_FREE_PCT}% + excess ${TARGET_EXCESS_PCT}% = ${RISK_FREE_PCT + TARGET_EXCESS_PCT}%/yr\n`);

  console.log("=== CEILING vs FLOOR by holding period ===");
  console.log("oracle = perfect foresight long top-k / short bottom-k, gross exposure 1.0");
  console.log("cost assumes FULL rotation each rebalance (the oracle's own turnover)\n");
  console.log("hold  rebal/yr   k   oracle%/yr   cost%/yr(mk)  cost(tk)   needed%/yr   required IC");

  const rows = [];
  for (const H of HOLD_DAYS) {
    const nPeriods = Math.floor((len - 1) / H);
    if (nPeriods < 8) continue;
    const k = Math.max(2, Math.floor(syms.length / 3));

    let oracleSum = 0;
    const periodRets = [];
    for (let p = 0; p < nPeriods; p += 1) {
      const i0 = p * H, i1 = (p + 1) * H;
      const rets = syms.map((s) => ({ s, r: px.get(s)[i1] / px.get(s)[i0] - 1 }))
        .filter((x) => Number.isFinite(x.r))
        .sort((a, b) => b.r - a.r);
      if (rets.length < 2 * k) continue;
      const top = rets.slice(0, k).reduce((a, b) => a + b.r, 0) / k;
      const bot = rets.slice(-k).reduce((a, b) => a + b.r, 0) / k;
      const ret = 0.5 * (top - bot);   // 0.5 long + 0.5 short = gross 1.0
      oracleSum += ret;
      periodRets.push(ret);
    }
    if (!periodRets.length) continue;

    const rebalPerYear = 365 / H;
    const oracleAnn = (oracleSum / periodRets.length) * rebalPerYear * 100;
    // full rotation: every position closed and reopened -> 2 sides on gross 1.0
    const costMk = rebalPerYear * 2 * FEE_PER_SIDE_PCT;
    const costTk = rebalPerYear * 2 * TAKER_PER_SIDE_PCT;
    const needed = RISK_FREE_PCT + TARGET_EXCESS_PCT + costMk;
    const reqIC = needed / oracleAnn;

    rows.push({ H, k, oracleAnn, costMk, costTk, needed, reqIC });
    console.log(
      String(H).padStart(4) + rebalPerYear.toFixed(1).padStart(10) + String(k).padStart(4) +
      oracleAnn.toFixed(0).padStart(12) + costMk.toFixed(1).padStart(14) + costTk.toFixed(0).padStart(10) +
      needed.toFixed(1).padStart(13) + reqIC.toFixed(3).padStart(14) +
      (reqIC <= 0.05 ? "  <- plausible" : reqIC <= 0.10 ? "  <- hard" : "")
    );
  }

  console.log("\n=== ACHIEVABLE: what real signals actually deliver on this data ===");
  console.log("IC = Spearman(signal rank, realised forward return rank), averaged over periods\n");
  console.log("hold   momentum(2H)   momentum(H)   reversal(H)   low-vol      required");
  for (const row of rows) {
    const H = row.H;
    const nPeriods = Math.floor((len - 1) / H);
    const acc = { mom2: [], mom1: [], rev: [], lowvol: [] };
    for (let p = 2; p < nPeriods; p += 1) {
      const i0 = p * H, i1 = (p + 1) * H;
      const fwd = [], m2 = [], m1 = [], vol = [];
      for (const s of syms) {
        const a = px.get(s);
        const f = a[i1] / a[i0] - 1;
        const lb2 = a[i0] / a[Math.max(0, i0 - 2 * H)] - 1;
        const lb1 = a[i0] / a[Math.max(0, i0 - H)] - 1;
        let v = 0;
        for (let j = Math.max(1, i0 - H); j <= i0; j += 1) v += Math.abs(Math.log(a[j] / a[j - 1]));
        if (![f, lb2, lb1, v].every(Number.isFinite)) continue;
        fwd.push(f); m2.push(lb2); m1.push(lb1); vol.push(-v);
      }
      if (fwd.length < 10) continue;
      const push = (key, sig) => { const ic = spearman(sig, fwd); if (ic !== null) acc[key].push(ic); };
      push("mom2", m2); push("mom1", m1);
      push("rev", m1.map((v) => -v));
      push("lowvol", vol);
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    const fmt = (v) => (Number.isNaN(v) ? "   n/a" : v.toFixed(3).padStart(6));
    console.log(
      String(H).padStart(4) + fmt(avg(acc.mom2)).padStart(14) + fmt(avg(acc.mom1)).padStart(14) +
      fmt(avg(acc.rev)).padStart(14) + fmt(avg(acc.lowvol)).padStart(12) +
      row.reqIC.toFixed(3).padStart(13)
    );
  }

  const best = rows.reduce((a, b) => (b.reqIC < a.reqIC ? b : a));
  console.log("\n=== VERDICT ===");
  console.log(`  lowest requirement is at hold = ${best.H}d: IC ${best.reqIC.toFixed(3)} needed`);
  console.log(`    oracle ${best.oracleAnn.toFixed(0)}%/yr, cost ${best.costMk.toFixed(1)}%/yr, bar ${best.needed.toFixed(1)}%/yr`);
  const daily = rows.find((r) => r.H === 1);
  if (daily) {
    console.log(`  for contrast, daily rebalancing (what v4 does today) needs IC ${daily.reqIC.toFixed(3)}`);
    console.log(`    its cost alone is ${daily.costMk.toFixed(0)}%/yr maker, ${daily.costTk.toFixed(0)}%/yr taker`);
  }
  console.log(`\n  reference: published equity factors run IC 0.02-0.05.`);
  console.log(`  Nothing in the 131 configurations tested here cleared 0.05 after controls.`);
}

(async () => {
  const series = new Map();
  for (const s of UNIVERSE) {
    try {
      const bars = await fetchDaily(s);
      if (bars.length > 400) series.set(s, bars);
    } catch (e) { console.error(`skip ${s}: ${e.message}`); }
  }
  main(series);
})().catch((e) => { console.error(e); process.exit(1); });
