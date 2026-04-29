"use strict";

// 2026-04-29 — V2 discovery bridge ENTRY α alert.
//
// Operator-reported issue: XRPUSDT entered at 06:31:17 UTC
// (V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED) but no Telegram
// alert ever shipped. The only ENTRY alert path was fillSync's
// 3-min polling → flushFillSyncAlertBatches → sendTradeExecutionAlert.
// When fillSync polling lags (or doesn't run for any reason — V1
// guard removal regression, scheduler tick gap, etc.) the operator
// loses entry visibility entirely.
//
// Fix: emit `sendTradeExecutionAlert` at the place-success boundary
// inside runV2DiscoveryCanaryServerSignalHandoff, mirroring the
// EXIT α/β path in src/services/binanceTickExit.js. dedupe key
// (symbol, ENTRY, signal_id) ensures fillSync's later authoritative
// echo is muted within ENTRY_ALERT_DEDUPE_TTL_MS.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const bridgeSrc = fs.readFileSync(
  path.join(__dirname, "..", "v2", "discoveryCanaryServerSignalBridge.js"),
  "utf8"
);

// (A) Structural: bridge imports sendTradeExecutionAlert and declares
//     dedupe + helpers + entry side resolver.
(function testStructuralAnchors() {
  assert.ok(
    /require\(["']\.\.\/services\/tradeExecutionAlert["']\)/.test(bridgeSrc),
    "(A1) bridge must require sendTradeExecutionAlert"
  );
  assert.ok(
    /const\s+entryAlertDedupeState\s*=\s*new\s+Map\s*\(\s*\)/.test(bridgeSrc),
    "(A2) entryAlertDedupeState Map must be declared"
  );
  assert.ok(
    /ENTRY_ALERT_DEDUPE_TTL_MS/.test(bridgeSrc),
    "(A3) ENTRY_ALERT_DEDUPE_TTL_MS constant must be declared"
  );
  assert.ok(
    /V2_DISCOVERY_BRIDGE_ENTRY_ALERT_DEDUPE_TTL_MS/.test(bridgeSrc),
    "(A4) TTL must be tunable via V2_DISCOVERY_BRIDGE_ENTRY_ALERT_DEDUPE_TTL_MS env"
  );
  assert.ok(
    /function\s+buildEntryAlertDedupeKey\s*\(/.test(bridgeSrc),
    "(A5) buildEntryAlertDedupeKey must be declared"
  );
  assert.ok(
    /function\s+shouldDispatchEntryAlert\s*\(/.test(bridgeSrc),
    "(A6) shouldDispatchEntryAlert must be declared"
  );
  assert.ok(
    /function\s+resolveEntrySideFromIntent\s*\(/.test(bridgeSrc),
    "(A7) resolveEntrySideFromIntent must be declared"
  );
})();

// (B) Alert dispatch is wired into the success branch — between the
//     "blocked" early return and the freezing OK return. Specifically
//     it must call sendTradeExecutionAlert with intent="ENTRY".
(function testAlertSitePlacement() {
  const okReturnIdx = bridgeSrc.indexOf('reason: "V2_DISCOVERY_BRIDGE_EXECUTED"');
  assert.ok(okReturnIdx > 0, "(B1) success-return reason marker not found");
  // Look back ~5000 chars from the OK return; the alert dispatch must
  // sit inside that window.
  const before = bridgeSrc.slice(Math.max(0, okReturnIdx - 5000), okReturnIdx);
  assert.ok(
    /sendTradeExecutionAlert\(\s*\{[\s\S]{0,2000}intent:\s*"ENTRY"/.test(before),
    "(B2) success branch must call sendTradeExecutionAlert with intent=\"ENTRY\" before the OK return"
  );
  assert.ok(
    /shouldDispatchEntryAlert\s*\(/.test(before),
    "(B3) success branch must dedupe via shouldDispatchEntryAlert"
  );
  assert.ok(
    /buildEntryAlertDedupeKey\s*\(/.test(before),
    "(B4) success branch must compute dedupeKey via buildEntryAlertDedupeKey"
  );
})();

// (C) Alert failures must not crash the handoff. Wrap in try/catch +
//     .catch on the returned Promise.
(function testAlertFailureFallthrough() {
  const okReturnIdx = bridgeSrc.indexOf('reason: "V2_DISCOVERY_BRIDGE_EXECUTED"');
  const before = bridgeSrc.slice(Math.max(0, okReturnIdx - 5000), okReturnIdx);
  assert.ok(
    /\.catch\(\(alertErr\)\s*=>/.test(before),
    "(C1) sendTradeExecutionAlert promise must have .catch fallthrough"
  );
  assert.ok(
    /\}\s*catch\s*\(\s*alertGuardErr\s*\)/.test(before),
    "(C2) entire alert dispatch must be wrapped in try/catch (alertGuardErr)"
  );
})();

// (D) Runtime: dedupe lifecycle + side resolver.
(function testRuntimeBehaviour() {
  delete require.cache[require.resolve("../v2/discoveryCanaryServerSignalBridge")];
  const { __test } = require("../v2/discoveryCanaryServerSignalBridge");
  const {
    buildEntryAlertDedupeKey,
    shouldDispatchEntryAlert,
    recordEntryAlertDispatched,
    clearEntryAlertDedupeForTest,
    resolveEntrySideFromIntent,
    ENTRY_ALERT_DEDUPE_TTL_MS,
  } = __test;

  clearEntryAlertDedupeForTest();

  const k1 = buildEntryAlertDedupeKey({ symbol: "XRPUSDT", signalId: "SIG__BTC__15m__1700__LONG" });
  const k1Lower = buildEntryAlertDedupeKey({ symbol: "xrpusdt", signalId: "SIG__BTC__15m__1700__LONG" });
  assert.strictEqual(k1, k1Lower, "(D1) dedupe key is case-insensitive on symbol");

  const k2 = buildEntryAlertDedupeKey({ symbol: "XRPUSDT", signalId: "SIG__OTHER" });
  assert.notStrictEqual(k1, k2, "(D2) different signalId → different key");

  // Fallback to intentId when no signalId.
  const kFallback = buildEntryAlertDedupeKey({ symbol: "XRPUSDT", intentId: "INTENT_42" });
  assert.ok(kFallback.includes("INTENT_42"), "(D3) intentId fallback when signalId missing");

  // Lifecycle.
  assert.strictEqual(shouldDispatchEntryAlert(k1), true, "(D4) fresh key allows dispatch");
  recordEntryAlertDispatched(k1, 1_000_000);
  assert.strictEqual(
    shouldDispatchEntryAlert(k1, 1_000_000 + ENTRY_ALERT_DEDUPE_TTL_MS - 1),
    false,
    "(D5) within TTL must not re-dispatch"
  );
  assert.strictEqual(
    shouldDispatchEntryAlert(k1, 1_000_000 + ENTRY_ALERT_DEDUPE_TTL_MS + 1),
    true,
    "(D6) past TTL must allow dispatch"
  );

  // Side resolver.
  assert.strictEqual(resolveEntrySideFromIntent({ side: "long" }), "LONG", "(D7) explicit side LONG");
  assert.strictEqual(resolveEntrySideFromIntent({ side: "SHORT" }), "SHORT", "(D8) explicit side SHORT");
  assert.strictEqual(
    resolveEntrySideFromIntent({ event: "ENTRY_SIGNAL_LONG" }),
    "LONG",
    "(D9) infer LONG from event name"
  );
  assert.strictEqual(
    resolveEntrySideFromIntent({ event: "ENTRY_SIGNAL_SHORT" }),
    "SHORT",
    "(D10) infer SHORT from event name"
  );
  assert.strictEqual(resolveEntrySideFromIntent({}), null, "(D11) no info → null");

  clearEntryAlertDedupeForTest();
})();

console.log("V2_DISCOVERY_BRIDGE_ENTRY_ALERT_TEST_OK");
