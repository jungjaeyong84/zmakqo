#!/usr/bin/env node
"use strict";

// scripts/evaluate-new-listing-short.js — do newly listed Binance perps drift
// down after listing, and can shorting that drift pay steadily? (2026-09-19)
//
// ORIGIN: GPT-5.5's fifth consultation said no price-pattern candidate left
// has a realistic 3%/month, and that the remaining search space is structural
// friction — forced flows around listings, unlocks, delistings. The user then
// lifted every research constraint, including one-directional trades and
// leverage. This is the first such candidate testable with public data.
// Mechanism: new tokens list with a small float against a large supply that
// unlocks later; early buyers and airdrop recipients sell into the listing.
//
// FROZEN SPEC (written before any post-listing return was looked at)
// ------------------------------------------------------------------
//   listings  every USDT perpetual with onboardDate from 2023-01-01, including
//             delisted (SETTLING) contracts, whose history is still served;
//             listed at least 45 days before the fetch.
//   entry     short at the close of the listing's SECOND daily bar (skip the
//             first, partial, most chaotic day).
//   exit      close of the 31st bar after entry (30 days held), or the last bar
//             if the contract stops trading first.
//   margin    each short fully collateralised (1x). If any day's HIGH reaches
//             2x the entry price the position is liquidated: loss = 100% of its
//             capital, closed.
//   costs     0.15% per side (taker 0.05% + 0.10% slippage for thin new
//             books); funding received by the short is credited daily.
//   P&L       in units of one position's capital; monthly P&L = sum over
//             positions of P&L booked (daily marked) inside the month.
//
//   PASS (the user's goal of a STEADY 3-5%/month, made scale-free):
//     losing months <= 20%, AND mean / |worst month| >= 0.25, AND both halves
//     (2023-02..2024-10, 2024-11..end) have positive mean, AND the size needed
//     for a 3% mean month fits fully collateralised: size x peak concurrent
//     positions <= 100% of NAV. Leverage is allowed by the user but not needed
//     to judge: the ratios above decide whether ANY size could be steady.
//
// Usage: node scripts/evaluate-new-listing-short.js --data DIR
//   DIR/meta.json { fetched_at, perps: [{symbol, onboard, status}] }
//   DIR/ohlc/SYM.json [[openTime, open, high, low, close]]
//   DIR/funding/SYM.json [[fundingTime, rate]]

const fs = require("fs");
const path = require("path");

// ---- frozen parameters: do not tune ----------------------------------------
const DAY = 864e5;
const FROM = Date.parse("2023-01-01T00:00:00Z");
const MIN_AGE_DAYS = 45;
const HOLD = 30;
const COST_SIDE = 0.0015;
const LIQ_MULT = 2.0;
const SPLIT = "2024-11";
// -----------------------------------------------------------------------------

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0) { console.error("usage: --data DIR"); process.exit(2); }
  const dir = process.argv[i + 1];
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const fetchedAt = Date.parse(meta.fetched_at);
  const monthPnl = new Map();
  const concurrent = new Map();   // day -> open positions
  const trades = [];
  for (const p of meta.perps) {
    if (!(p.onboard >= FROM) || p.onboard > fetchedAt - MIN_AGE_DAYS * DAY) continue;
    const op = path.join(dir, "ohlc", `${p.symbol}.json`);
    const fp = path.join(dir, "funding", `${p.symbol}.json`);
    if (!fs.existsSync(op)) continue;
    const bars = JSON.parse(fs.readFileSync(op, "utf8")).filter((b) => b[0] + DAY <= fetchedAt);
    if (bars.length < 3) continue;
    const fund = new Map();
    if (fs.existsSync(fp)) for (const [t, r] of JSON.parse(fs.readFileSync(fp, "utf8"))) {
      const d = Math.floor(t / DAY) * DAY;
      fund.set(d, (fund.get(d) || 0) + r);
    }
    const entryIdx = 1;
    const entry = bars[entryIdx][4];
    const lastIdx = Math.min(bars.length - 1, entryIdx + HOLD);
    let prevClose = entry;
    let pnl = -COST_SIDE;   // entry cost, booked on the entry day
    const book = (t, v) => { const m = new Date(t).toISOString().slice(0, 7); monthPnl.set(m, (monthPnl.get(m) || 0) + v); };
    book(bars[entryIdx][0], -COST_SIDE);
    let liquidated = false;
    let exitIdx = lastIdx;
    for (let k = entryIdx + 1; k <= lastIdx; k += 1) {
      const [t, , hi, , cl] = bars[k];
      concurrent.set(t, (concurrent.get(t) || 0) + 1);
      if (hi >= entry * LIQ_MULT) {
        const v = -1 - pnl;                      // bring the position to -100%
        book(t, v); pnl += v; liquidated = true; exitIdx = k; break;
      }
      const f = fund.get(t) || 0;               // short receives positive funding
      const v = -(cl - prevClose) / entry + f;
      book(t, v); pnl += v; prevClose = cl;
    }
    if (!liquidated) { book(bars[exitIdx][0], -COST_SIDE); pnl -= COST_SIDE; }
    trades.push({ symbol: p.symbol, listed: new Date(p.onboard).toISOString().slice(0, 10), status: p.status, pnl, liquidated });
  }
  const lastMonth = new Date(fetchedAt).toISOString().slice(0, 7);
  const months = [...monthPnl].filter(([m]) => m !== lastMonth).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const vals = months.map(([, v]) => v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const worst = months.reduce((a, b) => (b[1] < a[1] ? b : a));
  const losing = vals.filter((v) => v < 0).length / vals.length;
  const halfMean = (pred) => { const h = months.filter(([m]) => pred(m)).map(([, v]) => v); return h.reduce((a, b) => a + b, 0) / h.length; };
  const h1 = halfMean((m) => m < SPLIT), h2 = halfMean((m) => m >= SPLIT);
  const peak = Math.max(...concurrent.values());
  const sizeFor3 = mean > 0 ? 0.03 / mean : null;   // fraction of NAV per position for a 3% mean month
  const ratio = mean / Math.abs(worst[1]);
  const pass = losing <= 0.2 && ratio >= 0.25 && h1 > 0 && h2 > 0 && sizeFor3 !== null && sizeFor3 * peak <= 1;
  const tp = trades.map((t) => t.pnl).sort((a, b) => a - b);
  console.log(JSON.stringify({
    listings: trades.length, delisted_included: trades.filter((t) => t.status !== "TRADING").length,
    liquidations: trades.filter((t) => t.liquidated).length,
    trade_mean_pct: +((tp.reduce((a, b) => a + b, 0) / tp.length) * 100).toFixed(2), trade_median_pct: +(tp[Math.floor(tp.length / 2)] * 100).toFixed(2),
    win_rate: +(trades.filter((t) => t.pnl > 0).length / trades.length).toFixed(3),
    months: months.length, mean_month_units: +mean.toFixed(4), losing_share: +losing.toFixed(3),
    worst_month: `${worst[0]} ${worst[1].toFixed(3)}`, mean_over_worst: +ratio.toFixed(3),
    half_means: { before_2024_11: +h1.toFixed(4), from_2024_11: +h2.toFixed(4) },
    peak_concurrent: peak, size_per_position_for_3pct: sizeFor3 === null ? null : +sizeFor3.toFixed(4),
    gross_needed_at_peak: sizeFor3 === null ? null : +(sizeFor3 * peak).toFixed(2),
    verdict: pass ? "PASS" : "FAIL",
    monthly_units: months.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`),
  }, null, 1));
}

if (require.main === module) main();
