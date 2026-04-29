"use strict";

// 2026-04-29 — Issue 4: reduceOnly -2022 retry-storm cooldown.
//
// Root cause: after a position closes (V2 direct dispatch fill, native
// STOP fill, or external close), local position state can be stale for
// a few cycles. Each TICK_EXIT cycle in that window dispatches a fresh
// reduceOnly market order; Binance answers `-2022 ReduceOnly Order is
// rejected.` and the loop fires again next tick. Result: dozens of
// duplicate `v2_direct_exit_dispatch_place_fail` warnings per closed
// position.
//
// Fix: when a -2022 reject lands, mark the symbol as "recently
// rejected" for V2_DIRECT_EXIT_REJECT_COOLDOWN_MS (60 s). Subsequent
// fast-lane dispatches skip outright until the cooldown expires. The
// native STOP_MARKET path is unaffected — it owns the actual exit
// safety; this only suppresses wasteful duplicate market orders.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const tickExitSrc = fs.readFileSync(
  path.join(__dirname, "..", "services", "binanceTickExit.js"),
  "utf8"
);

// (A) Cooldown helper definitions exist.
(function testCooldownHelpersDefined() {
  assert.ok(
    /const\s+v2DirectExitRejectCooldownState\s*=\s*new\s+Map\s*\(\s*\)/.test(tickExitSrc),
    "(A1) v2DirectExitRejectCooldownState Map must be declared"
  );
  assert.ok(
    /const\s+V2_DIRECT_EXIT_REJECT_COOLDOWN_MS\s*=\s*60_000/.test(tickExitSrc)
    || /const\s+V2_DIRECT_EXIT_REJECT_COOLDOWN_MS\s*=\s*60000/.test(tickExitSrc),
    "(A2) cooldown duration must be 60s"
  );
  assert.ok(
    /function\s+isReduceOnlyReject\s*\(/.test(tickExitSrc),
    "(A3) isReduceOnlyReject helper must be declared"
  );
  assert.ok(
    /function\s+markV2DirectExitRecentReject\s*\(/.test(tickExitSrc),
    "(A4) markV2DirectExitRecentReject helper must be declared"
  );
  assert.ok(
    /function\s+isV2DirectExitInRejectCooldown\s*\(/.test(tickExitSrc),
    "(A5) isV2DirectExitInRejectCooldown helper must be declared"
  );
})();

// (B) Cooldown skip sits at the V2 direct dispatch entry point and
//     short-circuits before buildV2DirectExitDispatch is called.
(function testCooldownSkipPlacement() {
  const skipIdx = tickExitSrc.indexOf("v2_direct_exit_dispatch_reject_cooldown_skip");
  const buildIdx = tickExitSrc.indexOf("buildV2DirectExitDispatch({");
  assert.ok(skipIdx > 0, "(B1) cooldown skip log site not found");
  assert.ok(buildIdx > 0, "(B2) buildV2DirectExitDispatch call not found");
  assert.ok(
    skipIdx < buildIdx,
    "(B3) cooldown skip must precede the V2 direct dispatch builder call"
  );
})();

// (C) place_fail catch marks the symbol on reduceOnly reject.
(function testRejectMarkInPlaceFailCatch() {
  const fail = tickExitSrc.indexOf("structuredLog(\"v2_direct_exit_dispatch_place_fail\"");
  assert.ok(fail > 0, "(C1) v2_direct_exit_dispatch_place_fail structuredLog call site not found");
  // Find the catch block that wraps it (a window of 1500 chars around
  // the log site is enough for a small catch body).
  const around = tickExitSrc.slice(Math.max(0, fail - 1500), fail + 1500);
  assert.ok(
    /isReduceOnlyReject\s*\(\s*v2DispatchPlaceError\s*\)[\s\S]*markV2DirectExitRecentReject\s*\(\s*symbol\s*\)/.test(around),
    "(C2) place_fail catch must call markV2DirectExitRecentReject(symbol) when isReduceOnlyReject is true"
  );
})();

// (D) Runtime: isReduceOnlyReject parses both forms (numeric -2022 and
//     "ReduceOnly Order is rejected").
(function testIsReduceOnlyRejectRuntime() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const { isReduceOnlyReject } = __test;
  assert.strictEqual(isReduceOnlyReject(""), false, "(D1) empty string is not a reject");
  assert.strictEqual(isReduceOnlyReject(null), false, "(D2) null is not a reject");
  assert.strictEqual(
    isReduceOnlyReject("APIError: code=-2022, msg=ReduceOnly Order is rejected."),
    true,
    "(D3) typical Binance error string must match"
  );
  assert.strictEqual(
    isReduceOnlyReject("ReduceOnly Order is rejected"),
    true,
    "(D4) bare 'ReduceOnly Order is rejected' must match (case-insensitive variant covered by regex)"
  );
  assert.strictEqual(
    isReduceOnlyReject("APIError: code=-1234, msg=Some other error"),
    false,
    "(D5) unrelated APIError must not match"
  );
})();

// (E) Runtime: cooldown lifecycle.
(function testCooldownLifecycleRuntime() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const {
    markV2DirectExitRecentReject,
    isV2DirectExitInRejectCooldown,
    _v2DirectExitRejectCooldownState,
    V2_DIRECT_EXIT_REJECT_COOLDOWN_MS,
  } = __test;

  _v2DirectExitRejectCooldownState.clear();

  assert.strictEqual(
    isV2DirectExitInRejectCooldown("DOGEUSDT"),
    false,
    "(E1) fresh symbol must not be in cooldown"
  );

  markV2DirectExitRecentReject("DOGEUSDT");
  assert.strictEqual(
    isV2DirectExitInRejectCooldown("DOGEUSDT"),
    true,
    "(E2) immediately after mark, symbol must be in cooldown"
  );
  assert.strictEqual(
    isV2DirectExitInRejectCooldown("dogeusdt"),
    true,
    "(E3) cooldown must be case-insensitive (uppercase canonicalisation)"
  );
  assert.strictEqual(
    isV2DirectExitInRejectCooldown("LINKUSDT"),
    false,
    "(E4) cooldown must be per-symbol (LINK must not inherit DOGE's cooldown)"
  );

  // Just before expiry — still in cooldown.
  const justBeforeExpiry = Date.now() + V2_DIRECT_EXIT_REJECT_COOLDOWN_MS - 1;
  assert.strictEqual(
    isV2DirectExitInRejectCooldown("DOGEUSDT", justBeforeExpiry),
    true,
    "(E5) cooldown must remain active just before expiry"
  );

  // After expiry — cooldown lifted, and the entry is GC'd.
  const afterExpiry = Date.now() + V2_DIRECT_EXIT_REJECT_COOLDOWN_MS + 1;
  assert.strictEqual(
    isV2DirectExitInRejectCooldown("DOGEUSDT", afterExpiry),
    false,
    "(E6) cooldown must lift after V2_DIRECT_EXIT_REJECT_COOLDOWN_MS"
  );
  assert.strictEqual(
    _v2DirectExitRejectCooldownState.has("DOGEUSDT"),
    false,
    "(E7) expired entries must be GC'd from the Map on read"
  );

  _v2DirectExitRejectCooldownState.clear();
})();

console.log("V2_DIRECT_EXIT_REJECT_COOLDOWN_TEST_OK");
