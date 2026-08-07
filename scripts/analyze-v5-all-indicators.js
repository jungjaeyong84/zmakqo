#!/usr/bin/env node
"use strict";

// scripts/analyze-v5-all-indicators.js (2026-08-08)
//
// Every indicator family this venue can supply, in one composite — classical
// TA, hand-rolled price/vol features, funding, and ORDER FLOW.
//
// Three separate composites have now been worse than their own best single
// ingredient (0.0824 vs 0.0867; 0.0720 vs 0.0792). Adding more of the same
// thing will make that worse, not better, so the redundancy is attacked
// directly here rather than hoped away:
//
//   1. measure every indicator's IC in-sample
//   2. measure the CORRELATION MATRIX between indicators
//   3. build the composite greedily — take the strongest, then only admit a
//      new indicator if its |correlation| with everything already admitted is
//      below a cutoff
//
// A composite of near-duplicates is one indicator with extra steps. A
// composite of decorrelated signals is the thing that actually diversifies.
// Both are reported so the difference is visible instead of asserted.
//
// ORDER FLOW is the genuinely new information and it was missed until now. The
// kline payload carries twelve fields and earlier work used six. Fields [8]
// numberOfTrades, [9] takerBuyBaseVolume and [7] quoteAssetVolume were sitting
// unused, and they yield:
//
//   taker_ratio      takerBuyBase / volume — which side is CROSSING the spread
//   avg_trade_size   volume / numberOfTrades — whale vs retail proxy
//
// This matters because those are not transforms of the price series. Every
// other indicator here — Ichimoku, RSI, MACD, Bollinger — is some function of
// past prices, which is precisely why they correlate and why combining them
// added nothing. Order flow is a different measurement of the same bar.
//
// It is also the same KIND of information as /futures/data's takerlongshort
// endpoint, which was excluded from earlier work for having only 30 days of
// history. The per-bar version has years. That exclusion was half wrong.
//
// Finally the book is built two ways. The classical-TA run returned 15.1%/yr
// at 60.3% volatility — Sharpe 0.25 — because it ran 55/45 long/short with an
// 8.4pp directional tilt, so residual market exposure dominated. DOLLAR
// NEUTRAL forces equal long and short weight each period. If variance is the
// binding constraint rather than the signal, that is where it shows.

const fs = require("fs");
const path = require("path");
const ta = require("./analyze-v5-classic-ta.js");

const CACHE = process.env.V5_CACHE
  || path.join(process.env.TMPDIR || "/tmp", "v5_data_full.json");
const HOLD = 6;
const COST_PCT = 0.14;
const MIN_ABS_IC = 0.015;
const MAX_PAIR_CORR = 0.7;

const { buildIndicators, featuresAt, spearman, mean, sd } = ta;

function pearson(a, b) {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] - ma, y = b[i] - mb;
    n += x * y; da += x * x; db += y * y;
  }
  return n / (Math.sqrt(da * db) || 1e-12);
}

// Order-flow + price/vol features that the classical set does not cover.
function extraFeatures(bars, i) {
  const b = bars[i];
  const win = 30;
  let vSum = 0, nSum = 0, tbSum = 0;
  for (let k = i - win; k < i; k += 1) { vSum += bars[k].v; nSum += bars[k].n; tbSum += bars[k].tbv; }
  const vAvg = vSum / win || 1e-9, nAvg = nSum / win || 1e-9;

  // realized vol over 30 bars, used to normalise the momentum terms
  let s = 0, s2 = 0;
  for (let k = i - win; k < i; k += 1) { const r = Math.log(bars[k + 1].c / bars[k].c); s += r; s2 += r * r; }
  const mu = s / win;
  const rv = Math.sqrt(Math.max(s2 / win - mu * mu, 0)) || 1e-9;

  const takerRatio = b.tbv / (b.v || 1e-9);
  const takerRatioAvg = tbSum / (vSum || 1e-9);
  const avgSize = b.v / (b.n || 1e-9);
  const avgSizeAvg = vSum / (nSum || 1e-9);

  const body = Math.abs(b.c - b.o);
  const upper = b.h - Math.max(b.o, b.c);
  const lower = Math.min(b.o, b.c) - b.l;

  return {
    // ORDER FLOW — not derivable from price
    flow_taker_ratio: takerRatio - 0.5,
    flow_taker_dev: takerRatio - takerRatioAvg,
    flow_trade_size: Math.log(avgSize / avgSizeAvg),
    flow_trade_count: Math.log(b.n / nAvg),
    // hand-rolled price/vol
    mom_1d: (b.c / bars[i - 6].c - 1) / rv,
    mom_3d: (b.c / bars[i - 18].c - 1) / rv,
    mom_7d: (b.c / bars[i - 42].c - 1) / rv,
    vol_regime: rv,
    vol_shock: Math.log(b.v / vAvg),
    wick_skew: (lower - upper) / ((body + upper + lower) || 1e-9),
  };
}

