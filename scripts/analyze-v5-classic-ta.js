#!/usr/bin/env node
"use strict";

// scripts/analyze-v5-classic-ta.js (2026-08-08)
//
// The classical technical-analysis toolkit — Ichimoku, RSI, MACD, Bollinger,
// Stochastic, ADX/DMI, CCI, OBV, moving-average crosses — measured the same
// way everything else in this project gets measured.
//
// The previous composite used hand-rolled features (momentum over realized
// vol, range position, volume shock). Those are not the named indicators
// traders actually use, and "combine indicators" reasonably means these.
//
// Ichimoku gets full treatment because it is not one indicator but a system:
// conversion/base lines, both leading spans forming the cloud, and the lagging
// span. Each produces a distinct signal and they are tested separately rather
// than mashed into one score, so it is visible WHICH part carries information
// if any part does.
//
// LOOK-AHEAD IS THE TRAP HERE. Ichimoku's leading spans are plotted 26 periods
// INTO THE FUTURE, and its lagging span is plotted 26 periods into the past.
// On a chart that is presentation. In a backtest, reading the cloud "at" bar i
// off a chart means reading a value computed from bars up to i+26 — the future.
// Every span below is therefore indexed to what was KNOWN at bar i: the cloud
// active at i was computed at i-26, and the lagging-span comparison uses the
// close from i-26 against price at i-52. Getting this wrong manufactures
// spectacular results, which is exactly why it is spelled out.
//
// Methodology is unchanged and non-negotiable:
//   - forward returns symbol-demeaned (kills coin drift)
//   - indicator signs decided IN-SAMPLE only, first half
//   - reported out-of-sample
//   - and judged at PORTFOLIO level with non-overlapping periods, because
//     per-bar observations overlap 5/6 and 24 correlated symbols fire at once,
//     which inflated a t-stat 11-104x last time and flipped its sign.

const fs = require("fs");
const path = require("path");

const CACHE = process.env.V5_CACHE
  || path.join(process.env.TMPDIR || "/tmp", "v5_data_full.json");
const HOLD = 6;              // 6 x 4h = 1 day
const BARS_PER_DAY = 6;
const COST_PCT = 0.14;
const MIN_ABS_IC = 0.015;

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1e-9; };

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

// ---- indicator primitives ------------------------------------------------
function ema(vals, period) {
  const k = 2 / (period + 1);
  const out = new Array(vals.length).fill(null);
  let prev = null;
  for (let i = 0; i < vals.length; i += 1) {
    if (!Number.isFinite(vals[i])) continue;
    prev = prev === null ? vals[i] : vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function highest(bars, i, n) { let h = -Infinity; for (let k = i - n + 1; k <= i; k += 1) if (bars[k]) h = Math.max(h, bars[k].h); return h; }
function lowest(bars, i, n) { let l = Infinity; for (let k = i - n + 1; k <= i; k += 1) if (bars[k]) l = Math.min(l, bars[k].l); return l; }

function buildIndicators(bars) {
  const n = bars.length;
  const close = bars.map((b) => b.c);

  // MACD 12/26/9
  const e12 = ema(close, 12), e26 = ema(close, 26);
  const macdLine = close.map((_, i) => (e12[i] !== null && e26[i] !== null ? e12[i] - e26[i] : null));
  const macdSignal = ema(macdLine.map((v) => (v === null ? NaN : v)), 9);

  // RSI 14 (Wilder)
  const rsi = new Array(n).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < n; i += 1) {
    const ch = close[i] - close[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= 14) { avgGain += g / 14; avgLoss += l / 14; if (i === 14) rsi[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-9)); }
    else { avgGain = (avgGain * 13 + g) / 14; avgLoss = (avgLoss * 13 + l) / 14; rsi[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-9)); }
  }

  // ATR 14, and ADX/DMI 14
  const tr = new Array(n).fill(null);
  const plusDM = new Array(n).fill(0), minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - close[i - 1]), Math.abs(bars[i].l - close[i - 1]));
    const up = bars[i].h - bars[i - 1].h, dn = bars[i - 1].l - bars[i].l;
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
  }
  const atr = ema(tr.map((v) => (v === null ? NaN : v)), 14);
  const pDI = ema(plusDM, 14), mDI = ema(minusDM, 14);
  const dx = new Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    if (pDI[i] === null || mDI[i] === null) continue;
    const p = pDI[i] / (atr[i] || 1e-9) * 100, m = mDI[i] / (atr[i] || 1e-9) * 100;
    dx[i] = Math.abs(p - m) / ((p + m) || 1e-9) * 100;
  }
  const adx = ema(dx.map((v) => (v === null ? NaN : v)), 14);

  // OBV
  const obv = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) obv[i] = obv[i - 1] + (close[i] > close[i - 1] ? bars[i].v : close[i] < close[i - 1] ? -bars[i].v : 0);

  return { close, e12, e26, macdLine, macdSignal, rsi, atr, pDI, mDI, adx, obv };
}

