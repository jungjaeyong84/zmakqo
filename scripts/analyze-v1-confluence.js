#!/usr/bin/env node
"use strict";

// scripts/analyze-v1-confluence.js (2026-08-08)
//
// A faithful port of the v1 composite score engine from
// code/donbeolja_v5.5.9.1.pine.txt, tested with the methodology this project
// arrived at the hard way. Spec and Pine line references live in
// docs/V1_COMPOSITE_SCORE_SPEC.md.
//
// WHY THIS IS NOT A REPEAT OF TODAY'S OTHER STUDIES. Those z-scored raw
// indicator values and averaged them. v1 does something structurally
// different: six BOOLEAN conditions cast weighted votes, and several of those
// conditions are non-linear in the underlying indicator.
//
//   k < 80          non-monotonic in k — linear rank correlation reads noise
//   volume AND bias a conjunction that dissolves if you z-score each part
//   70% of 15 bars  persistence, which no spot value carries
//   RSI dead band   the vote ABSTAINS between 45 and 55; a z-score never does
//
// So a null result from the earlier work says nothing about this one. That is
// the entire reason for porting it rather than arguing from the previous
// conclusion.
//
// PARAMETERS are the Pine input defaults, not fitted here:
//   trend  EMA21 vs EMA55 on HL3, bull for >=70% of the last 15 bars
//   htf    RSI14 on the higher timeframe, bull >=55 / bear <=45
//   td     TD Sequential on close vs close[4]
//   stoch  k = SMA(stoch14, 3), d = SMA(k, 3); bull = k > d and k < 80
//   vol    volume / SMA(volume,20); ultra >=2.25, strong >=1.5
//          bias = close >= EMA(HL3,14) or bull_trend
//   regime ADX14; trend > 25, range < 20; bull = trend and +DI >= -DI
//   weights 1.0 / 1.0 / 0.7 / 0.7 / 0.8 / 0.7  (total 4.9)
//
// Execution timeframe 1H with a 4H higher timeframe, which is the coin setup
// the Pine input labels recommend.
//
// WHAT IS NOT PORTED, stated so the result is not oversold: posterior, wave,
// EV filters, percentile-rank gates, session and Breakwater score decay, and
// the 15m confirmation gate. Those are additional FILTERS on top of the score.
// This measures the score itself — if the core confluence carries nothing,
// filters on top of it cannot create something.

const fs = require("fs");
const path = require("path");

const CACHE = process.env.V1_CACHE || path.join(process.env.TMPDIR || "/tmp", "v1_1h.json");
const HTF_BARS = 4;          // 4h higher timeframe out of 1h execution bars
const HOLD = 24;             // 24 x 1h = 1 day
const COST_PCT = 0.14;

const W = { trend: 1.0, htf: 1.0, td: 0.7, stoch: 0.7, vol: 0.8, regime: 0.7 };
const TOTAL_W = Object.values(W).reduce((a, b) => a + b, 0);

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1e-9; };

