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
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "SOLUSDT:15|XRPUSDT:15",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "5",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "UNLIMITED",
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
  assert.strictEqual(pass.max_notional_quote, 15);

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

  const tooManyPositions = __test.evaluateV2DiscoveryCanaryLiveBridge({
    env: buildEnv({ DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "6" }),
    symbol: "XRPUSDT",
    executionMode: "LIVE",
  });
  assert.strictEqual(tooManyPositions.ok, false);
  assert.ok(tooManyPositions.blockers.includes("V2_DISCOVERY_CANARY_BRIDGE:MAX_POSITION_COUNT_EXCEEDS_5"));
}

function discoveryBridgeClampsLegacyMaxOrder() {
  const bridge = __test.evaluateV2DiscoveryCanaryLiveBridge({
    env: buildEnv({ DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "25" }),
    symbol: "XRPUSDT",
    executionMode: "LIVE",
  });
  assert.strictEqual(bridge.ok, true);
  assert.strictEqual(__test.clampDiscoveryCanaryMaxOrderQuote(0, bridge), 15);
  assert.strictEqual(__test.clampDiscoveryCanaryMaxOrderQuote(100, bridge), 15);
  assert.strictEqual(__test.clampDiscoveryCanaryMaxOrderQuote(8, bridge), 8);
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

function discoveryHandoffBlockReasonKeepsNestedRouteCause() {
  const handoff = {
    reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
    endpoint_result: {
      ok: false,
      reason: "V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED",
      route_result: {
        ok: false,
        reason: "V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE",
        routedDecision: {
          ok: false,
          reason: "SIGNAL_CRITERIA_BLOCKED",
          detail: { blockers: ["SIGNAL_CRITERIA:TRIGGER_MISSING"] },
        },
      },
      discovery_canary_contract: {
        ok: true,
        reason: "V2_DISCOVERY_CANARY_CONTRACT_PASS",
        blockers: [],
      },
    },
  };
  assert.strictEqual(
    __test.deriveV2DiscoveryHandoffBlockReason(handoff),
    "SIGNAL_CRITERIA_BLOCKED"
  );
  const patch = __test.buildV2DiscoveryHandoffFeaturePatch(handoff);
  assert.strictEqual(patch.v2_discovery_endpoint_reason, "V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED");
  assert.strictEqual(patch.v2_discovery_route_reason, "V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE");
  assert.strictEqual(patch.v2_discovery_router_reason, "SIGNAL_CRITERIA_BLOCKED");
  assert.deepStrictEqual(patch.v2_discovery_router_blockers, ["SIGNAL_CRITERIA:TRIGGER_MISSING"]);
}

function discoveryHandoffBlockReasonKeepsMarketDataCause() {
  const handoff = {
    reason: "V2_DISCOVERY_BRIDGE_MARKET_DATA_QUALITY_BLOCKED",
    marketDataQuality: {
      ok: false,
      reason: "V2_MARKET_DATA_QUALITY_BLOCKED",
      blockers: ["MARKET_DATA:STALE_CANDLE"],
    },
  };
  assert.strictEqual(
    __test.deriveV2DiscoveryHandoffBlockReason(handoff),
    "MARKET_DATA:STALE_CANDLE"
  );
  const patch = __test.buildV2DiscoveryHandoffFeaturePatch(handoff);
  assert.strictEqual(patch.v2_discovery_market_data_quality_reason, "V2_MARKET_DATA_QUALITY_BLOCKED");
  assert.deepStrictEqual(patch.v2_discovery_market_data_quality_blockers, ["MARKET_DATA:STALE_CANDLE"]);
}

function liveDisabledReasonIsOperatorReadable() {
  const classified = classifySignalReasonStage("LIVE_DISABLED");
  assert.strictEqual(classified.key, "LIVE_CONFIG");
  assert.strictEqual(classifySignalReasonStage("V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED").key, "LIVE_CONFIG");
  assert.strictEqual(classifySignalReasonStage("MARKET_DATA:STALE_CANDLE").key, "MARKET_DATA");
  assert.match(explainSignalReason("LIVE_DISABLED"), /서버 신호는 생성/);
  assert.match(explainSignalReason("V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED"), /route/);
  assert.match(explainSignalReason("MARKET_DATA:STALE_CANDLE"), /stale candle/);
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
  discoveryHandoffBlockReasonKeepsNestedRouteCause();
  discoveryHandoffBlockReasonKeepsMarketDataCause();
  liveDisabledReasonIsOperatorReadable();
  console.log("V2_DISCOVERY_LIVE_BRIDGE_TEST_OK");
}

main();
