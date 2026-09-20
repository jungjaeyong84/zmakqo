#!/usr/bin/env node
"use strict";

// scripts/evaluate-crypto-dual-momentum.js — GPT-5.5's top new candidate from
// the fourth consultation (2026-09-19): spot dual momentum with a BTC trend
// switch. GPT's rules and GPT's pass criteria are used verbatim; the choices
// that GPT left open are fixed below by Claude BEFORE the first run.
//
// RULES (GPT)
//   universe   Binance USDT spot pairs listed >= 180 days, stablecoins and
//              leveraged tokens excluded, top 60 by traded value
//   weekly     rank by 90-day return / 90-day volatility, buy the top 5 equal weight
//   switch     BTC below its 200-day average -> everything in USDT
//   filter     a coin below its own 60-day average is excluded
//   cost       0.1% per side
//   PASS       mean monthly >= 2%, losing months <= 38%, worst month >= -18%,
//              and 2021, 2022 and 2025 each positive
//   The user's own bar (a steady 3-5% a month) is reported next to GPT's.
//
// CHOICES FIXED BY CLAUDE (before the run)
//   survivorship  delisted (BREAK) pairs are INCLUDED; their history is still
//                 served. A gap of more than 3 days in a pair's bars starts a
//                 new listing (LUNA's symbol was reused after the collapse, and
//                 splicing the two would book a fake jump). A coin whose bars
//                 stop while held is sold at its last close.
//   timing        rebalance on Mondays using bars through Sunday's close, filled
//                 at Sunday's close; marked daily
//   traded value  mean quote volume over the previous 30 days
//   excluded      bases in STABLES, symbols ending UP/DOWN/BULL/BEAR USDT, and
//                 any pair whose 90-day annualised volatility is below 5%
//   period        2019-01-07 .. last complete week
//
// Usage: node scripts/evaluate-crypto-dual-momentum.js --data DIR

const fs = require("fs");
const path = require("path");

// ---- frozen parameters: do not tune ----------------------------------------
const DAY = 864e5;
const MIN_AGE = 180;
const TOP_LIQ = 60;
const TOP_K = 5;
const MOM = 90;
const SMA_COIN = 60;
const SMA_BTC = 200;
const LIQ_WIN = 30;
const COST = 0.001;
const GAP_DAYS = 3;
const MIN_VOL = 0.05;
const START = Date.parse("2019-01-07T00:00:00Z");   // a Monday
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
    // split on gaps into separate listings
    let cur = [];
    const flush = (k) => { if (cur.length) series.push({ id: `${s.symbol}#${k}`, symbol: s.symbol, bars: cur }); cur = []; };
    let k = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (cur.length && rows[i][0] - cur[cur.length - 1][0] > GAP_DAYS * DAY) { flush(k); k += 1; }
      cur.push(rows[i]);
    }
    flush(k);
  }
  for (const x of series) {
    x.idx = new Map(x.bars.map((b, i) => [b[0], i]));
    x.first = x.bars[0][0];
    x.last = x.bars[x.bars.length - 1][0];
  }
  return { meta, series };
}

function stats(x, i, n) {   // using bars i-n+1..i
  if (i - n < 0) return null;
  let s = 0;
  const lr = [];
  for (let j = i - n + 1; j <= i; j += 1) { s += x.bars[j][1]; lr.push(Math.log(x.bars[j][1] / x.bars[j - 1][1])); }
  const m = lr.reduce((a, b) => a + b, 0) / lr.length;
  const sd = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / (lr.length - 1)) * Math.sqrt(365);
  return { sma: s / n, vol: sd };
}

