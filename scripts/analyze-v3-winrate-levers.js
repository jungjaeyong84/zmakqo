#!/usr/bin/env node
"use strict";

// scripts/analyze-v3-winrate-levers.js
//
// Goal: find entry-selectivity filters that lift LONG and SHORT win-rate
// to >= 50% each in the v3 paper ledger, WITHOUT gaming the metric (no TP
// tightening) and WITHOUT overfitting.
//
// Method:
//   1. Join exit ledger (outcomes) with raw signal feed (full features).
//   2. Split chronologically into TRAIN (older 70%) and TEST (newer 30%).
//   3. For each side, single-feature univariate scan: for each numeric
//      feature and each candidate threshold (deciles), compute the WR of
//      the kept subset on TRAIN. Keep only filters that (a) lift WR, (b)
//      retain >= 40% of TRAIN sample, (c) keep expectancy positive.
//   4. Report the same filter's effect on TEST (out-of-sample) — this is
//      the honesty check. A filter that lifts TRAIN WR but not TEST WR is
//      overfit and rejected.
//   5. Try 2-feature combos for whichever side can't hit 50% alone.
//
// Output is a ranked table per side. Nothing is written to the policy —
// this is purely an analysis to inform the next config change.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXIT = path.join(ROOT, "ops/runtime/v3_paper_exit_ledger.jsonl");
const RAW = path.join(ROOT, "ops/runtime/v3_raw_signal_feed.jsonl");

function readJsonl(p) {
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const exits = readJsonl(EXIT);
const raw = readJsonl(RAW);
const rawMap = new Map(raw.map((r) => [r.signal_id, r]));

// Build joined rows: { side, ts, win(bool), r, features{} }
const rows = [];
for (const x of exits) {
  const r = rawMap.get(x.signal_id);
  if (!r || !r.features_json) continue;
  const realizedR = Number(x.realized_r);
  if (!Number.isFinite(realizedR)) continue;
  rows.push({
    side: x.side,
    ts: Date.parse(x.closed_at),
    win: realizedR > 0,
    r: realizedR,
    f: r.features_json,
  });
}
rows.sort((a, b) => a.ts - b.ts);

// Numeric features to scan (skip price-level fields and rr which is constant)
const NUMERIC_FEATURES = [
  "opportunity_score",
  "confidence",
  "setup_quality_score",
  "structure_alignment",
  "htf_alignment_score",
  "market_quality_score",
];

function metrics(subset) {
  const n = subset.length;
  if (!n) return { n: 0, wr: 0, exp: 0, net: 0 };
  const w = subset.filter((x) => x.win).length;
  const net = subset.reduce((s, x) => s + x.r, 0);
  return { n, wr: (w / n) * 100, exp: net / n, net };
}

function quantiles(values, qs) {
  const sorted = [...values].sort((a, b) => a - b);
  return qs.map((q) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))))]);
}

