#!/usr/bin/env node
"use strict";

// scripts/analyze-v4-placebo-control.js (2026-08-01) — red-team of my own v4.
//
// Two weaknesses in the v4 evidence, tested properly here:
//
// 1. CONFOUNDED CONTROL. The earlier shuffled-rank control randomised ranks
//    EVERY day, which maximises turnover, so its -42%/yr is mostly cost
//    drag, not absence of information. Claiming "the signal beats random by
//    50pp" was therefore not a clean alpha claim.
//    Fair placebo: keep the REAL momentum ranks (identical turnover, identical
//    position structure) but permute which symbol's RETURNS the portfolio
//    receives, fixed for the whole run. Information destroyed, costs
//    preserved. If the real run does not sit clearly outside the placebo
//    distribution, v4 is noise.
//
// 2. BACKWARDS k-PROFILE. A genuine cross-sectional momentum factor should be
//    STRONGEST in the extreme ranks. v4 was best at its least selective
//    setting (k=2 -4.4%, k=4 +14.9%), which points at a portfolio artifact
//    rather than a ranking edge. Measured directly here: return of the
//    extreme-rank leg vs the next-rank leg.
//
// Benchmark reality check: the alternative to trading is ~5%/yr risk-free
// (stablecoin yield), so excess-return Sharpe is what actually matters.

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AAVEUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "AXSUSDT"];
const COST = 0.0009;      // maker-first, the v4 base case
const RISK_FREE = 0.05;   // ~5%/yr stablecoin alternative

