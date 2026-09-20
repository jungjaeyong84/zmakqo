#!/usr/bin/env node
"use strict";

// scripts/evaluate-weak-alt-short.js — short the weakest alts, hedged with BTC
// (2026-09-20)
//
// ORIGIN, STATED PLAINLY: this hypothesis comes from what today's tests showed,
// not from a prior belief. Three Binance forced-exit event families paid ~70%
// win rates on the SHORT side, and the shock study found that violent drops
// continue rather than bounce (long-after-crash -5.03% over 346 events). The
// common thread is that dying alts keep dying: supply overhang, delisting risk,
// market makers withdrawing, holders who must exit. This turns that thread into
// a large-sample, always-on rule instead of an event trade.
//
// Because the idea was formed on this data, a pass here is a reason to
// pre-register forward confirmation, not a result.
//
// FROZEN SPEC (written before the first run)
//   universe   Binance USDT spot pairs including delisted (BREAK) ones; gaps of
//              more than 3 days start a new listing; >= 120 prior bars; trailing
//              30-day average quote volume >= $5M; stablecoins and leveraged
//              tokens excluded; BTC excluded.
//   weekly     every Monday, using bars through Sunday's close.
//   short      the 10 worst by 90-day return, equal weight, 100% of NAV short in
//              aggregate.
//   hedge      long BTC for the same notional, so the book is dollar-neutral and
//              the number is not a bet on the market falling.
//   exit       weekly rebalance; a coin that stops trading is closed at its last
//              close (delistings are kept, not dropped).
//   costs      0.15% per side on both legs, charged on turnover.
//   liquidation the short leg is fully collateralised: a coin that doubles in a
//              week costs 100% of its slot.
//
//   PASS  mean monthly >= 3% at <= 1.5x gross, losing months <= 20%,
//         mean / |worst month| >= 0.25, both halves positive, and no single
//         month contributing more than 25% of total profit.
//
// Usage: node scripts/evaluate-weak-alt-short.js --data DIR   (the mom study data)

const fs = require("fs");
const path = require("path");

// ---- frozen parameters: do not tune ----------------------------------------
const DAY = 864e5;
const LOOKBACK = 90;
const K = 10;
const MIN_AGE = 120;
const VOL_WIN = 30;
const MIN_VOL_USD = 5e6;
const COST = 0.0015;
const GAP_DAYS = 3;
const START = Date.parse("2019-01-07T00:00:00Z");
const MAX_GROSS = 1.5;
const STABLES = new Set(["USDC", "BUSD", "TUSD", "USDP", "PAX", "DAI", "FDUSD", "USDS", "USDSB", "UST", "USTC", "EUR", "GBP", "AUD",
  "AEUR", "USDE", "PYUSD", "XUSD", "USD1", "BFUSD", "EURI", "SUSD", "PAXG", "BKRW", "IDRT", "BIDR", "RLUSD", "USDSOLD"]);
// -----------------------------------------------------------------------------

