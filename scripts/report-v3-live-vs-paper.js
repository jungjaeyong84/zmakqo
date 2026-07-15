#!/usr/bin/env node
"use strict";

// scripts/report-v3-live-vs-paper.js — the number that gates full live.
//
// Joins the live exit ledger with the paper exit ledger on signal_id and
// measures the REAL per-trade cost of execution: entry/exit slippage + fees
// in R units, and the live-vs-paper realized-R gap. The full-live decision
// replaces the assumed ~0.12R cost with this measured number.
//
// Dry-run rows are reported separately (they mirror paper by construction —
// their only use is pipeline health: gap must be exactly 0).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAPER_EXIT = path.join(ROOT, "ops/runtime/v3_paper_exit_ledger.jsonl");
const LIVE_EXIT = path.join(ROOT, "ops/runtime/v3_live_exit_ledger.jsonl");
const OUT = path.join(ROOT, "ops/daily/v3_live_vs_paper_latest.json");

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 4) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

function stats(values) {
  const a = values.filter((v) => v !== null).sort((x, y) => x - y);
  if (!a.length) return null;
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return { n: a.length, mean: round(mean), median: round(a[Math.floor(a.length / 2)]), min: round(a[0]), max: round(a[a.length - 1]) };
}

function summarize(pairs) {
  if (!pairs.length) return null;
  return {
    n: pairs.length,
    live_realized_r: stats(pairs.map((p) => p.live_r)),
    paper_realized_r: stats(pairs.map((p) => p.paper_r)),
    r_gap_live_minus_paper: stats(pairs.map((p) => (p.live_r !== null && p.paper_r !== null) ? p.live_r - p.paper_r : null)),
    slippage_entry_r: stats(pairs.map((p) => p.slip_entry)),
    slippage_exit_r: stats(pairs.map((p) => p.slip_exit)),
    fee_r: stats(pairs.map((p) => p.fee_r)),
    // the headline: measured total execution cost per trade in R
    measured_cost_r_per_trade: round(
      (stats(pairs.map((p) => (p.live_r !== null && p.paper_r !== null) ? p.paper_r - p.live_r : null)) || {}).mean
    ),
    exit_event_agreement_pct: round(
      pairs.filter((p) => p.exit_agree !== null).length
        ? (pairs.filter((p) => p.exit_agree === true).length / pairs.filter((p) => p.exit_agree !== null).length) * 100
        : null, 1),
  };
}

function main() {
  const paper = new Map(readJsonl(PAPER_EXIT).map((r) => [r.signal_id, r]));
  const live = readJsonl(LIVE_EXIT).filter((r) => String(r.status).toUpperCase() === "CLOSED");

  const realPairs = [];
  const dryPairs = [];
  let unmatched = 0;
  for (const l of live) {
    const p = paper.get(l.signal_id);
    if (!p) { unmatched += 1; continue; }
    const pair = {
      live_r: num(l.realized_r),
      paper_r: num(p.realized_r),
      slip_entry: num(l.slippage_entry_r),
      slip_exit: num(l.slippage_exit_r),
      fee_r: num(l.fee_r),
      exit_agree: l.exit_event && p.exit_event ? l.exit_event === p.exit_event : null,
    };
    (l.dry_run === true ? dryPairs : realPairs).push(pair);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    real: summarize(realPairs),
    dry_run: summarize(dryPairs),
    unmatched_live_exit_n: unmatched,
    note: "measured_cost_r_per_trade (real) replaces the assumed ~0.12R live cost in the full-live funding decision",
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ ok: true, latest_json: OUT, real_n: realPairs.length, dry_run_n: dryPairs.length, unmatched_live_exit_n: unmatched, measured_cost_r_per_trade: payload.real ? payload.real.measured_cost_r_per_trade : null }));
}

main();
