"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildPerformanceSummary,
  buildSafetySummary,
  buildSnapshot,
  computeActiveProtectionStreakDays,
  collect,
  collectAsync,
  writeSnapshot,
  __test,
} = require("../../scripts/collect-v2-evidence-snapshot-daily");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-evidence-snapshot-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function appendJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const row of rows) fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

function performanceSummaryTreatsSampleInsufficientAsAccumulating() {
  const summary = buildPerformanceSummary({
    performanceGate: {
      ok: false,
      reason: "V2_PERFORMANCE_GATE_BLOCKED",
      blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"],
      metrics: { sample_n: 0, net_pnl_usdt: 0, bootstrap_pf_lower_ci: 0.98 },
    },
    performanceReport: {
      summary: { outcome_n: 0, trade_n: 0 },
      tail_loss: { p95_loss_r: -0.7 },
      cohort_summary: { by_regime_cohort: [{ key: "TREND", outcome_n: 1 }] },
    },
  });
  assert.strictEqual(summary.sample_n_30d, 0);
  assert.strictEqual(summary.performance_gate_status, "ACCUMULATING");
  assert.strictEqual(summary.bootstrap_pf_lower_ci, 0.98);
  assert.strictEqual(summary.tail_loss_mae_report_present, true);
  assert.strictEqual(summary.regime_breakdown_present, true);
}

