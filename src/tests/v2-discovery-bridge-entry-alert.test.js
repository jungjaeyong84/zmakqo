"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bridgeSrc = fs.readFileSync(
  path.join(__dirname, "..", "v2", "discoveryCanaryServerSignalBridge.js"),
  "utf8"
);

(function testStructuralAnchors() {
  assert.ok(
    /require\(["']\.\.\/services\/tradeExecutionAlert["']\)/.test(bridgeSrc),
    "bridge must require sendTradeExecutionAlert"
  );
  assert.ok(/function\s+buildEntryAlertDedupeKey\s*\(/.test(bridgeSrc), "durable dedupe key helper missing");
  assert.ok(/function\s+normalizeHtfDirection\s*\(/.test(bridgeSrc), "normalizeHtfDirection missing");
  assert.ok(/function\s+resolveHtfSeedRegime\s*\(/.test(bridgeSrc), "resolveHtfSeedRegime missing");
  assert.ok(/function\s+resolveEntrySideFromIntent\s*\(/.test(bridgeSrc), "resolveEntrySideFromIntent missing");
})();

(function testAlertSitePlacement() {
  assert.ok(/function\s+maybeDispatchEntryAlert\s*\(/.test(bridgeSrc), "entry alert helper missing");
  const helperIdx = bridgeSrc.indexOf("function maybeDispatchEntryAlert(");
  const helperWin = bridgeSrc.slice(helperIdx, helperIdx + 6000);
  assert.ok(/sendTradeExecutionAlert\(\s*\{[\s\S]{0,3000}intent:\s*"ENTRY"/.test(helperWin), "helper must call sendTradeExecutionAlert with ENTRY intent");
  assert.ok(/tradeAlertDedupeKey:\s*dedupeKey/.test(helperWin), "helper must pass durable tradeAlertDedupeKey");
  assert.ok(/idempotencyKey:\s*dedupeKey/.test(helperWin), "helper must pass idempotencyKey");
  assert.ok(/classifyEntryAlertReachability\s*\(/.test(helperWin), "helper must classify reachability before sending");
  assert.ok(!/shouldDispatchEntryAlert\s*\(/.test(helperWin), "helper must not use process-local dedupe anymore");
})();

(function testRuntimeHelpers() {
  delete require.cache[require.resolve("../v2/discoveryCanaryServerSignalBridge")];
  const { __test } = require("../v2/discoveryCanaryServerSignalBridge");
  const {
    buildEntryAlertDedupeKey,
    normalizeHtfDirection,
    resolveHtfSeedRegime,
    resolveEntrySideFromIntent,
  } = __test;

  const k1 = buildEntryAlertDedupeKey({ symbol: "XRPUSDT", signalId: "SIG__BTC__15m__1700__LONG" });
  const k1Lower = buildEntryAlertDedupeKey({ symbol: "xrpusdt", signalId: "SIG__BTC__15m__1700__LONG" });
  assert.strictEqual(k1, k1Lower, "dedupe key must be case-insensitive on symbol");
  assert.notStrictEqual(k1, buildEntryAlertDedupeKey({ symbol: "XRPUSDT", signalId: "SIG__OTHER" }));
  assert.ok(buildEntryAlertDedupeKey({ symbol: "XRPUSDT", intentId: "INTENT_42" }).includes("INTENT_42"));

  assert.strictEqual(normalizeHtfDirection("BULL"), "LONG");
  assert.strictEqual(normalizeHtfDirection("BEAR"), "SHORT");
  assert.strictEqual(normalizeHtfDirection("LONG"), "LONG");
  assert.strictEqual(resolveHtfSeedRegime({ htf_regime: "SHORT" }), "SHORT");
  assert.strictEqual(resolveHtfSeedRegime({ htf_bias: "BULL" }), "LONG");
  assert.strictEqual(resolveHtfSeedRegime({ btc_1h_trend: "LONG" }), "LONG");
  assert.strictEqual(resolveHtfSeedRegime({}), "NEUTRAL");

  assert.strictEqual(resolveEntrySideFromIntent({ side: "long" }), "LONG");
  assert.strictEqual(resolveEntrySideFromIntent({ side: "SHORT" }), "SHORT");
  assert.strictEqual(resolveEntrySideFromIntent({ event: "ENTRY_SIGNAL_LONG" }), "LONG");
  assert.strictEqual(resolveEntrySideFromIntent({ event: "ENTRY_SIGNAL_SHORT" }), "SHORT");
  assert.strictEqual(resolveEntrySideFromIntent({}), null);
})();

(function testReachabilityClassification() {
  delete require.cache[require.resolve("../v2/discoveryCanaryServerSignalBridge")];
  const { __test } = require("../v2/discoveryCanaryServerSignalBridge");
  const f = __test.classifyEntryAlertReachability;

  const ok = f({ ok: true, reason: "V2_DISCOVERY_BRIDGE_EXECUTED", endpoint_result: null });
  assert.strictEqual(ok.reachable, true);
  assert.strictEqual(ok.severity, "INFO");
  assert.strictEqual(ok.post_fill_only, false);

  const postFillCritical = f({
    ok: false,
    reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
    endpoint_result: { reason: "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL" },
  });
  assert.strictEqual(postFillCritical.reachable, true);
  assert.strictEqual(postFillCritical.severity, "CRITICAL");
  assert.strictEqual(postFillCritical.post_fill_only, true);

  const postFillProtected = f({
    ok: false,
    reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
    endpoint_result: { reason: "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED" },
  });
  assert.strictEqual(postFillProtected.reachable, true);
  assert.strictEqual(postFillProtected.severity, "WARN");

  const blockedPreFill = f({
    ok: false,
    reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
    endpoint_result: { reason: "V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE" },
  });
  assert.strictEqual(blockedPreFill.reachable, false);
})();

console.log("V2_DISCOVERY_BRIDGE_ENTRY_ALERT_TEST_OK");
