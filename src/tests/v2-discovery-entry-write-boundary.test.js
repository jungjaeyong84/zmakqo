"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "../engine/paperBinanceRunner.js"), "utf8");

(function discoveryCanaryCannotUseLegacyFuturesEntrySubmitPath() {
  const guardIndex = source.indexOf("isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent })");
  const handoffIndex = source.indexOf("runV2DiscoveryCanaryServerSignalHandoff({");
  const reasonIndex = source.indexOf("V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE");
  const routedIndex = source.indexOf("V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE");
  const submitIndex = source.indexOf("liveResult = await executeLiveFuturesOrder({");
  const finalGuardIndex = source.indexOf("V2_DISCOVERY_CANARY_LEGACY_ENTRY_WRITE_DENIED");
  assert.ok(guardIndex > -1, "legacy entry write guard call is missing");
  assert.ok(handoffIndex > -1, "V2 discovery server signal handoff is missing");
  assert.ok(reasonIndex > -1, "V2 production route blocker reason is missing");
  assert.ok(routedIndex > -1, "V2 production route handoff reason is missing");
  assert.ok(finalGuardIndex > -1, "executeLiveFuturesOrder must have a final V2 discovery legacy entry hard-deny");
  assert.ok(submitIndex > -1, "live futures submit call is missing from source audit fixture");
  assert.ok(guardIndex < submitIndex, "discovery entry guard must run before executeLiveFuturesOrder");
  assert.ok(finalGuardIndex < submitIndex, "final V2 discovery hard-deny must run before executeLiveFuturesOrder");
  assert.ok(handoffIndex > guardIndex && handoffIndex < submitIndex, "handoff must run before legacy executeLiveFuturesOrder");
})();

(function discoveryCanarySuccessfulHandoffMustNotBeCanceledDrop() {
  assert.ok(
    source.includes('markIntentStatus(it.intent_id, "SUPERSEDED_BY_V2_PROTECTED_ENTRY"'),
    "successful V2 discovery handoff must use a superseded/executed status, not CANCELED"
  );
  assert.ok(
    source.includes("not a drop/cancel"),
    "successful V2 discovery handoff note must explicitly tell operators it is not a drop/cancel"
  );
  assert.ok(
    !source.includes('markIntentStatus(it.intent_id, "CANCELED", {\n          cancel_reason: routeReason'),
    "successful V2 discovery handoff must not emit a canceled/drop intent"
  );
})();

(function discoveryCanaryMustNotFallbackToFirestoreLiveEnabled() {
  assert.ok(
    source.includes("const discoveryCanaryConfigured = discoveryBridge.policy.discovery_enabled === true"),
    "V2 discovery live config must explicitly detect discovery canary mode"
  );
  assert.ok(
    source.includes("discoveryCanaryConfigured\n      ? discoveryBridge.ok === true\n      : cfg.live_enabled === true"),
    "V2 discovery canary must require bridge.ok and must not OR with Firestore live_enabled"
  );
  assert.ok(
    !source.includes("cfg.live_enabled === true || discoveryBridge.ok === true"),
    "Firestore live_enabled must not revive legacy live entry when discovery bridge is blocked"
  );
})();

