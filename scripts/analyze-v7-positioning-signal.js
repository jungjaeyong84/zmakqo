#!/usr/bin/env node
"use strict";

// scripts/analyze-v7-positioning-signal.js (2026-08-17)
//
// The evidence behind the v7 paper lane, re-runnable. Reads the banked v5 flow
// ledger, measures every positioning feature against forward returns, and
// backtests the cross-sectional book the lane trades.
//
// WHY THIS SEARCH WAS DIFFERENT FROM THE ONES BEFORE IT.
//
// Every prior indicator search in this project ran on transforms of price. On
// 2026-08-17 a fresh sweep confirmed the ceiling once more, on 4.1 years of 4h
// bars across 10 majors, 41 indicators (Ichimoku decomposed with the leading
// spans lagged, RSI, MACD, Bollinger, Stochastic, ADX/DMI, CCI, Williams %R,
// ROC, TSI, Aroon, Donchian, Keltner, ATR, realised vol, OBV, MFI, CMF, Force
// Index, A/D, VWAP deviation, volume ratio, taker ratio, trade count, trade
// size):
//
//   linear composite      in-sample IC 0.0699 -> out-of-sample -0.0035
//   best single indicator out-of-sample |IC| 0.0282  (BEATS the 41-way blend)
//   backtest              in-sample +65.4%/yr, out-of-sample -68.2%/yr
//   shuffle control       p = 0.49
//   non-linear AND rules  30 found at |t|>3 in-sample, 4/30 kept sign out (13%)
//   walk-forward retrain  +49.9% at one setting, +5.5% once ensembled
//
// The 13% is the tell: it is not "no effect", it is systematic reversal. And
// ensembling made the walk-forward WORSE, which only happens when there was no
// signal to average in the first place.
//
// Positioning data is not a price transform. topLongShortPositionRatio is what
// large accounts hold; globalLongShortAccountRatio is what retail accounts
// hold. Neither is recoverable from OHLCV at any lag. That is the whole reason
// this one behaves differently.
//
// WHAT THIS SCRIPT FINDS (24 symbols x 242 4h periods, 5,808 observations):
//
//   whale_vs_retail  cross-sectional IC -0.0345  t = -2.63
//   taker_chg        cross-sectional IC -0.0317  t = -2.41
//   top_ratio        cross-sectional IC -0.0303  t = -2.31
//
// Compare against 45bb381a, where the classical toolkit's cross-sectional IC
// was 0.0036 — the number that closed the directional search. This is ~10x it,
// and it is in the cross-section, which is where a dollar-neutral book lives.
//
// HONEST LIMITS, because this is the part that gets forgotten later:
//
//   - 40.5 days. 242 periods is not a track record.
//   - t = 2.21 on the book barely passes 1.96, and it is the best of 8 features
//     examined. Bonferroni over 8 wants |t| > 2.73. It does NOT clear that.
//   - Sharpe 5.68 is what annualising 40 days does to a low-vol series. It is
//     not a property of the strategy and should not be quoted as one.
//   - K=4 turns the first half negative. Not parameter-flat.
//
// The lane exists because sample size is the only defect, and it is the one
// defect that repairs itself by waiting.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "ops/runtime/v5_flow_history.jsonl");

const COST_PER_TURNOVER_PCT = 0.07;   // taker 0.05 + slip 0.02, matches the lane
const SHUFFLES = 100;

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function sd(a) { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : 0; }

