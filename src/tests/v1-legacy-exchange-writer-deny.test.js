"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { __test } = require("../engine/paperBinanceRunner");

function bridgeDenyCoversAnyIntent() {
  const liveCfg = {
    executionMode: "LIVE",
    liveEnabled: true,
    v2DiscoveryCanaryBridge: true,
    v2DiscoveryCanaryConfigured: true,
    legacyV1ExchangeWriterEnabled: false,
  };
  assert.strictEqual(__test.isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent: "ENTRY" }), true);
  assert.strictEqual(__test.isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent: "ADD" }), true);
  assert.strictEqual(__test.isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent: "EXIT" }), true);
}

function legacyRuntimeDisabledCoversBridgeFailure() {
  const liveCfg = {
    executionMode: "LIVE",
    liveEnabled: false,
    v2DiscoveryCanaryBridge: false,
    v2DiscoveryCanaryConfigured: true,
    legacyV1ExchangeWriterEnabled: false,
    legacy_runtime_disabled: true,
  };
  assert.strictEqual(__test.isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent: "EXIT" }), true);
}

function v1FallbackCanStillPassWhenExplicitlyConfiguredOutsideV2Discovery() {
  const liveCfg = {
    executionMode: "LIVE",
    liveEnabled: true,
    v2DiscoveryCanaryBridge: false,
    v2DiscoveryCanaryConfigured: false,
    legacyV1ExchangeWriterEnabled: true,
    legacy_runtime_disabled: false,
  };
  assert.strictEqual(__test.isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent: "ENTRY" }), false);
}

function executeLiveFuturesOrderUsesWriterIdentityGuardBeforeExchangeSubmit() {
  const source = fs.readFileSync(path.resolve(__dirname, "../engine/paperBinanceRunner.js"), "utf8");
  const functionIndex = source.indexOf("async function executeLiveFuturesOrder({");
  const guardIndex = source.indexOf("isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent })", functionIndex);
  const marketSubmitIndex = source.indexOf("order = await placeFuturesMarketOrder({", functionIndex);
  const makerSubmitIndex = source.indexOf("order = await placeFuturesEntryMakerFirst({", functionIndex);
  const reasonIndex = source.indexOf("V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED", functionIndex);
  assert.ok(functionIndex > -1, "executeLiveFuturesOrder source is missing");
  assert.ok(guardIndex > functionIndex, "writer identity guard is missing in executeLiveFuturesOrder");
  assert.ok(reasonIndex > guardIndex, "legacy runtime disabled reason is missing after guard");
  assert.ok(guardIndex < marketSubmitIndex, "writer identity guard must run before market submit");
  assert.ok(guardIndex < makerSubmitIndex, "writer identity guard must run before maker-first submit");
}

function main() {
  bridgeDenyCoversAnyIntent();
  legacyRuntimeDisabledCoversBridgeFailure();
  v1FallbackCanStillPassWhenExplicitlyConfiguredOutsideV2Discovery();
  executeLiveFuturesOrderUsesWriterIdentityGuardBeforeExchangeSubmit();
}

main();
console.log("V1_LEGACY_EXCHANGE_WRITER_DENY_TEST_OK");