function run(dir) {
  const { meta, series } = load(dir);
  const fetchedAt = Date.parse(meta.fetched_at);
  const lastDay = Math.floor(fetchedAt / DAY) * DAY - DAY;   // last complete bar
  const btc = series.find((x) => x.symbol === "BTCUSDT" && x.first < START);
  let holdings = new Map();   // id -> { x, w, px }
  let cash = 1;
  let equity = 1;
  const daily = [];
  for (let d = START; d <= lastDay; d += DAY) {
    const prev = d - DAY;   // Sunday close when d is Monday
    // mark to market over bar d-1 -> ... we mark at each day's close: equity from prev close to d close
    if (new Date(d).getUTCDay() === 1) {
      // rebalance at prev close
      let target = new Map();
      const bi = btc.idx.get(prev);
      const bs = bi !== undefined ? stats(btc, bi, SMA_BTC) : null;
      const riskOn = bs && btc.bars[bi][1] >= bs.sma;
      if (riskOn) {
        const cands = [];
        for (const x of series) {
          const i = x.idx.get(prev);
          if (i === undefined || i < MIN_AGE) continue;
          let q = 0;
          for (let j = i - LIQ_WIN + 1; j <= i; j += 1) q += x.bars[j][2];
          cands.push({ x, i, liq: q / LIQ_WIN });
        }
        cands.sort((a, b) => b.liq - a.liq);
        const ranked = [];
        for (const c of cands.slice(0, TOP_LIQ)) {
          const s60 = stats(c.x, c.i, SMA_COIN), s90 = stats(c.x, c.i, MOM);
          if (!s60 || !s90 || s90.vol < MIN_VOL) continue;
          if (c.x.bars[c.i][1] < s60.sma) continue;
          const r90 = c.x.bars[c.i][1] / c.x.bars[c.i - MOM][1] - 1;
          ranked.push({ x: c.x, score: r90 / s90.vol });
        }
        ranked.sort((a, b) => b.score - a.score);
        for (const r of ranked.slice(0, TOP_K)) target.set(r.x.id, r.x);
      }
      // current weights at prev close
      const curW = new Map();
      for (const [id, h] of holdings) curW.set(id, (h.units * h.x.bars[h.x.idx.get(prev) ?? h.x.bars.length - 1][1]) / equity);
      const tgtW = new Map([...target.keys()].map((id) => [id, 1 / TOP_K]));
      if (target.size && target.size < TOP_K) for (const id of target.keys()) tgtW.set(id, 1 / TOP_K);   // unfilled slots stay in cash
      let turn = 0;
      for (const id of new Set([...curW.keys(), ...tgtW.keys()])) turn += Math.abs((tgtW.get(id) || 0) - (curW.get(id) || 0));
      equity *= 1 - turn * COST;
      holdings = new Map();
      let invested = 0;
      for (const [id, w] of tgtW) {
        const x = target.get(id);
        const p = x.bars[x.idx.get(prev)][1];
        holdings.set(id, { x, units: (w * equity) / p });
        invested += w;
      }
      cash = (1 - invested) * equity;
    }
    // value at d close
    let val = cash;
    for (const [id, h] of holdings) {
      const i = h.x.idx.get(d);
      if (i !== undefined) val += h.units * h.x.bars[i][1];
      else {
        // delisted or gap: sell at the last available close at or before d, move to cash
        const lastI = h.x.bars.findLastIndex((b) => b[0] <= d);
        const p = h.x.bars[lastI][1];
        cash += h.units * p;
        val += h.units * p;
        holdings.delete(id);
      }
    }
    equity = val;
    daily.push([d, equity]);
  }
  return { daily, lastDay };
}

function main() {
  const i = process.argv.indexOf("--data");
  if (i < 0) { console.error("usage: --data DIR"); process.exit(2); }
  const { daily, lastDay } = run(process.argv[i + 1]);
  const monthEnd = new Map();
  for (const [d, e] of daily) monthEnd.set(new Date(d).toISOString().slice(0, 7), e);
  const lastMonth = new Date(lastDay + DAY).toISOString().slice(0, 7);
  const months = [...monthEnd].filter(([m]) => m !== lastMonth || new Date(lastDay + DAY).getUTCDate() === 1);
  const rets = months.map(([m, e], j) => ({ m, pct: (e / (j ? months[j - 1][1] : 1) - 1) * 100 }));
  const mean = rets.reduce((a, r) => a + r.pct, 0) / rets.length;
  const losing = rets.filter((r) => r.pct < 0).length / rets.length;
  const worst = rets.reduce((a, r) => (r.pct < a.pct ? r : a));
  const year = (y) => { const rs = rets.filter((r) => r.m.startsWith(String(y))); return rs.length ? (rs.reduce((e, r) => e * (1 + r.pct / 100), 1) - 1) * 100 : null; };
  const years = Object.fromEntries([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => [y, year(y) === null ? null : +year(y).toFixed(1)]));
  const pass = mean >= 2 && losing <= 0.38 && worst.pct >= -18 && years[2021] > 0 && years[2022] > 0 && years[2025] > 0;
  let peak = 0, mdd = 0;
  for (const [, e] of daily) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
  const sorted = rets.map((r) => r.pct).sort((a, b) => a - b);
  console.log(JSON.stringify({
    months: rets.length, mean_monthly_pct: +mean.toFixed(2), median_monthly_pct: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    losing_share: +losing.toFixed(3), worst_month: `${worst.m} ${worst.pct.toFixed(1)}%`, max_drawdown_pct: +(mdd * 100).toFixed(1),
    annual_pct: years, gpt_verdict: pass ? "PASS" : "FAIL",
    user_bar_mean_ge_3: mean >= 3,
    monthly: rets.map((r) => `${r.m} ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}`),
  }, null, 1));
}

if (require.main === module) main();
