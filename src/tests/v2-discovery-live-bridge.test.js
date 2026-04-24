"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");
const { classifySignalReasonStage, explainSignalReason } = require("../utils/signalReasonView");

function buildEnv(overrides = {}) {
  return {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "25",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "1",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "1",
    DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: "10",
    DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1",
    ML_LIVE_SERVING_ARMED: "0",
    OPENCLAW_AGENT_APPLY_ENABLED: "0",
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "0",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "1",
    ...overrides,
  };
}

function discoveryBridgeAllowsOnlyApprovedSymbols() {
  const pass = __test.evaluateV2DiscoveryCanaryLiveBridge({
    env: buildEnv(),
    symbol: "SOLUSDT",
    executionMode: "LIVE",
  });
  assert.strictEqual(pass.ok, true);
  assert.strictEqual(pass.reason, "V2_DISCOVERY_CANARY_LIVE_BRIDGE_ENABLED");
  assert.strictEqual(pass.max_notional_quote, 25);

  const blocked = __test.evaluateV2DiscoveryCanaryLiveBridge({
    env: buildEnv(),
    symbol: "BTCUSDT",
    executionMode: "LIVE",
  });
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:SYMBOL_NOT_ALLOWED"));
}

function discoveryBridgeRequiresSafetyEnvelope() {
  const blocked = __test.evaluateV2DiscoveryCanaryLiveBridge({
    env: buildEnv({
      DONBEOLJA_V2_CANARY_ONLY: "0",
      DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "0",
      ML_LIVE_SERVING_ARMED: "1",
      DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "0",
      DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "0",
      DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "0",
      DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "0",
    }),
    symbol: "XRPUSDT",
    executionMode: "LIVE",
  });
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:CANARY_ONLY_REQUIRED"));
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:RISK_GOVERNOR_REQUIRED"));
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:ML_LIVE_ARMED"));
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WEBHOOK_NOT_BLOCKED"));
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_RUNTIME_NOT_RETIRED"));
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_ENTRY_FILTERS_NOT_RETIRED"));
  assert.ok(blocked.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WAIT_ONE_BAR_HARD_DROP_NOT_RETIRED"));
}

function discoveryBridgeClampsLegacyMaxOrder() {
  const bridge = __test.evaluateV2DiscoveryCanaryLiveBridge({
    env: buildEnv({ DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "25" }),
    symbol: "XRPUSDT",
    executionMode: "LIVE",
  });
  assert.strictEqual(bridge.ok, true);
  assert.strictEqual(__test.clampDiscoveryCanaryMaxOrderQuote(0, bridge), 25);
  assert.strictEqual(__test.clampDiscoveryCanaryMaxOrderQuote(100, bridge), 25);
  assert.strictEqual(__test.clampDiscoveryCanaryMaxOrderQuote(10, bridge), 10);
}

function discoveryBridgeBlocksLegacyEntryWritePath() {
  const liveCfg = {
    executionMode: "LIVE",
    liveEnabled: true,
    v2DiscoveryCanaryBridge: true,
  };
  assert.strictEqual(
    __test.isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent: "ENTRY" }),
    true
  );
  assert.strictEqual(
    __test.isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent: "ADD" }),
    true
  );
  assert.strictEqual(
    __test.isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent: "EXIT" }),
    false
  );
  assert.strictEqual(
    __test.isV2DiscoveryCanaryLegacyEntryWriteBlocked({
      liveCfg: { ...liveCfg, v2DiscoveryCanaryBridge: false },
      intent: "ENTRY",
    }),
    false
  );
}

function discoveryBridgeMakesLegacyWaitOneBarAdvisoryOnly() {
  const liveCfg = {
    executionMode: "LIVE",
    liveEnabled: true,
    v2DiscoveryCanaryBridge: true,
  };
  assert.strictEqual(
    __test.shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({ liveCfg, intent: "ENTRY" }),
    true
  );
  assert.strictEqual(
    __test.shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({ liveCfg, intent: "ADD" }),
    true
  );
  assert.strictEqual(
    __test.shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({ liveCfg, intent: "EXIT" }),
    false
  );
  assert.strictEqual(
    __test.shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({
      liveCfg: { ...liveCfg, v2DiscoveryCanaryBridge: false },
      intent: "ENTRY",
    }),
    false
  );
}

function discoveryBridgeBypassesLegacyEntryFiltersBeforeHandoff() {
  const liveCfg = {
    executionMode: "LIVE",
    liveEnabled: true,
    v2DiscoveryCanaryBridge: true,
  };
  assert.strictEqual(
    __test.shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg, intent: "ENTRY" }),
    true
  );
  assert.strictEqual(
    __test.shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg, intent: "ADD" }),
    true
  );
  assert.strictEqual(
    __test.shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg, intent: "EXIT" }),
    false
  );
  assert.strictEqual(
    __test.shouldBypassLegacyEntryFiltersForV2Discovery({
      liveCfg: { ...liveCfg, v2DiscoveryCanaryBridge: false },
      intent: "ENTRY",
    }),
    false
  );
}

function liveDisabledReasonIsOperatorReadable() {
  const classified = classifySignalReasonStage("LIVE_DISABLED");
  assert.strictEqual(classified.key, "LIVE_CONFIG");
  assert.match(explainSignalReason("LIVE_DISABLED"), /서버 신호는 생성/);
  assert.match(explainSignalReason("V2_DISCOVERY_CANARY_BRIDGE:SYMBOL_NOT_ALLOWED"), /허용 심볼/);
  assert.match(explainSignalReason("V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE"), /productionEntryLiveEndpoint/);
  assert.match(explainSignalReason("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_ENTRY_FILTERS_NOT_RETIRED"), /legacy entry filter/);
}

function main() {
  discoveryBridgeAllowsOnlyApprovedSymbols();
  discoveryBridgeRequiresSafetyEnvelope();
  discoveryBridgeClampsLegacyMaxOrder();
  discoveryBridgeBlocksLegacyEntryWritePath();
  discoveryBridgeMakesLegacyWaitOneBarAdvisoryOnly();
  discoveryBridgeBypassesLegacyEntryFiltersBeforeHandoff();
  liveDisabledReasonIsOperatorReadable();
  console.log("V2_DISCOVERY_LIVE_BRIDGE_TEST_OK");
}

main();