function ema(vals, n) {
  const k = 2 / (n + 1), out = new Array(vals.length).fill(null);
  let prev = null;
  for (let i = 0; i < vals.length; i += 1) {
    prev = prev === null ? vals[i] : vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function sma(vals, n) {
  const out = new Array(vals.length).fill(null);
  let s = 0;
  for (let i = 0; i < vals.length; i += 1) {
    s += vals[i];
    if (i >= n) s -= vals[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function rma(vals, n) {
  const out = new Array(vals.length).fill(null);
  let prev = null;
  for (let i = 0; i < vals.length; i += 1) {
    const v = Number.isFinite(vals[i]) ? vals[i] : 0;
    prev = prev === null ? v : (prev * (n - 1) + v) / n;
    out[i] = prev;
  }
  return out;
}

function buildStates(bars) {
  const n = bars.length;
  const hl3 = bars.map((b) => (b.h + b.l + b.c) / 3);
  const close = bars.map((b) => b.c);

  // --- trend: EMA21 vs EMA55 on HL3, sustained 70% of last 15 bars --------
  const f = ema(hl3, 21), s = ema(hl3, 55);
  const bull = close.map((_, i) => f[i] > s[i]);
  const bear = close.map((_, i) => f[i] < s[i]);
  const trendState = new Array(n).fill("neutral");
  for (let i = 15; i < n; i += 1) {
    let up = 0, dn = 0;
    for (let k = i - 14; k <= i; k += 1) { if (bull[k]) up += 1; if (bear[k]) dn += 1; }
    if (up >= 15 * 0.7) trendState[i] = "bull";
    else if (dn >= 15 * 0.7) trendState[i] = "bear";
  }

  // --- htf: RSI14 on 4h bars aggregated from 1h, then broadcast back ------
  // Only CLOSED higher-timeframe bars are visible, matching Pine's
  // lookahead_off. Bar i sees the last 4h bar that finished at or before i.
  const htfClose = [], htfEndIdx = [];
  for (let i = HTF_BARS - 1; i < n; i += HTF_BARS) { htfClose.push(close[i]); htfEndIdx.push(i); }
  const htfRsi = [];
  {
    let g = 0, l = 0;
    for (let i = 1; i < htfClose.length; i += 1) {
      const ch = htfClose[i] - htfClose[i - 1];
      const up = Math.max(ch, 0), dn = Math.max(-ch, 0);
      if (i <= 14) { g += up / 14; l += dn / 14; htfRsi[i] = i === 14 ? 100 - 100 / (1 + g / (l || 1e-9)) : null; }
      else { g = (g * 13 + up) / 14; l = (l * 13 + dn) / 14; htfRsi[i] = 100 - 100 / (1 + g / (l || 1e-9)); }
    }
  }
  const htfState = new Array(n).fill("neutral");
  for (let h = 0; h < htfEndIdx.length; h += 1) {
    const r = htfRsi[h];
    if (r == null) continue;
    const from = htfEndIdx[h] + 1;                       // visible only AFTER it closes
    const to = h + 1 < htfEndIdx.length ? htfEndIdx[h + 1] : n - 1;
    const st = r >= 55 ? "bull" : r <= 45 ? "bear" : "neutral";
    for (let i = from; i <= to && i < n; i += 1) htfState[i] = st;
  }

  // --- td: TD Sequential on close vs close[4] -----------------------------
  const tdState = new Array(n).fill("none");
  let tdBuy = 0, tdSell = 0;
  for (let i = 4; i < n; i += 1) {
    tdBuy = close[i] > close[i - 4] ? tdBuy + 1 : 0;
    tdSell = close[i] < close[i - 4] ? tdSell + 1 : 0;
    tdState[i] = tdBuy > 0 && tdSell === 0 ? "buy" : tdSell > 0 && tdBuy === 0 ? "sell" : "none";
  }

  // --- stoch: k = SMA(stoch14,3), d = SMA(k,3) ----------------------------
  const rawK = new Array(n).fill(null);
  for (let i = 13; i < n; i += 1) {
    let hh = -Infinity, ll = Infinity;
    for (let k = i - 13; k <= i; k += 1) { hh = Math.max(hh, bars[k].h); ll = Math.min(ll, bars[k].l); }
    rawK[i] = (close[i] - ll) / ((hh - ll) || 1e-9) * 100;
  }
  const kArr = sma(rawK.map((v) => (v === null ? 0 : v)), 3);
  const dArr = sma(kArr.map((v) => (v === null ? 0 : v)), 3);

  // --- vol ----------------------------------------------------------------
  const volMa = sma(bars.map((b) => b.v), 20);
  const bwMid = ema(hl3, 14);

  // --- regime: Wilder ADX/DMI 14 ------------------------------------------
  const tr = new Array(n).fill(0), pDM = new Array(n).fill(0), mDM = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - close[i - 1]), Math.abs(bars[i].l - close[i - 1]));
    const up = bars[i].h - bars[i - 1].h, dn = bars[i - 1].l - bars[i].l;
    pDM[i] = up > 0 && up > dn ? up : 0;
    mDM[i] = dn > 0 && dn > up ? dn : 0;
  }
  const trE = rma(tr, 14), pE = rma(pDM, 14), mE = rma(mDM, 14);
  const pDI = [], mDI = [], dx = [];
  for (let i = 0; i < n; i += 1) {
    pDI[i] = trE[i] ? pE[i] / trE[i] * 100 : 0;
    mDI[i] = trE[i] ? mE[i] / trE[i] * 100 : 0;
    dx[i] = (pDI[i] + mDI[i]) ? Math.abs(pDI[i] - mDI[i]) / (pDI[i] + mDI[i]) * 100 : 0;
  }
  const adx = rma(dx, 14);

  return { close, trendState, htfState, tdState, kArr, dArr, volMa, bwMid, pDI, mDI, adx, bullTrendRaw: bull };
}

// The six votes, long and short exactly mirrored.
function scoreAt(bars, st, i) {
  const b = bars[i];
  const bullTrend = st.trendState[i] === "bull";
  const bearTrend = st.trendState[i] === "bear";

  const volRatio = st.volMa[i] ? b.v / st.volMa[i] : 1;
  const volUltra = volRatio >= 2.25;
  const volStrong = !volUltra && volRatio >= 1.5;
  const volAny = volUltra || volStrong;
  const bullBias = b.c >= st.bwMid[i] || bullTrend;
  const bearBias = b.c <= st.bwMid[i] || bearTrend;

  const regimeTrend = st.adx[i] > 25;

  const L =
    (bullTrend ? W.trend : 0)
    + (st.htfState[i] === "bull" ? W.htf : 0)
    + (st.tdState[i] === "buy" ? W.td : 0)
    + (st.kArr[i] > st.dArr[i] && st.kArr[i] < 80 ? W.stoch : 0)
    + (volAny && bullBias ? W.vol : 0)
    + (regimeTrend && st.pDI[i] >= st.mDI[i] ? W.regime : 0);

  const S =
    (bearTrend ? W.trend : 0)
    + (st.htfState[i] === "bear" ? W.htf : 0)
    + (st.tdState[i] === "sell" ? W.td : 0)
    + (st.kArr[i] < st.dArr[i] && st.kArr[i] > 20 ? W.stoch : 0)
    + (volAny && bearBias ? W.vol : 0)
    + (regimeTrend && st.mDI[i] >= st.pDI[i] ? W.regime : 0);

  return (L / TOTAL_W) * 100 - (S / TOTAL_W) * 100;
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 30) return null;
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
  const rx = rank(xs), ry = rank(ys), m = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) { const a = rx[i] - m, b = ry[i] - m; num += a * b; dx += a * a; dy += b * b; }
  return num / (Math.sqrt(dx * dy) || 1e-12);
}

