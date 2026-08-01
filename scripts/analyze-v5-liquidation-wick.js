#!/usr/bin/env node
"use strict";

// scripts/analyze-v5-liquidation-wick.js (2026-08-01)
//
// Two of the three "never tested" ideas, tested together:
//
//   LIQUIDATION-CASCADE REVERSAL. Public historical liquidation data does not
//   exist (allForceOrders is 404, forceOrders needs a key and returns only
//   your own). But a cascade leaves an unmistakable print in the candle: a
//   long wick against an outsized volume bar — forced flow hitting the book
//   and being absorbed. That print IS available, for years, over REST.
//
//   REALIZED VOLATILITY. Used here as the normaliser: a "big wick" only means
//   something relative to how much the symbol has been moving, so every wick
//   is measured in units of trailing realized vol rather than raw percent.
//
// Unlike the /futures/data endpoints (capped at ~21 days), klines page back
// as far as we want — this study uses ~6 months per symbol, which is the
// first time in this project that a short-horizon signal gets real sample.
//
// Every control that killed the previous candidate is applied UP FRONT:
//   - symbol demeaning (this is what destroyed the retail_long signal)
//   - non-overlapping observations with the SE that actually applies
//   - first/second half stability
//   - explicit cost subtraction on the tradable version
//   - the full grid is printed, not just the best cell

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT"];
const INTERVAL = "1h";
const PAGES = 3;               // 3 x 1500 = 4500 bars ~ 187 days
const COST_PCT = 0.09;         // maker-first round trip, percent
const VOL_LOOKBACK = 24;       // hours for realized vol
const VOLUME_LOOKBACK = 24;

async function fetchKlines(sym) {
  const out = [];
  let endTime = Date.now();
  for (let p = 0; p < PAGES; p += 1) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${INTERVAL}&limit=1500&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.unshift(...rows);
    endTime = Number(rows[0][0]) - 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  // dedupe by open time
  const seen = new Set();
  return out
    .filter((r) => { const t = Number(r[0]); if (seen.has(t)) return false; seen.add(t); return true; })
    .map((r) => ({
      t: Number(r[0]), open: Number(r[1]), high: Number(r[2]),
      low: Number(r[3]), close: Number(r[4]), vol: Number(r[5]),
    }))
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.t - b.t);
}

function buildEvents(sym, bars) {
  const rows = [];
  for (let i = Math.max(VOL_LOOKBACK, VOLUME_LOOKBACK); i < bars.length - 12; i += 1) {
    const b = bars[i];
    // realized vol: stdev of trailing hourly log returns, in percent
    let s = 0, s2 = 0;
    for (let k = i - VOL_LOOKBACK; k < i; k += 1) {
      const r = Math.log(bars[k + 1].close / bars[k].close);
      s += r; s2 += r * r;
    }
    const mean = s / VOL_LOOKBACK;
    const rv = Math.sqrt(Math.max(s2 / VOL_LOOKBACK - mean * mean, 0)) * 100;
    if (!(rv > 0)) continue;

    let volSum = 0;
    for (let k = i - VOLUME_LOOKBACK; k < i; k += 1) volSum += bars[k].vol;
    const volAvg = volSum / VOLUME_LOOKBACK;
    if (!(volAvg > 0)) continue;

    const body = Math.abs(b.close - b.open);
    const lowerWickPct = (Math.min(b.open, b.close) - b.low) / b.close * 100;
    const upperWickPct = (b.high - Math.max(b.open, b.close)) / b.close * 100;

    rows.push({
      sym, i, t: b.t,
      lower_wick_rv: lowerWickPct / rv,     // wick measured in realized-vol units
      upper_wick_rv: upperWickPct / rv,
      vol_ratio: b.vol / volAvg,
      rv,
      body_pct: body / b.close * 100,
      fwd: {
        h1: bars[i + 1].close / b.close - 1,
        h4: bars[i + 4].close / b.close - 1,
        h12: bars[i + 12].close / b.close - 1,
      },
    });
  }
  return rows;
}

function stats(vals) {
  const n = vals.length;
  if (!n) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1e-12;
  return { n, mean_pct: mean * 100, t: (mean / (sd / Math.sqrt(n))) };
}

function report(label, subset, key, { costPct = 0, demeanBySym = null } = {}) {
  let vals = subset.map((r) => r.fwd[key]);
  if (demeanBySym) {
    vals = subset.map((r) => r.fwd[key] - (demeanBySym.get(r.sym) || 0));
  }
  const s = stats(vals);
  if (!s) return null;
  const net = s.mean_pct - costPct;
  return { ...s, net_pct: net, label };
}

