"use strict";

// 2026-04-29 — V2 direct exit alert dispatch (α + β).
//
// Problem: under DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1 the V1
// `processIntent → dispatchTradeExecutionAlert` path is dead. The only
// remaining alert source was fillSync, which polls every 3 minutes —
// operators stopped seeing SL/TP1/TRAIL fill alerts for whole minutes,
// or missed them entirely when fillSync's classifier mapped the fill
// to "external close".
//
// Fix: emit `sendTradeExecutionAlert` at two new points inside
// binanceTickExit:
//   α) immediately after a V2 direct exit dispatch place succeeds
//      (we know what we just sent + which fraction)
//   β) when R2's broker truth pre-filter sees the broker is already
//      flat for a position the local read view still calls ACTIVE
//      (almost always a native STOP/TP fill fillSync hasn't seen yet)
//
// A dedupe Map (10 min TTL) keys (symbol, event, idempotency-or-bar)
// so fillSync's later echo for the same fill never produces a second
// operator alert.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const tickExitSrc = fs.readFileSync(
  path.join(__dirname, "..", "services", "binanceTickExit.js"),
  "utf8"
);

// (A) sendTradeExecutionAlert is imported and helpers are declared.
(function testStructuralAnchors() {
  assert.ok(
    /require\(["']\.\/tradeExecutionAlert["']\)/.test(tickExitSrc),
    "(A1) tradeExecutionAlert module must be required"
  );
  assert.ok(
    /sendTradeExecutionAlert/.test(tickExitSrc),
    "(A2) sendTradeExecutionAlert must be referenced"
  );
  assert.ok(
    /function\s+resolveV2DirectDispatchAlertEvent\s*\(/.test(tickExitSrc),
    "(A3) resolveV2DirectDispatchAlertEvent helper must exist"
  );
  assert.ok(
    /function\s+resolveBrokerFlatAlertEvent\s*\(/.test(tickExitSrc),
    "(A4) resolveBrokerFlatAlertEvent helper must exist"
  );
  assert.ok(
    /function\s+buildTradeExecutionAlertDedupeKey\s*\(/.test(tickExitSrc),
    "(A5) buildTradeExecutionAlertDedupeKey helper must exist"
  );
  assert.ok(
    /function\s+shouldDispatchTradeExecutionAlert\s*\(/.test(tickExitSrc),
    "(A6) shouldDispatchTradeExecutionAlert helper must exist"
  );
})();

// (B) Place-success alert site (α) sits inside the place-success
//     branch and runs sendTradeExecutionAlert with canonical exit
//     metadata.
(function testPlaceSuccessAlertSiteShape() {
  const placedLogIdx = tickExitSrc.indexOf("structuredLog(\"v2_direct_exit_dispatch_placed\"");
  assert.ok(placedLogIdx > 0, "(B1) v2_direct_exit_dispatch_placed log site missing");
  const before = tickExitSrc.slice(Math.max(0, placedLogIdx - 5000), placedLogIdx);
  assert.ok(
    /resolveV2DirectDispatchAlertEvent\(/.test(before),
    "(B2) place-success branch must call resolveV2DirectDispatchAlertEvent"
  );
  assert.ok(
    /shouldDispatchTradeExecutionAlert\(/.test(before),
    "(B3) place-success branch must dedupe via shouldDispatchTradeExecutionAlert"
  );
  assert.ok(
    /sendTradeExecutionAlert\(/.test(before),
    "(B4) place-success branch must call sendTradeExecutionAlert"
  );
  assert.ok(
    /canonicalExitEvent/.test(before),
    "(B5) place-success alert must stamp canonicalExitEvent"
  );
})();

// (C) Broker-flat alert site (β) sits inside the R2 pre-filter
//     skip branch and runs sendTradeExecutionAlert.
(function testBrokerFlatAlertSiteShape() {
  const skipLogIdx = tickExitSrc.indexOf("structuredLog(\"tick_exit_skip_broker_flat\"");
  assert.ok(skipLogIdx > 0, "(C1) tick_exit_skip_broker_flat log site missing");
  const region = tickExitSrc.slice(skipLogIdx, skipLogIdx + 5000);
  assert.ok(
    /resolveBrokerFlatAlertEvent\(/.test(region),
    "(C2) broker-flat branch must call resolveBrokerFlatAlertEvent"
  );
  assert.ok(
    /shouldDispatchTradeExecutionAlert\(/.test(region),
    "(C3) broker-flat branch must dedupe via shouldDispatchTradeExecutionAlert"
  );
  assert.ok(
    /sendTradeExecutionAlert\(/.test(region),
    "(C4) broker-flat branch must call sendTradeExecutionAlert"
  );
  // Per the issue this fixes (operator-reported missing alerts), the
  // broker-flat branch must run BEFORE `continue;` so each broker-flat
  // observation produces an alert.
  const continueIdx = region.indexOf("continue;");
  const sendIdx = region.indexOf("sendTradeExecutionAlert(");
  assert.ok(sendIdx > 0 && sendIdx < continueIdx, "(C5) sendTradeExecutionAlert must run before continue");
})();

// (D) Runtime: resolveV2DirectDispatchAlertEvent maps trigger kinds
//     and fractions correctly.
(function testResolveDispatchAlertEvent() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const f = __test.resolveV2DirectDispatchAlertEvent;

  const trail = f({ triggeredKinds: ["TRAIL"], fraction: 1 });
  assert.strictEqual(trail.event, "EXIT_TRAIL_100P", "(D1) TRAIL fraction=1 → EXIT_TRAIL_100P");
  assert.strictEqual(trail.stage, "TRAIL");
  assert.strictEqual(trail.transitionEvent, "TRAIL_FIRED");

  const tp1 = f({ triggeredKinds: ["TP_P1"], fraction: 0.5 });
  assert.strictEqual(tp1.event, "EXIT_TP_P1_50P", "(D2) TP_P1 fraction=0.5 → EXIT_TP_P1_50P");
  assert.strictEqual(tp1.stage, "TP1");
  assert.strictEqual(tp1.transitionEvent, "TP1_REACHED");

  const sl = f({ triggeredKinds: ["SL"], fraction: 1 });
  assert.strictEqual(sl.event, "EXIT_SL_100P", "(D3) SL fraction=1 → EXIT_SL_100P");
  assert.strictEqual(sl.stage, "SL");
  assert.strictEqual(sl.transitionEvent, "SL_FIRED");

  const be = f({ triggeredKinds: ["BE"], fraction: 1 });
  assert.strictEqual(be.event, "EXIT_TP_P1_100P", "(D4) BE counts as TP1 stage");

  const generic = f({ triggeredKinds: [], fraction: 1 });
  assert.ok(generic.event && generic.event.startsWith("EXIT_GENERIC"), "(D5) unknown trigger → EXIT_GENERIC");
})();

// (E) Runtime: resolveBrokerFlatAlertEvent disambiguates by meta.
(function testResolveBrokerFlatAlertEvent() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const f = __test.resolveBrokerFlatAlertEvent;

  assert.strictEqual(
    f({ posMeta: { trail_active: true } }).event,
    "EXIT_TRAIL_100P",
    "(E1) trail_active=true → EXIT_TRAIL_100P"
  );
  assert.strictEqual(
    f({ posMeta: { tp_p1_done: true, trail_active: false } }).event,
    "EXIT_TP_P1_100P",
    "(E2) tp_p1_done=true, no trail → EXIT_TP_P1_100P"
  );
  assert.strictEqual(
    f({ posMeta: {} }).event,
    "EXIT_SL_100P",
    "(E3) no tp1, no trail → EXIT_SL_100P (default native STOP)"
  );
  assert.strictEqual(
    f({}).event,
    "EXIT_SL_100P",
    "(E4) no meta at all → EXIT_SL_100P"
  );
})();

// (F) Runtime: dedupe lifecycle.
(function testDedupeLifecycle() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const {
    buildTradeExecutionAlertDedupeKey,
    shouldDispatchTradeExecutionAlert,
    recordTradeExecutionAlertSent,
    clearTradeExecutionAlertDedupeForTest,
    TRADE_EXECUTION_ALERT_DEDUPE_TTL_MS,
  } = __test;

  clearTradeExecutionAlertDedupeForTest();

  const k1 = buildTradeExecutionAlertDedupeKey({
    symbol: "DOGEUSDT",
    event: "EXIT_TRAIL_100P",
    idempotencyKey: "RUN__BINANCEFUT__DOGEUSDT__TICK_EXIT__1700000000000__abcd",
  });
  const k1Lower = buildTradeExecutionAlertDedupeKey({
    symbol: "dogeusdt",
    event: "exit_trail_100p",
    idempotencyKey: "RUN__BINANCEFUT__DOGEUSDT__TICK_EXIT__1700000000000__abcd",
  });
  assert.strictEqual(k1, k1Lower, "(F1) dedupe keys are case-insensitive on symbol+event");

  const k2 = buildTradeExecutionAlertDedupeKey({
    symbol: "LINKUSDT",
    event: "EXIT_TRAIL_100P",
    idempotencyKey: "different",
  });
  assert.notStrictEqual(k1, k2, "(F2) different idempotency or symbol → different key");

  // Initially no entry → may dispatch.
  assert.strictEqual(shouldDispatchTradeExecutionAlert(k1), true, "(F3) fresh key allows dispatch");

  // Record sent → should NOT dispatch within TTL.
  recordTradeExecutionAlertSent(k1, 1_000_000);
  assert.strictEqual(
    shouldDispatchTradeExecutionAlert(k1, 1_000_000 + TRADE_EXECUTION_ALERT_DEDUPE_TTL_MS - 1),
    false,
    "(F4) within TTL must not re-dispatch"
  );

  // After TTL → may dispatch (and entry is GC'd on read).
  assert.strictEqual(
    shouldDispatchTradeExecutionAlert(k1, 1_000_000 + TRADE_EXECUTION_ALERT_DEDUPE_TTL_MS + 1),
    true,
    "(F5) past TTL must allow dispatch again"
  );

  // Empty key is a no-op (don't blow up).
  assert.strictEqual(shouldDispatchTradeExecutionAlert(""), true, "(F6) empty key allows dispatch");

  // Fallback bar bucket: same minute = same key, next minute = new key.
  const minute = 60 * 1000;
  const baseMs = 1_700_000_000_000;
  const kBar1 = buildTradeExecutionAlertDedupeKey({
    symbol: "BTCUSDT",
    event: "EXIT_TRAIL_100P",
    fallbackBucketMs: baseMs,
  });
  const kBar1b = buildTradeExecutionAlertDedupeKey({
    symbol: "BTCUSDT",
    event: "EXIT_TRAIL_100P",
    fallbackBucketMs: baseMs + 30 * 1000,
  });
  const kBar2 = buildTradeExecutionAlertDedupeKey({
    symbol: "BTCUSDT",
    event: "EXIT_TRAIL_100P",
    fallbackBucketMs: baseMs + minute + 1,
  });
  assert.strictEqual(kBar1, kBar1b, "(F7) same-minute fallback bucket keys are equal");
  assert.notStrictEqual(kBar1, kBar2, "(F8) next-minute fallback bucket key is different");

  clearTradeExecutionAlertDedupeForTest();
})();

console.log("V2_DIRECT_EXIT_ALERT_DISPATCH_TEST_OK");
