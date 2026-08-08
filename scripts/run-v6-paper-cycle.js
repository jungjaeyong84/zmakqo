#!/usr/bin/env node
"use strict";

// scripts/run-v6-paper-cycle.js (2026-08-08)
//
// Paper lane for the re-derived v1 boolean-confluence engine.
// Config: config/v6_confluence_config.json (locked by optimize-v6-confluence.js)
//
// WHY THIS RUNS DESPITE A BACKTEST THAT DOES NOT SUPPORT IT.
//
// The optimiser searched 30 threshold x hold cells in-sample. The BEST of them
// reached t = 0.28 — not significant in-sample, before any out-of-sample test
// was run. That is unusual and it is informative: normally a grid search finds
// something spectacular and fake, and the work is in tearing it down. Here
// there was nothing to overfit to. Out-of-sample then gave Sharpe 0.08, t 0.06,
// retaining 21% of an in-sample number that was already noise.
//
// So this lane is NOT deployed because the evidence favours it. It is deployed
// because forward paper data on bars nobody has seen is the only unbiased test
// left, it costs nothing, and every backtest conclusion this project has
// reached — including today's — has been revised at least once. The v4 lane
// runs on the same principle.
//
// The honest prior is that this lane will accumulate toward zero. It is set up
// so that outcome is legible rather than spun: the report carries the
// backtest's own expectation alongside the realised numbers, so drift away
// from prediction is visible in both directions.
//
// Paper only. No keys, no order path, no exposure.

const fs = require("fs");
const path = require("path");
const v1 = require("./analyze-v1-confluence.js");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "config/v6_confluence_config.json");
const LEDGER = path.join(ROOT, "ops/runtime/v6_paper_ledger.jsonl");
const REPORT = path.join(ROOT, "ops/daily/v6_paper_latest.json");
const STATE = path.join(ROOT, "ops/runtime/v6_paper_state.json");

// 2026-08-08 — leveraged bracket added.
//
// Entry is 2x notional. Take profit at +5% and stop at -2.5% are stated on
// the LEVERAGED return — what shows in the account — so the price moves that
// trigger them are half that: +2.5% and -1.25%. RR is 2:1.
//
// Three consequences that are easy to get wrong and are handled explicitly:
//
//   1. INTRABAR. A bracket can be hit and reversed inside one bar. Settling on
//      closes only would miss most stops and count losers as winners. Every 1h
//      bar between entry and now is walked, checking high and low.
//   2. SAME-BAR AMBIGUITY. When a bar's range spans BOTH levels there is no
//      way to know from OHLC which came first. The stop is assumed to fire.
//      Assuming the target instead would systematically flatter every result.
//   3. COST SCALES WITH LEVERAGE. Fees are charged on notional, so 0.14% round
//      trip on 2x notional is 0.28% against equity.

const LEVERAGE = 2;
const TP_EQUITY_PCT = 5.0;
const SL_EQUITY_PCT = 2.5;
const TP_PRICE_PCT = TP_EQUITY_PCT / LEVERAGE;   // 2.5%
const SL_PRICE_PCT = SL_EQUITY_PCT / LEVERAGE;   // 1.25%

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "LTCUSDT", "ATOMUSDT", "FILUSDT", "INJUSDT",
  "SEIUSDT", "GALAUSDT", "SANDUSDT", "AXSUSDT", "AAVEUSDT", "DOTUSDT"];

const NAMES = ["trend", "htf", "td", "stoch", "vol", "regime"];
const { buildStates } = v1;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : 0; };

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return fb; } }

function votes(bars, st, i) {
  const b = bars[i];
  const bullTrend = st.trendState[i] === "bull";
  const bearTrend = st.trendState[i] === "bear";
  const volRatio = st.volMa[i] ? b.v / st.volMa[i] : 1;
  const volAny = volRatio >= 1.5;
  const regimeTrend = st.adx[i] > 25;
  return {
    trend: bullTrend ? 1 : bearTrend ? -1 : 0,
    htf: st.htfState[i] === "bull" ? 1 : st.htfState[i] === "bear" ? -1 : 0,
    td: st.tdState[i] === "buy" ? 1 : st.tdState[i] === "sell" ? -1 : 0,
    stoch: (st.kArr[i] > st.dArr[i] && st.kArr[i] < 80) ? 1
      : (st.kArr[i] < st.dArr[i] && st.kArr[i] > 20) ? -1 : 0,
    vol: !volAny ? 0 : (b.c >= st.bwMid[i] || bullTrend) ? 1 : (b.c <= st.bwMid[i] || bearTrend) ? -1 : 0,
    regime: !regimeTrend ? 0 : st.pDI[i] >= st.mDI[i] ? 1 : -1,
  };
}