function main() {
  const store = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const rowsBySym = {};
  for (const [sym, bars] of Object.entries(store)) {
    if (!Array.isArray(bars) || bars.length < 400) continue;
    const st = buildStates(bars);
    const rows = [];
    for (let i = 120; i < bars.length - HOLD; i += 1) {
      const sc = scoreAt(bars, st, i);
      if (!Number.isFinite(sc)) continue;
      rows.push({ t: bars[i].t, score: sc, fwd: bars[i + HOLD].c / bars[i].c - 1 });
    }
    if (rows.length > 300) rowsBySym[sym] = rows;
  }

  const fwdMean = {};
  for (const [s, r] of Object.entries(rowsBySym)) fwdMean[s] = mean(r.map((x) => x.fwd));
  const all = [];
  for (const [s, r] of Object.entries(rowsBySym)) {
    for (const x of r) all.push({ sym: s, t: x.t, score: x.score, fwd: x.fwd, fwdDm: x.fwd - fwdMean[s] });
  }
  all.sort((a, b) => a.t - b.t);

  // cross-sectional demeaning per timestamp: what a market-neutral book gets
  const byT = new Map();
  for (const r of all) { if (!byT.has(r.t)) byT.set(r.t, []); byT.get(r.t).push(r); }
  for (const [, g] of byT) { const m = mean(g.map((x) => x.fwd)); for (const x of g) x.fwdXs = x.fwd - m; }

  const half = Math.floor(all.length / 2);
  const IS = all.slice(0, half), OOS = all.slice(half);
  console.log(`symbols ${Object.keys(rowsBySym).length}, observations ${all.length}, 1h exec / 4h HTF, hold ${HOLD} (1d)`);
  console.log(`in-sample  ${new Date(IS[0].t).toISOString().slice(0, 10)} ~ ${new Date(IS[IS.length - 1].t).toISOString().slice(0, 10)}`);
  console.log(`out-sample ${new Date(OOS[0].t).toISOString().slice(0, 10)} ~ ${new Date(OOS[OOS.length - 1].t).toISOString().slice(0, 10)}\n`);

  console.log("=== score distribution (the vote is discrete, so this matters) ===");
  const buckets = {};
  for (const r of all) { const k = Math.round(r.score / 10) * 10; buckets[k] = (buckets[k] || 0) + 1; }
  const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    const pct = buckets[k] / all.length * 100;
    if (pct < 0.5) continue;
    console.log(`  ${String(k).padStart(5)}  ${"#".repeat(Math.round(pct))} ${pct.toFixed(1)}%`);
  }

  console.log("\n=== IC under three return definitions (out-of-sample) ===");
  const sc = OOS.map((r) => r.score);
  for (const [label, key] of [["symbol-demeaned", "fwdDm"], ["raw", "fwd"], ["cross-sectional", "fwdXs"]]) {
    console.log(`  ${label.padEnd(18)} IC = ${spearman(sc, OOS.map((r) => r[key])).toFixed(4)}`);
  }

  console.log("\n=== staged gates: the v1 thresholds on |score| ===");
  console.log("stage       |score|>=   trades   long%   win%    gross%   net%     port t   ann%");
  const stamps = [...new Set(OOS.map((r) => r.t))].sort((a, b) => a - b);
  for (const [stage, thr] of [["EARLY", 18], ["CORE", 28], ["PRE_REAL", 34], ["REAL", 40], ["REAL+", 46]]) {
    const picks = [];
    for (const r of OOS) {
      if (r.score >= thr) picks.push({ d: 1, r: r.fwd });
      else if (r.score <= -thr) picks.push({ d: -1, r: r.fwd });
    }
    if (picks.length < 50) { console.log(`${stage.padEnd(11)}${String(thr).padStart(9)}   (표본 부족 ${picks.length})`); continue; }
    const pnl = picks.map((p) => p.d * p.r * 100);
    const net = pnl.map((v) => v - COST_PCT);
    const longs = picks.filter((p) => p.d > 0).length;

    const port = [];
    for (let k = 0; k < stamps.length; k += HOLD) {
      const legs = [];
      for (const r of (byT.get(stamps[k]) || [])) {
        if (!OOS.length || r.t < OOS[0].t) continue;
        if (r.score >= thr) legs.push(r.fwd * 100 - COST_PCT);
        else if (r.score <= -thr) legs.push(-r.fwd * 100 - COST_PCT);
      }
      if (legs.length >= 2) port.push(mean(legs));
    }
    const mB = port.length >= 20 ? mean(port) : null;
    const tB = mB === null ? null : mB / (sd(port) / Math.sqrt(port.length));
    console.log(
      stage.padEnd(11) + String(thr).padStart(9) + String(picks.length).padStart(9) +
      (longs / picks.length * 100).toFixed(0).padStart(7) + "%" +
      (net.filter((v) => v > 0).length / net.length * 100).toFixed(1).padStart(7) +
      mean(pnl).toFixed(4).padStart(10) + mean(net).toFixed(4).padStart(9) +
      (tB === null ? "      -" : tB.toFixed(2).padStart(9)) +
      (mB === null ? "       -" : (mB * 365).toFixed(1).padStart(9)) +
      (tB !== null && tB > 1.96 ? "  <- significant" : "")
    );
  }
  console.log(`\ncost ${COST_PCT}% round trip. Portfolio column is non-overlapping, one observation per period.`);
  console.log("Not ported: posterior / wave / EV / percentile gates / session decay / 15m confirm.");
}

if (require.main === module) main();

module.exports = { buildStates, scoreAt, spearman, mean, sd, ema, sma, rma, HOLD, COST_PCT, W };
