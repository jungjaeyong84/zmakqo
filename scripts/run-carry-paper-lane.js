#!/usr/bin/env node
"use strict";

// scripts/run-carry-paper-lane.js — funding carry, on paper, forward only
// (2026-09-20). PAPER ONLY: no keys, no order path, exposure reported as 0.
//
// WHY IT EXISTS
// -------------
// Carry is the one source this project ever validated: 2.7 years of funding
// history gave 7.4%/yr against 5% risk-free, and the 363-symbol ceiling study
// gave 9.7%/yr with a median month of 0.43%. It was never run forward, so the
// number is a backtest like any other.
//
// It is started now for a second reason. GPT-5.5 ranked "combine the forced-exit
// short with carry" as the single biggest improvement available to that
// candidate: the short's problem is losing months (24.2% against a 20% bar), and
// a low-correlation sleeve is the honest way to cut them. That combination
// cannot be measured without a forward carry series, so this lane produces one.
//
// FROZEN RULE — do not change while the forced-exit test runs
//   universe   USDT perpetuals with a Binance USDT spot pair (a delta-neutral
//              carry needs a spot leg), excluding contracts listed < 48h ago.
//   daily      at 00:00 UTC, rank by the previous UTC day's summed funding.
//   book       names whose previous-day funding annualises to >= 11% (the floor
//              the 2026-08-01 study validated), top 5, equal weight.
//   earn       each day, the funding actually paid on held names; idle slots
//              earn the 5%/yr risk-free rate.
//   costs      0.08% per full entry+exit cycle, charged on the half that trades.
//   capital    1.3x notional (spot leg plus perp margin), so the reported return
//              is on capital committed, not on notional.
//
// The lane makes no decision. Its series exists to be combined with the
// forced-exit lane at that lane's own decision dates (2027-03-20 / 2027-09-20).

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEDGER = path.join(ROOT, "ops/runtime/carry_paper_ledger.jsonl");
const REPORT = path.join(ROOT, "ops/daily/carry_paper_latest.json");

// ---- frozen parameters ------------------------------------------------------
const DAY = 864e5;
const FLOOR_ANNUAL = 0.11;
const TOP_K = 5;
const CYCLE_COST = 0.0008;
const CAP_MULT = 1.3;
const RISK_FREE = 0.05;
const MIN_AGE_MS = 48 * 3600e3;
// -----------------------------------------------------------------------------

const FAPI = "https://fapi.binance.com";
const SPOT = "https://api.binance.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rateLimited = null;

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 429 || res.status === 418) { rateLimited = res.status; throw new Error(`RATE_LIMITED ${res.status}`); }
  if (!res.ok) return null;
  return res.json();
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