async function main() {
  const bySym = new Map();
  for (const sym of SYMS) {
    try {
      const bars = await fetchKlines(sym);
      if (bars.length > 500) bySym.set(sym, bars);
    } catch (e) { console.error(`skip ${sym}: ${e.message}`); }
  }
  const all = [];
  for (const [sym, bars] of bySym) all.push(...buildEvents(sym, bars));
  all.sort((a, b) => a.t - b.t);

  const spanDays = all.length ? (all[all.length - 1].t - all[0].t) / 864e5 : 0;
  console.log(`symbols ${bySym.size}, observations ${all.length}, span ${spanDays.toFixed(0)} days (${INTERVAL})`);
  console.log(`cost assumption ${COST_PCT}% round trip (maker-first)\n`);

  // baseline forward return of ALL bars, per symbol — the demeaning reference
  const baseBySym = new Map();
  for (const [sym] of bySym) {
    const rows = all.filter((r) => r.sym === sym);
    for (const key of ["h1", "h4", "h12"]) {
      const m = rows.reduce((s, r) => s + r.fwd[key], 0) / (rows.length || 1);
      baseBySym.set(`${sym}|${key}`, m);
    }
  }

  console.log("=== LONG-WICK-DOWN events (long liquidation absorbed) → expect BOUNCE ===");
  console.log("thresholds are in realized-vol units; grid printed in full, no cell picked\n");
  console.log("wick>  vol>   horizon    n     mean%    net%(cost)   t-stat   demeaned-net%   1st/2nd sign");

  const grid = [];
  for (const wickTh of [1.0, 1.5, 2.0, 3.0]) {
    for (const volTh of [1.5, 2.0, 3.0]) {
      const subset = all.filter((r) => r.lower_wick_rv >= wickTh && r.vol_ratio >= volTh);
      if (subset.length < 50) continue;
      for (const key of ["h1", "h4", "h12"]) {
        const raw = report("raw", subset, key, { costPct: COST_PCT });
        // symbol-demeaned: subtract each symbol's unconditional mean forward return
        const dm = new Map();
        for (const [sym] of bySym) dm.set(sym, baseBySym.get(`${sym}|${key}`) || 0);
        const demeaned = report("demeaned", subset, key, { costPct: COST_PCT, demeanBySym: dm });
        // time-split sign stability
        const half = Math.floor(subset.length / 2);
        const s1 = stats(subset.slice(0, half).map((r) => r.fwd[key]));
        const s2 = stats(subset.slice(half).map((r) => r.fwd[key]));
        const stable = s1 && s2 && Math.sign(s1.mean_pct) === Math.sign(s2.mean_pct);
        grid.push({ wickTh, volTh, key, raw, demeaned, stable });
        console.log(
          String(wickTh).padStart(5) + String(volTh).padStart(6) + "   " + key.padEnd(6) +
          String(raw.n).padStart(6) + raw.mean_pct.toFixed(3).padStart(10) +
          raw.net_pct.toFixed(3).padStart(12) + raw.t.toFixed(2).padStart(9) +
          demeaned.net_pct.toFixed(3).padStart(15) + "   " + (stable ? "same" : "FLIP")
        );
      }
    }
  }

  console.log("\n=== UPPER-WICK events (short squeeze exhausted) → expect FADE ===");
  console.log("wick>  vol>   horizon    n     mean%    net%(cost)   t-stat   demeaned-net%   1st/2nd sign");
  for (const wickTh of [1.5, 2.0, 3.0]) {
    for (const volTh of [2.0, 3.0]) {
      const subset = all.filter((r) => r.upper_wick_rv >= wickTh && r.vol_ratio >= volTh);
      if (subset.length < 50) continue;
      for (const key of ["h4", "h12"]) {
        // fading an upper wick = SHORT, so the tradable return is negated
        const vals = subset.map((r) => -r.fwd[key]);
        const s = stats(vals);
        const dmMean = subset.reduce((acc, r) => acc + (baseBySym.get(`${r.sym}|${key}`) || 0), 0) / subset.length;
        const dmNet = (s.mean_pct + dmMean * 100) - COST_PCT; // add back because return was negated
        const half = Math.floor(vals.length / 2);
        const a = stats(vals.slice(0, half)), b = stats(vals.slice(half));
        const stable = a && b && Math.sign(a.mean_pct) === Math.sign(b.mean_pct);
        console.log(
          String(wickTh).padStart(5) + String(volTh).padStart(6) + "   " + key.padEnd(6) +
          String(s.n).padStart(6) + s.mean_pct.toFixed(3).padStart(10) +
          (s.mean_pct - COST_PCT).toFixed(3).padStart(12) + s.t.toFixed(2).padStart(9) +
          dmNet.toFixed(3).padStart(15) + "   " + (stable ? "same" : "FLIP")
        );
      }
    }
  }

  const survivors = grid.filter((g) => g.demeaned.net_pct > 0 && g.stable && Math.abs(g.raw.t) > 2);
  console.log(`\n=== SUMMARY ===`);
  console.log(`grid cells tested: ${grid.length} (+ upper-wick cells)`);
  console.log(`cells with positive cost-adjusted DEMEANED return, stable sign, |t|>2: ${survivors.length}`);
  for (const s of survivors) {
    console.log(`  wick>=${s.wickTh} vol>=${s.volTh} @ ${s.key}: net ${s.raw.net_pct.toFixed(3)}%, demeaned ${s.demeaned.net_pct.toFixed(3)}%, t=${s.raw.t.toFixed(2)}, n=${s.raw.n}`);
  }
  console.log(`\nexpected false positives at this cell count: ~${(grid.length * 0.05).toFixed(1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
