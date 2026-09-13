#!/usr/bin/env node
"use strict";

// scripts/evaluate-v7-turnover-gate.js — frozen evaluator for one registered
// variant (2026-09-14).
//
// WHAT THIS IS
// ------------
// v7 rebalances every 4h regardless of how little the book would change. This
// variant skips the rebalance when turnover would fall below a threshold. It is
// the least invasive intervention available to an equal-weight book: v7 holds
// +-0.5/K on every name, so there are no small weight adjustments to trim —
// every change is a full entry or exit, and the only thing that can be skipped
// is the whole rebalance.
//
// FROZEN. The parameters below were fixed on 2026-09-14 and must not be tuned.
// The in-sample result that motivated registration is recorded here so a later
// reader can see exactly what was known at registration time:
//
//   base (verified against the live ledger to 0.062pp on gross)
//     168 periods, net -2.725%, cost 1.843%
//   gate 0.20
//     net -1.649%, cost 1.470%, paired difference +1.076pp
//     difference sd 0.1475, t 0.56, MDE at 80% power 5.357pp
//
// The difference is a seventh of what this sample can detect. It is an
// exploratory number and nothing more. Whether it is real is a question only
// new data can answer, which is why the hypothesis carries a confirmation
// window of 2028-08-21 — the date at which 4,240 periods will exist, derived
// from the observed effect size and 80% power, not chosen for convenience.
//
// WHY NO SEPARATE LANE
// --------------------
// The variant is a deterministic function of the same flow ledger v7 already
// consumes, so it can be reconstructed at any future date by running this file.
// A second live lane would add a process that can fail, and v5_flow_history is
// v7's only input — nothing new should be able to touch it.
//
// Usage
//   node scripts/evaluate-v7-turnover-gate.js [--from YYYY-MM-DD] [--klines path]
//
// Klines are not in the repo. Supply a JSON file shaped { bars: { SYM: [[ts,
// close], ...] } } covering the evaluation window, or the script will say what
// is missing and exit non-zero rather than silently evaluating a short sample.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FLOW = path.join(ROOT, "ops/runtime/v5_flow_history.jsonl");

// ---- frozen parameters: do not tune ----------------------------------------
const K = 6;                      // longs and shorts per side
const GROSS = 1.0;                // 0.5 long + 0.5 short
const COST_PER_TURNOVER_PCT = 0.07;   // taker 0.05 + slippage 0.02
const TURNOVER_GATE = 0.20;       // skip the rebalance below this turnover
const MIN_SYMBOLS = 2 * K + 2;
const EVAL_FROM = "2026-09-15";   // evaluation data starts here
const MIN_PERIODS = 4240;         // 80% power at the registered effect size
// -----------------------------------------------------------------------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1e-12;
};

function loadFlow() {
  const byId = new Map();
  for (const line of fs.readFileSync(FLOW, "utf8").split("\n")) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch (_) { continue; }
    const id = `${r.symbol}|${r.ts}`;
    const cur = byId.get(id) || { symbol: r.symbol, ts: r.ts };
    if (r.top_ratio != null) cur.top = r.top_ratio;
    if (r.retail_ratio != null) cur.retail = r.retail_ratio;
    byId.set(id, cur);
  }
  const byTs = new Map();
  for (const v of byId.values()) {
    if (v.top == null || v.retail == null) continue;
    if (!byTs.has(v.ts)) byTs.set(v.ts, []);
    byTs.get(v.ts).push(v);
  }
  return byTs;
}

