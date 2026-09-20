#!/usr/bin/env node
"use strict";

// scripts/evaluate-delisting-short.js — GPT-5.5 sixth consultation, candidate
// 3 (its highest, 20-30%): short a token's USDT perp after Binance announces
// the token's delisting (2026-09-19).
//
// Mechanism (GPT): holders must exit before a deadline, market makers step
// back, collateral and withdrawal paths close, natural buyers disappear.
//
// EVENTS, fixed before any price was fetched: every Binance announcement titled
// "Binance Will Delist <tokens> on <date>" (catalog 161, fetched 2026-09-19,
// 433 articles back to 2022-02), each token matched to TOKEN / 1000TOKEN /
// 1000000TOKEN + USDT perpetual that was listed before the announcement.
// 61 events: 2024 11, 2025 16, 2026 34. No event is dropped after the fact.
//
// RULE (GPT, with Claude's fixes stated)
//   entry   close of the hourly bar in which the announcement falls (the first
//           hourly close after it)
//   exit    the earlier of 168 hours after entry and 12 hours before the perp's
//           last hourly bar (its trading end)
//   margin  1x; if an hourly HIGH reaches 2x entry, liquidated at -100%
//   costs   0.15% per side; funding received by the short credited
//   P&L     units of one position's capital, booked to the exit month
//
// PASS (GPT's criteria): losing months <= 20% (months with no event count as
// zero, not as wins), mean / |worst month| >= 0.25, both 2024-2025 and 2026
// with positive mean, top 5 events <= 50% of total P&L, and the size for a 3%
// mean month x peak concurrent positions <= 100% of NAV.
//
// Usage: node scripts/evaluate-delisting-short.js --events events.json --bars DIR --funding DIR

const fs = require("fs");
const path = require("path");

// ---- frozen parameters ------------------------------------------------------
const H = 3600e3;
const HOLD = 168;
const PRE_END = 12;
const COST = 0.0015;
const LIQ = 2.0;
const FIRST_MONTH = "2024-01";
// -----------------------------------------------------------------------------

function arg(n) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const events = JSON.parse(fs.readFileSync(arg("events"), "utf8")).filter((e) => e.perp && e.perp_listed_before);
  const monthPnl = new Map();
  const trades = [];
  const openHours = new Map();
  let lastSeen = "";
  for (const e of events) {
    const bars = JSON.parse(fs.readFileSync(path.join(arg("bars"), `${e.perp}_${e.announced.slice(0, 13)}.json`), "utf8"));
    const fp = path.join(arg("funding"), `${e.perp}.json`);
    const fund = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : [];
    const ann = Date.parse(e.announced);
    const ei = bars.findIndex((b) => b[0] <= ann && ann < b[0] + H);
    if (ei < 0 || ei >= bars.length - 1) { trades.push({ ...e, skipped: "no bar at announcement" }); continue; }
    const entry = bars[ei][4];
    const lastBar = bars.length - 1;
    const exitI = Math.min(ei + HOLD, lastBar - PRE_END);
    if (exitI <= ei) { trades.push({ ...e, skipped: "trading ends within 12h" }); continue; }
    let pnl = -COST, liq = false, exitAt = exitI;
    for (let k = ei + 1; k <= exitI; k += 1) {
      openHours.set(bars[k][0], (openHours.get(bars[k][0]) || 0) + 1);
      if (bars[k][2] >= entry * LIQ) { pnl = -1; liq = true; exitAt = k; break; }
    }
    if (!liq) {
      pnl += -(bars[exitI][4] - entry) / entry - COST;
      for (const [t, r] of fund) if (t > bars[ei][0] + H && t <= bars[exitI][0] + H) pnl += r;
    }
    const m = new Date(bars[exitAt][0]).toISOString().slice(0, 7);
    monthPnl.set(m, (monthPnl.get(m) || 0) + pnl);
    if (m > lastSeen) lastSeen = m;
    trades.push({ perp: e.perp, announced: e.announced.slice(0, 16), pnl: +pnl.toFixed(4), liquidated: liq });
  }
  const done = trades.filter((t) => !t.skipped);
  const months = [];
  for (let d = new Date(`${FIRST_MONTH}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= lastSeen; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const m = d.toISOString().slice(0, 7); months.push([m, monthPnl.get(m) || 0]);
  }
  const vals = months.map(([, v]) => v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const worst = months.reduce((a, b) => (b[1] < a[1] ? b : a));
  const losing = vals.filter((v) => v < 0).length / vals.length;
  const half = (pred) => { const h = months.filter(([m]) => pred(m)).map(([, v]) => v); return h.reduce((a, b) => a + b, 0) / h.length; };
  const h1 = half((m) => m < "2026-01"), h2 = half((m) => m >= "2026-01");
  const total = done.reduce((a, t) => a + t.pnl, 0);
  const top5 = done.map((t) => t.pnl).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const peak = Math.max(0, ...openHours.values());
  const sizeFor3 = mean > 0 ? 0.03 / mean : null;
  const ratio = worst[1] < 0 ? mean / Math.abs(worst[1]) : Infinity;
  const pass = losing <= 0.2 && ratio >= 0.25 && h1 > 0 && h2 > 0 && total > 0 && top5 / total <= 0.5 && sizeFor3 !== null && sizeFor3 * peak <= 1;
  const tp = done.map((t) => t.pnl).sort((a, b) => a - b);
  console.log(JSON.stringify({
    events: events.length, traded: done.length, skipped: trades.filter((t) => t.skipped).map((t) => `${t.perp} ${t.skipped}`),
    liquidations: done.filter((t) => t.liquidated).length, win_rate: +(done.filter((t) => t.pnl > 0).length / done.length).toFixed(3),
    trade_mean_pct: +((total / done.length) * 100).toFixed(2), trade_median_pct: +(tp[Math.floor(tp.length / 2)] * 100).toFixed(2),
    months: months.length, mean_month_units: +mean.toFixed(4), losing_share: +losing.toFixed(3), worst_month: `${worst[0]} ${worst[1].toFixed(3)}`,
    mean_over_worst: ratio === Infinity ? "no losing month" : +ratio.toFixed(3), half_means: { "2024-2025": +h1.toFixed(4), "2026": +h2.toFixed(4) },
    top5_share: total > 0 ? +(top5 / total).toFixed(3) : null, peak_concurrent: peak,
    size_for_3pct: sizeFor3 === null ? null : +sizeFor3.toFixed(3), capital_at_peak: sizeFor3 === null ? null : +(sizeFor3 * peak).toFixed(2),
    verdict: pass ? "PASS" : "FAIL",
    monthly_units: months.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${v.toFixed(3)}`),
  }, null, 1));
}

if (require.main === module) main();
