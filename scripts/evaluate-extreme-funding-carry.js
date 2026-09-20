#!/usr/bin/env node
"use strict";

// scripts/evaluate-extreme-funding-carry.js — GPT-5.5 sixth consultation,
// candidate 1: harvest funding only in extreme episodes (2026-09-19).
//
// GPT's rule: coins with both a USDT spot pair and a USDT perp; enter spot long
// / perp short when the last three funding payments sum to >= 0.24% (0.08% per
// 8h); skip the first 48h after the perp lists; hold 7 days or exit when the
// last three sum < 0.06%; fees on both legs. GPT's pass criteria: losing months
// <= 20%, mean / |worst month| >= 0.25, each of 2023 / 2024 / 2025+ good, top 5
// episodes <= 50% of total P&L.
//
// CHOICES FIXED BY CLAUDE BEFORE THE RUN
//   intervals   "last three payments" is normalised to the trailing 24h sum
//               (>= 0.24% to enter, < 0.06% to exit) so 1h / 4h / 8h contracts
//               compare; evaluated at each funding timestamp, entry earns from
//               the NEXT payment.
//   omitted     GPT's 0-1.5% spot/perp basis filter needs premium history that
//               is not collected; basis P&L is assumed zero. Both omissions are
//               stated, not hidden.
//   costs       0.15% per side per leg-pair (spot 0.10% + perp 0.05%), 0.30% a
//               round trip, charged on notional.
//   capital     1.3x notional per episode (spot plus perp margin).
//   survivors   delisted (SETTLING) perps are included with their full funding
//               history; spot availability includes delisted (BREAK) spot pairs.
//   period      episodes entered 2023-01-01 .. end of data.
//   feasible    the size needed for a 3% mean month x peak concurrent episodes
//               x 1.3 must be <= 100% of NAV.
//
// Usage: node scripts/evaluate-extreme-funding-carry.js --perps META --funding DIR --spot SPOTMETA

const fs = require("fs");
const path = require("path");

// ---- frozen parameters ------------------------------------------------------
const H = 3600e3;
const DAY = 864e5;
const ENTER = 0.0024;
const EXIT = 0.0006;
const HOLD_MAX = 7 * DAY;
const SKIP_AFTER_LISTING = 48 * H;
const RT_COST = 0.003;
const CAP = 1.3;
const FROM = Date.parse("2023-01-01T00:00:00Z");
// -----------------------------------------------------------------------------

function arg(n) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const perps = JSON.parse(fs.readFileSync(arg("perps"), "utf8"));
  const spot = JSON.parse(fs.readFileSync(arg("spot"), "utf8")).symbols;
  const spotBases = new Set(spot.map((s) => s.base));
  const fdir = arg("funding");
  const monthPnl = new Map();
  const episodes = [];
  const openAt = new Map();   // day -> open episodes
  for (const p of perps.perps) {
    const base = p.base.replace(/^(1000000|100000|10000|1000|1M)/, "");
    if (!spotBases.has(p.base) && !spotBases.has(base)) continue;
    const f = path.join(fdir, `${p.symbol}.json`);
    if (!fs.existsSync(f)) continue;
    const rows = JSON.parse(fs.readFileSync(f, "utf8")).filter(([t, r]) => Number.isFinite(r)).sort((a, b) => a[0] - b[0]);
    let inPos = false, entryT = 0, pnl = 0, lo = 0;
    const book = (t, v) => { const m = new Date(t).toISOString().slice(0, 7); monthPnl.set(m, (monthPnl.get(m) || 0) + v); };
    for (let i = 0; i < rows.length; i += 1) {
      const [t, r] = rows[i];
      while (rows[lo][0] <= t - DAY) lo += 1;
      let trail = 0;
      for (let k = lo; k <= i; k += 1) trail += rows[k][1];
      if (inPos) {
        // this payment accrues to the open episode (entered before it)
        book(t, r / CAP); pnl += r / CAP;
        const d = Math.floor(t / DAY) * DAY; openAt.set(d, (openAt.get(d) || 0) + 1);
        if (trail < EXIT || t - entryT >= HOLD_MAX) {
          book(t, -RT_COST / 2 / CAP); pnl -= RT_COST / 2 / CAP;
          episodes.push({ symbol: p.symbol, entered: new Date(entryT).toISOString().slice(0, 13), pnl });
          inPos = false;
        }
      } else if (t >= FROM && t - p.onboard >= SKIP_AFTER_LISTING && trail >= ENTER) {
        inPos = true; entryT = t; pnl = -RT_COST / 2 / CAP; book(t, -RT_COST / 2 / CAP);
      }
    }
    if (inPos) { episodes.push({ symbol: p.symbol, entered: new Date(entryT).toISOString().slice(0, 13), pnl, open: true }); }
  }
  const last = new Date(Math.max(...[...monthPnl.keys()].map((m) => Date.parse(m + "-01")))).toISOString().slice(0, 7);
  const months = [];
  for (let d = new Date("2023-01-01T00:00:00Z"); d.toISOString().slice(0, 7) < last; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const m = d.toISOString().slice(0, 7); months.push([m, monthPnl.get(m) || 0]);
  }
  const vals = months.map(([, v]) => v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const worst = months.reduce((a, b) => (b[1] < a[1] ? b : a));
  const losing = vals.filter((v) => v < 0).length / vals.length;
  const byYear = (pred) => { const h = months.filter(([m]) => pred(m)).map(([, v]) => v); return h.reduce((a, b) => a + b, 0) / h.length; };
  const y23 = byYear((m) => m.startsWith("2023")), y24 = byYear((m) => m.startsWith("2024")), y25 = byYear((m) => m >= "2025");
  const total = episodes.reduce((a, e) => a + e.pnl, 0);
  const top5 = episodes.map((e) => e.pnl).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const peak = Math.max(0, ...openAt.values());
  const sizeFor3 = mean > 0 ? 0.03 / mean : null;
  const ratio = worst[1] < 0 ? mean / Math.abs(worst[1]) : Infinity;
  const pass = losing <= 0.2 && ratio >= 0.25 && y23 > 0 && y24 > 0 && y25 > 0 && total > 0 && top5 / total <= 0.5 && sizeFor3 !== null && sizeFor3 * peak * CAP <= 1;
  console.log(JSON.stringify({
    episodes: episodes.length, symbols: new Set(episodes.map((e) => e.symbol)).size,
    episode_mean_pct_of_capital: +((total / episodes.length) * 100).toFixed(3),
    months: months.length, mean_month_units: +mean.toFixed(4), losing_share: +losing.toFixed(3),
    worst_month: `${worst[0]} ${worst[1].toFixed(4)}`, mean_over_worst: ratio === Infinity ? "no losing month" : +ratio.toFixed(3),
    year_means: { 2023: +y23.toFixed(4), 2024: +y24.toFixed(4), "2025+": +y25.toFixed(4) },
    top5_share: total > 0 ? +(top5 / total).toFixed(3) : null,
    peak_concurrent: peak, size_per_episode_for_3pct: sizeFor3 === null ? null : +sizeFor3.toFixed(3),
    capital_needed_at_peak: sizeFor3 === null ? null : +(sizeFor3 * peak * CAP).toFixed(2),
    verdict: pass ? "PASS" : "FAIL",
    monthly_units: months.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${v.toFixed(3)}`),
  }, null, 1));
}

if (require.main === module) main();
