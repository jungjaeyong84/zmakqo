"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { evaluateRepairLeaseFirestoreTx } = require("../../scripts/check-v2-repair-lease-firestore-tx");
const { evaluateAlgoEndpointEscalation } = require("../../scripts/check-v2-algo-endpoint-escalation");
const {
  evaluateV1WriterDenyStreak,
  runCheck: runV1WriterDenyStreakCheck,
} = require("../../scripts/check-v2-v1-writer-deny-streak");
const {
  evaluateActiveProtectionReconciliationStreak,
  runCheck: runActiveProtectionReconciliationStreakCheck,
} = require("../../scripts/check-v2-active-protection-reconciliation-streak");

async function repairLeaseGatePasses() {
  const result = await evaluateRepairLeaseFirestoreTx({});
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_REPAIR_LEASE_FIRESTORE_TX_PASS");
  assert.deepStrictEqual(result.blockers, []);
  assert.ok(result.checks.every((row) => row.ok === true));
}

async function algoEndpointEscalationGatePasses() {
  const result = await evaluateAlgoEndpointEscalation({});
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_ALGO_ENDPOINT_ESCALATION_PASS");
  assert.deepStrictEqual(result.blockers, []);
  assert.strictEqual(result.final_status, "RECOVERED");
}

function v1WriterDenyStreakBlocksWhenRequiredArtifactMissing() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-writer-streak-missing-"));
  const result = runV1WriterDenyStreakCheck({
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_FILE: path.join(tmpDir, "missing.json"),
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_REQUIRE_ARTIFACT: "1",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("V1_WRITER_DENY_STREAK:ARTIFACT_MISSING"));
}

function v1WriterDenyStreakPassesWithZeroWriteArtifact() {
  const result = evaluateV1WriterDenyStreak({
    artifact: {
      window_hours: 24,
      v1_place_futures_call_n_24h: 0,
      v1_writer_denied_call_n_24h: 3,
    },
    artifactMissing: false,
    artifactFile: "/tmp/artifact.json",
    env: { DONBEOLJA_V2_V1_WRITER_DENY_STREAK_REQUIRE_ARTIFACT: "1" },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.metrics.v1_place_futures_call_n, 0);
  assert.strictEqual(result.metrics.v1_writer_denied_call_n, 3);
}

function v1WriterDenyStreakBlocksNonZeroWriteArtifact() {
  const result = evaluateV1WriterDenyStreak({
    artifact: {
      window_hours: 24,
      v1_place_futures_call_n_24h: 1,
    },
    artifactMissing: false,
    artifactFile: "/tmp/artifact.json",
    env: { DONBEOLJA_V2_V1_WRITER_DENY_STREAK_REQUIRE_ARTIFACT: "1" },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("V1_WRITER_DENY_STREAK:V1_EXCHANGE_WRITE_CALLS_PRESENT"));
}

function activeProtectionStreakBlocksWhenRequiredHistoryMissing() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "active-protection-streak-missing-"));
  const result = runActiveProtectionReconciliationStreakCheck({
    V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_FILE: path.join(tmpDir, "missing.jsonl"),
    V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_REQUIRED: "1",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("ACTIVE_PROTECTION_RECONCILIATION_STREAK:HISTORY_MISSING"));
}

function activeProtectionStreakPassesCleanWindow() {
  const nowMs = Date.parse("2026-04-26T03:00:00.000Z");
  const result = evaluateActiveProtectionReconciliationStreak({
    nowMs,
    env: {
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_REQUIRED: "1",
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_MIN_RUN_N: "3",
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_MAX_GAP_MS: String(2 * 60 * 60 * 1000),
    },
    rows: [
      { generated_at: "2026-04-26T01:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
      { generated_at: "2026-04-26T02:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
      { generated_at: "2026-04-26T03:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
    ],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.metrics.run_n, 3);
}

function activeProtectionStreakBlocksUnprotectedWindow() {
  const nowMs = Date.parse("2026-04-26T03:00:00.000Z");
  const result = evaluateActiveProtectionReconciliationStreak({
    nowMs,
    env: {
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_REQUIRED: "1",
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_MIN_RUN_N: "2",
    },
    rows: [
      { generated_at: "2026-04-26T02:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
      { generated_at: "2026-04-26T03:00:00.000Z", ok: false, unprotected_position_n: 1, critical_issue_n: 1, unprotected_symbols: ["XRPUSDT"] },
    ],
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("ACTIVE_PROTECTION_RECONCILIATION_STREAK:BLOCKED_ROW_IN_WINDOW"));
  assert.ok(result.blockers.includes("ACTIVE_PROTECTION_RECONCILIATION_STREAK:UNPROTECTED_POSITION_IN_WINDOW"));
  assert.ok(result.blockers.includes("ACTIVE_PROTECTION_RECONCILIATION_STREAK:CRITICAL_ISSUE_IN_WINDOW"));
  assert.deepStrictEqual(result.metrics.unprotected_symbols, ["XRPUSDT"]);
}

(async function run() {
  await repairLeaseGatePasses();
  await algoEndpointEscalationGatePasses();
  v1WriterDenyStreakBlocksWhenRequiredArtifactMissing();
  v1WriterDenyStreakPassesWithZeroWriteArtifact();
  v1WriterDenyStreakBlocksNonZeroWriteArtifact();
  activeProtectionStreakBlocksWhenRequiredHistoryMissing();
  activeProtectionStreakPassesCleanWindow();
  activeProtectionStreakBlocksUnprotectedWindow();
  console.log("CHECK_V2_P1_PHASE_GATES_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
