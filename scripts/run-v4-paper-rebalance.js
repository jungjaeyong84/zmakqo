#!/usr/bin/env node
"use strict";

// scripts/run-v4-paper-rebalance.js — v4 cross-sectional PAPER lane.
//
// Runs once per day shortly after the 00:00 UTC daily close. For each
// universe variant it: books the realized return of the positions recorded
// last run, computes the new target ranks, and appends one row to
// ops/runtime/v4_paper_rebalance_ledger.jsonl.
//
// TWO VARIANTS RUN IN PARALLEL ON PURPOSE. The backtest disagreed about
// which universe is better (12-symbol looked better 2024, 27-symbol better
// 2026), so picking one now would be fitting to history. Paper is free —
// both run forward and the pre-committed criteria judge them on data that
// did not exist when the code was written.
//
// PAPER ONLY: there is deliberately no live execution path in v4. Money is
// only discussed after the 90-day criteria in src/v4/README.md are met.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const { computeTargetPositions, computePeriodResult } = require("../src/v4/crossSectionalSignal");

const ROOT = path.resolve(__dirname, "..");
const LEDGER = path.join(ROOT, "ops/runtime/v4_paper_rebalance_ledger.jsonl");
const OUT = path.join(ROOT, "ops/daily/v4_paper_latest.json");

const CORE12 = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
  "LINKUSDT", "AAVEUSDT", "SUIUSDT", "TIAUSDT", "ARBUSDT", "AXSUSDT"];
const EXT27 = [...CORE12, "AVAXUSDT", "DOTUSDT", "ATOMUSDT", "LTCUSDT", "NEARUSDT",
  "APTUSDT", "FILUSDT", "INJUSDT", "OPUSDT", "SEIUSDT", "TAOUSDT", "WLDUSDT",
  "SANDUSDT", "GALAUSDT", "ORDIUSDT", "PEPEUSDT"];

const LOOKBACK = Number(process.env.V4_LOOKBACK_DAYS) > 0 ? Math.floor(Number(process.env.V4_LOOKBACK_DAYS)) : 14;
// maker-first is the executable assumption: v3's maker-first entry layer is
// already built and measured. Taker is recorded alongside for reference.
const COST_MAKER = Number(process.env.V4_COST_MAKER) >= 0 ? Number(process.env.V4_COST_MAKER) : 0.0009;
const COST_TAKER = Number(process.env.V4_COST_TAKER) >= 0 ? Number(process.env.V4_COST_TAKER) : 0.0014;

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}
function appendJsonl(p, row) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(row) + "\n", "utf8");
}

// Daily closes through the last CLOSED candle (Binance returns the still-open
// candle last; dropping it is what keeps this free of lookahead).
async function fetchClosedDaily(symbol, limit = 60) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${limit}`);
  if (!res.ok) throw new Error(`${symbol} HTTP ${res.status}`);
  const rows = await res.json();
  const now = Date.now();
  const closed = rows.filter((r) => Number(r[6]) < now); // closeTime in the past
  return {
    closes: closed.map((r) => Number(r[4])).filter(Number.isFinite),
    lastCloseTime: closed.length ? Number(closed[closed.length - 1][6]) : null,
  };
}

async function main() {
  const variants = [
    { name: "core12", symbols: CORE12 },
    { name: "ext27", symbols: EXT27 },
  ];

  // one fetch pass covering the union of both universes
  const allSymbols = [...new Set(variants.flatMap((v) => v.symbols))];
  const data = new Map();
  let lastCloseTime = null;
  for (const s of allSymbols) {
    try {
      const d = await fetchClosedDaily(s, LOOKBACK + 10);
      if (d.closes.length >= LOOKBACK + 1) {
        data.set(s, d.closes);
        if (d.lastCloseTime && (!lastCloseTime || d.lastCloseTime > lastCloseTime)) lastCloseTime = d.lastCloseTime;
      }
    } catch (_) { /* symbol unavailable this run — variant just holds fewer names */ }
    await new Promise((r) => setTimeout(r, 90));
  }
  if (!data.size) {
    console.log(JSON.stringify({ ok: false, reason: "NO_MARKET_DATA" }));
    process.exit(1);
  }

  const history = readJsonl(LEDGER);
  const nowIso = new Date().toISOString();
  const barDate = lastCloseTime ? new Date(lastCloseTime).toISOString().slice(0, 10) : nowIso.slice(0, 10);
  const summary = [];

  for (const variant of variants) {
    const closesBySymbol = new Map();
    for (const s of variant.symbols) if (data.has(s)) closesBySymbol.set(s, data.get(s));

    const target = computeTargetPositions({ closesBySymbol, lookback: LOOKBACK });
    const currentPrices = {};
    for (const [s, c] of closesBySymbol) currentPrices[s] = c[c.length - 1];

    const prior = [...history].reverse().find((r) => r.variant === variant.name);
    // Same bar already recorded (a re-run inside the same day) — skip so the
    // equity curve can never be double-counted.
    if (prior && prior.bar_date === barDate) {
      summary.push({ variant: variant.name, skipped: "ALREADY_RECORDED_FOR_BAR" });
      continue;
    }

    let period = null;
    let equityMaker = 1;
    let equityTaker = 1;
    if (prior) {
      period = computePeriodResult({
        prevPositions: prior.positions,
        newPositions: target.positions,
        prevPrices: prior.prices,
        currentPrices,
        costPct: COST_MAKER,
      });
      const periodTaker = computePeriodResult({
        prevPositions: prior.positions,
        newPositions: target.positions,
        prevPrices: prior.prices,
        currentPrices,
        costPct: COST_TAKER,
      });
      equityMaker = Number(prior.equity_maker || 1) * (1 + period.net_return);
      equityTaker = Number(prior.equity_taker || 1) * (1 + periodTaker.net_return);
      period = { ...period, net_return_taker: periodTaker.net_return };
    }

    const row = {
      variant: variant.name,
      bar_date: barDate,
      generated_at: nowIso,
      lookback: LOOKBACK,
      universe_n: closesBySymbol.size,
      k: target.k,
      positions: target.positions,
      prices: currentPrices,
      top: target.ranked.slice(0, target.k).map((r) => r.symbol),
      bottom: target.ranked.slice(-target.k).map((r) => r.symbol),
      period, // null on the first row (nothing held yet)
      equity_maker: Number(equityMaker.toFixed(8)),
      equity_taker: Number(equityTaker.toFixed(8)),
      cost_maker: COST_MAKER,
      cost_taker: COST_TAKER,
      source: "V4_PAPER_REBALANCE",
    };
    appendJsonl(LEDGER, row);
    summary.push({
      variant: variant.name,
      universe_n: row.universe_n,
      k: row.k,
      net_return: period ? period.net_return : null,
      equity_maker: row.equity_maker,
      long: row.top,
      short: row.bottom,
    });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: nowIso, bar_date: barDate, lookback: LOOKBACK, variants: summary,
  }, null, 2));

  console.log(JSON.stringify({ ok: true, bar_date: barDate, latest_json: OUT, variants: summary }));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("RUN_V4_PAPER_REBALANCE_FAIL", e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}
