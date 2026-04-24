"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "../engine/paperBinanceRunner.js"), "utf8");

(function discoveryCanaryCannotUseLegacyFuturesEntrySubmitPath() {
  const guardIndex = source.indexOf("isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent })");
  const reasonIndex = source.indexOf("V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE");
  const submitIndex = source.indexOf("liveResult = await executeLiveFuturesOrder({");
  assert.ok(guardIndex > -1, "legacy entry write guard call is missing");
  assert.ok(reasonIndex > -1, "V2 production route blocker reason is missing");
  assert.ok(submitIndex > -1, "live futures submit call is missing from source audit fixture");
  assert.ok(guardIndex < submitIndex, "discovery entry guard must run before executeLiveFuturesOrder");
})();

(function discoveryCanaryBridgeRequiresRiskGovernorContract() {
  assert.ok(
    source.includes("risk_governor_required: normalizeBool(env.DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, true)"),
    "discovery bridge must read risk governor required flag with fail-closed default"
  );
  assert.ok(
    source.includes("V2_DISCOVERY_CANARY_BRIDGE:RISK_GOVERNOR_REQUIRED"),
    "discovery bridge must block when risk governor is not required"
  );
})();

console.log("V2_DISCOVERY_ENTRY_WRITE_BOUNDARY_TEST_OK");
