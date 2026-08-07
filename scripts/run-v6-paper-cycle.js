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
          close_due_at: new Date(now + cfg.hold_hours * 3600e3).toISOString(),
          hold_hours: cfg.hold_hours,
          cost_pct: cfg.cost_pct,
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
  const open = [...latest.values()].filter((r) => r.status === "OPEN" && Date.parse(r.close_due_at) <= now);

  const closedNow = [];
  for (const r of open) {
    try {
      const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${r.symbol}`);
      const px = Number((await res.json()).price);
      if (!Number.isFinite(px)) continue;
      const grossPct = (r.side === "LONG" ? px / r.entry_price - 1 : 1 - px / r.entry_price) * 100;
      const closed = { ...r, status: "CLOSED", closed_at: new Date().toISOString(), exit_price: px,
        gross_pct: Math.round(grossPct * 1e4) / 1e4, net_pct: Math.round((grossPct - r.cost_pct) * 1e4) / 1e4 };
      fs.appendFileSync(LEDGER, JSON.stringify(closed) + "\n", "utf8");
      latest.set(r.id, closed);
      closedNow.push(closed);
      await new Promise((x) => setTimeout(x, 100));
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
    config: { threshold: cfg.threshold, hold_hours: cfg.hold_hours, cost_pct: cfg.cost_pct, weights: cfg.weights },
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