// Everything indexed to what was KNOWN at bar i. See the look-ahead note above.
function featuresAt(bars, ind, i) {
  const b = bars[i], c = b.c;
  const atr = ind.atr[i] || 1e-9;

  // --- Ichimoku ---------------------------------------------------------
  const tenkan = (highest(bars, i, 9) + lowest(bars, i, 9)) / 2;
  const kijun = (highest(bars, i, 26) + lowest(bars, i, 26)) / 2;
  // The cloud in force AT i was computed 26 bars ago (it is plotted forward).
  const j = i - 26;
  const tenkanPast = (highest(bars, j, 9) + lowest(bars, j, 9)) / 2;
  const kijunPast = (highest(bars, j, 26) + lowest(bars, j, 26)) / 2;
  const spanA = (tenkanPast + kijunPast) / 2;
  const spanB = (highest(bars, j, 52) + lowest(bars, j, 52)) / 2;
  const cloudTop = Math.max(spanA, spanB), cloudBot = Math.min(spanA, spanB);
  // Lagging span: the close from 26 bars ago vs price 26 bars before THAT.
  const chikou = bars[i - 26].c - bars[i - 52].c;

  // --- Bollinger 20, 2σ -------------------------------------------------
  let s = 0, s2 = 0;
  for (let k = i - 19; k <= i; k += 1) { s += bars[k].c; s2 += bars[k].c * bars[k].c; }
  const bbMean = s / 20;
  const bbSd = Math.sqrt(Math.max(s2 / 20 - bbMean * bbMean, 0)) || 1e-9;

  // --- Stochastic 14 ----------------------------------------------------
  const hh = highest(bars, i, 14), ll = lowest(bars, i, 14);
  const stochK = (c - ll) / ((hh - ll) || 1e-9) * 100;
  let kSum = 0;
  for (let k = i - 2; k <= i; k += 1) {
    const h2 = highest(bars, k, 14), l2 = lowest(bars, k, 14);
    kSum += (bars[k].c - l2) / ((h2 - l2) || 1e-9) * 100;
  }

  // --- CCI 20 -----------------------------------------------------------
  const tp = (b.h + b.l + c) / 3;
  let tpSum = 0;
  const tps = [];
  for (let k = i - 19; k <= i; k += 1) { const t = (bars[k].h + bars[k].l + bars[k].c) / 3; tps.push(t); tpSum += t; }
  const tpMean = tpSum / 20;
  const md = mean(tps.map((t) => Math.abs(t - tpMean))) || 1e-9;

  // --- OBV slope over 20 -------------------------------------------------
  const obvSlope = (ind.obv[i] - ind.obv[i - 20]) / (mean(bars.slice(i - 20, i).map((x) => x.v)) * 20 || 1e-9);

  const pDIv = ind.pDI[i] / atr * 100, mDIv = ind.mDI[i] / atr * 100;

  return {
    // 일목균형표
    ichi_price_vs_cloud: c > cloudTop ? 1 : c < cloudBot ? -1 : 0,
    ichi_cloud_dist: (c - (cloudTop + cloudBot) / 2) / atr,
    ichi_tenkan_kijun: (tenkan - kijun) / atr,
    ichi_price_vs_kijun: (c - kijun) / atr,
    ichi_cloud_color: spanA > spanB ? 1 : spanA < spanB ? -1 : 0,
    ichi_cloud_thick: (cloudTop - cloudBot) / atr,
    ichi_chikou: chikou / atr,
    // 오실레이터
    rsi_14: ind.rsi[i],
    stoch_k: stochK,
    stoch_kd: stochK - kSum / 3,
    cci_20: (tp - tpMean) / (0.015 * md),
    // 추세
    macd_hist: (ind.macdLine[i] - ind.macdSignal[i]) / atr,
    macd_line: ind.macdLine[i] / atr,
    adx_14: ind.adx[i],
    dmi_diff: pDIv - mDIv,
    ma_cross: (ind.e12[i] - ind.e26[i]) / atr,
    // 변동성 / 거래량
    bb_pctb: (c - (bbMean - 2 * bbSd)) / ((4 * bbSd) || 1e-9),
    bb_width: (4 * bbSd) / bbMean,
    obv_slope: obvSlope,
  };
}

