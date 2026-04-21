"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { buildEntryProtectionPlacementRequest } = require("../v2/entryProtectionHandoff");
const { buildProtectionRuntimeWriteResult } = require("../v2/protectionRuntimeWriter");

function buildPlacementRequest() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__BTC__PRW",
    symbol: "BTCUSDT",
    side: "LONG",
    qualityScore: 0.85,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "live entry approved",
    policyScope: "BTC_15M",
    htfDirection: "LONG",
    htfConfidence: 0.8,
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const executed = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__BTC__PRW",
    entryOrderId: "ORDER__BTC__PRW",
    entryFillGroupId: "FILL_GROUP__BTC__PRW",
    entryPrice: 100000,
    entryQtyAbs: 0.02,
  });
  return buildEntryProtectionPlacementRequest(executed);
}

(function fullPlacementWritesHealthyRuntime() {
  const request = buildPlacementRequest();
  const result = buildProtectionRuntimeWriteResult({
    placementRequest: request,
    slAck: {
      status: "PLACED",
      order_id: "STOP__1",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__1",
    },
    observedAt: "2026-04-20T13:00:00.000Z",
  });
  assert.strictEqual(result.writeDecision.ok, true);
  assert.strictEqual(result.runtimeDoc.health_status, "HEALTHY");
  assert.strictEqual(result.runtimeDoc.native_refresh_status, "OK");
  assert.strictEqual(result.runtimeDoc.sl_order_status, "PLACED");
  assert.strictEqual(result.runtimeDoc.tp1_order_status, "PLACED");
})();

(function tp1FailureRemainsRepairableButProtected() {
  const request = buildPlacementRequest();
  const result = buildProtectionRuntimeWriteResult({
    placementRequest: request,
    slAck: {
      status: "PLACED",
      order_id: "STOP__2",
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "MIN_NOTIONAL",
    },
  });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.writeDecision.requires_repair, true);
  assert.strictEqual(result.runtimeDoc.health_status, "DEGRADED_REPAIRABLE");
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "SL_ONLY_PROTECTED");
  assert.ok(result.runtimeDoc.placement_issue_codes.includes("TP1_ORDER_MISSING"));
})();

(function stopFailureIsUnprotectedEvenIfTp1Exists() {
  const request = buildPlacementRequest();
  const result = buildProtectionRuntimeWriteResult({
    placementRequest: request,
    slAck: {
      status: "FAILED",
      error_code: "NETWORK",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__3",
    },
  });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.runtimeDoc.health_status, "DEGRADED_UNPROTECTED");
  assert.strictEqual(result.runtimeDoc.runtime_write_reason, "TP1_ONLY_PROTECTED");
  assert.ok(result.runtimeDoc.placement_issue_codes.includes("UNPROTECTED_ACTIVE_POSITION"));
})();

(function dualFailureIsHardUnprotected() {
  const request = buildPlacementRequest();
  const result = buildProtectionRuntimeWriteResult({
    placementRequest: request,
    slAck: {
      status: "FAILED",
      error_code: "NETWORK",
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "MIN_NOTIONAL",
    },
  });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.runtimeDoc.native_refresh_status, "ERROR");
  assert.strictEqual(result.runtimeDoc.health_status, "DEGRADED_UNPROTECTED");
  assert.ok(result.runtimeDoc.placement_issue_codes.includes("UNPROTECTED_ACTIVE_POSITION"));
  assert.ok(result.runtimeDoc.placement_issue_codes.includes("TP1_ORDER_MISSING"));
})();

console.log("V2_PROTECTION_RUNTIME_WRITER_TEST_OK");
