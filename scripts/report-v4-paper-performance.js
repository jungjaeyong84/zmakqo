#!/usr/bin/env node
"use strict";

// scripts/report-v4-paper-performance.js — v4 lane scorecard vs the
// PRE-COMMITTED criteria (written 2026-08-01, before any forward data
// existed, so the verdict cannot be rationalised after the fact):
//
//   90 days of forward paper AND annualized net return >= +8% at maker cost
//   AND Sharpe >= 0.5 AND max drawdown >= -20%
//
// Anything less and v4 is discarded exactly like the v3 directional lane.
// Both universe variants are scored independently; a variant only "passes"
// on its own forward record.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEDGER = path.join(ROOT, "ops/runtime/v4_paper_rebalance_ledger.jsonl");
const OUT = path.join(ROOT, "ops/daily/v4_paper_performance_latest.json");

const CRITERIA = Object.freeze({
  min_days: Number(process.env.V4_CRITERIA_MIN_DAYS) > 0 ? Number(process.env.V4_CRITERIA_MIN_DAYS) : 90,
  min_ann_return_pct: Number.isFinite(Number(process.env.V4_CRITERIA_MIN_ANN_PCT)) ? Number(process.env.V4_CRITERIA_MIN_ANN_PCT) : 8,
  min_sharpe: Number.isFinite(Number(process.env.V4_CRITERIA_MIN_SHARPE)) ? Number(process.env.V4_CRITERIA_MIN_SHARPE) : 0.5,
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

  const mean = rets.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / n) || 1e-9;
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  let eqT = 1;
  for (const r of retsTaker) eqT *= 1 + r;

  const annPct = (Math.exp(Math.log(Math.max(eq, 1e-9)) / (n / 365)) - 1) * 100;
  const sharpe = (mean / sd) * Math.sqrt(365);
  const ddPct = mdd * 100;

  const checks = {
    sample: n >= CRITERIA.min_days,
    return: annPct >= CRITERIA.min_ann_return_pct,
    sharpe: sharpe >= CRITERIA.min_sharpe,
    drawdown: ddPct >= CRITERIA.max_drawdown_pct,
  };
  return {
    days: n,
    ann_return_pct_maker: +annPct.toFixed(2),
    ann_return_pct_taker: +((Math.exp(Math.log(Math.max(eqT, 1e-9)) / (Math.max(retsTaker.length, 1) / 365)) - 1) * 100).toFixed(2),
    sharpe: +sharpe.toFixed(3),
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
