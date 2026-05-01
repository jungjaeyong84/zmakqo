"use strict";

const assert = require("assert");
const {
  buildActiveProtectionReconciliationHistoryDoc,
  isActiveProtectionReconciliationFirestoreReadEnabled,
  isActiveProtectionReconciliationFirestoreWriteEnabled,
  __test,
} = require("../v2/activeProtectionReconciliationHistory");
const {
  evaluateActiveProtectionReconciliationStreak,
  __test: streakTest,
} = require("../../scripts/check-v2-active-protection-reconciliation-streak");

function historyDocNormalizesProtectionSummary() {
  const doc = buildActiveProtectionReconciliationHistoryDoc({
    recordedAt: "2026-05-01T00:00:01.000Z",
    artifact: {
      generated_at: "2026-05-01T00:00:00.000Z",
      ok: true,
      reason: "V2_ACTIVE_PROTECTION_RECONCILIATION_PASS",
      exchange: "BINANCEFUT",
      cadence: "HOURLY",
      scheduler_job_id: "v2-active-protection-reconciliation",
      producer_script: "check-v2-active-protection-reconciliation",
      active_position_n: 2,
      protected_position_n: 2,
      unprotected_position_n: 0,
      critical_issue_n: 0,
      active_symbols: ["ethusdt", "BTCUSDT"],
      unprotected_symbols: [],
      issues: [],
    },
  });
  assert.ok(doc.active_protection_reconciliation_id.startsWith("APRCV2__"));
  assert.strictEqual(doc.ok, true);
  assert.strictEqual(doc.generated_at_ms, Date.parse("2026-05-01T00:00:00.000Z"));
  assert.deepStrictEqual(doc.active_symbols, ["BTCUSDT", "ETHUSDT"]);
  assert.deepStrictEqual(doc.unprotected_symbols, []);
  assert.strictEqual(doc.artifact_snapshot.scheduler_job_id, "v2-active-protection-reconciliation");
}

function historyDocRejectsSecretLeak() {
  assert.throws(() => buildActiveProtectionReconciliationHistoryDoc({
    artifact: {
      generated_at: "2026-05-01T00:00:00.000Z",
      ok: true,
      apiSecret: "leak",
    },
  }), /ACTIVE_PROTECTION_RECONCILIATION_SECRET_LEAK_GUARD/);
}

function firestoreFlagsDefaultClosed() {
  assert.strictEqual(isActiveProtectionReconciliationFirestoreWriteEnabled({}), false);
  assert.strictEqual(isActiveProtectionReconciliationFirestoreReadEnabled({}), false);
  assert.strictEqual(isActiveProtectionReconciliationFirestoreWriteEnabled({
    DONBEOLJA_V2_ACTIVE_PROTECTION_RECONCILIATION_FIRESTORE_WRITE_ENABLED: "1",
  }), true);
  assert.strictEqual(isActiveProtectionReconciliationFirestoreReadEnabled({
    DONBEOLJA_V2_ACTIVE_PROTECTION_RECONCILIATION_FIRESTORE_READ_ENABLED: "1",
  }), true);
}

function firestoreRowsFeedStreakEvaluator() {
  const nowMs = Date.parse("2026-05-01T02:00:00.000Z");
  const result = evaluateActiveProtectionReconciliationStreak({
    nowMs,
    env: {
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_REQUIRED: "1",
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_MIN_RUN_N: "2",
      V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_MAX_GAP_MS: String(2 * 60 * 60 * 1000),
    },
    rows: [
      { generated_at: "2026-05-01T01:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
      { generated_at: "2026-05-01T02:00:00.000Z", ok: true, unprotected_position_n: 0, critical_issue_n: 0 },
    ],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.metrics.run_n, 2);
}

function sourceFlagResolvesFirestore() {
  assert.strictEqual(streakTest.resolveHistorySource({}), "JSONL");
  assert.strictEqual(streakTest.resolveHistorySource({
    DONBEOLJA_V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_SOURCE: "FIRESTORE",
  }), "FIRESTORE");
}

historyDocNormalizesProtectionSummary();
historyDocRejectsSecretLeak();
firestoreFlagsDefaultClosed();
firestoreRowsFeedStreakEvaluator();
sourceFlagResolvesFirestore();
assert.strictEqual(__test.COLLECTION_KEY, "ACTIVE_PROTECTION_RECONCILIATIONS");
console.log("V2_ACTIVE_PROTECTION_RECONCILIATION_HISTORY_TEST_OK");