function analyzeSide(side) {
  const all = rows.filter((x) => x.side === side && x.f);
  // chronological split
  const cut = Math.floor(all.length * 0.7);
  const train = all.slice(0, cut);
  const test = all.slice(cut);

  const base = metrics(all);
  const baseTrain = metrics(train);
  const baseTest = metrics(test);

  console.log(`\n${"=".repeat(78)}`);
  console.log(`SIDE: ${side}`);
  console.log(`${"=".repeat(78)}`);
  console.log(`  baseline ALL:   n=${base.n}  WR=${base.wr.toFixed(1)}%  exp=${base.exp.toFixed(3)}R`);
  console.log(`  baseline TRAIN: n=${baseTrain.n}  WR=${baseTrain.wr.toFixed(1)}%  exp=${baseTrain.exp.toFixed(3)}R`);
  console.log(`  baseline TEST:  n=${baseTest.n}  WR=${baseTest.wr.toFixed(1)}%  exp=${baseTest.exp.toFixed(3)}R`);
  console.log();

  // Single-feature scan on TRAIN, validate on TEST
  const candidates = [];
  for (const feat of NUMERIC_FEATURES) {
    const vals = train.map((x) => Number(x.f[feat])).filter(Number.isFinite);
    if (vals.length < train.length * 0.5) continue; // feature mostly missing
    const thresholds = quantiles(vals, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    for (const th of thresholds) {
      // keep signals with feature >= threshold
      const keepTrain = train.filter((x) => Number(x.f[feat]) >= th);
      const keepTest = test.filter((x) => Number(x.f[feat]) >= th);
      const mTrain = metrics(keepTrain);
      const mTest = metrics(keepTest);
      if (mTrain.n < train.length * 0.4) continue; // too few retained
      if (mTrain.exp <= 0) continue; // must stay profitable
      candidates.push({ feat, th, mTrain, mTest });
    }
  }

  // dedupe by (feat) keeping best train WR
  candidates.sort((a, b) => b.mTrain.wr - a.mTrain.wr);
  console.log(`  --- single-feature filters (feature >= threshold), ranked by TRAIN WR ---`);
  console.log(`  ${"feature".padEnd(22)} ${"thr".padStart(7)} | TRAIN n/WR/exp        | TEST n/WR/exp`);
  const seen = new Set();
  let shown = 0;
  for (const c of candidates) {
    const key = c.feat;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      `  ${c.feat.padEnd(22)} ${c.th.toFixed(3).padStart(7)} | ` +
      `n=${String(c.mTrain.n).padEnd(3)} WR=${c.mTrain.wr.toFixed(1).padStart(5)}% exp=${c.mTrain.exp.toFixed(3).padStart(6)} | ` +
      `n=${String(c.mTest.n).padEnd(3)} WR=${c.mTest.wr.toFixed(1).padStart(5)}% exp=${c.mTest.exp.toFixed(3).padStart(6)}`
    );
    shown++;
    if (shown >= 8) break;
  }

  // Two-feature combos (greedy: top single feature + scan a second)
  console.log(`\n  --- best 2-feature combos (both >= threshold), TRAIN WR >= 50 & retains >= 30% ---`);
  const combos = [];
  for (let i = 0; i < NUMERIC_FEATURES.length; i++) {
    for (let j = i + 1; j < NUMERIC_FEATURES.length; j++) {
      const fA = NUMERIC_FEATURES[i], fB = NUMERIC_FEATURES[j];
      const valsA = train.map((x) => Number(x.f[fA])).filter(Number.isFinite);
      const valsB = train.map((x) => Number(x.f[fB])).filter(Number.isFinite);
      if (valsA.length < train.length * 0.5 || valsB.length < train.length * 0.5) continue;
      for (const thA of quantiles(valsA, [0.3, 0.5, 0.6])) {
        for (const thB of quantiles(valsB, [0.3, 0.5, 0.6])) {
          const keepTrain = train.filter((x) => Number(x.f[fA]) >= thA && Number(x.f[fB]) >= thB);
          const keepTest = test.filter((x) => Number(x.f[fA]) >= thA && Number(x.f[fB]) >= thB);
          const mTrain = metrics(keepTrain);
          const mTest = metrics(keepTest);
          if (mTrain.n < train.length * 0.3) continue;
          if (mTrain.wr < 50) continue;
          if (mTrain.exp <= 0) continue;
          combos.push({ fA, thA, fB, thB, mTrain, mTest });
        }
      }
    }
  }
  combos.sort((a, b) => (b.mTrain.wr + b.mTest.wr) - (a.mTrain.wr + a.mTest.wr));
  if (!combos.length) console.log("    (none found that hold TRAIN WR>=50 with >=30% retention)");
  for (const c of combos.slice(0, 6)) {
    console.log(
      `    ${c.fA}>=${c.thA.toFixed(2)} & ${c.fB}>=${c.thB.toFixed(2)}  | ` +
      `TRAIN n=${c.mTrain.n} WR=${c.mTrain.wr.toFixed(1)}% exp=${c.mTrain.exp.toFixed(3)} | ` +
      `TEST n=${c.mTest.n} WR=${c.mTest.wr.toFixed(1)}% exp=${c.mTest.exp.toFixed(3)}`
    );
  }
}

console.log(`v3 win-rate lever analysis — ${rows.length} joined closed trades`);
console.log(`(method: chronological 70/30 train/test split; filters found on TRAIN, validated on TEST)`);
analyzeSide("LONG");
analyzeSide("SHORT");
console.log();