function corr(pairs) {
  const p = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (p.length < 100) return { ic: 0, n: p.length, t: 0 };
  const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
  let nu = 0, dx = 0, dy = 0;
  for (const [x, y] of p) { nu += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
  const ic = dx && dy ? nu / Math.sqrt(dx * dy) : 0;
  return { ic, n: p.length, t: ic * Math.sqrt(p.length - 1) };
}

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
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=400`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = new Map();
  for (const r of await res.json()) m.set(Number(r[0]), Number(r[4]));
  return m;
}

// Features. Levels and changes are kept separate: a level says where
// positioning IS, a change says where it is GOING, and they are not the same
// statement.
function features(now, prev) {
  if (!now || !prev) return null;
  const f = {
    oi_chg: prev.oi ? now.oi / prev.oi - 1 : null,
    taker_ratio: now.taker_ratio ?? null,
    taker_chg: Number.isFinite(prev.taker_ratio) && Number.isFinite(now.taker_ratio) ? now.taker_ratio - prev.taker_ratio : null,
    top_ratio: now.top_ratio ?? null,
    top_chg: Number.isFinite(prev.top_ratio) && Number.isFinite(now.top_ratio) ? now.top_ratio - prev.top_ratio : null,
    retail_ratio: now.retail_ratio ?? null,
    retail_chg: Number.isFinite(prev.retail_ratio) && Number.isFinite(now.retail_ratio) ? now.retail_ratio - prev.retail_ratio : null,
    whale_vs_retail: Number.isFinite(now.top_ratio) && Number.isFinite(now.retail_ratio) ? now.top_ratio - now.retail_ratio : null,
  };
  return f;
}

async function main() {
  const flow = loadFlow();
  const symbols = [...new Set([...flow.values()].map((r) => r.symbol))].sort();
  const stamps = [...new Set([...flow.values()].map((r) => r.ts))].sort((a, b) => a - b);
  console.log(`v5 ledger: ${symbols.length} symbols x ${stamps.length} periods`);

  const closes = new Map();
  for (const s of symbols) {
    try { closes.set(s, await fetchCloses(s)); await new Promise((r) => setTimeout(r, 80)); }
    catch (e) { console.error(`  ${s}: ${e.message}`); }
  }

  // obs[i] = { symbol, ts, feat, fwd }.  fwd is the return of the bar AFTER the
  // one the signal stamps — the signal is a full closed period old when acted on.
  const obs = [];
  for (const s of symbols) {
    for (let i = 1; i < stamps.length - 1; i++) {
      const f = features(flow.get(`${s}|${stamps[i]}`), flow.get(`${s}|${stamps[i - 1]}`));
      const p0 = closes.get(s)?.get(stamps[i]);
      const p1 = closes.get(s)?.get(stamps[i + 1]);
      if (!f || !Number.isFinite(p0) || !Number.isFinite(p1)) continue;
      obs.push({ symbol: s, ts: stamps[i], feat: f, fwd: p1 / p0 - 1 });
    }
  }
  console.log(`observations: ${obs.length}\n`);

  const names = Object.keys(obs[0].feat);

  // Cross-sectional IC demeans BOTH the feature and the return within each
  // timestamp. That strips the market factor — which is exactly what 45bb381a
  // showed was carrying all of the classical toolkit's apparent skill.
  const byTs = new Map();
  for (const o of obs) { if (!byTs.has(o.ts)) byTs.set(o.ts, []); byTs.get(o.ts).push(o); }

  console.log("feature".padStart(18) + "raw IC".padStart(10) + "t".padStart(8) + "cross-sec IC".padStart(14) + "t".padStart(8));
  const results = {};
  for (const nm of names) {
    const raw = corr(obs.map((o) => [o.feat[nm], o.fwd]));
    const cs = [];
    for (const g of byTs.values()) {
      const vals = g.map((o) => o.feat[nm]).filter(Number.isFinite);
      if (vals.length < 8) continue;
      const mv = mean(vals), mf = mean(g.map((o) => o.fwd));
      for (const o of g) if (Number.isFinite(o.feat[nm])) cs.push([o.feat[nm] - mv, o.fwd - mf]);
    }
    const c = corr(cs);
    results[nm] = { raw_ic: raw.ic, raw_t: raw.t, cs_ic: c.ic, cs_t: c.t };
    console.log(nm.padStart(18) + raw.ic.toFixed(4).padStart(10) + raw.t.toFixed(2).padStart(8)
      + c.ic.toFixed(4).padStart(14) + c.t.toFixed(2).padStart(8));
  }
  console.log(`\n  |t| > 1.96 is nominally significant at ${obs.length} observations.`);
  console.log("  Bonferroni over 8 features wants |t| > 2.73.\n");

  // ---- the book the lane actually trades ---------------------------------
  // Rank on whale_vs_retail, long the low end, short the high end, equal weight,
  // dollar-neutral. sign=-1 follows the negative IC.
  function backtest(from, to, K, sign, permute) {
    let eq = 1, prevW = new Map(), prevPx = new Map();
    const rets = [];
    for (let i = from; i < to; i++) {
      const g = byTs.get(stamps[i]);
      if (!g || g.length < 12) continue;
      let rows = g.filter((o) => Number.isFinite(o.feat.whale_vs_retail));
      if (rows.length < 12) continue;
      if (permute) {
        const vals = rows.map((r) => r.feat.whale_vs_retail);
        for (let j = vals.length - 1; j > 0; j--) { const k = Math.floor(Math.random() * (j + 1)); [vals[j], vals[k]] = [vals[k], vals[j]]; }
        rows = rows.map((r, j) => ({ ...r, feat: { ...r.feat, whale_vs_retail: vals[j] } }));
      }
      rows.sort((a, b) => a.feat.whale_vs_retail - b.feat.whale_vs_retail);
      const lows = rows.slice(0, K), highs = rows.slice(-K);
      const longs = sign < 0 ? lows : highs, shorts = sign < 0 ? highs : lows;
      const w = new Map();
      for (const r of longs) w.set(r.symbol, 0.5 / K);
      for (const r of shorts) w.set(r.symbol, -0.5 / K);

      // book the prior weights over the step just completed
      let gross = 0, priced = prevW.size > 0;
      for (const [s, pw] of prevW) {
        const p0 = prevPx.get(s), p1 = closes.get(s)?.get(stamps[i]);
        if (!Number.isFinite(p0) || !Number.isFinite(p1)) { priced = false; break; }
        gross += pw * (p1 / p0 - 1);
      }
      let turn = 0;
      for (const s of new Set([...w.keys(), ...prevW.keys()])) turn += Math.abs((w.get(s) || 0) - (prevW.get(s) || 0));
      const net = (priced ? gross : 0) - turn * COST_PER_TURNOVER_PCT / 100;
      eq *= (1 + net);
      if (priced) rets.push(net);
      prevW = w;
      prevPx = new Map([...w.keys()].map((s) => [s, closes.get(s).get(stamps[i])]));
    }
    if (rets.length < 20) return null;
    const yrs = rets.length * 4 / 24 / 365;
    const ann = Math.pow(eq, 1 / yrs) - 1;
    const vol = sd(rets) * Math.sqrt(2190);
    return { ann, vol, sharpe: vol ? ann / vol : 0, t: sd(rets) ? mean(rets) / (sd(rets) / Math.sqrt(rets.length)) : 0, n: rets.length };
  }

  const N = stamps.length - 1, half = Math.floor(N / 2);
  console.log("dollar-neutral book on whale_vs_retail");
  console.log("window".padStart(10) + "K".padStart(4) + "ann".padStart(10) + "vol".padStart(9) + "sharpe".padStart(8) + "t".padStart(7));
  const book = {};
  for (const [lab, a, b] of [["full", 1, N], ["first", 1, half], ["second", half, N]]) {
    for (const K of [4, 6, 8]) {
      const r = backtest(a, b, K, -1, false);
      if (!r) continue;
      if (lab === "full") book[`k${K}`] = r;
      console.log(lab.padStart(10) + String(K).padStart(4) + (r.ann * 100).toFixed(1).padStart(9) + "%"
        + (r.vol * 100).toFixed(1).padStart(8) + "%" + r.sharpe.toFixed(2).padStart(8) + r.t.toFixed(2).padStart(7));
    }
  }

  // A real cross-sectional signal inverts cleanly. Noise does not.
  const fwdR = backtest(1, N, 6, -1, false), revR = backtest(1, N, 6, 1, false);
  console.log(`\nsign check   forward ${(fwdR.ann * 100).toFixed(1)}%  reversed ${(revR.ann * 100).toFixed(1)}%`);

  // Shuffle the feature ACROSS SYMBOLS WITHIN each timestamp. This destroys the
  // cross-sectional ranking while leaving the market path, the volatility
  // clustering and the turnover schedule untouched — so it isolates exactly the
  // claim being made.
  let beat = 0;
  for (let i = 0; i < SHUFFLES; i++) {
    const r = backtest(1, N, 6, -1, true);
    if (r && r.ann >= fwdR.ann) beat++;
  }
  console.log(`shuffle      ${beat}/${SHUFFLES} beat the real book  =>  p = ${(beat / SHUFFLES).toFixed(2)}`);

  console.log("\nREMINDER: 40.5 days, best of 8 features, t=2.21 does not clear Bonferroni (2.73).");
  console.log("The v7 paper lane exists to grow the sample, not because this is settled.");
}

main().catch((e) => { console.error(e); process.exit(1); });
