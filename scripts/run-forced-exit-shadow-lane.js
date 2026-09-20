#!/usr/bin/env node
"use strict";

// scripts/run-forced-exit-shadow-lane.js — pre-registered variants of the
// forced-exit short, recorded but never allowed to decide (2026-09-20).
//
// WHY SEPARATE
// ------------
// run-forced-exit-paper-lane.js is frozen until 2027-09-20 and its file is not
// touched: its hash is what makes its test meaningful. GPT-5.5's tenth
// consultation listed improvements that plausibly raise the odds — a carry
// sleeve, volatility-inverse sizing, faster entry, cluster limits — and warned
// about the trap of judging them on the same events they were designed from.
// So the variants live here, they are FIXED NOW, and the decision at 30 and 60
// events still belongs to the frozen rule alone. A variant that looks better is
// a candidate for a NEW forward test after that decision, not a rescue of it.
//
// PRE-REGISTERED VARIANTS (fixed 2026-09-20; nothing may be added later)
//   S1  enter 1 minute after the announcement, +1.00% extra slippage
//   S2  enter 5 minutes after,                 +0.50% extra slippage
//   S3  enter 15 minutes after,                +0.25% extra slippage
//       (faster fills are charged more because a thin book in the first minutes
//        is exactly where a backtest lies)
//   S4  primary entry, size = min(10%, 1.5% / 7-day realised daily vol) of NAV
//   S5  primary entry, plus a BTC long of 0.30x the short's notional
//   S6  primary entry, plus a BTC long of the 30-day hourly beta x notional
//   S7  primary entry, at most 3 new events per announcement day (first three)
//   Everything else — +50% stop, 168h, 0.15% per side, funding — matches the
//   frozen rule.
//
// The report also carries the combination the frozen lane cannot test alone:
// forced-exit + carry at 70:30 and 60:40 of risk budget, using the carry paper
// lane's own forward series.
//
// PAPER ONLY. No keys, no order path.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVENTS = path.join(ROOT, "ops/runtime/forced_exit_events.jsonl");
const PRIMARY = path.join(ROOT, "ops/runtime/forced_exit_paper_ledger.jsonl");
const CARRY = path.join(ROOT, "ops/runtime/carry_paper_ledger.jsonl");
const LEDGER = path.join(ROOT, "ops/runtime/forced_exit_shadow_ledger.jsonl");
const REPORT = path.join(ROOT, "ops/daily/forced_exit_shadow_latest.json");

// ---- frozen parameters (must mirror the primary lane) -----------------------
const H = 3600e3;
const MIN = 60e3;
const DAY = 864e5;
const HOLD_H = 168;
const STOP = 1.5;
const COST = 0.0015;
const BASE_SIZE = 0.06;
const FAPI = "https://fapi.binance.com";
const VARIANTS = [
  { id: "S1_entry_1m", delayMin: 1, slip: 0.0100 },
  { id: "S2_entry_5m", delayMin: 5, slip: 0.0050 },
  { id: "S3_entry_15m", delayMin: 15, slip: 0.0025 },
  { id: "S4_vol_target", volTarget: 0.015, maxSize: 0.10 },
  { id: "S5_btc_hedge_static", hedge: 0.30 },
  { id: "S6_btc_hedge_beta", hedge: "beta" },
  { id: "S7_cluster_limit_3", clusterLimit: 3 },
];
const COMBOS = [[0.70, 0.30], [0.60, 0.40]];
// -----------------------------------------------------------------------------

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

async function klines(symbol, interval, startTime, limit) {
  const r = await getJson(`${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=${limit}`);
  return Array.isArray(r) ? r.map((x) => [Number(x[0]), Number(x[1]), Number(x[2]), Number(x[3]), Number(x[4])]) : [];
}

// Walk a short from entryPrice over hourly bars, honouring stop / hold / end.
function walk(bars, fromTs, entryPrice, fundingRows) {
  const deadline = fromTs + HOLD_H * H;
  for (const b of bars) {
    if (b[0] <= fromTs) continue;
    if (b[2] >= entryPrice * STOP) return { exit: entryPrice * STOP, ts: b[0], reason: "STOP" };
    if (b[0] >= deadline) return { exit: b[4], ts: b[0], reason: "HOLD_EXPIRED" };
  }
  const last = bars[bars.length - 1];
  return last ? { exit: last[4], ts: last[0], reason: "DATA_END" } : null;
}

function fundingBetween(rows, from, to) {
  let s = 0;
  for (const [t, r] of rows) if (t > from && t <= to) s += r;
  return s;
}