async function fetchDaily(sym) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1000`);
  if (!res.ok) throw new Error(`${sym} HTTP ${res.status}`);
  return (await res.json()).map((r) => Number(r[4])).filter(Number.isFinite);
}

function annualize(rets) {
  const n = rets.length;
  let eq = 1;
  for (const r of rets) eq *= 1 + r;
  return (Math.exp(Math.log(Math.max(eq, 1e-9)) / (n / 365)) - 1) * 100;
}
function sharpe(rets, rfAnnual = 0) {
  const n = rets.length;
  const rfDaily = Math.pow(1 + rfAnnual, 1 / 365) - 1;
  const ex = rets.map((r) => r - rfDaily);
  const m = ex.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(ex.reduce((s, x) => s + (x - m) ** 2, 0) / n) || 1e-9;
  return (m / sd) * Math.sqrt(365);
}

// Core engine. `returnMap` maps a symbol to the symbol whose RETURNS it
// receives (identity = the real strategy; a permutation = placebo).
function run(P, syms, { lookback = 14, k, returnMap = null }) {
  const minLen = Math.min(...syms.map((s) => P.get(s).length));
  const C = new Map(syms.map((s) => [s, P.get(s).slice(-minLen)]));
  const kk = k || Math.max(1, Math.floor(syms.length / 3));
  const map = returnMap || new Map(syms.map((s) => [s, s]));
  let prev = new Map(syms.map((s) => [s, 0]));
  const rets = [];
  for (let i = lookback; i < minLen - 1; i += 1) {
    const ranked = syms
      .map((s) => ({ s, m: C.get(s)[i] / C.get(s)[i - lookback] - 1 }))
      .sort((a, b) => b.m - a.m);
    const want = new Map(syms.map((s) => [s, 0]));
    ranked.slice(0, kk).forEach((r) => want.set(r.s, 1));
    ranked.slice(-kk).forEach((r) => want.set(r.s, -1));
    const w = 1 / (2 * kk);
    let d = 0;
    for (const s of syms) {
      const pos = want.get(s);
      const src = C.get(map.get(s));          // returns may come from another symbol
      d += pos * (src[i + 1] / src[i] - 1) * w - Math.abs(pos - prev.get(s)) * COST * w;
    }
    prev = want;
    rets.push(d);
  }
  return rets;
}

// Return of a specific rank band (long band top / short band bottom), used to
// test whether the edge really lives in the extremes.
function runBand(P, syms, { lookback = 14, from, to }) {
  const minLen = Math.min(...syms.map((s) => P.get(s).length));
  const C = new Map(syms.map((s) => [s, P.get(s).slice(-minLen)]));
  const size = to - from;
  let prev = new Map(syms.map((s) => [s, 0]));
  const rets = [];
  for (let i = lookback; i < minLen - 1; i += 1) {
    const ranked = syms
      .map((s) => ({ s, m: C.get(s)[i] / C.get(s)[i - lookback] - 1 }))
      .sort((a, b) => b.m - a.m);
    const want = new Map(syms.map((s) => [s, 0]));
    ranked.slice(from, to).forEach((r) => want.set(r.s, 1));                       // long band
    ranked.slice(ranked.length - to, ranked.length - from).forEach((r) => want.set(r.s, -1)); // mirror short band
    const w = 1 / (2 * size);
    let d = 0;
    for (const s of syms) {
      const pos = want.get(s);
      d += pos * (C.get(s)[i + 1] / C.get(s)[i] - 1) * w - Math.abs(pos - prev.get(s)) * COST * w;
    }
    prev = want;
    rets.push(d);
  }
  return rets;
}

function shuffled(arr, seed) {
  let rng = seed;
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function main() {
  const P = new Map();
  for (const s of SYMS) {
    try { P.set(s, await fetchDaily(s)); } catch (_) {}
    await new Promise((r) => setTimeout(r, 110));
  }
  const syms = [...P.keys()];
  console.log(`universe ${syms.length}, cost ${(COST * 100).toFixed(2)}%, risk-free benchmark ${RISK_FREE * 100}%/yr\n`);

  // ---- TEST 1: turnover-matched placebo -----------------------------------
  const real = run(P, syms, { lookback: 14, k: 4 });
  const realAnn = annualize(real);
  console.log("===== TEST 1: turnover-matched placebo (real ranks, permuted return streams) =====");
  console.log(`  REAL: ann=${realAnn.toFixed(1)}%  sharpe(raw)=${sharpe(real).toFixed(2)}  sharpe(excess of 5% rf)=${sharpe(real, RISK_FREE).toFixed(2)}`);
  const placebos = [];
  for (let seed = 1; seed <= 40; seed += 1) {
    const perm = shuffled(syms, seed * 7919);
    const map = new Map(syms.map((s, i) => [s, perm[i]]));
    if (syms.every((s) => map.get(s) === s)) continue; // identity permutation
    placebos.push(annualize(run(P, syms, { lookback: 14, k: 4, returnMap: map })));
  }
  placebos.sort((a, b) => a - b);
  const pMean = placebos.reduce((s, x) => s + x, 0) / placebos.length;
  const beaten = placebos.filter((p) => p < realAnn).length;
  const pct = (q) => placebos[Math.min(placebos.length - 1, Math.floor(q * placebos.length))];
  console.log(`  PLACEBO n=${placebos.length}: mean=${pMean.toFixed(1)}%  p50=${pct(0.5).toFixed(1)}%  p90=${pct(0.9).toFixed(1)}%  max=${placebos[placebos.length - 1].toFixed(1)}%`);
  console.log(`  real beats ${beaten}/${placebos.length} placebos  => empirical p-value ≈ ${((1 - beaten / placebos.length)).toFixed(3)}`);
  console.log(`  ${beaten / placebos.length >= 0.95 ? "PASS: outside the placebo distribution" : "FAIL: inside the placebo distribution — indistinguishable from luck"}`);

  // ---- TEST 2: is the edge in the extremes? -------------------------------
  console.log("\n===== TEST 2: rank-band profile (a real factor is STRONGEST at the extremes) =====");
  for (const [label, from, to] of [["rank 1-2 (extreme)", 0, 2], ["rank 3-4 (next)", 2, 4], ["rank 5-6 (middle)", 4, 6]]) {
    const r = runBand(P, syms, { lookback: 14, from, to });
    console.log(`  ${label.padEnd(20)} ann=${annualize(r).toFixed(1).padStart(7)}%  sharpe=${sharpe(r).toFixed(2).padStart(5)}`);
  }

  // ---- TEST 3: the honest benchmark --------------------------------------
  console.log("\n===== TEST 3: versus simply not trading =====");
  const vol = Math.sqrt(real.reduce((s, x) => s + (x - real.reduce((a, b) => a + b, 0) / real.length) ** 2, 0) / real.length) * Math.sqrt(365) * 100;
  console.log(`  v4 backtest: ${realAnn.toFixed(1)}%/yr at ${vol.toFixed(1)}% annualized vol`);
  console.log(`  risk-free  : ${(RISK_FREE * 100).toFixed(1)}%/yr at ~0% vol`);
  console.log(`  excess     : ${(realAnn - RISK_FREE * 100).toFixed(1)}pp for ${vol.toFixed(1)}% vol  => excess Sharpe ${sharpe(real, RISK_FREE).toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
