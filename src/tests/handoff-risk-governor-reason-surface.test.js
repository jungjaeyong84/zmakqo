"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function riskGovernorBlockerIsPromotedToHandoffReason() {
  const handoff = {
    endpoint_result: {
      ok: false,
      reason: "V2_RISK_GOVERNOR_BLOCKED",
      risk_governor: {
        ok: false,
        reason: "V2_RISK_GOVERNOR_BLOCKED",
        blockers: ["RISK_GOVERNOR:CORRELATED_GROUP_NOTIONAL_EXCEEDED"],
      },
    },
  };
  const detail = __test.resolveV2DiscoveryHandoffDetail(handoff);
  assert.strictEqual(detail.risk_governor_reason, "V2_RISK_GOVERNOR_BLOCKED");
  assert.deepStrictEqual(detail.risk_governor_blockers, ["RISK_GOVERNOR:CORRELATED_GROUP_NOTIONAL_EXCEEDED"]);
  assert.strictEqual(detail.risk_governor_primary_code, "GROUP_NOTIONAL_EXCEEDED");
  assert.strictEqual(detail.risk_governor_surface.telegram_line, "riskGovernor: GROUP_NOTIONAL_EXCEEDED");
  assert.strictEqual(
    __test.deriveV2DiscoveryHandoffBlockReason(handoff),
    "RISK_GOVERNOR:CORRELATED_GROUP_NOTIONAL_EXCEEDED"
  );
  const patch = __test.buildV2DiscoveryHandoffFeaturePatch(handoff);
  assert.strictEqual(patch.v2_discovery_risk_governor_reason, "V2_RISK_GOVERNOR_BLOCKED");
  assert.deepStrictEqual(patch.v2_discovery_risk_governor_blockers, ["RISK_GOVERNOR:CORRELATED_GROUP_NOTIONAL_EXCEEDED"]);
  assert.strictEqual(patch.v2_discovery_risk_governor_primary_code, "GROUP_NOTIONAL_EXCEEDED");
  assert.strictEqual(patch.v2_discovery_risk_governor_surface.primary_code, "GROUP_NOTIONAL_EXCEEDED");
}

function routeReasonStillWinsWhenMoreSpecific() {
  const handoff = {
    endpoint_result: {
      ok: false,
      reason: "V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED",
      risk_governor: {
        ok: false,
        reason: "V2_RISK_GOVERNOR_BLOCKED",
        blockers: ["RISK_GOVERNOR:TOTAL_NOTIONAL_EXCEEDED"],
      },
      route_result: {
        ok: false,
        reason: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
      },
    },
  };
  assert.strictEqual(
    __test.deriveV2DiscoveryHandoffBlockReason(handoff),
    "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED"
  );
}

function main() {
  riskGovernorBlockerIsPromotedToHandoffReason();
  routeReasonStillWinsWhenMoreSpecific();
}

main();
console.log("HANDOFF_RISK_GOVERNOR_REASON_SURFACE_TEST_OK");
