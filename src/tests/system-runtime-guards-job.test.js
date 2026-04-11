"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runSystemRuntimeGuardsJob, __test } = require("../services/systemRuntimeGuardsJob");

async function run() {
  assert.strictEqual(__test.deriveSummaryStatus({
    sloState: { block_new_entries: false },
    anomalyState: { circuit_breaker_open: false },
  }), "진행");
  assert.strictEqual(__test.deriveSummaryStatus({
    sloState: { block_new_entries: true },
    anomalyState: { circuit_breaker_open: false },
  }), "보류");
  assert.strictEqual(__test.deriveSummaryStatus({
    sloState: { block_new_entries: true },
    anomalyState: { circuit_breaker_open: true },
  }), "중단");

  const recorded = {
    slo: [],
    anomaly: [],
    remediationState: [],
    remediation: [],
    actuation: [],
    exportTrace: [],
  };
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "donbeolja-runtime-guards-"));
  const result = await runSystemRuntimeGuardsJob({
    exchange: "BINANCEFUT",
    nowMs: Date.parse("2026-04-11T02:00:00.000Z"),
    remediateOnBlock: true,
    dryRun: true,
    artifactsDir,
    loadOpsRuntime: async () => ({ status: "PASS", reason: "OPS_GUARD_OK", block_new_entries: false }),
    loadServingRuntime: async () => ({ status: "PASS", reason: "ML_SERVING_OK", block_new_entries: false }),
    buildSlo: () => ({ status: "PASS", reason: "SYSTEM_SLO_HEALTHY", block_new_entries: false }),
    buildAnomaly: () => ({
      status: "BLOCK",
      reason: "ANOMALY_QTY_PCT_NON_POSITIVE",
      circuit_breaker_open: true,
      rollback_action: "REQUEST_ML_ROLLBACK",
    }),
    recordSlo: async (payload) => { recorded.slo.push(payload); },
    recordAnomaly: async (payload) => { recorded.anomaly.push(payload); },
    recordRemediation: async (payload) => { recorded.remediationState.push(payload); },
    actuateServing: async (payload) => {
      recorded.actuation.push(payload);
      return { ok: true, apply: true, exchange: "BINANCEFUT", reason: "ROLLED_BACK_TO_PREVIOUS_ARTIFACT" };
    },
    exportTrace: async (payload) => {
      recorded.exportTrace.push(payload);
      return { ok: true, skipped: false, reason: "OTEL_EXPORT_OK", status: 200 };
    },
    remediate: async (payload) => {
      recorded.remediation.push(payload);
      return { ok: true, exchange: "BINANCEFUT", remediated_positions: 0, rows: [] };
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "중단");
  assert.strictEqual(result.circuit_breaker_open, true);
  assert.strictEqual(recorded.slo.length, 1);
  assert.strictEqual(recorded.anomaly.length, 1);
  assert.strictEqual(recorded.remediation.length, 1);
  assert.strictEqual(recorded.remediationState.length, 1);
  assert.strictEqual(recorded.actuation.length, 1);
  assert.strictEqual(recorded.exportTrace.length, 1);
  assert.strictEqual(recorded.remediation[0].dryRun, true);
  assert.strictEqual(result.actuation.apply, true);
  assert.strictEqual(result.otel_export.ok, true);
  assert.ok(String(result.artifacts.system_slo_latest_json || "").startsWith(artifactsDir));
  assert.ok(String(result.artifacts.system_anomaly_latest_json || "").startsWith(artifactsDir));
  assert.ok(String(result.trace.traceparent || "").startsWith("00-"));

  let capturedExecutionQuality = null;
  let capturedLineageHealth = null;
  await runSystemRuntimeGuardsJob({
    exchange: "BINANCEFUT",
    nowMs: Date.parse("2026-04-11T02:00:00.000Z"),
    remediateOnBlock: false,
    dryRun: true,
    artifactsDir,
    loadOpsRuntime: async () => ({ status: "보류", reason: "OPS_GUARD_HOLD", block_new_entries: true }),
    loadServingRuntime: async () => ({ status: "PASS", reason: "ML_SERVING_OK", block_new_entries: false }),
    loadExecutionQuality: () => ({ generated_at: "2026-04-11T01:59:00.000Z", summary: { status: "EXECUTION_QUALITY_OK" } }),
    loadLineageHealth: () => ({ generated_at: "2026-04-11T01:59:00.000Z", summary: { verdict: "PASS" } }),
    buildSlo: (payload) => {
      capturedExecutionQuality = payload.executionQuality;
      capturedLineageHealth = payload.lineageHealth;
      return { status: "WARN", reason: "OPS_GUARD_HOLD", block_new_entries: true };
    },
    buildAnomaly: () => ({
      status: "WARN",
      reason: "ANOMALY_SYSTEM_SLO_HOLD",
      circuit_breaker_open: false,
      rollback_action: "NONE",
    }),
    recordSlo: async () => {},
    recordAnomaly: async () => {},
    recordRemediation: async () => {},
    actuateServing: async () => ({ ok: true, skipped: true, reason: "NOOP" }),
    exportTrace: async () => ({ ok: true, skipped: true, reason: "OTEL_EXPORT_SKIPPED" }),
  });
  assert.strictEqual(capturedExecutionQuality.summary.status, "EXECUTION_QUALITY_OK");
  assert.strictEqual(capturedLineageHealth.summary.verdict, "PASS");
}

run()
  .then(() => {
    console.log("SYSTEM_RUNTIME_GUARDS_JOB_TEST_OK");
  })
  .catch((err) => {
    console.error("SYSTEM_RUNTIME_GUARDS_JOB_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
