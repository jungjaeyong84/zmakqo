#!/usr/bin/env node
"use strict";

// scripts/analyze-v4-lowvol-controls.js (2026-08-07)
//
// The feasibility study found low-volatility ranking with IC 0.30-0.33 at
// 30-60 day holds against a requirement of 0.07-0.09. That is 3-4x the bar,
// on a day when three other "spectacular" signals died under controls. It
// gets the same treatment before anyone believes it.
//
// The prior is that it is fake, for a specific reason: THE IC RISES WITH
// HORIZON (0.033 at 1d, 0.334 at 60d). Genuine predictive signals decay with
// horizon, because information gets priced in. An IC that grows is the
// signature of a persistent CHARACTERISTIC lining up with a persistent TREND —
// the characteristic does not predict anything, it just labels which side of a
// one-way move a symbol sat on.
//
// Concretely, "long low-vol / short high-vol" in this universe means long
// BTC/ETH/LTC/BNB and short the small alts. Over the sample that is the BTC
// dominance trade. If so it is not 27 cross-sectional bets, it is ONE macro
// bet resampled 27 times, and its Sharpe is a fiction of pseudo-replication.
//
// Five tests, each of which the signal must survive:
//   1. TURNOVER. A signal reshuffles; a static bet does not. If the portfolio
//      barely changes, there is no cross-sectional information being used.
//   2. STATIC CLONE. Freeze the portfolio on day 0 by initial vol and never
//      rebalance. If that matches the "strategy", the strategy is the bet.
//   3. TIME STABILITY. First half vs second half.
//   4. DOMINANCE REGRESSION. Regress the long/short return on (BTC return
//      minus equal-weight universe return). If dominance explains it, the
//      residual alpha is what is actually left.
//   5. EFFECTIVE BREADTH. With positions this correlated, how many
//      INDEPENDENT bets are there really? t-stats computed on 27 symbols are
//      meaningless if they all move together.

const UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "LTCUSDT", "ATOMUSDT", "FILUSDT", "INJUSDT",
  "SEIUSDT", "GALAUSDT", "SANDUSDT", "AXSUSDT", "AAVEUSDT", "DOTUSDT",
  "WLDUSDT", "TAOUSDT", "ORDIUSDT",
];
const H = 30;                 // the horizon where low-vol looked strongest
const FEE_PER_SIDE_PCT = 0.02;
const DAYS = 730;

