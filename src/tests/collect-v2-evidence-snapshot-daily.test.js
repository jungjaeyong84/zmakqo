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
  writeSnapshot,
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
      metrics: { sample_n: 0, net_pnl_usdt: 0 },
    },
    performanceReport: { summary: { outcome_n: 0, trade_n: 0 } },
  });
  assert.strictEqual(summary.sample_n_30d, 0);
  assert.strictEqual(summary.performance_gate_status, "ACCUMULATING");
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
    nowMs,
  });
  assert.strictEqual(safety.max_unprotected_position_30d, 1);
  assert.strictEqual(safety.post_fill_critical_30d, 2);
  assert.strictEqual(safety.v1_place_futures_call_n_30d, 2);
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
  };
  const snapshot = buildSnapshot({ loaded, nowMs });
  assert.strictEqual(snapshot.performance_gate_status, "ACCUMULATING");
  assert.strictEqual(snapshot.ok, false);
  assert.ok(snapshot.blockers.includes("EVIDENCE_SNAPSHOT:UNPROTECTED_POSITION_30D"));
  assert.ok(snapshot.blockers.includes("EVIDENCE_SNAPSHOT:POST_FILL_CRITICAL_30D"));
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
    output: path.join(tmp, "snapshot.json"),
    history: path.join(tmp, "snapshot.jsonl"),
  };
  writeJson(files.performanceGate, { ok: false, reason: "V2_PERFORMANCE_GATE_BLOCKED", blockers: ["PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"], metrics: { sample_n: 0, net_pnl_usdt: 0 } });
  writeJson(files.performanceReport, { summary: { outcome_n: 0, trade_n: 0, net_pnl_usdt: 0 } });
  writeJson(files.activeProtectionLatest, { generated_at: "2026-04-26T03:00:00.000Z", ok: true, active_position_n: 2, protected_position_n: 2, unprotected_position_n: 0, critical_issue_n: 0 });
  writeJson(files.activeProtectionDaily, { generated_at: "2026-04-26T03:00:00.000Z", ok: true, active_position_n: 2, protected_position_n: 2, unprotected_position_n: 0, critical_issue_n: 0 });
  appendJsonl(files.activeProtectionHistory, [
    { generated_at: "2026-04-25T03:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
  ]);
  writeJson(files.v1WriterLatest, { v1_place_futures_call_n_24h: 0 });
  appendJsonl(files.v1WriterHistory, [{ generated_at: "2026-04-26T03:00:00.000Z", v1_place_futures_call_n_24h: 0, v1_direct_exchange_write_call_n_24h: 0 }]);
  writeJson(files.algoEndpointLatest, { degraded_crit_n: 0, degraded_warn_n: 0 });
  appendJsonl(files.algoEndpointHistory, [{ generated_at: "2026-04-26T03:00:00.000Z", degraded_crit_n: 0, degraded_warn_n: 0 }]);

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
    V2_EVIDENCE_SNAPSHOT_OUTPUT_FILE: files.output,
    V2_EVIDENCE_SNAPSHOT_HISTORY_FILE: files.history,
  };
  const snapshot = collect({ env, nowMs: Date.parse("2026-04-26T03:00:00.000Z") });
  assert.strictEqual(snapshot.ok, true);
  assert.strictEqual(snapshot.sample_n_30d, 0);
  assert.strictEqual(snapshot.active_protection_streak_days, 2);
  const written = writeSnapshot({ snapshot, env });
  assert.strictEqual(written.outputFile, files.output);
  assert.ok(fs.existsSync(files.output));
  assert.ok(fs.readFileSync(files.history, "utf8").includes("V2_EVIDENCE_SNAPSHOT_COLLECTED"));
}

performanceSummaryTreatsSampleInsufficientAsAccumulating();
activeProtectionStreakCountsConsecutivePassingDays();
safetySummaryBlocksUnprotectedAndV1Writes();
snapshotBlocksSafetyButNotPerformanceAccumulation();
collectAndWriteSnapshotFromFiles();
console.log("COLLECT_V2_EVIDENCE_SNAPSHOT_DAILY_TEST_OK");
