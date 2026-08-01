#!/usr/bin/env node
"use strict";

// scripts/analyze-v6-funding-timing.js (2026-08-01)
//
// Everything measured so far treated funding as a LEVEL: "BTC pays ~6%/yr,
// that is barely over risk-free, so hold stablecoins." But funding is paid
// every 8h and it moves a lot. Harvesting it SELECTIVELY — hold the
// delta-neutral book only while the rate is rich, sit in the risk-free asset
// otherwise — can earn far more than the average, and it requires no price
// prediction: funding is received, not forecast.
//
// The only assumption is PERSISTENCE: that a rich rate now implies a rich
// rate over the next few periods. That is an empirical property, tested
// first — if funding is not autocorrelated, selective harvesting is
// impossible and the idea dies here.
//
// Then a full simulation, honest about the things that killed earlier
// candidates:
//   - switching costs charged on every entry/exit (both legs)
//   - idle capital earns the risk-free rate, so the benchmark is beaten
//     only by genuine excess
//   - per-symbol results shown, not just the pooled best
//   - the always-on and always-risk-free baselines printed alongside
//
// Data: /fapi/v1/fundingRate pages back years — unlike the 21-day
// /futures/data endpoints, this study has real history.

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT"];
const RISK_FREE_ANNUAL = 0.05;
// delta-neutral entry = 2 legs, exit = 2 legs. Maker-first both sides.
const SWITCH_COST = 0.0008;   // 0.08% per full entry+exit cycle
const PAGES = 6;              // 6 x 1000 funding events ~ 5.5 years per symbol

async function fetchFunding(sym) {
  const out = [];
  let endTime = Date.now();
  for (let p = 0; p < PAGES; p += 1) {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1000&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    out.unshift(...rows);
    endTime = Number(rows[0].fundingTime) - 1;
    await new Promise((r) => setTimeout(r, 130));
  }
  const seen = new Set();
  return out
    .filter((r) => { const t = Number(r.fundingTime); if (seen.has(t)) return false; seen.add(t); return true; })
    .map((r) => ({ t: Number(r.fundingTime), rate: Number(r.fundingRate) }))
    .filter((r) => Number.isFinite(r.rate))
    .sort((a, b) => a.t - b.t);
}

function autocorr(series, lag) {
  const n = series.length - lag;
  if (n < 50) return null;
  const a = series.slice(0, n), b = series.slice(lag, lag + n);
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i += 1) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / (Math.sqrt(da * db) || 1e-12);
}

// Simulate selective harvesting.
//   enter when the trailing average rate >= enterTh, exit when it < exitTh.
//   While in position: receive each funding payment. While out: earn risk-free.
//   Every entry and every exit pays SWITCH_COST/2.
function simulate(rows, { enterTh, exitTh, lookback = 3 }) {
  const rfPerPeriod = Math.pow(1 + RISK_FREE_ANNUAL, 8 / (24 * 365)) - 1;
  let equity = 1, inPos = false, switches = 0, periodsIn = 0;
  for (let i = lookback; i < rows.length; i += 1) {
    let trail = 0;
    for (let k = i - lookback; k < i; k += 1) trail += rows[k].rate;
    trail /= lookback;

    if (!inPos && trail >= enterTh) { inPos = true; switches += 1; equity *= 1 - SWITCH_COST / 2; }
    else if (inPos && trail < exitTh) { inPos = false; switches += 1; equity *= 1 - SWITCH_COST / 2; }

    if (inPos) { equity *= 1 + rows[i].rate; periodsIn += 1; }
    else { equity *= 1 + rfPerPeriod; }
  }
  const years = (rows[rows.length - 1].t - rows[lookback].t) / (365.25 * 864e5);
  return {
    ann_pct: (Math.pow(equity, 1 / Math.max(years, 1e-6)) - 1) * 100,
    years, switches,
    time_in_pct: (periodsIn / Math.max(rows.length - lookback, 1)) * 100,
  };
}

function alwaysOn(rows) {
  let equity = 1;
  equity *= 1 - SWITCH_COST / 2;
  for (const r of rows) equity *= 1 + r.rate;
  const years = (rows[rows.length - 1].t - rows[0].t) / (365.25 * 864e5);
  return { ann_pct: (Math.pow(equity, 1 / Math.max(years, 1e-6)) - 1) * 100, years };
}

