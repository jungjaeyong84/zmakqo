#!/usr/bin/env node
"use strict";

// scripts/evaluate-kimchi-inventory-arb.js — Upbit/Binance premium, harvested
// with inventory on both sides and no transfers (2026-09-19).
//
// ORIGIN: GPT-5.5's first pick in the third consultation (2026-09-19), ranked
// 8-12% for a steady 3-5% a month. Its rules and its pass criteria are used
// verbatim; only the cost and capital assumptions below are Claude's.
//
// FROZEN SPEC (written before the first run; do not tune)
// -------------------------------------------------------
//   premium   k(t) = Upbit KRW close / (Binance USDT close x USDKRW) - 1, hourly.
//             USDKRW is the last daily close dated BEFORE t's UTC day, so the
//             rate is always known at t.
//   coins     BTC, ETH, XRP, SOL, one lot each, equal KRW notional N.
//   rule      state A (coin held on Upbit, USDT on Binance):
//               k(t) >= 4%  -> at the NEXT hour's close sell q on Upbit, buy q on
//                              Binance (q = N / Upbit price)             -> state B
//             state B:
//               k(t) <= 1%  -> at the next hour's close buy q on Upbit, sell q on
//                              Binance                                   -> state A
//             Acting on the next bar, not the one that triggered, so the
//             trigger price is never the fill price.
//   costs     per leg, on notional: Upbit 0.05% + Binance spot 0.10% + slippage
//             0.05% on each venue = 0.25%.
//   hedge     the coin count is constant across venues, so directional
//             exposure is assumed hedged with a Binance perp short; its funding
//             is ignored (usually income, so this is conservative).
//   capital   per coin 2.3 x N: coin inventory N, cash N, hedge margin 0.3N.
//             Idle capital earns nothing.
//   P&L       realised on each round trip, marked to market at month end in
//             KRW: q(U_sell - U_now) + q(B_now - B_buy) x USDKRW_now.
//
//   PASS (GPT's criteria, fixed before the run), over all complete months:
//     mean monthly return >= 3% of capital, losing months <= 20%, and no single
//     month contributing more than 25% of total profit.
//
// Usage: node scripts/evaluate-kimchi-inventory-arb.js --data data.json

const fs = require("fs");

// ---- frozen parameters: do not tune ----------------------------------------
const ENTER = 0.04;
const EXIT = 0.01;
const LEG_COST = 0.0005 + 0.0010 + 0.0005 + 0.0005;
const CAPITAL_MULT = 2.3;
const N = 1_000_000;   // KRW per coin; results are in % of capital, so scale-free
const H = 3600e3;
const DAY = 864e5;
// -----------------------------------------------------------------------------

