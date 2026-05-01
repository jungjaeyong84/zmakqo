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
    runExitIntegrityCycle: async () => ({
      ok: true,
      status: "OK",
      summary: { status: "OK", live_issue_count: 0 },
      output_json: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.json"),
      output_md: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.md"),
    }),
    runTradeAlertOutboxLineageCheck: async () => ({
      ok: true,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_PASS",
      checked_row_n: 0,
      issue_row_n: 0,
      output_json: path.join(artifactsDir, "trade_alert_outbox_lineage_evidence_latest.json"),
    }),
    loadOpsRuntime: async () => ({ status: "PASS", reason: "OPS_GUARD_OK", block_new_entries: false }),
    loadServingRuntime: async () => ({ status: "PASS", reason: "ML_SERVING_OK", block_new_entries: false }),
    loadNativeTrailProtection: async () => ({ available: true, gap_count: 1, top_symbols: [{ symbol: "ETHUSDT", count: 1 }] }),
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
  assert.ok(String(result.artifacts.native_trail_protection_latest_json || "").startsWith(artifactsDir));
  assert.ok(String(result.artifacts.binance_exit_integrity_cycle_latest_json || "").startsWith(artifactsDir));
  assert.ok(String(result.trace.traceparent || "").startsWith("00-"));
  assert.strictEqual(result.native_trail_protection.gap_count, 1);
  assert.strictEqual(result.exit_integrity_cycle.summary.live_issue_count, 0);
  assert.strictEqual(result.trade_alert_outbox_lineage.reason, "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_PASS");
  assert.ok(String(result.artifacts.trade_alert_outbox_lineage_latest_json || "").startsWith(artifactsDir));

  let capturedExecutionQuality = null;
  let capturedLineageHealth = null;
  await runSystemRuntimeGuardsJob({
    exchange: "BINANCEFUT",
    nowMs: Date.parse("2026-04-11T02:00:00.000Z"),
    remediateOnBlock: false,
    dryRun: true,
    artifactsDir,
    runExitIntegrityCycle: async () => ({
      ok: true,
      status: "OK",
      summary: { status: "OK", live_issue_count: 0 },
      output_json: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.json"),
      output_md: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.md"),
    }),
    runTradeAlertOutboxLineageCheck: async () => ({
      ok: true,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_PASS",
      checked_row_n: 0,
      issue_row_n: 0,
      output_json: path.join(artifactsDir, "trade_alert_outbox_lineage_evidence_latest.json"),
    }),
    loadOpsRuntime: async () => ({ status: "보류", reason: "OPS_GUARD_HOLD", block_new_entries: true }),
    loadServingRuntime: async () => ({ status: "PASS", reason: "ML_SERVING_OK", block_new_entries: false }),
    loadExecutionQuality: () => ({ generated_at: "2026-04-11T01:59:00.000Z", summary: { status: "EXECUTION_QUALITY_OK" } }),
    loadLineageHealth: () => ({ generated_at: "2026-04-11T01:59:00.000Z", summary: { verdict: "PASS" } }),
    loadNativeTrailProtection: () => ({ available: true, gap_count: 0, top_symbols: [] }),
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

  let refreshedExecutionQuality = 0;
  let refreshedLineage = 0;
  let refreshedExecutionQualityUsed = null;
  let refreshedLineageUsed = null;
  await runSystemRuntimeGuardsJob({
    exchange: "BINANCEFUT",
    nowMs: Date.parse("2026-04-13T04:00:00.000Z"),
    remediateOnBlock: false,
    dryRun: true,
    artifactsDir,
    runExitIntegrityCycle: async () => ({
      ok: true,
      status: "OK",
      summary: { status: "OK", live_issue_count: 0 },
      output_json: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.json"),
      output_md: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.md"),
    }),
    runTradeAlertOutboxLineageCheck: async () => ({
      ok: true,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_PASS",
      checked_row_n: 0,
      issue_row_n: 0,
      output_json: path.join(artifactsDir, "trade_alert_outbox_lineage_evidence_latest.json"),
    }),
    loadOpsRuntime: async () => ({ status: "PASS", reason: "OPS_GUARD_OK", block_new_entries: false }),
    loadServingRuntime: async () => ({ status: "PASS", reason: "ML_SERVING_OK", block_new_entries: false }),
    loadExecutionQuality: async (options) => {
      assert.ok(options && typeof options.refreshLocal === "function");
      await options.refreshLocal();
      return { generated_at: "2026-04-13T03:59:00.000Z", summary: { status: "EXECUTION_QUALITY_OK" } };
    },
    loadLineageHealth: async (options) => {
      assert.ok(options && typeof options.refreshLocal === "function");
      await options.refreshLocal();
      return { generated_at: "2026-04-13T03:59:00.000Z", summary: { verdict: "PASS" } };
    },
    refreshExecutionQualityInput: async () => { refreshedExecutionQuality += 1; },
    refreshLineageHealthInput: async () => { refreshedLineage += 1; },
    loadNativeTrailProtection: async () => ({ available: true, gap_count: 0, top_symbols: [] }),
    buildSlo: (payload) => {
      refreshedExecutionQualityUsed = payload.executionQuality;
      refreshedLineageUsed = payload.lineageHealth;
      return { status: "PASS", reason: "SYSTEM_SLO_HEALTHY", block_new_entries: false };
    },
    buildAnomaly: () => ({
      status: "PASS",
      reason: "SYSTEM_ANOMALY_HEALTHY",
      circuit_breaker_open: false,
      rollback_action: "NONE",
    }),
    recordSlo: async () => {},
    recordAnomaly: async () => {},
    recordRemediation: async () => {},
    actuateServing: async () => ({ ok: true, skipped: true, reason: "NOOP" }),
    exportTrace: async () => ({ ok: true, skipped: true, reason: "OTEL_EXPORT_SKIPPED" }),
  });
  assert.strictEqual(refreshedExecutionQuality, 1);
  assert.strictEqual(refreshedLineage, 1);
  assert.strictEqual(refreshedExecutionQualityUsed.summary.status, "EXECUTION_QUALITY_OK");
  assert.strictEqual(refreshedLineageUsed.summary.verdict, "PASS");

  const exitIntegrityBlocked = await runSystemRuntimeGuardsJob({
    exchange: "BINANCEFUT",
    nowMs: Date.parse("2026-04-13T05:00:00.000Z"),
    remediateOnBlock: false,
    dryRun: true,
    artifactsDir,
    runExitIntegrityCycle: async () => ({
      ok: true,
      status: "WARN",
      summary: { status: "WARN", live_issue_count: 2, reasons: ["exit integrity unresolved"] },
      output_json: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.json"),
      output_md: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.md"),
    }),
    runTradeAlertOutboxLineageCheck: async () => ({
      ok: true,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_PASS",
      checked_row_n: 0,
      issue_row_n: 0,
      output_json: path.join(artifactsDir, "trade_alert_outbox_lineage_evidence_latest.json"),
    }),
    loadOpsRuntime: async () => ({ status: "PASS", reason: "OPS_GUARD_OK", block_new_entries: false }),
    loadServingRuntime: async () => ({ status: "PASS", reason: "ML_SERVING_OK", block_new_entries: false }),
    loadExecutionQuality: async () => ({ generated_at: "2026-04-13T04:59:00.000Z", summary: { status: "EXECUTION_QUALITY_OK" } }),
    loadLineageHealth: async () => ({ generated_at: "2026-04-13T04:59:00.000Z", summary: { verdict: "PASS" } }),
    loadNativeTrailProtection: async () => ({ available: true, gap_count: 0, top_symbols: [] }),
    buildSlo: (payload) => {
      assert.strictEqual(payload.exitIntegrityCycle.summary.live_issue_count, 2);
      return { status: "WARN", reason: "EXIT_INTEGRITY_LIVE_ISSUE", block_new_entries: true };
    },
    buildAnomaly: (payload) => {
      assert.strictEqual(payload.exitIntegrityCycle.summary.live_issue_count, 2);
      return {
        status: "BLOCK",
        reason: "ANOMALY_EXIT_INTEGRITY_LIVE_ISSUE",
        circuit_breaker_open: true,
        rollback_action: "NONE",
      };
    },
    recordSlo: async () => {},
    recordAnomaly: async () => {},
    recordRemediation: async () => {},
    actuateServing: async () => ({ ok: true, skipped: true, reason: "NOOP" }),
    exportTrace: async () => ({ ok: true, skipped: true, reason: "OTEL_EXPORT_SKIPPED" }),
  });
  assert.strictEqual(exitIntegrityBlocked.status, "중단");
  assert.strictEqual(exitIntegrityBlocked.exit_integrity_cycle.summary.live_issue_count, 2);

  let capturedOutboxLineage = null;
  const outboxLineageWarn = await runSystemRuntimeGuardsJob({
    exchange: "BINANCEFUT",
    nowMs: Date.parse("2026-04-13T06:00:00.000Z"),
    remediateOnBlock: false,
    dryRun: true,
    artifactsDir,
    runExitIntegrityCycle: async () => ({
      ok: true,
      status: "OK",
      summary: { status: "OK", live_issue_count: 0 },
      output_json: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.json"),
      output_md: path.join(artifactsDir, "binance_exit_integrity_cycle_latest.md"),
    }),
    runTradeAlertOutboxLineageCheck: async (env) => {
      assert.strictEqual(env.TRADE_ALERT_OUTBOX_LINEAGE_SOFT, "1");
      assert.strictEqual(env.TRADE_ALERT_OUTBOX_LINEAGE_QUIET, "1");
      assert.strictEqual(env.TRADE_ALERT_OUTBOX_LINEAGE_OUTPUT_DIR, artifactsDir);
      return {
        ok: false,
        reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BLOCKED",
        checked_row_n: 3,
        issue_row_n: 1,
        output_json: path.join(artifactsDir, "trade_alert_outbox_lineage_evidence_latest.json"),
      };
    },
    loadOpsRuntime: async () => ({ status: "PASS", reason: "OPS_GUARD_OK", block_new_entries: false }),
    loadServingRuntime: async () => ({ status: "PASS", reason: "ML_SERVING_OK", block_new_entries: false }),
    loadExecutionQuality: async () => ({ generated_at: "2026-04-13T05:59:00.000Z", summary: { status: "EXECUTION_QUALITY_OK" } }),
    loadLineageHealth: async () => ({ generated_at: "2026-04-13T05:59:00.000Z", summary: { verdict: "PASS" } }),
    loadNativeTrailProtection: async () => ({ available: true, gap_count: 0, top_symbols: [] }),
    buildSlo: (payload) => {
      capturedOutboxLineage = payload.tradeAlertOutboxLineage;
      return { status: "WARN", reason: "TRADE_ALERT_OUTBOX_SCHEMA_WARN", block_new_entries: false };
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
  assert.strictEqual(capturedOutboxLineage.issue_row_n, 1);
  assert.strictEqual(outboxLineageWarn.trade_alert_outbox_lineage.issue_row_n, 1);
  assert.ok(String(outboxLineageWarn.artifacts.trade_alert_outbox_lineage_latest_json || "").startsWith(artifactsDir));
}

run()
  .then(() => {
    console.log("SYSTEM_RUNTIME_GUARDS_JOB_TEST_OK");
  })
  .catch((err) => {
    console.error("SYSTEM_RUNTIME_GUARDS_JOB_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
