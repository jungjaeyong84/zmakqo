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

// (B) maybeDispatchEntryAlert helper exists, calls
//     sendTradeExecutionAlert with intent="ENTRY", and is invoked
//     from BOTH the success branch AND the ok=false-but-post-fill-
//     reachable branch (so broker fills with protection failures
//     still alert the operator).
(function testAlertSitePlacement() {
  assert.ok(
    /function\s+maybeDispatchEntryAlert\s*\(/.test(bridgeSrc),
    "(B1) maybeDispatchEntryAlert helper must be declared inside the bridge function"
  );
  // The helper must call sendTradeExecutionAlert with intent="ENTRY".
  const helperIdx = bridgeSrc.indexOf("function maybeDispatchEntryAlert(");
  assert.ok(helperIdx > 0, "(B2) helper anchor missing");
  const helperWin = bridgeSrc.slice(helperIdx, helperIdx + 6000);
  assert.ok(
    /sendTradeExecutionAlert\(\s*\{[\s\S]{0,3000}intent:\s*"ENTRY"/.test(helperWin),
    "(B3) helper must call sendTradeExecutionAlert with intent=\"ENTRY\""
  );
  assert.ok(
    /shouldDispatchEntryAlert\s*\(/.test(helperWin),
    "(B4) helper must dedupe via shouldDispatchEntryAlert"
  );
  assert.ok(
    /classifyEntryAlertReachability\s*\(/.test(helperWin),
    "(B5) helper must call classifyEntryAlertReachability and bail on !reachable"
  );

  // The helper must be invoked from BOTH branches: ok=false (post-fill
  // exposure) AND ok=true (success). Use lastIndexOf to land on the
  // ACTUAL return statements (the reason string also appears inside
  // classifyEntryAlertReachability literals, which is fine — we want
  // the last occurrence which is always the return).
  const blockedReturnIdx = bridgeSrc.lastIndexOf('reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED"');
  assert.ok(blockedReturnIdx > 0, "(B6) blocked-return marker not found");
  const beforeBlocked = bridgeSrc.slice(Math.max(0, blockedReturnIdx - 2000), blockedReturnIdx);
  assert.ok(
    /maybeDispatchEntryAlert\s*\(/.test(beforeBlocked),
    "(B7) maybeDispatchEntryAlert must be invoked before the BLOCKED return so post-fill exposure still alerts"
  );

  const successReturnIdx = bridgeSrc.lastIndexOf('reason: "V2_DISCOVERY_BRIDGE_EXECUTED"');
  assert.ok(successReturnIdx > 0, "(B8) success-return marker not found");
  const beforeSuccess = bridgeSrc.slice(Math.max(0, successReturnIdx - 2000), successReturnIdx);
  assert.ok(
    /maybeDispatchEntryAlert\s*\(/.test(beforeSuccess),
    "(B9) maybeDispatchEntryAlert must be invoked before the SUCCESS return"
  );
})();

// (C) Alert failures must not crash the handoff — helper has both
//     a .catch on the sendTradeExecutionAlert Promise and an outer
//     try/catch (alertGuardErr).
(function testAlertFailureFallthrough() {
  const helperIdx = bridgeSrc.indexOf("function maybeDispatchEntryAlert(");
  const helperWin = bridgeSrc.slice(helperIdx, helperIdx + 6000);
  assert.ok(
    /\.catch\(\(alertErr\)\s*=>/.test(helperWin),
    "(C1) sendTradeExecutionAlert promise must have .catch fallthrough"
  );
  assert.ok(
    /\}\s*catch\s*\(\s*alertGuardErr\s*\)/.test(helperWin),
    "(C2) helper must wrap its body in try/catch (alertGuardErr)"
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

// (E) classifyEntryAlertReachability — broker side reached
//     classification covers the operator-reported DOGE 07:01:31 case.
(function testReachabilityClassification() {
  delete require.cache[require.resolve("../v2/discoveryCanaryServerSignalBridge")];
  const { __test } = require("../v2/discoveryCanaryServerSignalBridge");
  const f = __test.classifyEntryAlertReachability;

  // Clean success.
  const ok = f({ ok: true, reason: "V2_DISCOVERY_BRIDGE_EXECUTED", endpoint_result: null });
  assert.strictEqual(ok.reachable, true, "(E1) success path is reachable");
  assert.strictEqual(ok.severity, "INFO", "(E2) success severity INFO");
  assert.strictEqual(ok.post_fill_only, false, "(E3) success not post-fill-only");

  // Operator-reported DOGE 07:01:31 case — broker filled but protection critical.
  const postFillCritical = f({
    ok: false,
    reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
    endpoint_result: { reason: "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL" },
  });
  assert.strictEqual(postFillCritical.reachable, true,
    "(E4) post-fill-protection-critical MUST be reachable — broker has the position");
  assert.strictEqual(postFillCritical.severity, "CRITICAL", "(E5) severity CRITICAL");
  assert.strictEqual(postFillCritical.post_fill_only, true, "(E6) post-fill-only flag");

  // Post-fill route failure (protected).
  const postFillProtected = f({
    ok: false,
    reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
    endpoint_result: { reason: "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED" },
  });
  assert.strictEqual(postFillProtected.reachable, true,
    "(E7) post-fill-route-failure-protected reachable");
  assert.strictEqual(postFillProtected.severity, "WARN", "(E8) severity WARN (protected)");

  // Pre-fill blocked (no broker exposure) — must NOT alert.
  const blockedPreFill = f({
    ok: false,
    reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
    endpoint_result: { reason: "V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE" },
  });
  assert.strictEqual(blockedPreFill.reachable, false,
    "(E9) pre-fill block (router not executable) MUST NOT trigger entry alert");

  // No endpoint result at all.
  const noEndpoint = f({ ok: false, reason: "V2_DISCOVERY_BRIDGE_LEDGER_PERSIST_BLOCKED" });
  assert.strictEqual(noEndpoint.reachable, false, "(E10) no endpoint result → not reachable");

  // Null/undefined input.
  assert.strictEqual(f(null).reachable, false, "(E11) null input → not reachable");
  assert.strictEqual(f().reachable, false, "(E12) missing input → not reachable");
})();

console.log("V2_DISCOVERY_BRIDGE_ENTRY_ALERT_TEST_OK");
