#!/usr/bin/env node
"use strict";

// scripts/evaluate-shock-reversal.js — does a violent, high-volume move reverse?
// (2026-09-20)
//
// ORIGIN: GPT-5.5's third consultation, candidate 3, never tested until now.
// Picked next because the user's objection to the forced-exit short was sample
// size: this one produces thousands of events from data already on disk.
// Mechanism: forced deleveraging (liquidation cascades, margin calls, panic
// exits) pushes a price past what information justifies; whoever supplies
// liquidity into that is paid by the bounce. Symmetric: a violent move UP from
// short liquidations is traded the same way, in the other direction.
//
// FROZEN SPEC (written before any event return was looked at)
//   universe   Binance USDT spot pairs including delisted (BREAK) ones; a gap of
//              more than 3 days starts a new listing; >= 60 prior bars;
//              trailing 30-day average quote volume >= $5M at the event.
//   event      daily bar t with |return| >= 20% AND quote volume >= 3x its
//              trailing 30-day average.
//   trade      at bar t's close, take the OPPOSITE side, hold 3 days, exit at
//              the close of t+3 (or the last bar if the pair stops trading).
//   hedge      BTC's return over the same window is subtracted, so the number
//              is the idiosyncratic bounce, not market direction.
//   costs      0.15% per side (spot fee plus slippage), charged twice.
//   P&L        per event, in units of one position's notional; a month's P&L is
//              the sum of events exiting in it.
//
//   PASS (the user's steady 3-5%/month, made scale-free)
//     losing months <= 20%, mean / |worst month| >= 0.25, both halves of the
//     sample positive, top 5 events <= 50% of total P&L, and the size needed for
//     a 3% mean month x peak concurrent positions <= 150% of NAV (the user has
//     allowed leverage; 1.5x is the cap GPT and Claude fixed for this family).
//
// Usage: node scripts/evaluate-shock-reversal.js --data DIR   (DIR = mom study data)

const fs = require("fs");
const path = require("path");

// ---- frozen parameters: do not tune ----------------------------------------
const DAY = 864e5;
const MOVE = 0.20;
const VOL_MULT = 3;
const VOL_WIN = 30;
const MIN_VOL_USD = 5e6;
const MIN_AGE = 60;
const HOLD = 3;
const COST = 0.0015;
const GAP_DAYS = 3;
const MAX_GROSS = 1.5;
const STABLES = new Set(["USDC", "BUSD", "TUSD", "USDP", "PAX", "DAI", "FDUSD", "USDS", "USDSB", "UST", "USTC", "EUR", "GBP", "AUD",
  "AEUR", "USDE", "PYUSD", "XUSD", "USD1", "BFUSD", "EURI", "SUSD", "PAXG", "BKRW", "IDRT", "BIDR", "RLUSD", "USDSOLD"]);
// -----------------------------------------------------------------------------

