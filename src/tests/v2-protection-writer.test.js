"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { buildEntryProtectionPlacementRequest } = require("../v2/entryProtectionHandoff");
const {
  buildInitialProtectionCommands,
  buildRefreshStopCommand,
  buildTp1RepairCommand,
  buildFullProtectionRepairCommand,
  finalizeInitialProtectionPlacement,
  finalizeAuditedInitialProtectionPlacement,
  finalizeRefreshStopPlacement,
  finalizeTp1RepairPlacement,
  finalizeFullProtectionRepairPlacement,
  __test,
} = require("../v2/protectionWriter");

function buildPlacementRequest() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__PW",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.79,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "canary entry approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.83,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.71,
      volatility_rank: 0.39,
    },
    proposalVerdict: "PASS",
    rankScore: 0.63,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_eth_pw",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "canary long approved",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const executed = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__PW",
    entryOrderId: "ORDER__ETH__PW",
    entryFillGroupId: "FILL_GROUP__ETH__PW",
    entryPrice: 2500,
    entryQtyAbs: 1.2,
  });
  return buildEntryProtectionPlacementRequest(executed);
}

function buildExecutedEntry() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__PW_EXECUTED",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.79,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "canary entry approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.83,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.71,
      volatility_rank: 0.39,
    },
    proposalVerdict: "PASS",
    rankScore: 0.63,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_eth_pw_executed",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "canary long approved",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  return buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__PW_EXECUTED",
    entryOrderId: "ORDER__ETH__PW_EXECUTED",
    entryFillGroupId: "FILL_GROUP__ETH__PW_EXECUTED",
    entryPrice: 2500,
    entryQtyAbs: 1.2,
  });
}

