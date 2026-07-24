#!/usr/bin/env node
"use strict";

// scripts/analyze-v3-daily-regime-gate.js (2026-07-24)
//
// Hypothesis from the July failure mechanism: 15m/1h market_state flips BEAR
// during bull-market corrections, and those counter-HTF shorts get run over
// when the daily trend resumes (the INJUSDT lesson, market-wide). Test: a
// SYMMETRIC daily-regime alignment gate — SHORT allowed only when the BTC
// DAILY regime is bearish, LONG only when bullish (one rule, both sides,
// per operator doctrine).
//
// Method: join all closed trades to the BTC daily regime at ENTRY time and
// measure kept (aligned) vs dropped (misaligned) buckets. To limit
// pick-the-best-indicator bias, THREE standard regime definitions are
// evaluated and robustness across all three matters more than any single
// best row:
//   R1  close vs EMA50(daily)
//   R2  EMA20(daily) vs EMA50(daily)
//   R3  7-day momentum (close vs close 7 days ago)
// Caveats stated up front: single asset regime proxy (BTC drives crypto
// beta), trades are correlated (clusters), and this is one pass over the
// same history that motivated the hypothesis — a positive result here
// justifies a FORWARD paper test, not instant live money.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const readJsonl = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").split("\n").filter(Boolean).map(JSON.parse);

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  for (const v of values) {
    prev = prev === null ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

async function fetchBtcDaily() {
  const url = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines HTTP ${res.status}`);
  const rows = await res.json();
  // [openTime, open, high, low, close, ...] — use closed candles only
  return rows.map((r) => ({ openTime: r[0], close: Number(r[4]) }));
}

function buildRegimes(daily) {
  const closes = daily.map((d) => d.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  // regime known at day t applies to entries DURING day t+1 (no lookahead:
  // we only use fully closed daily candles).
  const regimes = [];
  for (let i = 0; i < daily.length; i += 1) {
    regimes.push({
      dayStartMs: daily[i].openTime + 24 * 3600 * 1000, // applies to the NEXT day
      r1: closes[i] > e50[i] ? "BULL" : "BEAR",
      r2: e20[i] > e50[i] ? "BULL" : "BEAR",
      r3: i >= 7 ? (closes[i] > closes[i - 7] ? "BULL" : "BEAR") : null,
    });
  }
  return regimes;
}

function regimeAt(regimes, tsMs) {
  let best = null;
  for (const r of regimes) {
    if (r.dayStartMs <= tsMs) best = r; else break;
  }
  return best;
}

function metrics(a) {
  const n = a.length;
  if (!n) return { n: 0, wr: null, exp: null, net: 0 };
  const w = a.filter((t) => t.r > 0).length;
  const net = a.reduce((s, t) => s + t.r, 0);
  return { n, wr: +(w / n * 100).toFixed(1), exp: +(net / n).toFixed(3), net: +net.toFixed(1) };
}
const fmt = (m) => `n=${String(m.n).padEnd(4)} WR=${m.wr === null ? "  - " : String(m.wr).padStart(4)}% exp=${m.exp === null ? "   -  " : m.exp.toFixed(3).padStart(6)}R net=${String(m.net).padStart(7)}R`;

async function main() {
  const entries = new Map(readJsonl("ops/runtime/v3_paper_entry_ledger.jsonl").map((e) => [e.signal_id, e]));
  const exits = readJsonl("ops/runtime/v3_paper_exit_ledger.jsonl");
  const daily = await fetchBtcDaily();
  const regimes = buildRegimes(daily);

  const trades = [];
  for (const x of exits) {
    const e = entries.get(x.signal_id);
    const entryTs = Date.parse((e && e.created_at) || x.closed_at);
    const r = Number(x.realized_r);
    if (!Number.isFinite(entryTs) || !Number.isFinite(r)) continue;
    const reg = regimeAt(regimes, entryTs);
    if (!reg) continue;
    trades.push({ side: x.side, r, reg, ts: entryTs });
  }
  console.log(`joined trades: ${trades.length}\n`);
  console.log("SYMMETRIC ALIGNMENT GATE — keep only trades whose direction matches the BTC DAILY regime");
  console.log("(SHORT needs daily BEAR, LONG needs daily BULL — one rule, both sides)\n");

  for (const def of ["r1", "r2", "r3"]) {
    const usable = trades.filter((t) => t.reg[def]);
    const aligned = usable.filter((t) => (t.side === "SHORT" && t.reg[def] === "BEAR") || (t.side === "LONG" && t.reg[def] === "BULL"));
    const misaligned = usable.filter((t) => !aligned.includes(t));
    const label = { r1: "R1 close>EMA50(d)", r2: "R2 EMA20>EMA50(d)", r3: "R3 7d momentum  " }[def];
    console.log(`--- ${label} ---`);
    console.log(`  baseline   ${fmt(metrics(usable))}`);
    console.log(`  KEPT       ${fmt(metrics(aligned))}`);
    console.log(`    SHORT    ${fmt(metrics(aligned.filter((t) => t.side === "SHORT")))}`);
    console.log(`    LONG     ${fmt(metrics(aligned.filter((t) => t.side === "LONG")))}`);
    console.log(`  DROPPED    ${fmt(metrics(misaligned))}`);
    // time split honesty check: first 70% vs last 30% by entry time
    const sorted = [...usable].sort((a, b) => a.ts - b.ts);
    const cut = Math.floor(sorted.length * 0.7);
    const later = sorted.slice(cut);
    const laterAligned = later.filter((t) => (t.side === "SHORT" && t.reg[def] === "BEAR") || (t.side === "LONG" && t.reg[def] === "BULL"));
    console.log(`  LAST-30%: baseline ${fmt(metrics(later))}`);
    console.log(`            kept     ${fmt(metrics(laterAligned))}`);
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