async function main() {
  const now = Date.now();
  const today = Math.floor(now / DAY) * DAY;
  const ledger = readJsonl(LEDGER);
  const done = new Set(ledger.map((r) => r.day));
  const errors = [];

  const [fx, sx] = await Promise.all([getJson(`${FAPI}/fapi/v1/exchangeInfo`), getJson(`${SPOT}/api/v3/exchangeInfo?permissions=SPOT`)]);
  const spotBases = new Set(sx.symbols.filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING").map((s) => s.baseAsset));
  const perps = fx.symbols.filter((s) => s.quoteAsset === "USDT" && s.contractType === "PERPETUAL" && s.status === "TRADING")
    .map((s) => ({ symbol: s.symbol, base: s.baseAsset, onboard: s.onboardDate }))
    .filter((p) => {
      const stripped = p.base.replace(/^(1000000|100000|10000|1000|1M)/, "");
      return (spotBases.has(p.base) || spotBases.has(stripped)) && now - p.onboard >= MIN_AGE_MS;
    });

  // Book every closed day that is not booked yet, oldest first (catch-up safe).
  const firstDay = ledger.length ? ledger[ledger.length - 1].day + DAY : today - DAY;
  const days = [];
  for (let d = firstDay; d < today; d += DAY) if (!done.has(d)) days.push(d);
  if (!days.length) days.length = 0;

  let equity = ledger.length ? ledger[ledger.length - 1].equity : 1;
  let held = ledger.length ? new Set(ledger[ledger.length - 1].held) : new Set();

  for (const day of days.slice(-7)) {                       // at most a week of catch-up per run
    const rates = new Map();
    for (const p of perps) {
      try {
        const rows = await getJson(`${FAPI}/fapi/v1/fundingRate?symbol=${p.symbol}&startTime=${day - DAY}&limit=48`);
        await sleep(120);
        if (!Array.isArray(rows)) continue;
        let prev = 0, cur = 0, hasPrev = false, hasCur = false;
        for (const r of rows) {
          const t = Number(r.fundingTime), v = Number(r.fundingRate);
          if (!Number.isFinite(v)) continue;
          if (t >= day - DAY && t < day) { prev += v; hasPrev = true; }
          else if (t >= day && t < day + DAY) { cur += v; hasCur = true; }
        }
        if (hasPrev) rates.set(p.symbol, { prev, cur: hasCur ? cur : null });
      } catch (e) { errors.push(`${p.symbol}: ${e.message}`); if (rateLimited) break; }
    }
    if (rateLimited) break;

    const picks = [...rates.entries()]
      .filter(([, v]) => v.prev * 365 >= FLOOR_ANNUAL && v.cur !== null)
      .sort((a, b) => b[1].prev - a[1].prev)
      .slice(0, TOP_K);
    const next = new Set(picks.map(([s]) => s));
    let changes = 0;
    for (const s of next) if (!held.has(s)) changes += 1;
    for (const s of held) if (!next.has(s)) changes += 1;

    const w = 1 / TOP_K;
    const rfDay = Math.pow(1 + RISK_FREE, 1 / 365) - 1;
    let earned = 0;
    for (const [, v] of picks) earned += (w * v.cur) / CAP_MULT;
    const idle = (TOP_K - picks.length) * w * rfDay;
    const cost = (changes * w * (CYCLE_COST / 2)) / CAP_MULT;
    const ret = earned + idle - cost;
    equity *= 1 + ret;
    const row = { lane: "carry_paper", day, date: new Date(day).toISOString().slice(0, 10),
      held: [...next], n: picks.length, funding_pct: Math.round(earned * 1e6) / 1e4, idle_pct: Math.round(idle * 1e6) / 1e4,
      cost_pct: Math.round(cost * 1e6) / 1e4, return_pct: Math.round(ret * 1e6) / 1e4,
      equity: Math.round(equity * 1e8) / 1e8, booked_at: new Date(now).toISOString() };
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, `${JSON.stringify(row)}\n`);
    held = next;
  }

  const all = readJsonl(LEDGER);
  const byMonth = new Map();
  for (const r of all) {
    const m = r.date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 1) * (1 + r.return_pct / 100));
  }
  const months = [...byMonth].sort().map(([m, e]) => [m, (e - 1) * 100]);
  const report = {
    generated_at: new Date(now).toISOString(),
    lane: "carry_paper",
    rule: "top 5 perps by previous-day funding >= 11%/yr, spot-hedged, 1.3x capital, 0.08% per cycle, idle earns 5%/yr",
    purpose: "forward series for the carry sleeve, and for combining with forced_exit_short_paper at its decision dates",
    days_booked: all.length,
    equity: all.length ? all[all.length - 1].equity : 1,
    held_today: all.length ? all[all.length - 1].held : [],
    mean_daily_pct: all.length ? Math.round((all.reduce((a, r) => a + r.return_pct, 0) / all.length) * 1e4) / 1e4 : null,
    monthly_pct: months.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`),
    universe_size: perps.length,
    live_exposure_usdt: 0,
    rate_limited: rateLimited,
    errors: errors.slice(0, 10),
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: !rateLimited, days: all.length, equity: report.equity, held: report.held_today.length, errors: errors.length }));
  if (rateLimited) process.exit(3);
}

if (require.main === module) {
  main().catch((e) => { console.error("CARRY_PAPER_LANE_FAIL", e && e.stack ? e.stack : String(e)); process.exit(1); });
}