function load(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const series = [];
  for (const s of meta.symbols) {
    if (STABLES.has(s.base) || /(UP|DOWN|BULL|BEAR)USDT$/.test(s.symbol)) continue;
    const f = path.join(dir, "daily", `${s.symbol}.json`);
    if (!fs.existsSync(f)) continue;
    const rows = JSON.parse(fs.readFileSync(f, "utf8"));
    let cur = [];
    const flush = () => { if (cur.length) series.push({ symbol: s.symbol, bars: cur }); cur = []; };
    for (let i = 0; i < rows.length; i += 1) {
      if (cur.length && rows[i][0] - cur[cur.length - 1][0] > GAP_DAYS * DAY) flush();
      cur.push(rows[i]);
    }
    flush();
  }
  return series;
}

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0) { console.error("usage: --data DIR"); process.exit(2); }
  const series = load(process.argv[i + 1]);
  const btc = series.find((x) => x.symbol === "BTCUSDT" && x.bars.length > 1000);
  const btcClose = new Map(btc.bars.map((b) => [b[0], b[1]]));
  const trades = [];
  const open = new Map();
  for (const s of series) {
    for (let k = MIN_AGE; k < s.bars.length - 1; k += 1) {
      const [t, c, qv] = s.bars[k];
      const prev = s.bars[k - 1][1];
      if (!(prev > 0)) continue;
      const ret = c / prev - 1;
      if (Math.abs(ret) < MOVE) continue;
      let v = 0, n = 0;
      for (let j = k - VOL_WIN; j < k; j += 1) { if (Number.isFinite(s.bars[j][2])) { v += s.bars[j][2]; n += 1; } }
      if (n < VOL_WIN * 0.8) continue;
      const avg = v / n;
      if (!(avg >= MIN_VOL_USD) || !(qv >= VOL_MULT * avg)) continue;
      const exitK = Math.min(k + HOLD, s.bars.length - 1);
      if (exitK === k) continue;
      const side = ret > 0 ? -1 : 1;
      const raw = s.bars[exitK][1] / c - 1;
      const b0 = btcClose.get(t), b1 = btcClose.get(s.bars[exitK][0]);
      const hedge = Number.isFinite(b0) && Number.isFinite(b1) ? b1 / b0 - 1 : 0;
      const pnl = side * (raw - hedge) - 2 * COST;
      for (let d = k; d < exitK; d += 1) open.set(s.bars[d][0], (open.get(s.bars[d][0]) || 0) + 1);
      trades.push({ symbol: s.symbol, t, side, move: ret, pnl, month: new Date(s.bars[exitK][0]).toISOString().slice(0, 7) });
    }
  }
  const monthPnl = new Map();
  for (const tr of trades) monthPnl.set(tr.month, (monthPnl.get(tr.month) || 0) + tr.pnl);
  const all = [...monthPnl.keys()].sort();
  const lastMonth = all[all.length - 1];
  const months = all.filter((m) => m !== lastMonth).map((m) => [m, monthPnl.get(m)]);
  const vals = months.map(([, v]) => v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const worst = months.reduce((a, b) => (b[1] < a[1] ? b : a));
  const losing = vals.filter((v) => v < 0).length / vals.length;
  const mid = months[Math.floor(months.length / 2)][0];
  const half = (pred) => { const h = months.filter(([m]) => pred(m)).map(([, v]) => v); return h.reduce((a, b) => a + b, 0) / h.length; };
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const top5 = trades.map((t) => t.pnl).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const peak = Math.max(...open.values());
  const sizeFor3 = mean > 0 ? 0.03 / mean : null;
  const ratio = mean / Math.abs(worst[1]);
  const pass = losing <= 0.2 && ratio >= 0.25 && half((m) => m < mid) > 0 && half((m) => m >= mid) > 0
    && total > 0 && top5 / total <= 0.5 && sizeFor3 !== null && sizeFor3 * peak <= MAX_GROSS;
  const tp = trades.map((t) => t.pnl).sort((a, b) => a - b);
  const downs = trades.filter((t) => t.side === 1), ups = trades.filter((t) => t.side === -1);
  const stat = (a) => (a.length ? { n: a.length, mean_pct: +((a.reduce((x, y) => x + y.pnl, 0) / a.length) * 100).toFixed(3), win: +(a.filter((x) => x.pnl > 0).length / a.length).toFixed(3) } : null);
  console.log(JSON.stringify({
    events: trades.length, symbols: new Set(trades.map((t) => t.symbol)).size,
    after_crash_long: stat(downs), after_spike_short: stat(ups),
    trade_mean_pct: +((total / trades.length) * 100).toFixed(3), trade_median_pct: +(tp[Math.floor(tp.length / 2)] * 100).toFixed(3),
    months: months.length, first_month: months[0][0], mean_month_units: +mean.toFixed(3), losing_share: +losing.toFixed(3),
    worst_month: `${worst[0]} ${worst[1].toFixed(2)}`, mean_over_worst: +ratio.toFixed(3),
    half_means: { early: +half((m) => m < mid).toFixed(3), late: +half((m) => m >= mid).toFixed(3) },
    top5_share: +(top5 / total).toFixed(3), peak_concurrent: peak,
    size_for_3pct: sizeFor3 === null ? null : +sizeFor3.toFixed(4), gross_at_peak: sizeFor3 === null ? null : +(sizeFor3 * peak).toFixed(2),
    verdict: pass ? "PASS" : "FAIL",
    monthly_units: months.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${v.toFixed(1)}`),
  }, null, 1));
}

if (require.main === module) main();