function main() {
  const store = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const perSym = {};
  for (const [sym, d] of Object.entries(store)) {
    const bars = d.bars;
    if (!bars || bars.length < 300) continue;
    const ind = buildIndicators(bars);
    const rows = [];
    for (let i = 90; i < bars.length - HOLD; i += 1) {
      const f = featuresAt(bars, ind, i);
      if (!Object.values(f).every(Number.isFinite)) continue;
      rows.push({ t: bars[i].t, f, fwd: bars[i + HOLD].c / bars[i].c - 1 });
    }
    if (rows.length > 200) perSym[sym] = rows;
  }

  const fwdMeanBySym = {};
  for (const [sym, rows] of Object.entries(perSym)) fwdMeanBySym[sym] = mean(rows.map((r) => r.fwd));

  const all = [];
  for (const [sym, rows] of Object.entries(perSym)) {
    for (const r of rows) all.push({ sym, t: r.t, f: r.f, fwd: r.fwd - fwdMeanBySym[sym] });
  }
  all.sort((a, b) => a.t - b.t);
  const half = Math.floor(all.length / 2);
  const IS = all.slice(0, half), OOS = all.slice(half);
  const names = Object.keys(all[0].f);

  console.log(`symbols ${Object.keys(perSym).length}, observations ${all.length}, 4h bars, hold ${HOLD} (~1d)`);
  console.log(`in-sample  ${new Date(IS[0].t).toISOString().slice(0, 10)} ~ ${new Date(IS[IS.length - 1].t).toISOString().slice(0, 10)}`);
  console.log(`out-sample ${new Date(OOS[0].t).toISOString().slice(0, 10)} ~ ${new Date(OOS[OOS.length - 1].t).toISOString().slice(0, 10)}\n`);

  console.log("=== STEP 1: each classical indicator alone ===");
  console.log("indicator               IC(in)    IC(out)   sign  included");
  const chosen = [];
  for (const nm of names) {
    const icIn = spearman(IS.map((r) => r.f[nm]), IS.map((r) => r.fwd));
    const icOut = spearman(OOS.map((r) => r.f[nm]), OOS.map((r) => r.fwd));
    const include = icIn !== null && Math.abs(icIn) >= MIN_ABS_IC;
    if (include) chosen.push({ nm, sign: icIn >= 0 ? 1 : -1 });
    console.log(
      nm.padEnd(23) + icIn.toFixed(4).padStart(8) + icOut.toFixed(4).padStart(10) +
      String(icIn >= 0 ? "+" : "-").padStart(6) + (include ? "     yes" : "      no") +
      (include && icIn * icOut < 0 ? "  <- sign FLIPS out of sample" : "")
    );
  }
  console.log(`\nincluded ${chosen.length}/${names.length} at |IC| >= ${MIN_ABS_IC}`);
  if (!chosen.length) { console.log("nothing cleared the bar."); return; }

  const st = {};
  for (const { nm } of chosen) { const v = IS.map((r) => r.f[nm]); st[nm] = { m: mean(v), s: sd(v) }; }
  const score = (r) => chosen.reduce((acc, { nm, sign }) => acc + sign * ((r.f[nm] - st[nm].m) / st[nm].s), 0) / chosen.length;

  const icComp = spearman(OOS.map(score), OOS.map((r) => r.fwd));
  const bestSingle = Math.max(...chosen.map(({ nm, sign }) =>
    Math.abs(spearman(OOS.map((r) => sign * r.f[nm]), OOS.map((r) => r.fwd)))));
  console.log("\n=== STEP 2: composite vs best single ===");
  console.log(`  composite IC out-of-sample : ${icComp.toFixed(4)}`);
  console.log(`  best single ingredient     : ${bestSingle.toFixed(4)}`);
  console.log(`  -> combining ${Math.abs(icComp) > bestSingle ? "BEATS" : "does not beat"} the best single indicator`);

  console.log("\n=== STEP 3: tradable book — per-bar vs PORTFOLIO ===");
  console.log("only the portfolio column is evidence; per-bar overlaps 5/6 and 24 correlated symbols fire together\n");
  console.log("   t    per-bar n   per-bar net%   t   |  port n   port net%    t      ann%");
  const stamps = [...new Set(OOS.map((r) => r.t))].sort((a, b) => a - b);
  const byT = new Map();
  for (const r of OOS) { if (!byT.has(r.t)) byT.set(r.t, []); byT.get(r.t).push(r); }

  for (const th of [0.2, 0.3, 0.4, 0.5, 0.6]) {
    const lapped = [];
    for (const r of OOS) {
      const s = score(r);
      if (s > th) lapped.push(r.fwd * 100 - COST_PCT);
      else if (s < -th) lapped.push(-r.fwd * 100 - COST_PCT);
    }
    if (lapped.length < 50) continue;
    const mA = mean(lapped), tA = mA / (sd(lapped) / Math.sqrt(lapped.length));

    const port = [];
    for (let k = 0; k < stamps.length; k += HOLD) {
      const legs = [];
      for (const r of (byT.get(stamps[k]) || [])) {
        const s = score(r);
        if (s > th) legs.push(r.fwd * 100 - COST_PCT);
        else if (s < -th) legs.push(-r.fwd * 100 - COST_PCT);
      }
      if (legs.length >= 3) port.push(mean(legs));
    }
    if (port.length < 20) continue;
    const mB = mean(port), tB = mB / (sd(port) / Math.sqrt(port.length));
    console.log(
      th.toFixed(1).padStart(5) + String(lapped.length).padStart(11) + mA.toFixed(4).padStart(14) +
      tA.toFixed(2).padStart(7) + "   |" + String(port.length).padStart(8) +
      mB.toFixed(4).padStart(11) + tB.toFixed(2).padStart(8) +
      (mB * (365 / (HOLD / BARS_PER_DAY))).toFixed(1).padStart(10) +
      (tB > 1.96 ? "  <- significant" : "")
    );
  }
  console.log(`\ncost ${COST_PCT}% round trip. Forward returns symbol-demeaned.`);
}

if (require.main === module) main();

module.exports = { buildIndicators, featuresAt, spearman, mean, sd, HOLD, COST_PCT, MIN_ABS_IC };
