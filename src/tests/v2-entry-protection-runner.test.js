"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { runV2EntryProtectionActivation } = require("../v2/entryProtectionRunner");
const { buildBinanceInitialProtectionTransports } = require("../v2/binanceInitialProtectionTransport");
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
    signalLineageId: "LINEAGE__ETH__ENTRY_RUNNER",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.84,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "entry runner approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.81,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.74,
      volatility_rank: 0.37,
    },
    proposalVerdict: "PASS",
    rankScore: 0.69,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_entry_runner",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "entry runner canary long approved",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "ETHUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: buildPassSignalCriteriaSeed("LONG"),
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  return buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__ENTRY_RUNNER",
    entryOrderId: "ORDER__ETH__ENTRY_RUNNER",
    entryFillGroupId: "FILL_GROUP__ETH__ENTRY_RUNNER",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
}

function buildClock() {
  const values = [
    "2026-04-21T04:00:00.000Z",
    "2026-04-21T04:00:01.500Z",
  ];
  return () => values.shift() || "2026-04-21T04:00:01.500Z";
}

async function happyPathCommitsPendingThenProtectedActivation() {
  const calls = [];
  const transportCalls = [];
  const executed = buildExecutedEntry();
  const result = await runV2EntryProtectionActivation({
    db: buildFakeDb(calls),
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    executedEntry: executed,
    now: buildClock(),
    transports: {
      placeInitialSl: async ({ command }) => {
        transportCalls.push(command.command_type);
        return {
          status: "PLACED",
          order_id: "STOP__ETH__ENTRY_RUNNER",
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T04:00:00.700Z",
        };
      },
      placeInitialTp1: async ({ command }) => {
        transportCalls.push(command.command_type);
        return {
          status: "PLACED",
          order_id: "TP1__ETH__ENTRY_RUNNER",
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T04:00:01.000Z",
        };
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "ENTRY_PROTECTION_ACTIVE");
  assert.deepStrictEqual(transportCalls, ["PLACE_INITIAL_SL", "PLACE_INITIAL_TP1"]);
  assert.strictEqual(result.pendingCommit.position_cycle_status, "PROTECTION_PENDING");
  assert.strictEqual(result.activationCommit.position_cycle_status, "ACTIVE_PROTECTED");
  assert.strictEqual(result.protectionWriteResult.writeDecision.ok, true);
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 2);
  const activeWrite = calls.find((row) => row.type === "batch-set" && row.payload.status === "ACTIVE_PROTECTED");
  assert.ok(activeWrite);
}

async function tp1FailureKeepsCyclePendingAndDoesNotCommitActivation() {
  const calls = [];
  const transportCalls = [];
  const executed = buildExecutedEntry();
  const result = await runV2EntryProtectionActivation({
    db: buildFakeDb(calls),
    executedEntry: executed,
    now: buildClock(),
    transports: {
      placeInitialSl: async ({ command }) => {
        transportCalls.push(command.command_type);
        return {
          status: "PLACED",
          order_id: "STOP__ETH__ENTRY_RUNNER_FAIL",
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T04:00:00.700Z",
        };
      },
      placeInitialTp1: async ({ command }) => {
        transportCalls.push(command.command_type);
        return {
          status: "FAILED",
          error_code: "MIN_NOTIONAL",
          trigger_price: command.trigger_price,
        };
      },
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "RUNTIME_CHAIN_PROTECTION_NOT_READY");
  assert.deepStrictEqual(transportCalls, ["PLACE_INITIAL_SL", "PLACE_INITIAL_TP1"]);
  assert.strictEqual(result.pendingCommit.position_cycle_status, "PROTECTION_PENDING");
  assert.strictEqual(result.activationCommit, null);
  assert.strictEqual(result.repairQueueCommit.ok, true);
  assert.strictEqual(result.repairQueueCommit.write_mode, "BATCH");
  assert.strictEqual(result.repairQueueCommit.repair_request_n, 1);
  assert.strictEqual(result.repairQueueCommit.repair_requests[0].issue_code, "TP1_ORDER_MISSING");
  assert.strictEqual(result.repairQueueCommit.repair_requests[0].requested_action, "ENSURE_TP1_ORDER");
  assert.strictEqual(result.protectionWriteResult.writeDecision.requires_repair, true);
  assert.ok(result.protectionWriteResult.runtimeDoc.placement_issue_codes.includes("TP1_ORDER_MISSING"));
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 2);
  assert.strictEqual(calls.some((row) => row.type === "batch-set" && row.payload.status === "ACTIVE_PROTECTED"), false);
  assert.ok(calls.some((row) => row.type === "batch-set" && row.payload.issue_code === "TP1_ORDER_MISSING"));
}

async function runnerRejectsMissingTransportBeforeAnyWrite() {
  const calls = [];
  const executed = buildExecutedEntry();
  let err = null;
  try {
    await runV2EntryProtectionActivation({
      db: buildFakeDb(calls),
      executedEntry: executed,
      transports: {
        placeInitialSl: async () => ({ status: "PLACED", order_id: "STOP__1" }),
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "PLACE_INITIAL_TP1_TRANSPORT_REQUIRED");
  assert.strictEqual(calls.length, 0);
}

async function runnerRejectsMalformedAckBeforeActivationWrite() {
  const calls = [];
  const executed = buildExecutedEntry();
  const result = await runV2EntryProtectionActivation({
    db: buildFakeDb(calls),
    executedEntry: executed,
    now: buildClock(),
    transports: {
      placeInitialSl: async () => ({ status: "OK", order_id: "STOP__BAD" }),
      placeInitialTp1: async () => ({ status: "PLACED", order_id: "TP1__BAD" }),
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "RUNTIME_CHAIN_PROTECTION_NOT_READY");
  assert.strictEqual(result.slAck.status, "FAILED");
  assert.strictEqual(result.slAck.error_code, "SL_ACK_STATUS_INVALID");
  assert.strictEqual(result.tp1Ack.status, "PLACED");
  assert.strictEqual(result.repairQueueCommit.ok, true);
  assert.strictEqual(result.repairQueueCommit.repair_request_n, 1);
  assert.strictEqual(result.repairQueueCommit.repair_requests[0].issue_code, "UNPROTECTED_ACTIVE_POSITION");
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 2);
  assert.strictEqual(calls.some((row) => row.type === "batch-set" && row.payload.status === "ACTIVE_PROTECTED"), false);
}

async function transportThrowStillWritesRuntimeAndRepairEvidence() {
  const calls = [];
  const transportCalls = [];
  const executed = buildExecutedEntry();
  const result = await runV2EntryProtectionActivation({
    db: buildFakeDb(calls),
    executedEntry: executed,
    now: buildClock(),
    transports: {
      placeInitialSl: async ({ command }) => {
        transportCalls.push(command.command_type);
        throw new Error("binance stop timeout");
      },
      placeInitialTp1: async ({ command }) => {
        transportCalls.push(command.command_type);
        throw new Error("binance tp1 timeout");
      },
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "RUNTIME_CHAIN_PROTECTION_NOT_READY");
  assert.deepStrictEqual(transportCalls, ["PLACE_INITIAL_SL", "PLACE_INITIAL_TP1"]);
  assert.strictEqual(result.slAck.status, "FAILED");
  assert.strictEqual(result.slAck.error_code, "BINANCE_STOP_TIMEOUT");
  assert.strictEqual(result.tp1Ack.status, "FAILED");
  assert.strictEqual(result.tp1Ack.error_code, "BINANCE_TP1_TIMEOUT");
  assert.strictEqual(result.protectionWriteResult.runtimeDoc.health_status, "DEGRADED_UNPROTECTED");
  assert.ok(result.protectionWriteResult.runtimeDoc.placement_issue_codes.includes("UNPROTECTED_ACTIVE_POSITION"));
  assert.ok(result.protectionWriteResult.runtimeDoc.placement_issue_codes.includes("TP1_ORDER_MISSING"));
  assert.strictEqual(result.repairQueueCommit.ok, true);
  assert.strictEqual(result.repairQueueCommit.repair_request_n, 2);
  assert.deepStrictEqual(
    result.repairQueueCommit.repair_requests.map((row) => row.issue_code).sort(),
    ["TP1_ORDER_MISSING", "UNPROTECTED_ACTIVE_POSITION"]
  );
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 2);
  assert.strictEqual(calls.some((row) => row.type === "batch-set" && row.payload.status === "ACTIVE_PROTECTED"), false);
}

async function dryRunBinanceAdapterNeverActivatesProtectedCycle() {
  const calls = [];
  let exchangeWriteCalled = false;
  const executed = buildExecutedEntry();
  const transports = buildBinanceInitialProtectionTransports({
    liveCfg: {
      apiKey: "key",
      apiSecret: "secret",
      liveEnabled: false,
      liveDryRun: true,
    },
    placeStopMarketOrder: async () => {
      exchangeWriteCalled = true;
      return {};
    },
    placeTakeProfitMarketOrder: async () => {
      exchangeWriteCalled = true;
      return {};
    },
  });
  const result = await runV2EntryProtectionActivation({
    db: buildFakeDb(calls),
    executedEntry: executed,
    now: buildClock(),
    transports,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(exchangeWriteCalled, false);
  assert.strictEqual(result.activationCommit, null);
  assert.strictEqual(result.repairQueueCommit.ok, true);
  assert.strictEqual(result.repairQueueCommit.write_mode, "SKIPPED");
  assert.strictEqual(result.repairQueueCommit.skip_reason, "DRY_RUN_PROTECTION_ACK");
  assert.strictEqual(result.repairQueueCommit.repair_request_n, 0);
  assert.strictEqual(result.protectionWriteResult.runtimeDoc.health_status, "DEGRADED_UNPROTECTED");
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 1);
  assert.strictEqual(calls.some((row) => row.type === "batch-set" && row.payload.status === "ACTIVE_PROTECTED"), false);
}

async function main() {
  await happyPathCommitsPendingThenProtectedActivation();
  await tp1FailureKeepsCyclePendingAndDoesNotCommitActivation();
  await runnerRejectsMissingTransportBeforeAnyWrite();
  await runnerRejectsMalformedAckBeforeActivationWrite();
  await transportThrowStillWritesRuntimeAndRepairEvidence();
  await dryRunBinanceAdapterNeverActivatesProtectedCycle();
}

main()
  .then(() => {
    console.log("V2_ENTRY_PROTECTION_RUNNER_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
