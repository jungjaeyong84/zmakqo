#!/usr/bin/env node
"use strict";

// scripts/optimize-v6-confluence.js (2026-08-08)
//
// Re-derive the v1 boolean-confluence engine from data instead of inheriting
// its hand-set constants, then lock one configuration and hand it to a paper
// lane.
//
// v1's architecture earned this. Its score carried |IC| 0.073 out of sample —
// the largest number this project has produced — while every linear z-score
// composite tried today sat near zero. Boolean confluence sees non-linearities
// (k<80, "volume AND bias", "bull 70% of 15 bars") that rank correlation on
// raw values cannot. What v1 did NOT have right, in this sample, is the sign
// and the constants.
//
// OVERFITTING IS THE ENTIRE RISK HERE and the design fights it structurally
// rather than by hoping:
//
//   - WEIGHTS ARE NOT SEARCHED. Each component's weight comes from its own
//     in-sample IC. A grid over six weights would be ~10^6 configurations and
//     would find something magnificent and fake. Deriving them costs zero
//     degrees of freedom beyond the ICs already being measured.
//   - SIGN IS DERIVED, not chosen. Whatever the in-sample IC says.
//   - ONLY threshold x hold is searched: 5 x 6 = 30 cells. Expected false
//     positives at 5% is 1.5, which is reported, not hidden.
//   - OUT-OF-SAMPLE IS READ ONCE, after the config is locked. No iterating on
//     it. If the locked cell disappoints, that is the answer.
//   - Judged at PORTFOLIO level, non-overlapping. Per-bar observations
//     inflated a t-stat 11-104x earlier today and flipped its sign.
//
// Entry is EVENT-based (threshold crossing plus cooldown), not state-based.
// State entry re-enters the same setup on every bar it persists, which
// measured persistence rather than signal and was wrong by t = 2.0.

const fs = require("fs");
const path = require("path");
const v1 = require("./analyze-v1-confluence.js");

const CACHE = process.env.V1_CACHE || path.join(process.env.TMPDIR || "/tmp", "v1_1h.json");
const OUT = path.join(__dirname, "..", "config", "v6_confluence_config.json");
const COST_PCT = 0.14;
const THRESHOLDS = [15, 25, 35, 45, 55];
const HOLDS = [6, 12, 24, 48, 72, 120];      // hours

const { buildStates, spearman, mean, sd } = v1;

// The six votes, kept as SEPARATE signed components so each can be weighted
// independently. +1 bullish, -1 bearish, 0 abstain — the abstention is the
// part a z-score cannot express.
function componentVotes(bars, st, i) {
  const b = bars[i];
  const bullTrend = st.trendState[i] === "bull";
  const bearTrend = st.trendState[i] === "bear";
  const volRatio = st.volMa[i] ? b.v / st.volMa[i] : 1;
  const volAny = volRatio >= 1.5;
  const regimeTrend = st.adx[i] > 25;
  return {
    trend: bullTrend ? 1 : bearTrend ? -1 : 0,
    htf: st.htfState[i] === "bull" ? 1 : st.htfState[i] === "bear" ? -1 : 0,
    td: st.tdState[i] === "buy" ? 1 : st.tdState[i] === "sell" ? -1 : 0,
    stoch: (st.kArr[i] > st.dArr[i] && st.kArr[i] < 80) ? 1
      : (st.kArr[i] < st.dArr[i] && st.kArr[i] > 20) ? -1 : 0,
    vol: !volAny ? 0 : (b.c >= st.bwMid[i] || bullTrend) ? 1 : (b.c <= st.bwMid[i] || bearTrend) ? -1 : 0,
    regime: !regimeTrend ? 0 : st.pDI[i] >= st.mDI[i] ? 1 : -1,
  };
}

const NAMES = ["trend", "htf", "td", "stoch", "vol", "regime"];

