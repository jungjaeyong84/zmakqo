#!/usr/bin/env node
"use strict";

// scripts/run-research-gate.js — run a book through the standing control, and
// manage the hypothesis registry (2026-09-13).
//
// Built after v8. The lesson that produced it: a book's own return tells you
// almost nothing, because a directional bet in a trending quarter looks
// identical to skill. What separates them is whether the book beats its own
// average exposure held constant. See src/research/staticBenchmarkGate.js.
//
// Usage
//   node scripts/run-research-gate.js gate --positions p.json --returns r.json [--cost 0.07] [--lag 24] [--label name]
//   node scripts/run-research-gate.js registry list
//   node scripts/run-research-gate.js registry validate
//
// The position and return files are JSON arrays of numbers (returns in percent
// per period). Both must be the same length and aligned so that positions[i]
// is the position HELD GOING INTO the period whose return is returns[i] — if
// they overlap, the gate measures coincidence, not forecasting.

const fs = require("fs");
const path = require("path");
const { evaluateAgainstStaticBenchmark, formatGateReport } = require("../src/research/staticBenchmarkGate");
const { listHypotheses, validateRegistry } = require("../src/research/hypothesisRegistry");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = process.env.RESEARCH_REGISTRY || path.join(ROOT, "ops/research/hypotheses.json");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readNumbers(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`NOT_AN_ARRAY: ${file}`);
  return parsed.map(Number);
}

function runGate() {
  const positionsFile = arg("positions");
  const returnsFile = arg("returns");
  if (!positionsFile || !returnsFile) {
    console.error("usage: run-research-gate.js gate --positions p.json --returns r.json [--cost 0.07] [--lag 24]");
    process.exit(2);
  }
  const result = evaluateAgainstStaticBenchmark({
    positions: readNumbers(positionsFile),
    marketReturns: readNumbers(returnsFile),
    costPerTurnPct: Number(arg("cost", "0.07")),
    neweyWestLag: Number(arg("lag", "24")),
    label: arg("label", path.basename(positionsFile, ".json")),
  });
  console.log(formatGateReport(result));
  console.log("");
  console.log(JSON.stringify({ verdict: result.verdict, excess_pct: result.excessPct, timing_nw_t: result.decomposition.timingT }, null, 2));
  process.exit(result.passed ? 0 : 1);
}

function runRegistry() {
  const sub = process.argv[3] || "list";
  if (sub === "validate") {
    const v = validateRegistry({ registryPath: REGISTRY });
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.ok ? 0 : 1);
  }
  const rows = listHypotheses({ registryPath: REGISTRY });
  if (!rows.length) {
    console.log(`등록된 가설 없음 (${REGISTRY})`);
    return;
  }
  for (const r of rows) {
    const state = r.outcome
      ? `판정 ${r.outcome.verdict}`
      : r.window_open
        ? "확인창 열림"
        : `확인창 ${r.days_until_open}일 후`;
    console.log(`${r.id.padEnd(24)} ${state.padEnd(18)} ${r.confirmation_starts_at.slice(0, 10)}  ${r.title}`);
  }
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "gate") return runGate();
  if (cmd === "registry") return runRegistry();
  console.error("usage: run-research-gate.js <gate|registry> ...");
  process.exit(2);
}

if (require.main === module) main();