function activeProtectionStreakCountsConsecutivePassingDays() {
  const nowMs = Date.parse("2026-04-26T03:00:00.000Z");
  const rows = [
    { generated_at: "2026-04-24T03:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
    { generated_at: "2026-04-25T03:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
  ];
  const latest = { generated_at: "2026-04-26T03:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 };
  assert.strictEqual(computeActiveProtectionStreakDays(rows, latest, nowMs), 3);
}

function safetySummaryBlocksUnprotectedAndV1Writes() {
  const nowMs = Date.parse("2026-04-26T03:00:00.000Z");
  const safety = buildSafetySummary({
    activeProtectionLatest: { generated_at: "2026-04-26T03:00:00.000Z", ok: false, active_position_n: 1, protected_position_n: 0, unprotected_position_n: 1, critical_issue_n: 1 },
    activeProtectionHistoryRows: [
      { generated_at: "2026-04-26T02:00:00.000Z", ok: false, unprotected_position_n: 1, critical_issue_n: 1 },
    ],
    v1WriterLatest: { v1_place_futures_call_n_24h: 2 },
    v1WriterHistoryRows: [],
    algoEndpointLatest: { degraded_crit_n: 0, degraded_warn_n: 0 },
    alertEventConsistencyLatest: { issue_n: 1 },
    tradeExecutionAlertCrossAuditLatest: { missing_alert_fill_n: 2 },
    nowMs,
  });
  assert.strictEqual(safety.max_unprotected_position_30d, 1);
  assert.strictEqual(safety.post_fill_critical_30d, 2);
  assert.strictEqual(safety.v1_place_futures_call_n_30d, 2);
  assert.strictEqual(safety.contradictory_alert_fill_issue_n_30d, 3);
}

function snapshotBlocksSafetyButNotPerformanceAccumulation() {
  const nowMs = Date.parse("2026-04-26T03:00:00.000Z");
  const loaded = {
    performanceGate: { exists: true, required: true, file: "perf.json", data: { ok: false, reason: "V2_PERFORMANCE_GATE_BLOCKED", blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], metrics: { sample_n: 0 } } },
    performanceReport: { exists: true, required: true, file: "report.json", data: { summary: { outcome_n: 0, trade_n: 0 } } },
    activeProtectionLatest: { exists: true, required: true, file: "active.json", data: { generated_at: "2026-04-26T03:00:00.000Z", ok: false, active_position_n: 1, protected_position_n: 0, unprotected_position_n: 1, critical_issue_n: 1 } },
    activeProtectionHistory: { exists: true, required: false, file: "active.jsonl", rows: [] },
    v1WriterLatest: { exists: true, required: true, file: "v1.json", data: { v1_place_futures_call_n_24h: 0 } },
    v1WriterHistory: { exists: true, required: false, file: "v1.jsonl", rows: [] },
    algoEndpointLatest: { exists: true, required: true, file: "algo.json", data: { degraded_crit_n: 0, degraded_warn_n: 0 } },
    algoEndpointHistory: { exists: true, required: false, file: "algo.jsonl", rows: [] },
    repairQueueLatest: { exists: false, required: false, file: "repair.json", data: null },
    runtimeManifestLatest: { exists: false, required: false, file: "manifest.json", data: null },
    alertEventConsistencyLatest: { exists: true, required: false, file: "alert-event.json", data: { issue_n: 1 } },
    tradeExecutionAlertCrossAuditLatest: { exists: true, required: false, file: "alert-cross.json", data: { missing_alert_fill_n: 0 } },
  };
  const snapshot = buildSnapshot({ loaded, nowMs });
  assert.strictEqual(snapshot.performance_gate_status, "ACCUMULATING");
  assert.strictEqual(snapshot.ok, false);
  assert.ok(snapshot.blockers.includes("EVIDENCE_SNAPSHOT:UNPROTECTED_POSITION_30D"));
  assert.ok(snapshot.blockers.includes("EVIDENCE_SNAPSHOT:POST_FILL_CRITICAL_30D"));
  assert.ok(snapshot.blockers.includes("EVIDENCE_SNAPSHOT:ALERT_FILL_CONTRADICTION_30D"));
}

function collectAndWriteSnapshotFromFiles() {
  const tmp = mkTmp();
  const files = {
    performanceGate: path.join(tmp, "performance-gate.json"),
    performanceReport: path.join(tmp, "performance-report.json"),
    activeProtectionLatest: path.join(tmp, "active-latest.json"),
    activeProtectionDaily: path.join(tmp, "active-daily.json"),
    activeProtectionHistory: path.join(tmp, "active-history.jsonl"),
    v1WriterLatest: path.join(tmp, "v1-writer.json"),
    v1WriterHistory: path.join(tmp, "v1-writer.jsonl"),
    algoEndpointLatest: path.join(tmp, "algo.json"),
    algoEndpointHistory: path.join(tmp, "algo.jsonl"),
    alertEventConsistency: path.join(tmp, "alert-event.json"),
    tradeExecutionAlertCrossAudit: path.join(tmp, "alert-cross.json"),
    output: path.join(tmp, "snapshot.json"),
    history: path.join(tmp, "snapshot.jsonl"),
  };
  writeJson(files.performanceGate, { ok: false, reason: "V2_PERFORMANCE_GATE_BLOCKED", blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], metrics: { sample_n: 0, net_pnl_usdt: 0, profit_factor_bootstrap_lower_ci: 0.91 } });
  writeJson(files.performanceReport, { summary: { outcome_n: 0, trade_n: 0, net_pnl_usdt: 0, by_symbol: { BTCUSDT: { outcome_n: 0 } } }, mae: { p95_mae_r: -0.3 } });
  writeJson(files.activeProtectionLatest, { generated_at: "2026-04-26T03:00:00.000Z", ok: true, active_position_n: 2, protected_position_n: 2, unprotected_position_n: 0, critical_issue_n: 0 });
  writeJson(files.activeProtectionDaily, { generated_at: "2026-04-26T03:00:00.000Z", ok: true, active_position_n: 2, protected_position_n: 2, unprotected_position_n: 0, critical_issue_n: 0 });
  appendJsonl(files.activeProtectionHistory, [
    { generated_at: "2026-04-25T03:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
  ]);
  writeJson(files.v1WriterLatest, { v1_place_futures_call_n_24h: 0 });
  appendJsonl(files.v1WriterHistory, [{ generated_at: "2026-04-26T03:00:00.000Z", v1_place_futures_call_n_24h: 0, v1_direct_exchange_write_call_n_24h: 0 }]);
  writeJson(files.algoEndpointLatest, { degraded_crit_n: 0, degraded_warn_n: 0 });
  appendJsonl(files.algoEndpointHistory, [{ generated_at: "2026-04-26T03:00:00.000Z", degraded_crit_n: 0, degraded_warn_n: 0 }]);
  writeJson(files.alertEventConsistency, { issue_n: 0, issue_fill_n: 0 });
  writeJson(files.tradeExecutionAlertCrossAudit, { missing_alert_fill_n: 0, unmatched_alert_n: 0 });

  const env = {
    V2_EVIDENCE_SNAPSHOT_PERFORMANCE_GATE_FILE: files.performanceGate,
    V2_EVIDENCE_SNAPSHOT_PERFORMANCE_REPORT_FILE: files.performanceReport,
    V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_LATEST_FILE: files.activeProtectionLatest,
    V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_DAILY_FILE: files.activeProtectionDaily,
    V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_HISTORY_FILE: files.activeProtectionHistory,
    V2_EVIDENCE_SNAPSHOT_V1_WRITER_FILE: files.v1WriterLatest,
    V2_EVIDENCE_SNAPSHOT_V1_WRITER_HISTORY_FILE: files.v1WriterHistory,
    V2_EVIDENCE_SNAPSHOT_ALGO_ENDPOINT_FILE: files.algoEndpointLatest,
    V2_EVIDENCE_SNAPSHOT_ALGO_ENDPOINT_HISTORY_FILE: files.algoEndpointHistory,
    V2_EVIDENCE_SNAPSHOT_ALERT_EVENT_CONSISTENCY_FILE: files.alertEventConsistency,
    V2_EVIDENCE_SNAPSHOT_TRADE_EXECUTION_ALERT_CROSS_AUDIT_FILE: files.tradeExecutionAlertCrossAudit,
    V2_EVIDENCE_SNAPSHOT_OUTPUT_FILE: files.output,
    V2_EVIDENCE_SNAPSHOT_HISTORY_FILE: files.history,
  };
  const snapshot = collect({ env, nowMs: Date.parse("2026-04-26T03:00:00.000Z") });
  assert.strictEqual(snapshot.ok, true);
  assert.strictEqual(snapshot.sample_n_30d, 0);
  assert.strictEqual(snapshot.active_protection_streak_days, 2);
  assert.strictEqual(snapshot.bootstrap_pf_lower_ci, 0.91);
  assert.strictEqual(snapshot.symbol_breakdown_present, true);
  assert.strictEqual(snapshot.tail_loss_mae_report_present, true);
  assert.strictEqual(snapshot.contradictory_alert_fill_issue_n_30d, 0);
  const written = writeSnapshot({ snapshot, env });
  assert.strictEqual(written.outputFile, files.output);
  assert.ok(fs.existsSync(files.output));
  assert.ok(fs.readFileSync(files.history, "utf8").includes("V2_EVIDENCE_SNAPSHOT_COLLECTED"));
}

async function collectAsyncUsesFirestoreActiveProtectionEvidence() {
  const tmp = mkTmp();
  const files = {
    performanceGate: path.join(tmp, "performance-gate.json"),
    performanceReport: path.join(tmp, "performance-report.json"),
    v1WriterLatest: path.join(tmp, "v1-writer.json"),
    v1WriterHistory: path.join(tmp, "v1-writer.jsonl"),
    algoEndpointLatest: path.join(tmp, "algo.json"),
    algoEndpointHistory: path.join(tmp, "algo.jsonl"),
    alertEventConsistency: path.join(tmp, "alert-event.json"),
    tradeExecutionAlertCrossAudit: path.join(tmp, "alert-cross.json"),
  };
  writeJson(files.performanceGate, { ok: false, reason: "V2_PERFORMANCE_GATE_BLOCKED", blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], metrics: { sample_n: 0 } });
  writeJson(files.performanceReport, { summary: { outcome_n: 0, trade_n: 0 } });
  writeJson(files.v1WriterLatest, { v1_place_futures_call_n_24h: 0 });
  appendJsonl(files.v1WriterHistory, []);
  writeJson(files.algoEndpointLatest, { degraded_crit_n: 0, degraded_warn_n: 0 });
  appendJsonl(files.algoEndpointHistory, []);
  writeJson(files.alertEventConsistency, { issue_n: 0, issue_fill_n: 0 });
  writeJson(files.tradeExecutionAlertCrossAudit, { missing_alert_fill_n: 0, missing_verified_exit_alert_fill_n: 0, unmatched_alert_n: 0 });
  const nowMs = Date.parse("2026-05-01T03:00:00.000Z");
  const env = {
    V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_SOURCE: "FIRESTORE",
    DONBEOLJA_V2_ACTIVE_PROTECTION_RECONCILIATION_FIRESTORE_READ_ENABLED: "1",
    V2_EVIDENCE_SNAPSHOT_PERFORMANCE_GATE_FILE: files.performanceGate,
    V2_EVIDENCE_SNAPSHOT_PERFORMANCE_REPORT_FILE: files.performanceReport,
    V2_EVIDENCE_SNAPSHOT_V1_WRITER_FILE: files.v1WriterLatest,
    V2_EVIDENCE_SNAPSHOT_V1_WRITER_HISTORY_FILE: files.v1WriterHistory,
    V2_EVIDENCE_SNAPSHOT_ALGO_ENDPOINT_FILE: files.algoEndpointLatest,
    V2_EVIDENCE_SNAPSHOT_ALGO_ENDPOINT_HISTORY_FILE: files.algoEndpointHistory,
    V2_EVIDENCE_SNAPSHOT_ALERT_EVENT_CONSISTENCY_FILE: files.alertEventConsistency,
    V2_EVIDENCE_SNAPSHOT_TRADE_EXECUTION_ALERT_CROSS_AUDIT_FILE: files.tradeExecutionAlertCrossAudit,
  };
  const snapshot = await collectAsync({
    env,
    nowMs,
    activeProtectionLoader: async () => ({
      collectionName: "v2__active_protection_reconciliations_v2",
      rows: [
        { payload: { generated_at: "2026-04-30T03:00:00.000Z", ok: true, active_position_n: 2, protected_position_n: 2, unprotected_position_n: 0, critical_issue_n: 0 } },
        { payload: { generated_at: "2026-05-01T03:00:00.000Z", ok: true, active_position_n: 3, protected_position_n: 3, unprotected_position_n: 0, critical_issue_n: 0 } },
      ],
    }),
  });
  assert.strictEqual(snapshot.ok, true);
  assert.strictEqual(snapshot.active_protection_streak_days, 2);
  assert.strictEqual(snapshot.active_position_n, 3);
  assert.strictEqual(snapshot.protected_position_n, 3);
  assert.strictEqual(snapshot.unprotected_position_n, 0);
  assert.strictEqual(snapshot.source_files.activeProtectionHistory, "v2__active_protection_reconciliations_v2");
}

async function collectAsyncBlocksWhenFirestoreActiveProtectionReadDisabled() {
  const tmp = mkTmp();
  const files = {
    performanceGate: path.join(tmp, "performance-gate.json"),
    performanceReport: path.join(tmp, "performance-report.json"),
    v1WriterLatest: path.join(tmp, "v1-writer.json"),
    algoEndpointLatest: path.join(tmp, "algo.json"),
    alertEventConsistency: path.join(tmp, "alert-event.json"),
    tradeExecutionAlertCrossAudit: path.join(tmp, "alert-cross.json"),
  };
  writeJson(files.performanceGate, { ok: false, reason: "V2_PERFORMANCE_GATE_BLOCKED", blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], metrics: { sample_n: 0 } });
  writeJson(files.performanceReport, { summary: { outcome_n: 0, trade_n: 0 } });
  writeJson(files.v1WriterLatest, { v1_place_futures_call_n_24h: 0 });
  writeJson(files.algoEndpointLatest, { degraded_crit_n: 0, degraded_warn_n: 0 });
  writeJson(files.alertEventConsistency, { issue_n: 0, issue_fill_n: 0 });
  writeJson(files.tradeExecutionAlertCrossAudit, { missing_alert_fill_n: 0, missing_verified_exit_alert_fill_n: 0, unmatched_alert_n: 0 });
  const snapshot = await collectAsync({
    env: {
      V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_SOURCE: "FIRESTORE",
      V2_EVIDENCE_SNAPSHOT_PERFORMANCE_GATE_FILE: files.performanceGate,
      V2_EVIDENCE_SNAPSHOT_PERFORMANCE_REPORT_FILE: files.performanceReport,
      V2_EVIDENCE_SNAPSHOT_V1_WRITER_FILE: files.v1WriterLatest,
      V2_EVIDENCE_SNAPSHOT_ALGO_ENDPOINT_FILE: files.algoEndpointLatest,
      V2_EVIDENCE_SNAPSHOT_ALERT_EVENT_CONSISTENCY_FILE: files.alertEventConsistency,
      V2_EVIDENCE_SNAPSHOT_TRADE_EXECUTION_ALERT_CROSS_AUDIT_FILE: files.tradeExecutionAlertCrossAudit,
    },
    nowMs: Date.parse("2026-05-01T03:00:00.000Z"),
  });
  assert.strictEqual(snapshot.ok, false);
  assert.ok(snapshot.blockers.includes("EVIDENCE_SNAPSHOT:REQUIRED_EVIDENCE_MISSING"));
  assert.strictEqual(snapshot.missing_required_evidence.includes("activeProtectionLatest"), true);
}

performanceSummaryTreatsSampleInsufficientAsAccumulating();
activeProtectionStreakCountsConsecutivePassingDays();
safetySummaryBlocksUnprotectedAndV1Writes();
snapshotBlocksSafetyButNotPerformanceAccumulation();
collectAndWriteSnapshotFromFiles();
(async function runAsyncCases() {
  assert.strictEqual(__test.resolveActiveProtectionSource({}), "JSONL");
  assert.strictEqual(__test.resolveActiveProtectionSource({ V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_SOURCE: "FIRESTORE" }), "FIRESTORE");
  await collectAsyncUsesFirestoreActiveProtectionEvidence();
  await collectAsyncBlocksWhenFirestoreActiveProtectionReadDisabled();
  console.log("COLLECT_V2_EVIDENCE_SNAPSHOT_DAILY_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
