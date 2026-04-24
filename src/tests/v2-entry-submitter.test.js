"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { runV2EntrySubmitter, normalizeEntryFillReceipt } = require("../v2/entrySubmitter");
const { buildPassSignalCriteriaSeed } = require("./helpers/passSignalCriteriaSeed");

function buildEntryIntent({ decisionMode = "CANARY" } = {}) {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: `LINEAGE__ETH__SUBMITTER__${decisionMode}`,
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.86,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode,
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "entry submitter approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.82,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.76,
      volatility_rank: 0.35,
    },
    proposalVerdict: "PASS",
    rankScore: 0.7,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: `feat_hash_entry_submitter_${decisionMode}`,
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "entry submitter canary long approved",
    marketDataQuality: {
      ok: true,
      reason: "ENTRY_SUBMITTER_TEST_MARKET_OK",
      blockers: [],
      metrics: {
        spread_bps: 3,
        mark_index_gap_bps: 2,
      },
    },
    signalCriteria: buildPassSignalCriteriaSeed("LONG"),
  });
  return resolveEntryIntentFromOpenClaw(bundle).entryIntent;
}

function buildProtectionTransports() {
  return {
    placeInitialSl: async () => ({ status: "PLACED", order_id: "STOP__UNUSED" }),
    placeInitialTp1: async () => ({ status: "PLACED", order_id: "TP1__UNUSED" }),
  };
}

function buildProtectionActivationFixture(executedEntry) {
  const positionCycleId = executedEntry.positionCycle.position_cycle_id;
  return Object.freeze({
    ok: true,
    reason: "ENTRY_PROTECTION_ACTIVE",
    activationCommit: Object.freeze({
      ok: true,
      position_cycle_id: positionCycleId,
      position_cycle_status: "ACTIVE_PROTECTED",
      protection_runtime_id: `PRTV2__${positionCycleId}`,
      chainAudit: Object.freeze({
        ok: true,
        fail_n: 0,
        failed_check_ids: [],
      }),
    }),
    protectionWriteResult: Object.freeze({
      writeDecision: Object.freeze({
        ok: true,
      }),
      runtimeDoc: Object.freeze({
        protection_runtime_id: `PRTV2__${positionCycleId}`,
        position_cycle_id: positionCycleId,
        health_status: "HEALTHY",
        sl_order_id: "STOP__SUBMITTER",
        tp1_order_id: "TP1__SUBMITTER",
      }),
    }),
  });
}