function fxLookup(fx) {
  const days = fx.map(([t, v]) => [Math.floor(t / DAY) * DAY, v]).sort((a, b) => a[0] - b[0]);
  return (t) => {
    const dayStart = Math.floor(t / DAY) * DAY;
    let lo = 0, hi = days.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (days[mid][0] < dayStart) { ans = days[mid][1]; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  };
}

function simulateCoin(up, bn, fxAt) {
  const U = new Map(up), B = new Map(bn);
  const hours = up.map(([t]) => t).filter((t) => B.has(t)).sort((a, b) => a - b);
  let state = "A", q = 0, uSell = 0, bBuy = 0, realised = 0, trips = 0, legs = 0;
  const monthEnd = new Map();   // month -> cumulative P&L (realised - costs + MTM)
  const prem = [];
  for (let i = 0; i < hours.length - 1; i += 1) {
    const t = hours[i], fx = fxAt(t);
    if (!fx) continue;
    const k = U.get(t) / (B.get(t) * fx) - 1;
    prem.push([t, k]);
    const tn = hours[i + 1];
    if (tn - t !== H) continue;              // only act on a contiguous next bar
    const fxn = fxAt(tn);
    if (!fxn) continue;
    if (state === "A" && k >= ENTER) {
      q = N / U.get(tn); uSell = U.get(tn); bBuy = B.get(tn);
      realised -= LEG_COST * N; legs += 1; state = "B";
    } else if (state === "B" && k <= EXIT) {
      realised += q * (uSell - U.get(tn)) + q * (B.get(tn) - bBuy) * fxn;
      realised -= LEG_COST * N; legs += 1; trips += 1; state = "A"; q = 0;
    }
    const m = new Date(tn).toISOString().slice(0, 7);
    const mtm = state === "B" ? q * (uSell - U.get(tn)) + q * (B.get(tn) - bBuy) * fxn : 0;
    monthEnd.set(m, realised + mtm);
  }
  return { monthEnd, trips, legs, prem, endState: state };
}

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0) { console.error("usage: --data data.json"); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(process.argv[i + 1], "utf8"));
  const fxAt = fxLookup(data.fx);
  const coins = Object.keys(data.upbit);
  const perCoin = {};
  const months = new Set();
  for (const c of coins) {
    const r = simulateCoin(data.upbit[c], data.binance[c], fxAt);
    perCoin[c] = r;
    for (const m of r.monthEnd.keys()) months.add(m);
  }
  const fetchedMonth = data.fetched_at.slice(0, 7);
  const ordered = [...months].sort().filter((m) => m !== fetchedMonth);   // drop the incomplete month
  const capital = coins.length * CAPITAL_MULT * N;
  const last = Object.fromEntries(coins.map((c) => [c, 0]));
  const monthly = [];
  for (const m of ordered) {
    let cum = 0;
    for (const c of coins) {
      if (perCoin[c].monthEnd.has(m)) last[c] = perCoin[c].monthEnd.get(m);
      cum += last[c];
    }
    monthly.push({ month: m, cum });
  }
  const rets = monthly.map((x, j) => ({ month: x.month, pct: ((x.cum - (j ? monthly[j - 1].cum : 0)) / capital) * 100 }));
  const mean = rets.reduce((a, r) => a + r.pct, 0) / rets.length;
  const losing = rets.filter((r) => r.pct < 0).length;
  const total = rets.reduce((a, r) => a + r.pct, 0);
  const maxShare = total > 0 ? Math.max(...rets.map((r) => r.pct)) / total : null;
  const pass = mean >= 3 && losing / rets.length <= 0.2 && maxShare !== null && maxShare <= 0.25;

  // premium distribution by year (all coins pooled)
  const byYear = {};
  for (const c of coins) for (const [t, k] of perCoin[c].prem) {
    const y = new Date(t).getUTCFullYear();
    (byYear[y] = byYear[y] || []).push(k);
  }
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  const dist = Object.fromEntries(Object.entries(byYear).map(([y, a]) => [y, {
    hours: a.length, p10: +(pct(a, 0.1) * 100).toFixed(2), median: +(pct(a, 0.5) * 100).toFixed(2), p90: +(pct(a, 0.9) * 100).toFixed(2),
    share_ge_4: +((a.filter((k) => k >= ENTER).length / a.length) * 100).toFixed(1),
    share_le_1: +((a.filter((k) => k <= EXIT).length / a.length) * 100).toFixed(1),
  }]));

  console.log(JSON.stringify({
    fetched_at: data.fetched_at,
    months: rets.length,
    mean_monthly_pct: +mean.toFixed(3),
    losing_months: losing,
    losing_share: +(losing / rets.length).toFixed(3),
    total_pct: +total.toFixed(2),
    max_month_share_of_profit: maxShare === null ? null : +maxShare.toFixed(3),
    verdict: pass ? "PASS" : "FAIL",
    round_trips: Object.fromEntries(coins.map((c) => [c, perCoin[c].trips])),
    end_state: Object.fromEntries(coins.map((c) => [c, perCoin[c].endState])),
    premium_by_year_pct: dist,
    monthly: rets.map((r) => `${r.month} ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}`),
  }, null, 1));
}

if (require.main === module) main();
module.exports = { fxLookup, simulateCoin };