// One pass over the timestamps. gate=0 reproduces v7 as built.
function run(byTs, px, stamps, gate) {
  let prevW = null;
  let prevPx = null;
  const per = [];
  for (const t of stamps) {
    const g = (byTs.get(t) || []).filter((v) => px[v.symbol]);
    if (g.length < MIN_SYMBOLS) continue;
    g.sort((a, b) => (a.top - a.retail) - (b.top - b.retail));

    // Settle the book held since the previous stamp before rebuilding it.
    let gross = null;
    if (prevW) {
      let acc = 0;
      let ok = true;
      for (const [s, pw] of prevW) {
        const p0 = prevPx.get(s);
        const p1 = px[s] && px[s].get(t);
        if (p0 == null || p1 == null) { ok = false; break; }
        acc += pw * (p1 / p0 - 1);
      }
      gross = ok ? acc * 100 : 0;
    }

    // IC is negative: the LOW end of the spread is the long side.
    let w = new Map();
    for (const v of g.slice(0, K)) w.set(v.symbol, (GROSS / 2) / K);
    for (const v of g.slice(-K)) w.set(v.symbol, -(GROSS / 2) / K);

    let turnover = 0;
    const keys = new Set([...w.keys(), ...(prevW ? prevW.keys() : [])]);
    for (const s of keys) turnover += Math.abs((w.get(s) || 0) - ((prevW && prevW.get(s)) || 0));

    if (gate > 0 && prevW && turnover < gate) { w = prevW; turnover = 0; }

    if (prevW) per.push({ t, gross, cost: turnover * COST_PER_TURNOVER_PCT, net: gross - turnover * COST_PER_TURNOVER_PCT, turnover });

    prevW = w;
    prevPx = new Map();
    for (const s of w.keys()) prevPx.set(s, px[s].get(t));
  }
  return per;
}

function main() {
  const klinePath = arg("klines");
  if (!klinePath || !fs.existsSync(klinePath)) {
    console.error("KLINES_REQUIRED: pass --klines <file> shaped { bars: { SYM: [[ts, close], ...] } }");
    process.exit(2);
  }
  const kl = JSON.parse(fs.readFileSync(klinePath, "utf8"));
  const px = {};
  for (const s of Object.keys(kl.bars || {})) px[s] = new Map(kl.bars[s]);

  const from = Date.parse(`${arg("from", EVAL_FROM)}T00:00:00.000Z`);
  const byTs = loadFlow();
  const stamps = [...byTs.keys()].map(Number).filter((t) => t >= from).sort((a, b) => a - b);

  const base = run(byTs, px, stamps, 0);
  const variant = run(byTs, px, stamps, TURNOVER_GATE);
  const n = Math.min(base.length, variant.length);

  const diff = [];
  for (let i = 0; i < n; i += 1) diff.push(variant[i].net - base[i].net);
  const dsd = sd(diff);
  const t = n > 2 ? mean(diff) / (dsd / Math.sqrt(n)) : 0;
  const Z = 1.959964 + 0.841621;   // two-sided alpha .05, power .80
  const mde = n > 2 ? Z * dsd / Math.sqrt(n) * n : null;

  const out = {
    generated_at: new Date().toISOString(),
    hypothesis_id: "v7-turnover-gate-020",
    frozen: { K, GROSS, COST_PER_TURNOVER_PCT, TURNOVER_GATE, MIN_SYMBOLS, EVAL_FROM, MIN_PERIODS },
    evaluation_from: new Date(from).toISOString(),
    periods: n,
    periods_required: MIN_PERIODS,
    sample_sufficient: n >= MIN_PERIODS,
    base: { net_pct: base.slice(0, n).reduce((a, b) => a + b.net, 0), cost_pct: base.slice(0, n).reduce((a, b) => a + b.cost, 0) },
    variant: { net_pct: variant.slice(0, n).reduce((a, b) => a + b.net, 0), cost_pct: variant.slice(0, n).reduce((a, b) => a + b.cost, 0), skipped: variant.slice(0, n).filter((r) => r.turnover === 0).length },
    paired: { difference_pct: diff.reduce((a, b) => a + b, 0), mean: mean(diff), sd: dsd, t, mde_80pct: mde },
    verdict_allowed: n >= MIN_PERIODS,
    note: n >= MIN_PERIODS
      ? "sample sufficient — a verdict may be recorded against the registry"
      : `sample insufficient: ${n} of ${MIN_PERIODS} periods. Any difference shown here is exploratory.`,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.sample_sufficient) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { run, K, TURNOVER_GATE, COST_PER_TURNOVER_PCT, MIN_PERIODS, EVAL_FROM };