(function liveFuturesSubmitRequiresAtomicPendingIntentClaim() {
  const claimIndex = source.lastIndexOf("claimPendingIntentForExecution(it.intent_id", source.indexOf("liveResult = await executeLiveFuturesOrder({"));
  const submitIndex = source.indexOf("liveResult = await executeLiveFuturesOrder({");
  assert.ok(source.includes("claimPendingIntentForExecution"), "pending intent claim import/call is missing");
  assert.ok(claimIndex > -1, "live futures submit must claim pending intent before exchange write");
  assert.ok(claimIndex < submitIndex, "pending intent claim must run before executeLiveFuturesOrder");
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

(function discoveryCanaryBypassesLegacyWaitOneBarHardDrop() {
  assert.ok(
    source.includes("shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({ liveCfg, intent })"),
    "V2 discovery must classify legacy wait-one-bar as advisory before hard drop"
  );
  assert.ok(
    source.includes("wait_one_bar_v2_discovery_advisory_only: true"),
    "V2 discovery wait-one-bar advisory marker is missing"
  );
  assert.ok(
    source.includes("wait_one_bar_legacy_hard_drop_bypassed: true"),
    "V2 discovery wait-one-bar bypass marker is missing"
  );
})();

(function discoveryCanaryBypassesLegacyEntryFiltersBeforeHandoff() {
  const bypassIndex = source.indexOf("v2_discovery_legacy_entry_filters_bypassed: true");
  const handoffIndex = source.indexOf("runV2DiscoveryCanaryServerSignalHandoff({");
  assert.ok(bypassIndex > -1, "V2 discovery legacy entry filter bypass marker is missing");
  assert.ok(handoffIndex > -1, "V2 discovery handoff is missing");
  assert.ok(bypassIndex < handoffIndex, "V2 discovery legacy entry filters must be bypassed before route handoff");
  assert.ok(
    source.includes("intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && aiBiasGateCfg"),
    "legacy AI bias gate must not hard-drop V2 discovery before route handoff"
  );
  assert.ok(
    source.includes("intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && evGateCfg"),
    "legacy EV gate must not hard-drop V2 discovery before route handoff"
  );
  assert.ok(
    source.includes("intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && !manualRetryIntent"),
    "legacy canonical/quality gate must not hard-drop V2 discovery before route handoff"
  );
})();

(function discoveryCanarySignalFanInCannotCreateLegacyImmediateIntent() {
  const fanInMarker = "v2_discovery_signal_fan_in_handoff = true";
  const firstFanInIndex = source.indexOf(fanInMarker);
  const secondFanInIndex = source.indexOf(fanInMarker, firstFanInIndex + 1);
  assert.ok(firstFanInIndex > -1, "first signal fan-in V2 discovery handoff guard is missing");
  assert.ok(secondFanInIndex > -1, "second signal fan-in V2 discovery handoff guard is missing");

  for (const fanInIndex of [firstFanInIndex, secondFanInIndex]) {
    const immediateIndex = source.indexOf("[immediate_entry]", fanInIndex);
    const upsertIndex = source.indexOf("await upsertIntent({", fanInIndex);
    const handoffIndex = source.indexOf("runV2DiscoveryCanaryServerSignalHandoff({", fanInIndex);
    const blockedIndex = source.indexOf("v2_discovery_signal_fan_in_blocked: true", fanInIndex);
    assert.ok(handoffIndex > fanInIndex, "signal fan-in guard must call production entry handoff");
    assert.ok(blockedIndex > handoffIndex, "signal fan-in blocked handoff must be recorded as a drop");
    assert.ok(immediateIndex > handoffIndex, "signal fan-in handoff must run before immediate_entry logging");
    assert.ok(upsertIndex > handoffIndex, "signal fan-in handoff must run before legacy upsertIntent");
  }
})();

(function postFillProtectionFailureMustRecoverNotClose() {
  const entrySubmitterSource = fs.readFileSync(path.resolve(__dirname, "../v2/entrySubmitter.js"), "utf8");
  assert.ok(
    entrySubmitterSource.includes("recoverUnprotectedEntryProtection"),
    "post-fill protection failure must retry protection recovery"
  );
  assert.ok(
    !entrySubmitterSource.includes("emergencyCloseEntry"),
    "entry submitter must not auto-close a filled discovery position instead of repairing protection"
  );
})();

(function postFillEndpointCriticalMustNotLookLikeNormalDrop() {
  assert.ok(
    source.includes("endpointPostFillCritical"),
    "paper runner must detect endpoint post-fill protection critical state"
  );
  assert.ok(
    source.includes('endpointPostFillCritical ? "FAILED_INTERNAL" : "CANCELED"'),
    "post-fill protection critical state must not be written as a normal canceled/drop intent"
  );
  assert.ok(
    source.includes("Actual exchange entry may exist and requires protection repair verification."),
    "post-fill protection critical note must tell operators that an exchange position may exist"
  );
})();

console.log("V2_DISCOVERY_ENTRY_WRITE_BOUNDARY_TEST_OK");