function load() {
  const store = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const rows = [];
  for (const [sym, bars] of Object.entries(store)) {
    if (!Array.isArray(bars) || bars.length < 500) continue;
    const st = buildStates(bars);
    for (let i = 120; i < bars.length - Math.max(...HOLDS); i += 1) {
      const v = componentVotes(bars, st, i);
      if (!NAMES.every((n) => Number.isFinite(v[n]))) continue;
      const fwd = {};
      for (const h of HOLDS) fwd[h] = bars[i + h].c / bars[i].c - 1;
      rows.push({ sym, t: bars[i].t, v, fwd });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

function portfolioStat(picks, hold) {
  // one observation per non-overlapping period
  const bucket = new Map();
  const span = hold * 3600e3;
  for (const p of picks) {
    const k = Math.floor(p.t / span);
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(p.pnl);
  }
  const port = [...bucket.values()].filter((g) => g.length >= 2).map(mean);
  if (port.length < 20) return null;
  const m = mean(port), s = sd(port);
  const periodsPerYear = (365 * 24) / hold;
  return {
    n: port.length,
    net: m,
    t: m / (s / Math.sqrt(port.length)),
    ann: m * periodsPerYear,
    vol: s * Math.sqrt(periodsPerYear),
    sharpe: (m * periodsPerYear) / (s * Math.sqrt(periodsPerYear) || 1e-9),
  };
}

function runConfig(rows, weights, thr, hold) {
  const bySym = new Map();
  for (const r of rows) { if (!bySym.has(r.sym)) bySym.set(r.sym, []); bySym.get(r.sym).push(r); }
  const picks = [];
  for (const [, list] of bySym) {
    let prev = 0, cooldown = -Infinity;
    for (const r of list) {
      let sc = 0, tw = 0;
      for (const n of NAMES) { sc += weights[n] * r.v[n]; tw += Math.abs(weights[n]); }
      sc = tw ? (sc / tw) * 100 : 0;
      let dir = 0;
      if (r.t > cooldown) {
        if (prev < thr && sc >= thr) dir = 1;
        else if (prev > -thr && sc <= -thr) dir = -1;
      }
      prev = sc;
      if (dir) {
        cooldown = r.t + hold * 3600e3;
        picks.push({ t: r.t, dir, pnl: dir * r.fwd[hold] * 100 - COST_PCT });
      }
    }
  }
  return picks;
}

function main() {
  const rows = load();
  const half = Math.floor(rows.length / 2);
  const IS = rows.slice(0, half), OOS = rows.slice(half);
  console.log(`observations ${rows.length}, symbols ${new Set(rows.map((r) => r.sym)).size}`);
  console.log(`in-sample  ${new Date(IS[0].t).toISOString().slice(0, 10)} ~ ${new Date(IS[IS.length - 1].t).toISOString().slice(0, 10)}`);
  console.log(`out-sample ${new Date(OOS[0].t).toISOString().slice(0, 10)} ~ ${new Date(OOS[OOS.length - 1].t).toISOString().slice(0, 10)}\n`);

  // ---- weights derived from in-sample component IC, at the 24h horizon ----
  console.log("=== STEP 1: weight each component by its OWN in-sample IC (no search) ===");
  console.log("component     IC(in,24h)   weight   note");
  const weights = {};
  for (const n of NAMES) {
    const ic = spearman(IS.map((r) => r.v[n]), IS.map((r) => r.fwd[24]));
    weights[n] = ic;   // signed: magnitude = conviction, sign = direction
    console.log(`  ${n.padEnd(10)}${ic.toFixed(4).padStart(11)}${ic.toFixed(3).padStart(9)}   ${Math.abs(ic) < 0.005 ? "near-zero, contributes little" : ic < 0 ? "INVERTED vs v1" : "same as v1"}`);
  }

  // ---- search threshold x hold, IN-SAMPLE ONLY ---------------------------
  console.log(`\n=== STEP 2: search ${THRESHOLDS.length}x${HOLDS.length} = ${THRESHOLDS.length * HOLDS.length} cells, IN-SAMPLE ONLY ===`);
  console.log("thr  hold   trades   net%/trade   port t   ann%    Sharpe");
  let best = null;
  for (const thr of THRESHOLDS) {
    for (const hold of HOLDS) {
      const st = portfolioStat(runConfig(IS, weights, thr, hold), hold);
      if (!st) continue;
      console.log(
        String(thr).padStart(3) + String(hold).padStart(6) + String(st.n).padStart(9) +
        st.net.toFixed(4).padStart(13) + st.t.toFixed(2).padStart(9) +
        st.ann.toFixed(1).padStart(8) + st.sharpe.toFixed(2).padStart(9)
      );
      if (!best || st.sharpe > best.st.sharpe) best = { thr, hold, st };
    }
  }
  if (!best) { console.log("no viable cell"); return; }

  console.log(`\n=== STEP 3: LOCKED — thr ${best.thr}, hold ${best.hold}h ===`);
  console.log(`  in-sample: ${best.st.ann.toFixed(1)}%/yr, Sharpe ${best.st.sharpe.toFixed(2)}, t ${best.st.t.toFixed(2)}`);
  console.log(`  expected false positives across ${THRESHOLDS.length * HOLDS.length} cells at 5%: ${(THRESHOLDS.length * HOLDS.length * 0.05).toFixed(1)}`);

  // ---- ONE look at out-of-sample -----------------------------------------
  const oos = portfolioStat(runConfig(OOS, weights, best.thr, best.hold), best.hold);
  console.log("\n=== STEP 4: OUT-OF-SAMPLE, read once ===");
  if (!oos) { console.log("  insufficient out-of-sample periods"); return; }
  console.log(`  periods ${oos.n}`);
  console.log(`  net ${oos.net.toFixed(4)}%/trade   annualised ${oos.ann.toFixed(1)}%   vol ${oos.vol.toFixed(1)}%`);
  console.log(`  Sharpe ${oos.sharpe.toFixed(2)}   t ${oos.t.toFixed(2)}   ${oos.t > 1.96 ? "SIGNIFICANT" : "not significant"}`);
  const decay = best.st.sharpe ? oos.sharpe / best.st.sharpe : 0;
  console.log(`  Sharpe retention in-sample -> out-of-sample: ${(decay * 100).toFixed(0)}%`);
  console.log(`  ${decay < 0.3 ? "-> heavy decay. The in-sample number was mostly fit." : decay < 0.7 ? "-> partial decay, normal for a real but noisy edge." : "-> holds up."}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "optimize-v6-confluence.js",
    architecture: "v1 boolean confluence, weights re-derived from in-sample IC",
    weights,
    threshold: best.thr,
    hold_hours: best.hold,
    cost_pct: COST_PCT,
    entry: "event (threshold crossing) + cooldown = hold",
    in_sample: { ann_pct: best.st.ann, sharpe: best.st.sharpe, t: best.st.t, periods: best.st.n },
    out_of_sample: { ann_pct: oos.ann, sharpe: oos.sharpe, t: oos.t, periods: oos.n, vol_pct: oos.vol },
    cells_searched: THRESHOLDS.length * HOLDS.length,
    expected_false_positives: THRESHOLDS.length * HOLDS.length * 0.05,
  }, null, 2));
  console.log(`\nconfig written: ${path.relative(process.cwd(), OUT)}`);
}

main();