function fundingFeatures(funding, fi) {
  const now = funding.length ? funding[fi].r : 0;
  let s = 0, c = 0;
  for (let k = Math.max(0, fi - 8); k <= fi; k += 1) { s += funding[k].r; c += 1; }
  return { funding_level: now, funding_dev: now - (c ? s / c : 0) };
}

function main() {
  const store = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const perSym = {};
  for (const [sym, d] of Object.entries(store)) {
    const bars = d.bars, funding = d.funding || [];
    if (!bars || bars.length < 300) continue;
    const ind = buildIndicators(bars);
    const rows = [];
    let fi = 0;
    for (let i = 90; i < bars.length - HOLD; i += 1) {
      while (fi + 1 < funding.length && funding[fi + 1].t <= bars[i].t) fi += 1;
      const f = { ...featuresAt(bars, ind, i), ...extraFeatures(bars, i), ...fundingFeatures(funding, fi) };
      if (!Object.values(f).every(Number.isFinite)) continue;
      rows.push({ t: bars[i].t, f, fwd: bars[i + HOLD].c / bars[i].c - 1 });
    }
    if (rows.length > 200) perSym[sym] = rows;
  }

  // Two return series, and using the wrong one silently breaks the test.
  //
  //   fwd     RAW forward return. This is what a portfolio actually earns.
  //   fwdDm   symbol-demeaned, for measuring IC across symbols without a
  //           coin's own drift manufacturing correlation.
  //
  // An earlier version fed the DEMEANED series to the portfolio too. That is
  // wrong twice over. A dollar-neutral book already cancels the market factor
  // by construction — equal long and short weight — so demeaning applies the
  // adjustment a second time. And the demeaning constant is each symbol's mean
  // over the WHOLE sample, in-sample included, so it leaks. The result was a
  // book reporting -112%/yr while its own IC was positive, which is
  // self-contradictory and was the tell.
  const fwdMean = {};
  for (const [s, r] of Object.entries(perSym)) fwdMean[s] = mean(r.map((x) => x.fwd));
  const all = [];
  for (const [s, r] of Object.entries(perSym)) {
    for (const x of r) all.push({ sym: s, t: x.t, f: x.f, fwd: x.fwd, fwdDm: x.fwd - fwdMean[s] });
  }
  all.sort((a, b) => a.t - b.t);
  const half = Math.floor(all.length / 2);
  const IS = all.slice(0, half), OOS = all.slice(half);
  const names = Object.keys(all[0].f);

  console.log(`symbols ${Object.keys(perSym).length}, observations ${all.length}, ${names.length} indicators`);
  console.log(`in-sample  ${new Date(IS[0].t).toISOString().slice(0, 10)} ~ ${new Date(IS[IS.length - 1].t).toISOString().slice(0, 10)}`);
  console.log(`out-sample ${new Date(OOS[0].t).toISOString().slice(0, 10)} ~ ${new Date(OOS[OOS.length - 1].t).toISOString().slice(0, 10)}\n`);

  // ---- step 1: IC of every indicator ------------------------------------
  console.log("=== STEP 1: every indicator, ranked by |IC| in-sample ===");
  console.log("ORDER FLOW rows marked * — these are the only ones not derived from price\n");
  console.log("indicator               IC(in)    IC(out)   sign");
  const scored = [];
  for (const nm of names) {
    const icIn = spearman(IS.map((r) => r.f[nm]), IS.map((r) => r.fwdDm));
    const icOut = spearman(OOS.map((r) => r.f[nm]), OOS.map((r) => r.fwdDm));
    scored.push({ nm, icIn, icOut, sign: icIn >= 0 ? 1 : -1 });
  }
  scored.sort((a, b) => Math.abs(b.icIn) - Math.abs(a.icIn));
  for (const s of scored) {
    console.log(
      (s.nm.startsWith("flow_") ? "* " : "  ") + s.nm.padEnd(21) +
      s.icIn.toFixed(4).padStart(8) + s.icOut.toFixed(4).padStart(10) +
      String(s.sign > 0 ? "+" : "-").padStart(6) +
      (Math.abs(s.icIn) >= MIN_ABS_IC ? (s.icIn * s.icOut < 0 ? "   FLIPS" : "   ok") : "   weak")
    );
  }

  // ---- step 2: correlation structure ------------------------------------
  const eligible = scored.filter((s) => Math.abs(s.icIn) >= MIN_ABS_IC);
  const cols = {};
  for (const s of eligible) cols[s.nm] = IS.map((r) => s.sign * r.f[s.nm]);

  console.log(`\n=== STEP 2: how redundant are they? (|corr| among the ${eligible.length} eligible) ===`);
  const pairs = [];
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      pairs.push({ a: eligible[i].nm, b: eligible[j].nm, c: Math.abs(pearson(cols[eligible[i].nm], cols[eligible[j].nm])) });
    }
  }
  pairs.sort((x, y) => y.c - x.c);
  console.log(`  average |corr| across all ${pairs.length} pairs: ${mean(pairs.map((p) => p.c)).toFixed(3)}`);
  console.log(`  pairs above ${MAX_PAIR_CORR}: ${pairs.filter((p) => p.c > MAX_PAIR_CORR).length}`);
  console.log("  most duplicated pairs:");
  for (const p of pairs.slice(0, 6)) console.log(`    ${p.a} ~ ${p.b}: ${p.c.toFixed(3)}`);

  // ---- step 3: greedy decorrelated selection ----------------------------
  const keep = [];
  for (const s of eligible) {
    const dup = keep.find((k) => Math.abs(pearson(cols[k.nm], cols[s.nm])) > MAX_PAIR_CORR);
    if (!dup) keep.push(s);
  }
  console.log(`\n=== STEP 3: decorrelated subset (|corr| < ${MAX_PAIR_CORR}) ===`);
  console.log(`  kept ${keep.length} of ${eligible.length}: ${keep.map((k) => k.nm).join(", ")}`);
  console.log(`  order-flow survivors: ${keep.filter((k) => k.nm.startsWith("flow_")).length}`);

  const mk = (list) => {
    const st = {};
    for (const { nm } of list) { const v = IS.map((r) => r.f[nm]); st[nm] = { m: mean(v), s: sd(v) }; }
    return (r) => list.reduce((a, { nm, sign }) => a + sign * ((r.f[nm] - st[nm].m) / st[nm].s), 0) / list.length;
  };
  const scoreAll = mk(eligible);
  const scoreKeep = mk(keep);
  const bestSingle = Math.max(...eligible.map((s) => Math.abs(spearman(OOS.map((r) => s.sign * r.f[s.nm]), OOS.map((r) => r.fwdDm)))));

  console.log("\n=== STEP 4: does deduplication fix the composite? ===");
  console.log(`  best single indicator          IC ${bestSingle.toFixed(4)}`);
  console.log(`  composite, all ${String(eligible.length).padStart(2)} eligible      IC ${spearman(OOS.map(scoreAll), OOS.map((r) => r.fwdDm)).toFixed(4)}`);
  console.log(`  composite, ${String(keep.length).padStart(2)} decorrelated    IC ${spearman(OOS.map(scoreKeep), OOS.map((r) => r.fwdDm)).toFixed(4)}`);

  // ---- step 5: tradable, directional vs dollar-neutral -------------------
  const stamps = [...new Set(OOS.map((r) => r.t))].sort((a, b) => a - b);
  const byT = new Map();
  for (const r of OOS) { if (!byT.has(r.t)) byT.set(r.t, []); byT.get(r.t).push(r); }

  for (const [label, scoreFn] of [["ALL ELIGIBLE", scoreAll], ["DECORRELATED", scoreKeep]]) {
    console.log(`\n=== STEP 5 (${label}): portfolio, directional vs dollar-neutral ===`);
    console.log("   t   |  directional: ret%/yr  vol%  Sharpe    t   |  neutral: ret%/yr  vol%  Sharpe    t");
    for (const th of [0.2, 0.3, 0.4, 0.5]) {
      const dir = [], neu = [];
      for (let k = 0; k < stamps.length; k += HOLD) {
        const L = [], S = [];
        for (const r of (byT.get(stamps[k]) || [])) {
          const s = scoreFn(r);
          if (s > th) L.push(r.fwd * 100 - COST_PCT);
          else if (s < -th) S.push(-r.fwd * 100 - COST_PCT);
        }
        if (L.length + S.length >= 3) dir.push(mean([...L, ...S]));
        // dollar neutral: equal weight to each side, so no residual market tilt
        if (L.length >= 2 && S.length >= 2) neu.push(0.5 * mean(L) + 0.5 * mean(S));
      }
      const stat = (a) => {
        if (a.length < 20) return null;
        const m = mean(a), s = sd(a);
        return { ann: m * 365, vol: s * Math.sqrt(365), sh: (m * 365) / (s * Math.sqrt(365)), t: m / (s / Math.sqrt(a.length)), n: a.length };
      };
      const d = stat(dir), nu = stat(neu);
      if (!d) continue;
      const fmt = (x) => x ? `${x.ann.toFixed(1).padStart(8)}${x.vol.toFixed(1).padStart(7)}${x.sh.toFixed(2).padStart(8)}${x.t.toFixed(2).padStart(7)}` : "        -      -       -      -";
      console.log(`${th.toFixed(1).padStart(5)} |${fmt(d)}   |${fmt(nu)}${nu && nu.t > 1.96 ? "  <- significant" : ""}`);
    }
  }
  console.log(`\ncost ${COST_PCT}% round trip, forward returns symbol-demeaned, non-overlapping periods.`);
}

main();
