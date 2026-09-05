#!/usr/bin/env node
"use strict";

// scripts/diagnose-v7-signal-vs-book.js (2026-09-05)
//
// v7 went from t = +1.00 at 80 periods to t = -0.21 at 116. The question that
// decides whether anything is fixable is one this project had not asked: did
// the SIGNAL die, or did the BOOK fail to convert a signal that is still there?
//
// They look identical from the equity curve and call for opposite responses.
//
// Measured on the banked v5 ledger (60 days) by splitting at the live start:
//
//   whale_vs_retail cross-sectional IC
//     backtest window   -0.0497   t -3.00
//     LIVE window       -0.0193   t -0.80    <- same sign, weaker
//     full 60 days      -0.0418   t -3.04    <- stronger than the original -0.0345
//
// The signal held its sign through the period the book lost money in. That is
// a different failure from v3 and v6, where the IC itself vanished.
//
// Reconstructing the book confirms there is no implementation bug: the same
// settings the lane runs (k=6, rebalance every stamp) reproduce the live
// result — -1.36% computed against -1.13% actually booked.
//
// TWO UPGRADES WERE THEN TESTED AND BOTH REJECTED.
//
// 1. Grid over k x rebalance period (16 cells). Best cell in the live window
//    reached t = +0.66. The same 16-cell search run against SHUFFLED signal
//    reaches a median max-t of +1.29 and a 95th percentile of +2.01. Picking
//    the best of sixteen produces a better number from noise than the real
//    data gave, so the cell is search luck and was not adopted.
//
// 2. Rank-proportional weighting over the whole cross-section instead of
//    top-k/bottom-k. This is a structural change rather than a parameter, so it
//    carries almost no multiple-testing cost — but it is simply worse:
//    -1.63% against -1.36% live, +5.25% against +6.57% over 60 days.
//
// A NOTE ON THE NULL, because it is easy to misread. Shuffling the signal
// leaves turnover cost in place, so shuffled books lose systematically and
// their t sits near -2.4. "Beating the null" here therefore only means "better
// than random selection paying the same costs" — it does not mean profitable.
// A test whose null is negative cannot certify an edge.
//
// CONCLUSION: no upgrade survives testing on 94 live periods. That is not the
// same as "no upgrade exists" — the search noise is simply larger than the
// effect at this sample size. What v7 needs is data, not ideas.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "ops/runtime/v5_flow_history.jsonl");
const LIVE_START = Date.parse("2026-08-16T16:00:00.000Z");
const COST_PER_TURNOVER_PCT = 0.07;

function loadFlow() {
  const m = new Map();
  for (const line of fs.readFileSync(FLOW, "utf8").split("\n")) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const k = `${r.symbol}|${r.ts}`;
    const cur = m.get(k) || { symbol: r.symbol, ts: r.ts };
    for (const [f, v] of Object.entries(r)) if (!["key", "symbol", "ts"].includes(f)) cur[f] = v;
    m.set(k, cur);
  }
  return m;
}

async function fetchCloses(sym) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=500`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  return new Map(rows.map((r) => [Number(r[0]), Number(r[4])]));
}

const spread = (r) => (r && Number.isFinite(r.top_ratio) && Number.isFinite(r.retail_ratio)
  ? r.top_ratio - r.retail_ratio : null);

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 0; };
const tstat = (a) => (a.length > 9 && sd(a) ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0);

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 8) return null;
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n);
    idx.forEach(([, i], j) => { r[i] = j + 1; });
    return r;
  };
  const rx = rank(xs), ry = rank(ys), m = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) { const a = rx[i] - m, b = ry[i] - m; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

async function main() {
  const flow = loadFlow();
  const syms = [...new Set([...flow.values()].map((r) => r.symbol))].sort();
  const stamps = [...new Set([...flow.values()].map((r) => r.ts))].sort((a, b) => a - b);

  const closes = new Map();
  for (const s of syms) {
    try { closes.set(s, await fetchCloses(s)); await new Promise((r) => setTimeout(r, 80)); }
    catch (_) { /* one symbol short is tolerable for a diagnostic */ }
  }

  const pre = stamps.filter((t) => t < LIVE_START);
  const post = stamps.filter((t) => t >= LIVE_START);

  const icOver = (seg) => {
    const ics = [];
    for (let i = 0; i < seg.length - 1; i += 1) {
      const xs = [], ys = [];
      for (const s of syms) {
        const sp = spread(flow.get(`${s}|${seg[i]}`));
        const p0 = closes.get(s)?.get(seg[i]), p1 = closes.get(s)?.get(seg[i + 1]);
        if (sp === null || !p0 || !p1) continue;
        xs.push(sp); ys.push(p1 / p0 - 1);
      }
      const ic = spearman(xs, ys);
      if (ic !== null) ics.push(ic);
    }
    return { n: ics.length, ic: mean(ics), t: tstat(ics) };
  };

  console.log("=== Is the SIGNAL dead, or is the BOOK failing? ===");
  console.log("whale_vs_retail, cross-sectional IC per period\n");
  for (const [label, seg] of [["backtest window", pre], ["LIVE window", post], ["full 60 days", stamps]]) {
    const r = icOver(seg);
    console.log(`  ${label.padEnd(18)} n=${String(r.n).padStart(3)}  IC ${r.ic.toFixed(4)}  t ${r.t.toFixed(2)}`);
  }
  console.log("\n  The sign holds through the window the book lost money in.");
  console.log("  That is a book problem, not a dead signal — v3 and v6 lost the IC itself.");
}

main().catch((e) => { console.error(e); process.exit(1); });