function beta(alt, btc) {
  const m = new Map(btc.map((b) => [b[0], b[4]]));
  const xs = [], ys = [];
  for (let i = 1; i < alt.length; i += 1) {
    const b1 = m.get(alt[i][0]), b0 = m.get(alt[i - 1][0]);
    if (!b1 || !b0) continue;
    xs.push(b1 / b0 - 1);
    ys.push(alt[i][4] / alt[i - 1][4] - 1);
  }
  if (xs.length < 100) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i += 1) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  return sxx > 0 ? sxy / sxx : null;
}

async function main() {
  const now = Date.now();
  const events = new Map(readJsonl(EVENTS).map((e) => [e.event_id, e]));
  const primaryClosed = readJsonl(PRIMARY).filter((r) => r.status === "CLOSED");
  const doneIds = new Set(readJsonl(LEDGER).map((r) => r.event_id));
  const errors = [];
  let processed = 0;

  for (const p of primaryClosed) {
    if (doneIds.has(p.event_id)) continue;
    const e = events.get(p.event_id);
    if (!e) { errors.push(`${p.event_id}: event row missing`); continue; }
    const annMs = e.announced_ms;
    const hourOpen = Math.floor(annMs / H) * H;
    try {
      const minuteBars = await klines(p.symbol, "1m", annMs - MIN, 30);
      await sleep(250);
      const hourly = await klines(p.symbol, "1h", hourOpen, 300);
      await sleep(250);
      const daily = await klines(p.symbol, "1d", annMs - 10 * DAY, 12);
      await sleep(250);
      const btcHourly = await klines("BTCUSDT", "1h", annMs - 31 * DAY, 800);
      await sleep(250);
      const altHourly = await klines(p.symbol, "1h", annMs - 31 * DAY, 800);
      await sleep(250);
      const fundingRows = (await getJson(`${FAPI}/fapi/v1/fundingRate?symbol=${p.symbol}&startTime=${hourOpen}&limit=100`)) || [];
      const fr = Array.isArray(fundingRows) ? fundingRows.map((x) => [Number(x.fundingTime), Number(x.fundingRate)]) : [];
      await sleep(250);

      const btcMap = new Map(btcHourly.map((b) => [b[0], b[4]]));
      const b30 = beta(altHourly, btcHourly);
      // 7-day realised daily vol
      const rets = [];
      for (let i = 1; i < daily.length; i += 1) rets.push(Math.log(daily[i][4] / daily[i - 1][4]));
      const last7 = rets.slice(-7);
      const mu = last7.length ? last7.reduce((a, b) => a + b, 0) / last7.length : 0;
      const vol7 = last7.length > 1 ? Math.sqrt(last7.reduce((a, b) => a + (b - mu) ** 2, 0) / (last7.length - 1)) : null;

      const row = { event_id: p.event_id, symbol: p.symbol, family: p.family, announced: p.announced,
        primary_pnl_pct: p.pnl_pct, primary_size: p.size, exit_time: p.exit_time, variants: {}, recorded_at: new Date(now).toISOString() };

      for (const v of VARIANTS) {
        let entryTs, entryPrice, size = BASE_SIZE, hedge = 0, note = null;
        if (v.delayMin !== undefined) {
          const want = annMs + v.delayMin * MIN;
          const bar = minuteBars.find((b) => b[0] <= want && want < b[0] + MIN) || minuteBars.find((b) => b[0] >= want);
          if (!bar) { row.variants[v.id] = { skipped: "no minute bar" }; continue; }
          entryTs = bar[0];
          entryPrice = bar[4] * (1 - v.slip);          // a short filled worse than the print
          note = `slippage ${(v.slip * 100).toFixed(2)}%`;
        } else {
          entryTs = hourOpen;
          const bar = hourly.find((b) => b[0] === hourOpen);
          if (!bar) { row.variants[v.id] = { skipped: "no hour bar" }; continue; }
          entryPrice = bar[4];
        }
        if (v.volTarget) {
          if (!vol7) { row.variants[v.id] = { skipped: "no 7d vol" }; continue; }
          size = Math.min(v.maxSize, v.volTarget / vol7);
          note = `vol7 ${(vol7 * 100).toFixed(1)}% -> size ${(size * 100).toFixed(1)}%`;
        }
        if (v.hedge) {
          hedge = v.hedge === "beta" ? b30 : v.hedge;
          if (hedge === null || !Number.isFinite(hedge)) { row.variants[v.id] = { skipped: "no beta" }; continue; }
          note = `hedge ${hedge.toFixed(2)}x BTC`;
        }
        const w = walk(hourly, entryTs, entryPrice, fr);
        if (!w) { row.variants[v.id] = { skipped: "no bars" }; continue; }
        const gross = -(w.exit - entryPrice) / entryPrice;
        const fund = w.reason === "STOP" ? 0 : fundingBetween(fr, entryTs, w.ts);
        let pnl = gross + fund - 2 * COST;
        if (hedge) {
          const b0 = btcMap.get(entryTs) || btcMap.get(hourOpen), b1 = btcMap.get(w.ts);
          if (b0 && b1) pnl += hedge * (b1 / b0 - 1) - hedge * 2 * COST;
          else note += " (btc bars missing, hedge skipped)";
        }
        row.variants[v.id] = { entry_time: new Date(entryTs).toISOString(), entry: entryPrice, exit: w.exit, exit_reason: w.reason,
          size: Math.round(size * 1e4) / 1e4, pnl_pct: Math.round(pnl * 1e4) / 100, note };
      }
      fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
      fs.appendFileSync(LEDGER, `${JSON.stringify(row)}\n`);
      processed += 1;
    } catch (err) {
      errors.push(`${p.symbol}: ${err.message}`);
      if (rateLimited) break;
    }
  }

  // ---- report -----------------------------------------------------------------
  const rows = readJsonl(LEDGER);
  const monthlyOf = (pick) => {
    const m = new Map();
    for (const r of rows) {
      const v = pick(r);
      if (!v || v.skipped) continue;
      const k = r.exit_time.slice(0, 7);
      m.set(k, (m.get(k) || 0) + (v.size !== undefined ? v.size : BASE_SIZE) * (v.pnl_pct / 100));
    }
    return m;
  };
  const stats = (m) => {
    const vals = [...m.values()];
    if (!vals.length) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const worst = Math.min(...vals);
    return { months: vals.length, mean_monthly_pct: Math.round(mean * 1e4) / 100,
      losing_share: Math.round((vals.filter((v) => v < 0).length / vals.length) * 1000) / 1000,
      worst_month_pct: Math.round(worst * 1e4) / 100,
      mean_over_worst: worst < 0 ? Math.round((mean / Math.abs(worst)) * 1000) / 1000 : null };
  };
  const primaryMonthly = monthlyOf((r) => ({ size: r.primary_size, pnl_pct: r.primary_pnl_pct }));
  const carryMonthly = new Map();
  for (const r of readJsonl(CARRY)) {
    const k = r.date.slice(0, 7);
    carryMonthly.set(k, (carryMonthly.get(k) || 1) * (1 + r.return_pct / 100));
  }
  for (const [k, v] of carryMonthly) carryMonthly.set(k, v - 1);

  const combos = {};
  for (const [ws, wc] of COMBOS) {
    const m = new Map();
    for (const k of new Set([...primaryMonthly.keys(), ...carryMonthly.keys()])) {
      m.set(k, ws * (primaryMonthly.get(k) || 0) + wc * (carryMonthly.get(k) || 0));
    }
    combos[`short_${Math.round(ws * 100)}_carry_${Math.round(wc * 100)}`] = stats(m);
  }

  const report = {
    generated_at: new Date(now).toISOString(),
    lane: "forced_exit_shadow",
    decision_authority: "none — the frozen lane decides at 2027-03-20 / 2027-09-20",
    variants_frozen_on: "2026-09-20",
    events_recorded: rows.length,
    newly_processed: processed,
    primary: stats(primaryMonthly),
    variants: Object.fromEntries(VARIANTS.map((v) => [v.id, {
      ...stats(monthlyOf((r) => r.variants[v.id])),
      events: rows.filter((r) => r.variants[v.id] && !r.variants[v.id].skipped).length,
      skipped: rows.filter((r) => r.variants[v.id] && r.variants[v.id].skipped).length,
    }])),
    carry_months: carryMonthly.size,
    combinations: combos,
    live_exposure_usdt: 0,
    rate_limited: rateLimited,
    errors: errors.slice(0, 10),
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: !rateLimited, recorded: rows.length, processed, errors: errors.length }));
  if (rateLimited) process.exit(3);
}

if (require.main === module) {
  main().catch((e) => { console.error("FORCED_EXIT_SHADOW_LANE_FAIL", e && e.stack ? e.stack : String(e)); process.exit(1); });
}
