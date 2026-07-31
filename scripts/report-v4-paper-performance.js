#!/usr/bin/env node
"use strict";

// scripts/report-v4-paper-performance.js — v4 lane scorecard vs the
// PRE-COMMITTED criteria. Scored per universe variant on its own forward
// record; anything less and v4 is discarded exactly like the v3 lane.
//
// CRITERIA TIGHTENED 2026-08-01 (same day, still ZERO forward data, so this
// cannot be fitting to results — and it moves the bar UP, not down):
// the original bar was absolute (>= +8%/yr, Sharpe >= 0.5), which a lane
// could clear while delivering barely 3pp over simply holding stablecoins
// at ~5%/yr — with ~24% annualized volatility. The real alternative to
// trading is the risk-free yield, so the bar is now EXCESS of it:
//
//   90 days forward  AND  excess return >= +8pp over risk-free
//                    AND  excess Sharpe >= 0.5
//                    AND  max drawdown >= -20%

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEDGER = path.join(ROOT, "ops/runtime/v4_paper_rebalance_ledger.jsonl");
const OUT = path.join(ROOT, "ops/daily/v4_paper_performance_latest.json");

const CRITERIA = Object.freeze({
  min_days: Number(process.env.V4_CRITERIA_MIN_DAYS) > 0 ? Number(process.env.V4_CRITERIA_MIN_DAYS) : 90,
  // annualized risk-free alternative (stablecoin yield) the lane must beat
  risk_free_pct: Number.isFinite(Number(process.env.V4_CRITERIA_RISK_FREE_PCT)) ? Number(process.env.V4_CRITERIA_RISK_FREE_PCT) : 5,
  min_excess_return_pct: Number.isFinite(Number(process.env.V4_CRITERIA_MIN_EXCESS_PCT)) ? Number(process.env.V4_CRITERIA_MIN_EXCESS_PCT) : 8,
  min_excess_sharpe: Number.isFinite(Number(process.env.V4_CRITERIA_MIN_SHARPE)) ? Number(process.env.V4_CRITERIA_MIN_SHARPE) : 0.5,
  max_drawdown_pct: Number.isFinite(Number(process.env.V4_CRITERIA_MAX_DD_PCT)) ? Number(process.env.V4_CRITERIA_MAX_DD_PCT) : -20,
});

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

function scoreVariant(rows) {
  // period returns start on the SECOND row (the first row only opens positions)
  const rets = rows.map((r) => r.period && Number(r.period.net_return))
    .filter((v) => Number.isFinite(v));
  const retsTaker = rows.map((r) => r.period && Number(r.period.net_return_taker))
    .filter((v) => Number.isFinite(v));
  const n = rets.length;
  // First row only opens positions, so a fresh lane legitimately has no
  // period returns yet — that is ACCUMULATING, not a missing verdict.
  if (!n) return { days: 0, verdict: "ACCUMULATING", checks: { sample: false } };

  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  let eqT = 1;
  for (const r of retsTaker) eqT *= 1 + r;

  const annPct = (Math.exp(Math.log(Math.max(eq, 1e-9)) / (n / 365)) - 1) * 100;
  // Excess of the risk-free alternative: subtracting the daily-compounded
  // risk-free rate from each period return, so both the return and the
  // Sharpe are measured against "just hold stablecoins".
  const rfDaily = Math.pow(1 + CRITERIA.risk_free_pct / 100, 1 / 365) - 1;
  const excess = rets.map((r) => r - rfDaily);
  const exMean = excess.reduce((s, x) => s + x, 0) / n;
  const exSd = Math.sqrt(excess.reduce((s, x) => s + (x - exMean) ** 2, 0) / n) || 1e-9;
  const excessSharpe = (exMean / exSd) * Math.sqrt(365);
  const volPct = exSd * Math.sqrt(365) * 100;
  const excessPct = annPct - CRITERIA.risk_free_pct;
  const ddPct = mdd * 100;

  const checks = {
    sample: n >= CRITERIA.min_days,
    excess_return: excessPct >= CRITERIA.min_excess_return_pct,
    excess_sharpe: excessSharpe >= CRITERIA.min_excess_sharpe,
    drawdown: ddPct >= CRITERIA.max_drawdown_pct,
  };
  return {
    days: n,
    ann_return_pct_maker: +annPct.toFixed(2),
    ann_return_pct_taker: +((Math.exp(Math.log(Math.max(eqT, 1e-9)) / (Math.max(retsTaker.length, 1) / 365)) - 1) * 100).toFixed(2),
    excess_return_pct: +excessPct.toFixed(2),
    excess_sharpe: +excessSharpe.toFixed(3),
    annualized_vol_pct: +volPct.toFixed(2),
    max_drawdown_pct: +ddPct.toFixed(2),
    equity_maker: +eq.toFixed(6),
    checks,
    verdict: Object.values(checks).every(Boolean)
      ? "PASS"
      : (checks.sample ? "FAIL" : "ACCUMULATING"),
  };
}

function main() {
  const rows = readJsonl(LEDGER);
  const byVariant = {};
  for (const r of rows) {
    if (!r.variant) continue;
    (byVariant[r.variant] ||= []).push(r);
  }
  const variants = {};
  for (const [name, vrows] of Object.entries(byVariant)) {
    vrows.sort((a, b) => String(a.bar_date).localeCompare(String(b.bar_date)));
    variants[name] = scoreVariant(vrows);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    criteria: CRITERIA,
    criteria_note: "pre-committed 2026-08-01 before any forward data existed",
    variants,
    ledger_rows: rows.length,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

  console.log(JSON.stringify({
    ok: true,
    latest_json: OUT,
    variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, `${v.verdict} (${v.days}d, ann ${v.ann_return_pct_maker ?? "-"}%, sh ${v.sharpe ?? "-"})`])),
  }));
}

main();