(function commandBuilderProducesSingleWriterAttemptAndTwoCommands() {
  const placementRequest = buildPlacementRequest();
  const built = buildInitialProtectionCommands({
    placementRequest,
    placementStartedAt: "2026-04-20T13:10:00.000Z",
    placementRetryId: "R1",
  });
  assert.strictEqual(built.attemptMeta.requested_by_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(built.attemptMeta.placement_retry_id, "R1");
  assert.ok(built.attemptMeta.placement_attempt_id.startsWith("PRATTV2__"));
  assert.strictEqual(built.commands.sl.command_type, "PLACE_INITIAL_SL");
  assert.strictEqual(built.commands.tp1.command_type, "PLACE_INITIAL_TP1");
  assert.strictEqual(built.commands.sl.placement_attempt_id, built.attemptMeta.placement_attempt_id);
  assert.strictEqual(built.commands.tp1.placement_attempt_id, built.attemptMeta.placement_attempt_id);
})();

(function fullPlacementMeasuresGapUntilStopAck() {
  const placementRequest = buildPlacementRequest();
  const built = buildInitialProtectionCommands({
    placementRequest,
    placementStartedAt: "2026-04-20T13:10:00.000Z",
    placementRetryId: "R2",
  });
  const result = finalizeInitialProtectionPlacement({
    placementRequest,
    attemptMeta: built.attemptMeta,
    slAck: {
      status: "PLACED",
      order_id: "STOP__10",
      ack_at: "2026-04-20T13:10:01.500Z",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__10",
      ack_at: "2026-04-20T13:10:01.200Z",
    },
    placementFinishedAt: "2026-04-20T13:10:01.800Z",
  });
  assert.strictEqual(result.runtimeDoc.placement_attempt_id, built.attemptMeta.placement_attempt_id);
  assert.strictEqual(result.runtimeDoc.placement_retry_id, "R2");
  assert.strictEqual(result.runtimeDoc.sl_ack_at, "2026-04-20T13:10:01.500Z");
  assert.strictEqual(result.runtimeDoc.tp1_ack_at, "2026-04-20T13:10:01.200Z");
  assert.strictEqual(result.runtimeDoc.last_gap_ms, 1500);
})();

(function auditedPlacementFailsClosedOnHealthySingleLineage() {
  const executed = buildExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const built = buildInitialProtectionCommands({
    placementRequest,
    placementStartedAt: "2026-04-20T13:10:00.000Z",
    placementRetryId: "R2A",
  });
  const result = finalizeAuditedInitialProtectionPlacement({
    executedEntry: executed,
    placementRequest,
    attemptMeta: built.attemptMeta,
    slAck: {
      status: "PLACED",
      order_id: "STOP__10A",
      ack_at: "2026-04-20T13:10:01.500Z",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__10A",
      ack_at: "2026-04-20T13:10:01.200Z",
    },
    placementFinishedAt: "2026-04-20T13:10:01.800Z",
  });
  assert.strictEqual(result.writeDecision.ok, true);
  assert.strictEqual(result.activatedPositionCycle.status, "ACTIVE_PROTECTED");
  assert.strictEqual(result.activatedPositionCycle.position_cycle_id, executed.positionCycle.position_cycle_id);
  assert.strictEqual(result.activatedPositionCycle.protection_runtime_id, result.runtimeDoc.protection_runtime_id);
  assert.strictEqual(result.chainAudit.ok, true);
  assert.strictEqual(result.chainAudit.fail_n, 0);
})();

(function auditedPlacementRejectsDegradedProtectionRuntime() {
  const executed = buildExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const built = buildInitialProtectionCommands({
    placementRequest,
    placementStartedAt: "2026-04-20T13:20:00.000Z",
    placementRetryId: "R3A",
  });
  let err = null;
  try {
    finalizeAuditedInitialProtectionPlacement({
      executedEntry: executed,
      placementRequest,
      attemptMeta: built.attemptMeta,
      slAck: {
        status: "PLACED",
        order_id: "STOP__20A",
        ack_at: "2026-04-20T13:20:01.500Z",
      },
      tp1Ack: {
        status: "FAILED",
        error_code: "NETWORK",
      },
      placementFinishedAt: "2026-04-20T13:20:02.250Z",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "RUNTIME_CHAIN_PROTECTION_NOT_READY");
})();

(function stopFailureUsesAttemptFinishForGap() {
  const placementRequest = buildPlacementRequest();
  const built = buildInitialProtectionCommands({
    placementRequest,
    placementStartedAt: "2026-04-20T13:20:00.000Z",
    placementRetryId: "R3",
  });
  const result = finalizeInitialProtectionPlacement({
    placementRequest,
    attemptMeta: built.attemptMeta,
    slAck: {
      status: "FAILED",
      error_code: "NETWORK",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__20",
      ack_at: "2026-04-20T13:20:01.000Z",
    },
    placementFinishedAt: "2026-04-20T13:20:02.250Z",
  });
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "TP1_ONLY_PROTECTED");
  assert.strictEqual(result.runtimeDoc.last_gap_ms, 2250);
  assert.strictEqual(result.runtimeDoc.placement_finished_at, "2026-04-20T13:20:02.250Z");
})();

(function helperRejectsRequestWithoutLineage() {
  let err = null;
  try {
    buildInitialProtectionCommands({
      placementRequest: {
        position_cycle_id: null,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "position_cycle_id_REQUIRED");
})();

(function gapHelperReturnsNullWhenAttemptStillOpen() {
  const gap = __test.measureInitialProtectionGapMs({
    placementStartedAt: "2026-04-20T13:30:00.000Z",
    slAckAt: null,
    placementFinishedAt: null,
  });
  assert.strictEqual(gap, null);
})();

(function refreshCommandUsesSameAttemptContract() {
  const built = buildRefreshStopCommand({
    refreshRequest: {
      position_cycle_id: "PCY__ETH__TRAIL",
      requested_stop_price: 2512.25,
      requested_stop_source: "TRAIL",
      previous_native_stop_price: 2504.5,
      reason: "TRAIL_TIGHTEN_ONLY_REFRESH",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__TRAIL",
      native_stop_price: 2504.5,
      tp1_order_id: null,
      tp1_order_status: null,
    },
    placementStartedAt: "2026-04-20T13:40:00.000Z",
    placementRetryId: "R4",
  });
  assert.strictEqual(built.attemptMeta.refresh_reason, "TRAIL_TIGHTEN_ONLY_REFRESH");
  assert.strictEqual(built.command.command_type, "REFRESH_NATIVE_STOP");
  assert.strictEqual(built.command.trigger_price, 2512.25);
  assert.strictEqual(built.command.requested_stop_source, "TRAIL");
  assert.strictEqual(built.command.previous_native_stop_price, 2504.5);
})();

(function refreshSuccessPreservesTp1IssueAndClosesGapOnStopAck() {
  const built = buildRefreshStopCommand({
    refreshRequest: {
      position_cycle_id: "PCY__ETH__PRE",
      requested_stop_price: 2488.75,
      requested_stop_source: "FLOOR",
      previous_native_stop_price: null,
      reason: "NATIVE_REFRESH_UNHEALTHY",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__PRE",
      tp1_order_id: null,
      tp1_order_status: "FAILED",
      native_tp1_price: 2542.1,
      placement_issue_codes: ["TP1_ORDER_MISSING", "UNPROTECTED_ACTIVE_POSITION", "NATIVE_REFRESH_UNHEALTHY"],
      tp1_ack_at: "2026-04-20T13:39:58.000Z",
    },
    placementStartedAt: "2026-04-20T13:40:00.000Z",
    placementRetryId: "R5",
  });
  const result = finalizeRefreshStopPlacement({
    refreshRequest: {
      position_cycle_id: "PCY__ETH__PRE",
      requested_stop_price: 2488.75,
      requested_stop_source: "FLOOR",
      reason: "NATIVE_REFRESH_UNHEALTHY",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__PRE",
      tp1_order_id: null,
      tp1_order_status: "FAILED",
      native_tp1_price: 2542.1,
      placement_issue_codes: ["TP1_ORDER_MISSING", "UNPROTECTED_ACTIVE_POSITION", "NATIVE_REFRESH_UNHEALTHY"],
      tp1_ack_at: "2026-04-20T13:39:58.000Z",
    },
    attemptMeta: built.attemptMeta,
    slAck: {
      status: "PLACED",
      order_id: "STOP__REFRESH__1",
      trigger_price: 2488.75,
      ack_at: "2026-04-20T13:40:01.750Z",
    },
    placementFinishedAt: "2026-04-20T13:40:02.000Z",
  });
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "REFRESH_STOP_PROTECTED");
  assert.strictEqual(result.runtimeDoc.native_refresh_status, "OK");
  assert.strictEqual(result.runtimeDoc.health_status, "DEGRADED_REPAIRABLE");
  assert.deepStrictEqual(result.runtimeDoc.placement_issue_codes, ["TP1_ORDER_MISSING"]);
  assert.strictEqual(result.runtimeDoc.tp1_order_status, "FAILED");
  assert.strictEqual(result.runtimeDoc.last_gap_ms, 1750);
  assert.strictEqual(result.writeDecision.requires_repair, true);
})();

(function refreshFailureFailsClosedAndUsesFinishTimeForGap() {
  const built = buildRefreshStopCommand({
    refreshRequest: {
      position_cycle_id: "PCY__BNB__TRAIL",
      requested_stop_price: 602.4,
      requested_stop_source: "TRAIL",
      previous_native_stop_price: 598.2,
      reason: "TRAIL_STOP_MISSING",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__BNB__TRAIL",
      tp1_order_id: null,
      tp1_order_status: null,
      placement_issue_codes: [],
    },
    placementStartedAt: "2026-04-20T13:50:00.000Z",
    placementRetryId: "R6",
  });
  const result = finalizeRefreshStopPlacement({
    refreshRequest: {
      position_cycle_id: "PCY__BNB__TRAIL",
      requested_stop_price: 602.4,
      requested_stop_source: "TRAIL",
      reason: "TRAIL_STOP_MISSING",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__BNB__TRAIL",
      tp1_order_id: null,
      tp1_order_status: null,
      placement_issue_codes: [],
    },
    attemptMeta: built.attemptMeta,
    slAck: {
      status: "FAILED",
      error_code: "EXCHANGE_TIMEOUT",
    },
    placementFinishedAt: "2026-04-20T13:50:03.250Z",
  });
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "REFRESH_STOP_FAILED");
  assert.strictEqual(result.runtimeDoc.native_refresh_status, "ERROR");
  assert.strictEqual(result.runtimeDoc.health_status, "DEGRADED_UNPROTECTED");
  assert.deepStrictEqual(result.runtimeDoc.placement_issue_codes, ["UNPROTECTED_ACTIVE_POSITION"]);
  assert.strictEqual(result.runtimeDoc.sl_order_id, null);
  assert.strictEqual(result.runtimeDoc.native_stop_price, null);
  assert.strictEqual(result.runtimeDoc.last_gap_ms, 3250);
  assert.strictEqual(result.writeDecision.requires_repair, true);
})();

(function tp1RepairCommandUsesProtectionWriterAttemptContract() {
  const built = buildTp1RepairCommand({
    tp1RepairRequest: {
      position_cycle_id: "PCY__ETH__PRE",
      requested_tp1_price: 2542,
      requested_tp1_qty_abs: 0.6,
      reason: "TP1_ORDER_MISSING",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__PRE",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      tp1_order_id: null,
    },
    positionCycle: {
      position_cycle_id: "PCY__ETH__PRE",
      symbol: "ETHUSDT",
      position_side: "LONG",
    },
    placementStartedAt: "2026-04-20T14:00:00.000Z",
    placementRetryId: "R7",
  });
  assert.strictEqual(built.attemptMeta.requested_by_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(built.attemptMeta.repair_reason, "TP1_ORDER_MISSING");
  assert.strictEqual(built.command.command_type, "PLACE_OR_REPLACE_TP1");
  assert.strictEqual(built.command.symbol, "ETHUSDT");
  assert.strictEqual(built.command.close_side, "SELL");
  assert.strictEqual(built.command.trigger_price, 2542);
  assert.strictEqual(built.command.quantity_abs, 0.6);
  assert.strictEqual(built.command.client_order_key, `RTP1__${built.attemptMeta.placement_attempt_id}`);
})();

(function tp1RepairSuccessClearsTp1IssueButPreservesStopEvidence() {
  const result = finalizeTp1RepairPlacement({
    tp1RepairRequest: {
      position_cycle_id: "PCY__ETH__PRE",
      requested_tp1_price: 2542,
      requested_tp1_qty_abs: 0.6,
      reason: "TP1_ORDER_MISSING",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__PRE",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      native_stop_price: 2445,
      native_refresh_status: "OK",
      placement_issue_codes: ["TP1_ORDER_MISSING"],
      sl_ack_at: "2026-04-20T13:59:59.000Z",
    },
    attemptMeta: {
      placement_attempt_id: "PRATTV2__TP1REPAIR",
      placement_retry_id: "R8",
      placement_started_at: "2026-04-20T14:00:00.000Z",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__REPAIRED",
      trigger_price: 2542,
      ack_at: "2026-04-20T14:00:01.000Z",
    },
    placementFinishedAt: "2026-04-20T14:00:02.000Z",
  });
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "TP1_REPAIRED");
  assert.strictEqual(result.runtimeDoc.health_status, "HEALTHY");
  assert.strictEqual(result.runtimeDoc.sl_order_id, "STOP__OK");
  assert.strictEqual(result.runtimeDoc.native_stop_price, 2445);
  assert.strictEqual(result.runtimeDoc.tp1_order_id, "TP1__REPAIRED");
  assert.strictEqual(result.runtimeDoc.native_tp1_price, 2542);
  assert.deepStrictEqual(result.runtimeDoc.placement_issue_codes, []);
  assert.strictEqual(result.writeDecision.ok, true);
})();

(function tp1RepairFailureKeepsTp1IssueFailClosed() {
  const result = finalizeTp1RepairPlacement({
    tp1RepairRequest: {
      position_cycle_id: "PCY__ETH__PRE",
      requested_tp1_price: 2542,
      requested_tp1_qty_abs: 0.6,
      reason: "TP1_ORDER_MISSING",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__PRE",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      native_stop_price: 2445,
      native_refresh_status: "OK",
      placement_issue_codes: ["TP1_ORDER_MISSING"],
    },
    attemptMeta: {
      placement_attempt_id: "PRATTV2__TP1REPAIR_FAIL",
      placement_retry_id: "R9",
      placement_started_at: "2026-04-20T14:10:00.000Z",
    },
    tp1Ack: {
      status: "FAILED",
      trigger_price: 2542,
      error_code: "MIN_NOTIONAL",
    },
    placementFinishedAt: "2026-04-20T14:10:02.000Z",
  });
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "TP1_REPAIR_FAILED");
  assert.strictEqual(result.runtimeDoc.health_status, "DEGRADED_REPAIRABLE");
  assert.deepStrictEqual(result.runtimeDoc.placement_issue_codes, ["TP1_ORDER_MISSING"]);
  assert.strictEqual(result.runtimeDoc.tp1_order_id, null);
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.writeDecision.requires_repair, true);
})();

(function fullProtectionCommandOnlyBuildsMissingLegs() {
  const built = buildFullProtectionRepairCommand({
    fullProtectionRepairRequest: {
      position_cycle_id: "PCY__ETH__FULL",
      include_sl_order: false,
      include_tp1_order: true,
      requested_tp1_price: 2542,
      requested_tp1_qty_abs: 0.5,
      reason: "UNPROTECTED_ACTIVE_POSITION",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__FULL",
      symbol: "ETHUSDT",
      position_side: "LONG",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      native_stop_price: 2445,
      tp1_order_id: null,
    },
    placementStartedAt: "2026-04-21T07:00:00.000Z",
    placementRetryId: "RFP1",
  });
  assert.strictEqual(built.command.command_type, "PLACE_OR_REPLACE_FULL_PROTECTION");
  assert.strictEqual(built.command.include_sl_order, false);
  assert.strictEqual(built.command.include_tp1_order, true);
  assert.strictEqual(built.command.commands.sl, null);
  assert.strictEqual(built.command.commands.tp1.command_type, "PLACE_OR_REPLACE_TP1");
  assert.strictEqual(built.command.commands.tp1.trigger_price, 2542);
  assert.strictEqual(built.command.commands.tp1.quantity_abs, 0.5);
})();

(function fullProtectionRepairSuccessPreservesExistingStopAndClearsTp1Issue() {
  const built = buildFullProtectionRepairCommand({
    fullProtectionRepairRequest: {
      position_cycle_id: "PCY__ETH__FULL_OK",
      include_sl_order: false,
      include_tp1_order: true,
      requested_tp1_price: 2542,
      requested_tp1_qty_abs: 0.5,
      reason: "UNPROTECTED_ACTIVE_POSITION",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__FULL_OK",
      symbol: "ETHUSDT",
      position_side: "LONG",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      native_stop_price: 2445,
      sl_ack_at: "2026-04-21T07:09:58.000Z",
      tp1_order_id: null,
      tp1_order_status: "FAILED",
      placement_issue_codes: ["UNPROTECTED_ACTIVE_POSITION", "TP1_ORDER_MISSING"],
      last_gap_ms: 1200,
    },
    placementStartedAt: "2026-04-21T07:10:00.000Z",
    placementRetryId: "RFP2",
  });
  const result = finalizeFullProtectionRepairPlacement({
    fullProtectionRepairRequest: {
      position_cycle_id: "PCY__ETH__FULL_OK",
      include_sl_order: false,
      include_tp1_order: true,
      requested_tp1_price: 2542,
      requested_tp1_qty_abs: 0.5,
      reason: "UNPROTECTED_ACTIVE_POSITION",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__FULL_OK",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      native_stop_price: 2445,
      sl_ack_at: "2026-04-21T07:09:58.000Z",
      tp1_order_id: null,
      tp1_order_status: "FAILED",
      placement_issue_codes: ["UNPROTECTED_ACTIVE_POSITION", "TP1_ORDER_MISSING"],
      last_gap_ms: 1200,
    },
    attemptMeta: built.attemptMeta,
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__REPAIRED",
      trigger_price: 2542,
      ack_at: "2026-04-21T07:10:01.000Z",
    },
    placementFinishedAt: "2026-04-21T07:10:02.000Z",
  });
  assert.strictEqual(result.writeDecision.ok, true);
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "FULL_PROTECTION_REPAIRED");
  assert.strictEqual(result.runtimeDoc.sl_order_id, "STOP__OK");
  assert.strictEqual(result.runtimeDoc.tp1_order_id, "TP1__REPAIRED");
  assert.deepStrictEqual(result.runtimeDoc.placement_issue_codes, []);
})();