async function submitterRunsProtectionOnlyAfterFilledEntryReceipt() {
  const calls = [];
  const result = await runV2EntrySubmitter({
    entryIntent: buildEntryIntent(),
    entryTransport: {
      submitEntryOrder: async ({ entryIntent }) => {
        calls.push({ type: "entry-submit", entryIntent });
        return {
          status: "FILLED",
          symbol: "ETHUSDT",
          side: "LONG",
          entry_event_id: "ENTRY__ETH__SUBMITTER",
          entry_order_id: "ORDER__ETH__SUBMITTER",
          entry_fill_group_id: "FILL_GROUP__ETH__SUBMITTER",
          avg_price: 2500,
          executed_qty_abs: 0.8,
        };
      },
    },
    protectionTransports: buildProtectionTransports(),
    now: () => "2026-04-21T05:00:00.000Z",
    runProtectionActivation: async ({ executedEntry, transports }) => {
      calls.push({ type: "protection", executedEntry, transports });
      return buildProtectionActivationFixture(executedEntry);
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "ENTRY_SUBMITTED_AND_PROTECTED");
  assert.strictEqual(result.protectionEvidence.ok, true);
  assert.deepStrictEqual(calls.map((row) => row.type), ["entry-submit", "protection"]);
  assert.strictEqual(result.executedEntry.positionCycle.status, "PROTECTION_PENDING");
  assert.strictEqual(result.executedEntry.positionCycle.entry_event_id, "ENTRY__ETH__SUBMITTER");
  assert.strictEqual(result.executedEntry.protectionPlan.tp1_qty_abs, 0.4);
}

async function fakeProtectionOkWithoutEvidenceIsBlockedAfterEntrySubmit() {
  const calls = [];
  const result = await runV2EntrySubmitter({
    entryIntent: buildEntryIntent(),
    entryTransport: {
      submitEntryOrder: async () => {
        calls.push("entry-submit");
        return {
          status: "FILLED",
          symbol: "ETHUSDT",
          side: "LONG",
          entry_event_id: "ENTRY__ETH__FAKE_PROTECTION_OK",
          entry_order_id: "ORDER__ETH__FAKE_PROTECTION_OK",
          entry_fill_group_id: "FILL_GROUP__ETH__FAKE_PROTECTION_OK",
          avg_price: 2500,
          executed_qty_abs: 0.8,
        };
      },
    },
    protectionTransports: buildProtectionTransports(),
    runProtectionActivation: async () => {
      calls.push("protection");
      return { ok: true, reason: "ENTRY_PROTECTION_ACTIVE" };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "ENTRY_SUBMITTED_PROTECTION_BLOCKED");
  assert.strictEqual(result.protectionEvidence.reason, "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_INVALID");
  assert.ok(result.protectionEvidence.failed_check_ids.includes("ENTRY_PROTECTION_ACTIVATION_COMMIT_OK"));
  assert.ok(result.protectionEvidence.failed_check_ids.includes("ENTRY_PROTECTION_WRITE_DECISION_OK"));
  assert.strictEqual(result.recoveryResult.ok, false);
  assert.strictEqual(result.recoveryResult.reason, "ENTRY_PROTECTION_RECOVERY_BLOCKED");
  assert.deepStrictEqual(calls, ["entry-submit", "protection", "protection"]);
}

async function missingProtectionTransportBlocksBeforeEntrySubmit() {
  const calls = [];
  let err = null;
  try {
    await runV2EntrySubmitter({
      entryIntent: buildEntryIntent(),
      entryTransport: {
        submitEntryOrder: async () => {
          calls.push("entry-submit");
          return {};
        },
      },
      protectionTransports: {
        placeInitialSl: async () => ({ status: "PLACED", order_id: "STOP__1" }),
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "PLACE_INITIAL_TP1_TRANSPORT_REQUIRED");
  assert.deepStrictEqual(calls, []);
}

async function shadowIntentBlocksBeforeEntrySubmit() {
  const calls = [];
  let err = null;
  try {
    await runV2EntrySubmitter({
      entryIntent: {
        entry_intent_id: "EINTV2__shadow_submitter",
        signal_intent_id: "SIGINTV2__shadow_submitter",
        openclaw_decision_id: "OCDV2__shadow_submitter",
        signal_source_mode: "SERVER_NATIVE_ML_AI",
        decision_mode: "SHADOW",
        policy_scope: "ETH_15M",
        symbol: "ETHUSDT",
        side: "LONG",
      },
      entryTransport: {
        submitEntryOrder: async () => {
          calls.push("entry-submit");
          return {};
        },
      },
      protectionTransports: buildProtectionTransports(),
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_INTENT_DECISION_MODE_NOT_EXECUTABLE");
  assert.deepStrictEqual(calls, []);
}

async function missingFillLineageBlocksProtectionAfterEntrySubmit() {
  const calls = [];
  let err = null;
  try {
    await runV2EntrySubmitter({
      entryIntent: buildEntryIntent(),
      entryTransport: {
        submitEntryOrder: async () => {
          calls.push("entry-submit");
          return {
            status: "FILLED",
            symbol: "ETHUSDT",
            side: "LONG",
            entry_order_id: "ORDER__NO_EVENT",
            entry_fill_group_id: "FILL_GROUP__NO_EVENT",
            avg_price: 2500,
            executed_qty_abs: 0.8,
          };
        },
      },
      protectionTransports: buildProtectionTransports(),
      runProtectionActivation: async () => {
        calls.push("protection");
        return { ok: true };
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_EVENT_ID_REQUIRED");
  assert.deepStrictEqual(calls, ["entry-submit"]);
}

async function protectionActivationThrowReturnsStructuredPostFillFailure() {
  const calls = [];
  const result = await runV2EntrySubmitter({
    entryIntent: buildEntryIntent(),
    entryTransport: {
      submitEntryOrder: async () => {
        calls.push("entry-submit");
        return {
          status: "FILLED",
          symbol: "ETHUSDT",
          side: "LONG",
          entry_event_id: "ENTRY__ETH__PROTECTION_THROW",
          entry_order_id: "ORDER__ETH__PROTECTION_THROW",
          entry_fill_group_id: "FILL_GROUP__ETH__PROTECTION_THROW",
          avg_price: 2500,
          executed_qty_abs: 0.8,
        };
      },
    },
    protectionTransports: buildProtectionTransports(),
    runProtectionActivation: async () => {
      calls.push("protection");
      throw new Error("firestore unavailable after fill");
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "ENTRY_SUBMITTED_PROTECTION_BLOCKED");
  assert.strictEqual(result.fill.entry_event_id, "ENTRY__ETH__PROTECTION_THROW");
  assert.strictEqual(result.executedEntry.positionCycle.entry_event_id, "ENTRY__ETH__PROTECTION_THROW");
  assert.strictEqual(result.protectionResult.reason, "ENTRY_PROTECTION_ACTIVATION_THROWN");
  assert.strictEqual(result.protectionResult.error_code, "FIRESTORE_UNAVAILABLE_AFTER_FILL");
  assert.strictEqual(result.protectionEvidence.ok, false);
  assert.ok(result.protectionEvidence.failed_check_ids.includes("ENTRY_PROTECTION_RESULT_OK"));
  assert.strictEqual(result.recoveryResult.ok, false);
  assert.strictEqual(result.recoveryResult.reason, "ENTRY_PROTECTION_RECOVERY_THROWN");
  assert.deepStrictEqual(calls, ["entry-submit", "protection", "protection"]);
}

async function failedInitialProtectionRetriesBeforeReturningBlocked() {
  const calls = [];
  const result = await runV2EntrySubmitter({
    entryIntent: buildEntryIntent(),
    entryTransport: {
      submitEntryOrder: async () => {
        calls.push("entry-submit");
        return {
          status: "FILLED",
          symbol: "ETHUSDT",
          side: "LONG",
          entry_event_id: "ENTRY__ETH__PROTECTION_RECOVERY",
          entry_order_id: "ORDER__ETH__PROTECTION_RECOVERY",
          entry_fill_group_id: "FILL_GROUP__ETH__PROTECTION_RECOVERY",
          avg_price: 2500,
          executed_qty_abs: 0.8,
        };
      },
    },
    protectionTransports: buildProtectionTransports(),
    runProtectionActivation: async ({ executedEntry, placementRetryId }) => {
      calls.push(`protection:${placementRetryId}`);
      if (placementRetryId === "R0") {
        return { ok: false, reason: "ENTRY_PROTECTION_ACTIVATION_BLOCKED" };
      }
      return buildProtectionActivationFixture(executedEntry);
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "ENTRY_SUBMITTED_AND_PROTECTED");
  assert.strictEqual(result.recoveryResult.ok, true);
  assert.strictEqual(result.recoveryResult.reason, "ENTRY_PROTECTION_RECOVERY_ACTIVE");
  assert.strictEqual(result.protectionEvidence.ok, true);
  assert.deepStrictEqual(calls, ["entry-submit", "protection:R0", "protection:R0_RECOVERY"]);
}

async function partialProtectionAckDefersToRepairQueueWithoutBlindRetry() {
  const calls = [];
  const result = await runV2EntrySubmitter({
    entryIntent: buildEntryIntent(),
    entryTransport: {
      submitEntryOrder: async () => {
        calls.push("entry-submit");
        return {
          status: "FILLED",
          symbol: "ETHUSDT",
          side: "LONG",
          entry_event_id: "ENTRY__ETH__PARTIAL_PROTECTION",
          entry_order_id: "ORDER__ETH__PARTIAL_PROTECTION",
          entry_fill_group_id: "FILL_GROUP__ETH__PARTIAL_PROTECTION",
          avg_price: 2500,
          executed_qty_abs: 0.8,
        };
      },
    },
    protectionTransports: buildProtectionTransports(),
    runProtectionActivation: async ({ placementRetryId }) => {
      calls.push(`protection:${placementRetryId}`);
      return {
        ok: false,
        reason: "ENTRY_PROTECTION_ACTIVATION_BLOCKED",
        slAck: { status: "PLACED", order_id: "SL__PARTIAL" },
        tp1Ack: { status: "FAILED", error_code: "TP1_TRANSPORT_FAILED" },
        repairQueueCommit: { ok: true, repair_request_n: 1 },
      };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "ENTRY_SUBMITTED_PROTECTION_BLOCKED");
  assert.strictEqual(result.recoveryResult.attempted, false);
  assert.strictEqual(result.recoveryResult.reason, "ENTRY_PROTECTION_RECOVERY_DEFERRED_TO_REPAIR_QUEUE");
  assert.deepStrictEqual(result.recoveryResult.repairQueueCommit, { ok: true, repair_request_n: 1 });
  assert.deepStrictEqual(calls, ["entry-submit", "protection:R0"]);
}

(function normalizeEntryFillReceiptRejectsPartialFill() {
  let err = null;
  try {
    normalizeEntryFillReceipt({
      entryContract: {
        symbol: "ETHUSDT",
        side: "LONG",
      },
      receipt: {
        status: "PARTIALLY_FILLED",
        entry_event_id: "ENTRY__PARTIAL",
        entry_order_id: "ORDER__PARTIAL",
        entry_fill_group_id: "FILL__PARTIAL",
        avg_price: 2500,
        executed_qty_abs: 0.2,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_ORDER_FILLED_STATUS_REQUIRED");
})();

async function main() {
  await submitterRunsProtectionOnlyAfterFilledEntryReceipt();
  await fakeProtectionOkWithoutEvidenceIsBlockedAfterEntrySubmit();
  await missingProtectionTransportBlocksBeforeEntrySubmit();
  await shadowIntentBlocksBeforeEntrySubmit();
  await missingFillLineageBlocksProtectionAfterEntrySubmit();
  await protectionActivationThrowReturnsStructuredPostFillFailure();
  await failedInitialProtectionRetriesBeforeReturningBlocked();
  await partialProtectionAckDefersToRepairQueueWithoutBlindRetry();
}

main()
  .then(() => {
    console.log("V2_ENTRY_SUBMITTER_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
