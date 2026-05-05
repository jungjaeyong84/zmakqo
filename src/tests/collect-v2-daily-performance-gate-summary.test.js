"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildSummary,
  main,
  resolveCostInclusion,
} = require("../../scripts/collect-v2-daily-performance-gate-summary");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-daily-perf-summary-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function gateFixture(overrides = {}) {
  return {
    ok: false,
    reason: "V2_PERFORMANCE_GATE_BLOCKED",
    stage: "LIVE",
    run_id: "cycle_a",
    source_cycle_id: "cycle_a",
    generated_at: "2026-05-01T00:01:00.000Z",
    blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"],
    metrics: {
      sample_n: 0,
      profit_factor: null,
      expectancy_r: null,
      net_pnl_pct: 0,
    },
    stage_matrix: {
      highest_passed_stage: null,
      discovery: { ok: false, blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], thresholds: { min_sample_n: 20 } },
      canary: { ok: false, blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], thresholds: { min_sample_n: 50 } },
      live: { ok: false, blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], thresholds: { min_sample_n: 200 } },
    },
    ...overrides,
  };
}

function reportFixture(overrides = {}) {
  return {
    run_id: "cycle_a",
    source_cycle_id: "cycle_a",
    generated_at: "2026-05-01T00:00:30.000Z",
    fee_included: true,
    funding_included: true,
    slippage_included: true,
    ...overrides,
  };
}

function blockedGateIsAccumulatingSummary() {
  const summary = buildSummary({ performanceGate: gateFixture(), performanceReport: reportFixture(), nowMs: Date.parse("2026-05-01T00:00:00Z") });
  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.current_status, "ACCUMULATING");
  assert.strictEqual(summary.sample_n, 0);
  assert.strictEqual(summary.stages.live.status, "BLOCKED");
  assert.deepStrictEqual(summary.warnings, []);
}

function passingGateShowsStagePass() {
  const summary = buildSummary({
    performanceGate: gateFixture({
      ok: true,
      blockers: [],
      metrics: { sample_n: 240, profit_factor: 1.2, expectancy_r: 0.04, net_pnl_pct: 2.1 },
      stage_matrix: {
        highest_passed_stage: "LIVE",
        discovery: { ok: true, blockers: [], thresholds: {} },
        canary: { ok: true, blockers: [], thresholds: {} },
        live: { ok: true, blockers: [], thresholds: {} },
      },
    }),
    performanceReport: reportFixture(),
  });
  assert.strictEqual(summary.current_status, "PASS");
  assert.strictEqual(summary.highest_passed_stage, "LIVE");
  assert.strictEqual(summary.stages.discovery.status, "PASS");
}

function costWarningsAreExplicit() {
  const summary = buildSummary({ performanceGate: gateFixture(), performanceReport: reportFixture({ fee_included: false, funding_included: null, slippage_included: undefined }) });
  assert.ok(summary.warnings.includes("PERFORMANCE_DAILY:FEE_INCLUSION_NOT_PROVEN"));
  assert.ok(summary.warnings.includes("PERFORMANCE_DAILY:FUNDING_INCLUSION_NOT_PROVEN"));
  assert.ok(summary.warnings.includes("PERFORMANCE_DAILY:SLIPPAGE_INCLUSION_NOT_PROVEN"));
}

function missingGateBlocksCollector() {
  const summary = buildSummary({ performanceGate: null, performanceReport: reportFixture() });
  assert.strictEqual(summary.ok, false);
  assert.ok(summary.blockers.includes("PERFORMANCE_DAILY:GATE_ARTIFACT_MISSING"));
}

function cycleMismatchBlocksSummary() {
  const summary = buildSummary({
    performanceGate: gateFixture({ run_id: "cycle_gate", source_cycle_id: "cycle_gate" }),
    performanceReport: reportFixture({ run_id: "cycle_report", source_cycle_id: "cycle_report" }),
  });
  assert.strictEqual(summary.ok, false);
  assert.ok(summary.blockers.includes("PERFORMANCE_DAILY:CYCLE_ID_MISMATCH"));
}

function staleGateBlocksSummary() {
  const summary = buildSummary({
    performanceGate: gateFixture({ generated_at: "2026-05-01T00:00:00.000Z" }),
    performanceReport: reportFixture({ generated_at: "2026-05-01T00:02:00.000Z" }),
  });
  assert.strictEqual(summary.ok, false);
  assert.ok(summary.blockers.includes("PERFORMANCE_DAILY:GATE_STALE_VS_REPORT"));
}

function collectWritesOutputAndHistory() {
  const tmp = mkTmp();
  const gateFile = path.join(tmp, "gate.json");
  const reportFile = path.join(tmp, "report.json");
  const outputFile = path.join(tmp, "summary.json");
  const historyFile = path.join(tmp, "history.jsonl");
  writeJson(gateFile, gateFixture());
  writeJson(reportFile, reportFixture());
  const result = main({
    V2_DAILY_PERFORMANCE_GATE_SUMMARY_GATE_FILE: gateFile,
    V2_DAILY_PERFORMANCE_GATE_SUMMARY_REPORT_FILE: reportFile,
    V2_DAILY_PERFORMANCE_GATE_SUMMARY_OUTPUT_FILE: outputFile,
    V2_DAILY_PERFORMANCE_GATE_SUMMARY_HISTORY_FILE: historyFile,
  });
  assert.strictEqual(result.ok, true);
  assert.ok(fs.existsSync(outputFile));
  assert.ok(fs.existsSync(historyFile));
}

function nestedCostFallbacksWork() {
  const costs = resolveCostInclusion({ costs: { fee_included: "1", funding_included: "true", slippage_included: "yes" } }, {});
  assert.deepStrictEqual(costs, { fee_included: true, funding_included: true, slippage_included: true });
}

blockedGateIsAccumulatingSummary();
passingGateShowsStagePass();
costWarningsAreExplicit();
missingGateBlocksCollector();
cycleMismatchBlocksSummary();
staleGateBlocksSummary();
collectWritesOutputAndHistory();
nestedCostFallbacksWork();
console.log("COLLECT_V2_DAILY_PERFORMANCE_GATE_SUMMARY_TEST_OK");
