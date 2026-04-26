"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { runV2EntryProtectionActivation } = require("../v2/entryProtectionRunner");
const {
  reconcileInitialProtectionLatePlaced,
  isInitialProtectionDeadlineErrorCode,
} = require("../v2/initialProtectionLatePlacedReconciler");
const { buildPassSignalCriteriaSeed } = require("./helpers/passSignalCriteriaSeed");

function buildFakeDb(calls) {
  return {
    collection(name) {
      calls.push({ type: "collection", name });
      return {
        doc(id) {
          calls.push({ type: "doc", id });
          return { path: `${name}/${id}` };
        },
      };
    },
    batch() {
      calls.push({ type: "batch" });
      const writes = [];
      return {
        set(ref, payload, options) {
          writes.push({ ref, payload, options });
          calls.push({ type: "batch-set", ref, payload, options });
        },
        async commit() {
          calls.push({ type: "batch-commit", write_n: writes.length });
        },
      };
    },
  };
}

function buildExecutedEntry() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__LINK__INITIAL_DEADLINE",
    symbol: "LINKUSDT",
    side: "LONG",
    qualityScore: 0.88,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "initial protection deadline test",
    policyScope: "LINK_15M",
    htfDirection: "LONG",
    htfConfidence: 0.82,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: { trend_bias: 0.8, volatility_rank: 0.42 },
    proposalVerdict: "PASS",
    rankScore: 0.72,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_initial_deadline",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "initial protection deadline approved",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "LINKUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: buildPassSignalCriteriaSeed("LONG"),
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  return buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__LINK__INITIAL_DEADLINE",
    entryOrderId: "ORDER__LINK__INITIAL_DEADLINE",
    entryFillGroupId: "FILL_GROUP__LINK__INITIAL_DEADLINE",
    entryPrice: 15,
    entryQtyAbs: 2,
  });
}

function buildClock() {
  const values = [
    "2026-04-26T00:00:00.000Z",
    "2026-04-26T00:00:06.000Z",
    "2026-04-26T00:00:07.000Z",
  ];
  return () => values.shift() || "2026-04-26T00:00:07.000Z";
}

async function latePlacedReconcilerPromotesDeadlineFailedAck() {
  assert.strictEqual(isInitialProtectionDeadlineErrorCode("BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED"), true);
  const result = await reconcileInitialProtectionLatePlaced({
    env: {
      DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_MAX_POLL_MS: "0",
      DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_POLL_DELAY_MS: "0",
    },
    now: () => "2026-04-26T00:00:05.000Z",
    commands: {
      tp1: {
        client_order_key: "TP1__PRATT__1",
        symbol: "LINKUSDT",
        close_side: "SELL",
        trigger_price: 15.5,
        quantity_abs: 1,
      },
    },
    slAck: {
      status: "PLACED",
      order_id: "SL__OK",
      trigger_price: 14.5,
      ack_at: "2026-04-26T00:00:01.000Z",
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED",
      trigger_price: 15.5,
    },
    fetchOrderByClientOrderId: async () => ({
      orderId: "TP1__LATE",
      clientOrderId: "TP1__PRATT__1",
      symbol: "LINKUSDT",
      side: "SELL",
      status: "NEW",
      type: "TAKE_PROFIT_MARKET",
      reduceOnly: "true",
      closePosition: "false",
      origQty: "1",
      stopPrice: "15.5",
    }),
  });
  assert.strictEqual(result.late_placed_after_abort, true);
  assert.deepStrictEqual(result.late_placed_legs, ["TP1"]);
  assert.strictEqual(result.tp1Ack.status, "PLACED");
  assert.strictEqual(result.tp1Ack.order_id, "TP1__LATE");
  assert.strictEqual(result.tp1Ack.late_placed_after_abort, true);
  assert.strictEqual(result.tp1Ack.original_error_code, "BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED");
}

async function runnerDoesNotQueueRepairForLatePlacedTp1() {
  const calls = [];
  const executed = buildExecutedEntry();
  const result = await runV2EntryProtectionActivation({
    db: buildFakeDb(calls),
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_MAX_POLL_MS: "0",
      DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_POLL_DELAY_MS: "0",
    },
    executedEntry: executed,
    now: buildClock(),
    transports: {
      placeInitialSl: async ({ command }) => ({
        status: "PLACED",
        order_id: "SL__LINK__INITIAL_DEADLINE",
        trigger_price: command.trigger_price,
        ack_at: "2026-04-26T00:00:01.000Z",
      }),
      placeInitialTp1: async ({ command }) => ({
        status: "FAILED",
        error_code: "BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED",
        trigger_price: command.trigger_price,
      }),
      fetchOrderByClientOrderId: async ({ command }) => ({
        orderId: "TP1__LINK__LATE",
        clientOrderId: command.client_order_key,
        symbol: command.symbol,
        side: command.close_side,
        status: "NEW",
        type: "TAKE_PROFIT_MARKET",
        reduceOnly: true,
        closePosition: false,
        origQty: String(command.quantity_abs),
        stopPrice: String(command.trigger_price),
      }),
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_ACTIVE");
  assert.strictEqual(result.repairQueueCommit, null);
  assert.strictEqual(result.tp1Ack.status, "PLACED");
  assert.strictEqual(result.tp1Ack.late_placed_after_abort, true);
  assert.strictEqual(result.protectionWriteResult.runtimeDoc.tp1_order_id, "TP1__LINK__LATE");
  assert.strictEqual(
    result.protectionWriteResult.runtimeDoc.last_exchange_evidence.initial_protection.late_placed_after_abort,
    true
  );
  assert.deepStrictEqual(
    result.protectionWriteResult.runtimeDoc.last_exchange_evidence.initial_protection.late_placed_legs,
    ["TP1"]
  );
  assert.strictEqual(calls.some((row) => row.type === "batch-set" && row.payload.issue_code === "TP1_ORDER_MISSING"), false);
}

async function runnerQueuesRepairWhenLatePlacedOrderNotFound() {
  const calls = [];
  const executed = buildExecutedEntry();
  const result = await runV2EntryProtectionActivation({
    db: buildFakeDb(calls),
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_MAX_POLL_MS: "0",
      DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_POLL_DELAY_MS: "0",
    },
    executedEntry: executed,
    now: buildClock(),
    transports: {
      placeInitialSl: async ({ command }) => ({
        status: "PLACED",
        order_id: "SL__LINK__INITIAL_DEADLINE",
        trigger_price: command.trigger_price,
        ack_at: "2026-04-26T00:00:01.000Z",
      }),
      placeInitialTp1: async ({ command }) => ({
        status: "FAILED",
        error_code: "BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED",
        trigger_price: command.trigger_price,
      }),
      fetchOrderByClientOrderId: async () => null,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.tp1Ack.status, "FAILED");
  assert.strictEqual(result.tp1Ack.late_placed_after_abort, false);
  assert.strictEqual(result.tp1Ack.late_placed_reconcile_status, "TP1_LATE_PLACED_NOT_FOUND");
  assert.strictEqual(result.repairQueueCommit.ok, true);
  assert.strictEqual(result.repairQueueCommit.repair_request_n, 1);
  assert.strictEqual(result.repairQueueCommit.repair_requests[0].issue_code, "TP1_ORDER_MISSING");
}

async function main() {
  await latePlacedReconcilerPromotesDeadlineFailedAck();
  await runnerDoesNotQueueRepairForLatePlacedTp1();
  await runnerQueuesRepairWhenLatePlacedOrderNotFound();
}

main()
  .then(() => {
    console.log("V2_INITIAL_PROTECTION_DEADLINE_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