async function fetchDaily(sym) {
  const out = [];
  let end = Date.now();
  for (let p = 0; p < 2; p += 1) {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=1000&endTime=${end}`);
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.unshift(...rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })));
    end = Number(rows[0][0]) - 1;
    await new Promise((r) => setTimeout(r, 120));
  }
  const seen = new Set();
  return out.filter((b) => { if (seen.has(b.t)) return false; seen.add(b.t); return Number.isFinite(b.c) && b.c > 0; })
    .sort((a, b) => a.t - b.t).slice(-DAYS);
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));

function main(series) {
  const syms = [...series.keys()];
  const len = Math.min(...syms.map((s) => series.get(s).length));
  const px = new Map(syms.map((s) => [s, series.get(s).slice(-len).map((b) => b.c)]));
  const k = Math.max(2, Math.floor(syms.length / 3));
  const nPeriods = Math.floor((len - 1) / H);

  console.log(`universe ${syms.length}, ${len} days, hold ${H}d, k=${k}, ${nPeriods} periods\n`);

  // build the low-vol book period by period
  const books = [];
  for (let p = 1; p < nPeriods; p += 1) {
    const i0 = p * H, i1 = (p + 1) * H;
    const scored = [];
    for (const s of syms) {
      const a = px.get(s);
      let v = 0;
      for (let j = i0 - H + 1; j <= i0; j += 1) v += Math.abs(Math.log(a[j] / a[j - 1]));
      const fwd = a[i1] / a[i0] - 1;
      if (Number.isFinite(v) && Number.isFinite(fwd)) scored.push({ s, vol: v, fwd });
    }
    if (scored.length < 2 * k) continue;
    scored.sort((a, b) => a.vol - b.vol);          // low vol first
    const longs = scored.slice(0, k).map((x) => x.s);
    const shorts = scored.slice(-k).map((x) => x.s);
    const ret = 0.5 * (mean(scored.slice(0, k).map((x) => x.fwd)) - mean(scored.slice(-k).map((x) => x.fwd)));
    const uni = mean(scored.map((x) => x.fwd));
    const btc = scored.find((x) => x.s === "BTCUSDT");
    books.push({ p, longs, shorts, ret, dom: (btc ? btc.fwd : uni) - uni });
  }

  // ---- 1. TURNOVER --------------------------------------------------------
  let turn = 0, cmp = 0;
  for (let i = 1; i < books.length; i += 1) {
    const prev = new Set([...books[i - 1].longs, ...books[i - 1].shorts]);
    const cur = [...books[i].longs, ...books[i].shorts];
    turn += cur.filter((s) => !prev.has(s)).length / cur.length;
    cmp += 1;
  }
  const avgTurn = turn / cmp;
  console.log("=== 1. TURNOVER ===");
  console.log(`  average roster change per rebalance: ${(avgTurn * 100).toFixed(1)}%`);
  console.log(`  -> ${avgTurn < 0.2 ? "the book barely moves. This is a STATIC BET, not a cross-sectional signal." : "the book genuinely reshuffles"}`);
  const alwaysLong = syms.filter((s) => books.every((b) => b.longs.includes(s)));
  const alwaysShort = syms.filter((s) => books.every((b) => b.shorts.includes(s)));
  console.log(`  held long in EVERY period : ${alwaysLong.join(", ") || "(none)"}`);
  console.log(`  held short in EVERY period: ${alwaysShort.join(", ") || "(none)"}`);

  // ---- 2. STATIC CLONE ----------------------------------------------------
  const first = books[0];
  let staticSum = 0;
  for (const b of books) {
    const i0 = b.p * H, i1 = (b.p + 1) * H;
    const rl = mean(first.longs.map((s) => px.get(s)[i1] / px.get(s)[i0] - 1));
    const rs = mean(first.shorts.map((s) => px.get(s)[i1] / px.get(s)[i0] - 1));
    staticSum += 0.5 * (rl - rs);
  }
  const rebalAnn = (mean(books.map((b) => b.ret))) * (365 / H) * 100;
  const staticAnn = (staticSum / books.length) * (365 / H) * 100;
  console.log("\n=== 2. STATIC CLONE (frozen on day 0, never rebalanced) ===");
  console.log(`  rebalanced low-vol strategy: ${rebalAnn.toFixed(1)}%/yr`);
  console.log(`  frozen day-0 portfolio     : ${staticAnn.toFixed(1)}%/yr`);
  console.log(`  -> rebalancing adds ${(rebalAnn - staticAnn).toFixed(1)}pp. ${Math.abs(rebalAnn - staticAnn) < Math.abs(staticAnn) * 0.3 ? "The signal contributes almost nothing beyond the initial bet." : "Rebalancing does real work."}`);

  // ---- 3. TIME STABILITY --------------------------------------------------
  const h = Math.floor(books.length / 2);
  const seg = (arr) => {
    const m = mean(arr.map((b) => b.ret));
    const s = sd(arr.map((b) => b.ret));
    const se = s / Math.sqrt(arr.length);
    return { ann: m * (365 / H) * 100, t: m / (se || 1e-12), n: arr.length };
  };
  const a1 = seg(books.slice(0, h)), a2 = seg(books.slice(h)), all = seg(books);
  console.log("\n=== 3. TIME STABILITY ===");
  console.log(`  full   : ${all.ann.toFixed(1)}%/yr  t=${all.t.toFixed(2)}  (n=${all.n} periods)`);
  console.log(`  1st half: ${a1.ann.toFixed(1)}%/yr  t=${a1.t.toFixed(2)}`);
  console.log(`  2nd half: ${a2.ann.toFixed(1)}%/yr  t=${a2.t.toFixed(2)}`);
  console.log(`  -> ${Math.sign(a1.ann) === Math.sign(a2.ann) ? "sign stable" : "SIGN FLIPS between halves — not a stable effect"}`);

  // ---- 4. DOMINANCE REGRESSION -------------------------------------------
  const y = books.map((b) => b.ret), x = books.map((b) => b.dom);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < y.length; i += 1) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const beta = sxy / sxx, alpha = my - beta * mx;
  const resid = y.map((v, i) => v - (alpha + beta * x[i]));
  const r2 = 1 - (mean(resid.map((v) => v * v)) / mean(y.map((v) => (v - my) ** 2)));
  const seA = sd(resid) / Math.sqrt(y.length);
  console.log("\n=== 4. DOMINANCE REGRESSION (return ~ BTC minus universe) ===");
  console.log(`  beta on dominance: ${beta.toFixed(3)},  R2 = ${r2.toFixed(3)}`);
  console.log(`  alpha after removing dominance: ${(alpha * (365 / H) * 100).toFixed(2)}%/yr  t=${(alpha / (seA || 1e-12)).toFixed(2)}`);
  console.log(`  -> ${r2 > 0.4 ? "dominance explains most of it" : "dominance does not explain it"}; residual alpha ${Math.abs(alpha / (seA || 1e-12)) > 2 ? "SURVIVES" : "is not significant"}`);

  // ---- 5. EFFECTIVE BREADTH ----------------------------------------------
  // average pairwise correlation of the daily returns of the long basket
  const rets = new Map(syms.map((s) => {
    const a = px.get(s); const out = [];
    for (let i = 1; i < a.length; i += 1) out.push(Math.log(a[i] / a[i - 1]));
    return [s, out];
  }));
  const corr = (a, b) => {
    const ma = mean(a), mb = mean(b);
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i += 1) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return n / (Math.sqrt(da * db) || 1e-12);
  };
  let cs = 0, cn = 0;
  for (let i = 0; i < syms.length; i += 1) {
    for (let j = i + 1; j < syms.length; j += 1) { cs += corr(rets.get(syms[i]), rets.get(syms[j])); cn += 1; }
  }
  const rho = cs / cn;
  const effN = syms.length / (1 + (syms.length - 1) * rho);
  console.log("\n=== 5. EFFECTIVE BREADTH ===");
  console.log(`  average pairwise correlation across the universe: ${rho.toFixed(3)}`);
  console.log(`  effective independent bets: ${effN.toFixed(1)} (nominal ${syms.length})`);
  console.log(`  -> a t-stat computed as if there were ${syms.length} independent names is overstated by ~${Math.sqrt(syms.length / effN).toFixed(1)}x`);

  console.log("\n=== VERDICT ===");
  const fails = [];
  if (avgTurn < 0.2) fails.push("turnover (static bet)");
  if (Math.abs(rebalAnn - staticAnn) < Math.abs(staticAnn) * 0.3) fails.push("static clone matches");
  if (Math.sign(a1.ann) !== Math.sign(a2.ann)) fails.push("sign flips across halves");
  if (r2 > 0.4 && Math.abs(alpha / (seA || 1e-12)) < 2) fails.push("explained by BTC dominance");
  console.log(fails.length ? `  FAILED: ${fails.join("; ")}` : "  survived all five controls");
}

(async () => {
  const series = new Map();
  for (const s of UNIVERSE) {
    try { const b = await fetchDaily(s); if (b.length > 400) series.set(s, b); }
    catch (e) { console.error(`skip ${s}: ${e.message}`); }
  }
  main(series);
})().catch((e) => { console.error(e); process.exit(1); });