(function fullProtectionRepairFailureKeepsUnprotectedIssue() {
  const built = buildFullProtectionRepairCommand({
    fullProtectionRepairRequest: {
      position_cycle_id: "PCY__ETH__FULL_FAIL",
      include_sl_order: true,
      include_tp1_order: false,
      requested_stop_price: 2445,
      requested_stop_source: "SL",
      reason: "UNPROTECTED_ACTIVE_POSITION",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__FULL_FAIL",
      symbol: "ETHUSDT",
      position_side: "LONG",
      sl_order_id: null,
      tp1_order_id: "TP1__OK",
      tp1_order_status: "PLACED",
      native_tp1_price: 2542,
      placement_issue_codes: ["UNPROTECTED_ACTIVE_POSITION"],
    },
    placementStartedAt: "2026-04-21T07:20:00.000Z",
    placementRetryId: "RFP3",
  });
  const result = finalizeFullProtectionRepairPlacement({
    fullProtectionRepairRequest: {
      position_cycle_id: "PCY__ETH__FULL_FAIL",
      include_sl_order: true,
      include_tp1_order: false,
      requested_stop_price: 2445,
      requested_stop_source: "SL",
      reason: "UNPROTECTED_ACTIVE_POSITION",
    },
    protectionRuntime: {
      position_cycle_id: "PCY__ETH__FULL_FAIL",
      tp1_order_id: "TP1__OK",
      tp1_order_status: "PLACED",
      native_tp1_price: 2542,
      placement_issue_codes: ["UNPROTECTED_ACTIVE_POSITION"],
    },
    attemptMeta: built.attemptMeta,
    slAck: {
      status: "FAILED",
      trigger_price: 2445,
      error_code: "BINANCE_STOP_REJECTED",
    },
    placementFinishedAt: "2026-04-21T07:20:02.000Z",
  });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "FULL_PROTECTION_REPAIR_FAILED");
  assert.deepStrictEqual(result.runtimeDoc.placement_issue_codes, ["UNPROTECTED_ACTIVE_POSITION"]);
  assert.strictEqual(result.runtimeDoc.tp1_order_id, "TP1__OK");
})();

console.log("V2_PROTECTION_WRITER_TEST_OK");