function load(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const out = [];
  for (const s of meta.symbols) {
    if (STABLES.has(s.base) || /(UP|DOWN|BULL|BEAR)USDT$/.test(s.symbol)) continue;
    const f = path.join(dir, "daily", `${s.symbol}.json`);
    if (!fs.existsSync(f)) continue;
    const rows = JSON.parse(fs.readFileSync(f, "utf8"));
    let cur = [];
    const flush = (n) => { if (cur.length) out.push({ id: `${s.symbol}#${n}`, symbol: s.symbol, bars: cur, idx: new Map(cur.map((b, i) => [b[0], i])) }); cur = []; };
    let n = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (cur.length && rows[i][0] - cur[cur.length - 1][0] > GAP_DAYS * DAY) { flush(n); n += 1; }
      cur.push(rows[i]);
    }
    flush(n);
  }
  return out;
}

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0) { console.error("usage: --data DIR"); process.exit(2); }
  const series = load(process.argv[i + 1]);
  const btc = series.find((x) => x.symbol === "BTCUSDT" && x.bars.length > 1000);
  const lastDay = Math.max(...series.map((s) => s.bars[s.bars.length - 1][0]));
  let equity = 1;
  let held = new Map();   // id -> { s, units(neg), entry }
  let btcUnits = 0;
  const daily = [];
  for (let d = START; d <= lastDay; d += DAY) {
    const prev = d - DAY;
    if (new Date(d).getUTCDay() === 1) {
      const cands = [];
      for (const s of series) {
        if (s.symbol === "BTCUSDT") continue;
        const idx = s.idx.get(prev);
        if (idx === undefined || idx < Math.max(MIN_AGE, LOOKBACK)) continue;
        let v = 0, n = 0;
        for (let j = idx - VOL_WIN + 1; j <= idx; j += 1) if (Number.isFinite(s.bars[j][2])) { v += s.bars[j][2]; n += 1; }
        if (n < VOL_WIN * 0.8 || v / n < MIN_VOL_USD) continue;
        const r90 = s.bars[idx][1] / s.bars[idx - LOOKBACK][1] - 1;
        cands.push({ s, idx, r90 });
      }
      cands.sort((a, b) => a.r90 - b.r90);
      const picks = cands.slice(0, K);
      // turnover: notional traded on both legs
      const newIds = new Set(picks.map((p) => p.s.id));
      let turn = 0;
      for (const id of new Set([...held.keys(), ...newIds])) turn += (held.has(id) ? 1 : 0) !== (newIds.has(id) ? 1 : 0) ? 1 / K : 0;
      equity *= 1 - turn * COST * 2;   // short leg and its BTC hedge both trade
      held = new Map();
      for (const p of picks) {
        const px = p.s.bars[p.idx][1];
        held.set(p.s.id, { s: p.s, units: -(equity / K) / px, entry: px });
      }
      const bi = btc.idx.get(prev);
      btcUnits = bi === undefined ? 0 : (equity * (picks.length / K)) / btc.bars[bi][1];
    }
    let pnl = 0;
    for (const [id, h] of [...held]) {
      const i1 = h.s.idx.get(d), i0 = h.s.idx.get(d - DAY);
      if (i1 !== undefined && i0 !== undefined) pnl += h.units * (h.s.bars[i1][1] - h.s.bars[i0][1]);
      else if (i1 === undefined) {
        // stopped trading: close at the last available close, no further P&L
        held.delete(id);
      }
    }
    const b1 = btc.idx.get(d), b0 = btc.idx.get(d - DAY);
    if (b1 !== undefined && b0 !== undefined) pnl += btcUnits * (btc.bars[b1][1] - btc.bars[b0][1]);
    equity += pnl;
    if (equity <= 0) { equity = 1e-9; }
    daily.push([d, equity]);
  }
  const monthEnd = new Map();
  for (const [d, e] of daily) monthEnd.set(new Date(d).toISOString().slice(0, 7), e);
  const ms = [...monthEnd].slice(0, -1);
  const rets = ms.map(([m, e], j) => [m, (e / (j ? ms[j - 1][1] : 1) - 1) * 100]);
  const vals = rets.map(([, v]) => v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const worst = rets.reduce((a, b) => (b[1] < a[1] ? b : a));
  const losing = vals.filter((v) => v < 0).length / vals.length;
  const mid = rets[Math.floor(rets.length / 2)][0];
  const half = (pred) => { const h = rets.filter(([m]) => pred(m)).map(([, v]) => v); return h.reduce((a, b) => a + b, 0) / h.length; };
  const total = vals.reduce((a, b) => a + b, 0);
  const best = Math.max(...vals);
  let peak = 0, mdd = 0;
  for (const [, e] of daily) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
  const pass = mean >= 3 && losing <= 0.2 && mean / Math.abs(worst[1]) >= 0.25 && half((m) => m < mid) > 0 && half((m) => m >= mid) > 0 && (total > 0 ? best / total <= 0.25 : false);
  console.log(JSON.stringify({
    months: rets.length, gross: `1.0x short + 1.0x BTC hedge (<= ${MAX_GROSS}x allowed)`,
    mean_monthly_pct: +mean.toFixed(2), median_monthly_pct: +vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)].toFixed(2),
    losing_share: +losing.toFixed(3), worst_month: `${worst[0]} ${worst[1].toFixed(1)}%`, best_month: `${rets.find(([, v]) => v === best)[0]} ${best.toFixed(1)}%`,
    mean_over_worst: +(mean / Math.abs(worst[1])).toFixed(3), max_drawdown_pct: +(mdd * 100).toFixed(1),
    half_means: { early: +half((m) => m < mid).toFixed(2), late: +half((m) => m >= mid).toFixed(2) },
    best_month_share_of_total: total > 0 ? +(best / total).toFixed(3) : null,
    verdict: pass ? "PASS" : "FAIL",
    monthly: rets.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${v.toFixed(1)}`),
  }, null, 1));
}

if (require.main === module) main();