async function main() {
  const data = new Map();
  for (const s of SYMS) {
    try { const r = await fetchFunding(s); if (r.length > 500) data.set(s, r); }
    catch (e) { console.error(`skip ${s}: ${e.message}`); }
  }
  const anyRows = [...data.values()][0] || [];
  const span = anyRows.length ? (anyRows[anyRows.length - 1].t - anyRows[0].t) / (365.25 * 864e5) : 0;
  console.log(`symbols ${data.size}, events/symbol ~${anyRows.length}, span ~${span.toFixed(1)} years`);
  console.log(`risk-free ${(RISK_FREE_ANNUAL * 100).toFixed(1)}%/yr, switch cost ${(SWITCH_COST * 100).toFixed(2)}% per cycle\n`);

  // ---- PREREQUISITE: is funding persistent at all? -------------------------
  console.log("=== STEP 1: does funding persist? (autocorrelation of the 8h rate) ===");
  console.log("if these are ~0, selective harvesting is impossible and the idea is dead\n");
  console.log("symbol      lag1     lag3     lag9(1d)  lag21(1wk)   mean%/yr");
  const persist = [];
  for (const [sym, rows] of data) {
    const series = rows.map((r) => r.rate);
    const a1 = autocorr(series, 1), a3 = autocorr(series, 3), a9 = autocorr(series, 9), a21 = autocorr(series, 21);
    const meanAnn = series.reduce((s, x) => s + x, 0) / series.length * 3 * 365 * 100;
    persist.push({ sym, a1, a3, a9, a21, meanAnn });
    console.log(sym.padEnd(11) + [a1, a3, a9, a21].map((v) => (v === null ? "  n/a" : v.toFixed(3)).padStart(8)).join("") + meanAnn.toFixed(2).padStart(11));
  }
  const avgA9 = persist.filter((p) => p.a9 !== null).reduce((s, p) => s + p.a9, 0) / persist.length;
  console.log(`\naverage 1-day autocorrelation: ${avgA9.toFixed(3)} — ${avgA9 > 0.3 ? "STRONG persistence, selective harvesting is viable" : avgA9 > 0.1 ? "moderate persistence" : "too weak, idea dies"}`);

  // ---- SIMULATION ---------------------------------------------------------
  console.log("\n=== STEP 2: selective harvest vs always-on vs risk-free ===");
  console.log("thresholds are per-8h rates; 0.0001 = 0.01% per 8h = ~11%/yr\n");
  const GRID = [
    { enterTh: 0.00005, exitTh: 0.00002, label: "enter>5.5%/yr" },
    { enterTh: 0.0001, exitTh: 0.00005, label: "enter>11%/yr " },
    { enterTh: 0.0002, exitTh: 0.0001, label: "enter>22%/yr " },
    { enterTh: 0.0003, exitTh: 0.00015, label: "enter>33%/yr " },
  ];
  console.log("symbol      always-on   " + GRID.map((g) => g.label).join("  ") + "   (time in position %)");
  const totals = new Map(GRID.map((g) => [g.label, []]));
  const alwaysTotals = [];
  for (const [sym, rows] of data) {
    const ao = alwaysOn(rows);
    alwaysTotals.push(ao.ann_pct);
    const cells = [];
    for (const g of GRID) {
      const r = simulate(rows, g);
      totals.get(g.label).push(r.ann_pct);
      cells.push(`${r.ann_pct.toFixed(1).padStart(7)}%(${r.time_in_pct.toFixed(0)}%)`);
    }
    console.log(sym.padEnd(11) + `${ao.ann_pct.toFixed(1).padStart(8)}%   ` + cells.join("  "));
  }

  console.log("\n=== PORTFOLIO AVERAGE (equal weight across symbols) ===");
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  console.log(`  risk-free (do nothing) : ${(RISK_FREE_ANNUAL * 100).toFixed(2)}%/yr`);
  console.log(`  always-on harvest      : ${avg(alwaysTotals).toFixed(2)}%/yr   (excess ${(avg(alwaysTotals) - RISK_FREE_ANNUAL * 100).toFixed(2)}pp)`);
  for (const g of GRID) {
    const a = avg(totals.get(g.label));
    console.log(`  selective ${g.label}: ${a.toFixed(2)}%/yr   (excess ${(a - RISK_FREE_ANNUAL * 100).toFixed(2)}pp)`);
  }
  console.log("\nnote: funding is RECEIVED, not predicted. The only assumption is that a rich");
  console.log("      rate persists for a few periods, which STEP 1 measures directly.");
}

main().catch((e) => { console.error(e); process.exit(1); });