async function fetchBars(sym) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=400`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  // drop the still-forming final bar: acting on an unclosed bar is look-ahead
  return rows.slice(0, -1).map((r) => ({
    t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]),
  }));
}

async function fetchBarsSince(sym, sinceMs) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&startTime=${sinceMs}&limit=500`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  // skip the entry bar itself and drop the forming bar
  return rows.slice(1, -1).map((r) => ({ t: Number(r[0]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
}

async function main() {
  const cfg = readJson(CONFIG, null);
  if (!cfg) { console.error("config missing — run optimize-v6-confluence.js first"); process.exit(1); }
  const state = readJson(STATE, { prevScore: {}, cooldownUntil: {} });
  const now = Date.now();

  const opened = [];
  const errors = [];
  for (const sym of SYMBOLS) {
    try {
      const bars = await fetchBars(sym);
      if (bars.length < 200) continue;
      const st = buildStates(bars);
      const i = bars.length - 1;
      const v = votes(bars, st, i);
      let sc = 0, tw = 0;
      for (const n of NAMES) { sc += cfg.weights[n] * v[n]; tw += Math.abs(cfg.weights[n]); }
      sc = tw ? (sc / tw) * 100 : 0;

      const prev = Number(state.prevScore[sym]);
      const cd = Number(state.cooldownUntil[sym]) || 0;
      let dir = 0;
      if (Number.isFinite(prev) && now > cd) {
        if (prev < cfg.threshold && sc >= cfg.threshold) dir = 1;
        else if (prev > -cfg.threshold && sc <= -cfg.threshold) dir = -1;
      }
      state.prevScore[sym] = sc;

      if (dir) {
        state.cooldownUntil[sym] = now + cfg.hold_hours * 3600e3;
        const row = {
          id: `V6__${sym}__${bars[i].t}__${dir > 0 ? "LONG" : "SHORT"}`,
          opened_at: new Date().toISOString(),
          bar_time: new Date(bars[i].t).toISOString(),
          symbol: sym,
          side: dir > 0 ? "LONG" : "SHORT",
          score: Math.round(sc * 100) / 100,
          votes: v,
          entry_price: bars[i].c,
          leverage: LEVERAGE,
          tp_price: dir > 0 ? bars[i].c * (1 + TP_PRICE_PCT / 100) : bars[i].c * (1 - TP_PRICE_PCT / 100),
          sl_price: dir > 0 ? bars[i].c * (1 - SL_PRICE_PCT / 100) : bars[i].c * (1 + SL_PRICE_PCT / 100),
          tp_equity_pct: TP_EQUITY_PCT,
          sl_equity_pct: -SL_EQUITY_PCT,
          close_due_at: new Date(now + cfg.hold_hours * 3600e3).toISOString(),
          hold_hours: cfg.hold_hours,
          cost_pct: cfg.cost_pct * LEVERAGE,   // fees are on notional
          status: "OPEN",
        };
        fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
        fs.appendFileSync(LEDGER, JSON.stringify(row) + "\n", "utf8");
        opened.push(row);
      }
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) { errors.push(`${sym}: ${e.message}`); }
  }

  // ---- settle anything whose hold has elapsed ----------------------------
  const rows = fs.existsSync(LEDGER)
    ? fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean)
    : [];
  const latest = new Map();
  for (const r of rows) latest.set(r.id, r);
  // Every OPEN position is checked each cycle, not only expired ones: a
  // bracket can fire long before the hold elapses, and settling only at expiry
  // would record the wrong exit price.
  const open = [...latest.values()].filter((r) => r.status === "OPEN");

  const closedNow = [];
  for (const r of open) {
    try {
      const bars = await fetchBarsSince(r.symbol, Date.parse(r.bar_time));
      if (!bars.length) continue;
      const lev = Number(r.leverage) || LEVERAGE;
      const isLong = r.side === "LONG";
      // A row written before the bracket existed has no tp_price/sl_price.
      // Number(undefined) is NaN and EVERY comparison against NaN is false, so
      // the bracket would silently never fire and every trade would settle at
      // hold expiry — which is exactly what happened on the first run: a +5.14%
      // move recorded as HOLD_EXPIRY instead of stopping out at target.
      // Derive the levels from the entry when they are missing.
      let tp = Number(r.tp_price), sl = Number(r.sl_price);
      if (!Number.isFinite(tp) || !Number.isFinite(sl)) {
        tp = isLong ? r.entry_price * (1 + TP_PRICE_PCT / 100) : r.entry_price * (1 - TP_PRICE_PCT / 100);
        sl = isLong ? r.entry_price * (1 - SL_PRICE_PCT / 100) : r.entry_price * (1 + SL_PRICE_PCT / 100);
      }
      let exitPx = null, reason = "HOLD_EXPIRY";

      // Walk forward. Same-bar ambiguity resolves to the STOP: OHLC cannot say
      // which came first, and assuming the target would flatter every result.
      for (const b of bars) {
        const hitSl = isLong ? b.l <= sl : b.h >= sl;
        const hitTp = isLong ? b.h >= tp : b.l <= tp;
        if (hitSl) { exitPx = sl; reason = "STOP"; break; }
        if (hitTp) { exitPx = tp; reason = "TARGET"; break; }
      }
      // No bracket hit. Only settle if the hold has actually elapsed —
      // otherwise the position is still live and closing it here at the last
      // close would cut every trade short at whatever hour this cycle ran.
      if (exitPx === null) {
        if (Date.parse(r.close_due_at) > now) continue;
        exitPx = bars[bars.length - 1].c;
      }

      const pricePct = (isLong ? exitPx / r.entry_price - 1 : 1 - exitPx / r.entry_price) * 100;
      const grossPct = pricePct * lev;
      const closed = { ...r, status: "CLOSED", closed_at: new Date().toISOString(),
        exit_price: Math.round(exitPx * 1e8) / 1e8, exit_reason: reason,
        price_move_pct: Math.round(pricePct * 1e4) / 1e4,
        gross_pct: Math.round(grossPct * 1e4) / 1e4,
        net_pct: Math.round((grossPct - r.cost_pct) * 1e4) / 1e4 };
      fs.appendFileSync(LEDGER, JSON.stringify(closed) + "\n", "utf8");
      latest.set(r.id, closed);
      closedNow.push(closed);
      await new Promise((x) => setTimeout(x, 110));
    } catch (e) { errors.push(`settle ${r.symbol}: ${e.message}`); }
  }

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  // ---- report ------------------------------------------------------------
  const all = [...latest.values()];
  const closed = all.filter((r) => r.status === "CLOSED");
  const nets = closed.map((r) => r.net_pct);
  const periodsPerYear = (365 * 24) / cfg.hold_hours;
  const m = mean(nets), s = sd(nets);
  const firstAt = all.length ? all.map((r) => Date.parse(r.opened_at)).sort((a, b) => a - b)[0] : now;

  const report = {
    generated_at: new Date().toISOString(),
    lane: "v6_confluence_paper",
    config: {
      threshold: cfg.threshold, hold_hours: cfg.hold_hours, weights: cfg.weights,
      leverage: LEVERAGE,
      tp_equity_pct: TP_EQUITY_PCT, sl_equity_pct: -SL_EQUITY_PCT,
      tp_price_pct: TP_PRICE_PCT, sl_price_pct: -SL_PRICE_PCT,
      cost_pct: cfg.cost_pct * LEVERAGE,   // charged on notional, so 2x
    },
    days_running: Math.round((now - firstAt) / 864e5 * 10) / 10,
    open_n: all.filter((r) => r.status === "OPEN").length,
    closed_n: closed.length,
    opened_this_cycle: opened.length,
    closed_this_cycle: closedNow.length,
    realised: closed.length ? {
      win_rate_pct: Math.round(nets.filter((v) => v > 0).length / nets.length * 1000) / 10,
      mean_net_pct: Math.round(m * 1e4) / 1e4,
      total_net_pct: Math.round(nets.reduce((a, b) => a + b, 0) * 1e4) / 1e4,
      ann_pct: Math.round(m * periodsPerYear * 10) / 10,
      t_stat: s ? Math.round(m / (s / Math.sqrt(nets.length)) * 100) / 100 : null,
      long_n: closed.filter((r) => r.side === "LONG").length,
      short_n: closed.filter((r) => r.side === "SHORT").length,
      exit_target_n: closed.filter((r) => r.exit_reason === "TARGET").length,
      exit_stop_n: closed.filter((r) => r.exit_reason === "STOP").length,
      exit_expiry_n: closed.filter((r) => r.exit_reason === "HOLD_EXPIRY").length,
    } : null,
    // carried so drift from the backtest is visible in BOTH directions
    backtest_expectation: {
      out_of_sample_ann_pct: cfg.out_of_sample.ann_pct,
      out_of_sample_sharpe: cfg.out_of_sample.sharpe,
      out_of_sample_t: cfg.out_of_sample.t,
      note: "best of 30 in-sample cells reached only t=0.28; this lane tests, it does not confirm",
    },
    min_closed_for_verdict: 100,
    verdict: closed.length < 100 ? "ACCUMULATING" : (m > 0 && s && m / (s / Math.sqrt(nets.length)) > 1.96 ? "POSITIVE_SIGNIFICANT" : m > 0 ? "POSITIVE_NOT_SIGNIFICANT" : "NEGATIVE"),
    live_exposure_usdt: 0,
    errors,
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
