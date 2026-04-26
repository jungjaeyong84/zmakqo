"use strict";

const assert = require("assert");
const { __test } = require("../services/signalLifecycleAlert");
const { __test: signalDropsTest } = require("../storage/signalDrops");

function droppedMessageIncludesRiskGovernorPrimaryCode() {
  const message = __test.buildDroppedMessage({
    symbol: "BTCUSDT",
    event: "LONG",
    side: "LONG",
    tf: "15m",
    executionMode: "LIVE",
    reason: "V2_RISK_GOVERNOR_BLOCKED",
    dropReasonCode: "V2_RISK_GOVERNOR_BLOCKED",
    riskGovernor: {
      present: true,
      ok: false,
      reason: "V2_RISK_GOVERNOR_BLOCKED",
      primary_code: "GROUP_NOTIONAL_EXCEEDED",
      blockers: ["RISK_GOVERNOR:CORRELATED_GROUP_NOTIONAL_EXCEEDED"],
    },
  });
  assert.ok(message);
  assert.ok(message.body.includes("riskGovernor: GROUP_NOTIONAL_EXCEEDED"));
}

function progressMessageIncludesRiskGovernorPrimaryCode() {
  const message = __test.buildProgressMessage({
    symbol: "ETHUSDT",
    event: "SHORT",
    side: "SHORT",
    tf: "15m",
    executionMode: "LIVE",
    progressReason: "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE",
    riskGovernor: {
      present: true,
      ok: false,
      reason: "V2_RISK_GOVERNOR_BLOCKED",
      primary_code: "TOTAL_NOTIONAL_EXCEEDED",
      blockers: ["RISK_GOVERNOR:TOTAL_NOTIONAL_EXCEEDED"],
    },
  });
  assert.ok(message);
  assert.ok(message.body.includes("riskGovernor: TOTAL_NOTIONAL_EXCEEDED"));
}

function dropAlertPayloadExtractsRiskGovernorSurfaceFromFeatures() {
  const payload = signalDropsTest.buildDropAlertPayload({
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "LINKUSDT",
    tf: "15m",
    event: "LONG",
    side: "LONG",
    execution_mode: "LIVE",
    reason: "V2_RISK_GOVERNOR_BLOCKED",
    features_json: {
      v2_discovery_risk_governor_surface: {
        present: true,
        ok: false,
        reason: "V2_RISK_GOVERNOR_BLOCKED",
        primary_code: "GROUP_NOTIONAL_EXCEEDED",
        blockers: ["RISK_GOVERNOR:CORRELATED_GROUP_NOTIONAL_EXCEEDED"],
      },
    },
  });
  assert.strictEqual(payload.riskGovernor.primary_code, "GROUP_NOTIONAL_EXCEEDED");
}

droppedMessageIncludesRiskGovernorPrimaryCode();
progressMessageIncludesRiskGovernorPrimaryCode();
dropAlertPayloadExtractsRiskGovernorSurfaceFromFeatures();

console.log("SIGNAL_LIFECYCLE_RISK_GOVERNOR_ALERT_TEST_OK");
