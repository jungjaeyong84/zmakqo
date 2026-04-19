"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// active-position-repair-stop-missing-escalation.test.js
//
// 2026-04-19 ETHUSDT 20-minute blackout fix regression test.
//
// Scenario: the position has an active native STOP gap — either
// `native_protection_refresh_status === "MISSING"` or the projection
// invariant list contains "NATIVE_STOP_MISSING". The repair path
// (`repairActivePositionExitRuntimeState`) must escalate the native
// protection refresh dispatch from `/run` (fire-and-forget self-
// dispatch, vulnerable to Cloud Run CPU throttling once the outer
// response returns) to `/run-execute` (synchronous; the worker holds
// the HTTP connection so Cloud Run keeps the container CPU allocated
// for the full burst) by passing `executeImmediately: true`.
//
// Background: on 2026-04-19 11:15:23Z, ETHUSDT LONG entered with
// only a partial fill (qty=0.864 / 1.0 requested) because the
// market-fallback leg hit `code=-2019 "Margin is insufficient"`.
// The resulting position had no native STOP on the exchange.  The
// 2-minute periodic repair triggers all dispatched via `/run`, and
// the refresh attempts never appeared in logs — 20 minutes elapsed
// before a manual `/run-execute` synchronously placed the stop.
//
// This regression guards:
//   (a) stopMissing-state → `executeImmediately: true`
//   (b) routine (non-missing) → `executeImmediately: false` preserved
//       (BE-raise tick-level refreshes should stay cheap since they
//        re-fire every tick).
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const Module = require("module");

// Stub `triggerExitWorkerRun` so we can observe what
// `requestBinanceNativeProtectionRefresh` forwards without making real
// network calls.  We do this via require-cache injection before
// loading paperBinanceRunner.
const triggerCalls = [];
const stubPath = require.resolve("../services/exitWorkerClient");
require.cache[stubPath] = {
  id: stubPath,
  filename: stubPath,
  loaded: true,
  exports: {
    triggerExitWorkerRun: async (args) => {
      triggerCalls.push(args);
      return { ok: true, dispatched: true };
    },
    __test: {},
  },
};

// Stub `recordExitRepairRequest` so we avoid Firestore writes.
const repairRequestStore = require.resolve("../storage/exitRepairRequests");
require.cache[repairRequestStore] = {
  id: repairRequestStore,
  filename: repairRequestStore,
  loaded: true,
  exports: {
    recordExitRepairRequest: async () => ({ exit_repair_request_id: "TEST_REQ_ID" }),
    __test: {},
  },
};

const { __test } = require("../engine/paperBinanceRunner");

assert.ok(__test, "__test export missing");
assert.strictEqual(
  typeof __test.repairActivePositionExitRuntimeState,
  "function",
  "repairActivePositionExitRuntimeState export missing"
);

const liveCfg = { apiKey: "TEST_KEY", apiSecret: "TEST_SECRET" };

function baseArgs(overrides = {}) {
  return {
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2326.65,
    leverage: 2,
    liveCfg,
    cohort: null,
    posMeta: {
      exit_profile: "BASE",
      exit_profile_reason: "RUNTIME",
      position_side: "LONG",
      ...overrides,
    },
  };
}

(async () => {
  // ── Case A: refresh_status MISSING → escalate ──────────────────────
  triggerCalls.length = 0;
  await __test.repairActivePositionExitRuntimeState(baseArgs({
    native_protection_refresh_status: "MISSING",
    native_protection_refresh_reason: "STOP_ORDER_NOT_FOUND",
  }));
  assert.strictEqual(triggerCalls.length, 1,
    "Case A: triggerExitWorkerRun must be called exactly once");
  const callA = triggerCalls[0];
  assert.strictEqual(callA.dispatchOnly, false,
    "Case A: stopMissing=true must force dispatchOnly=false (/run-execute)");
  assert.strictEqual(callA.timeoutMs, 15000,
    "Case A: executeImmediately=true must lift timeoutMs to 15000");
  assert.deepStrictEqual(callA.targetSymbols, ["ETHUSDT"],
    "Case A: targetSymbols must still scope to the symbol");

  // ── Case B: invariant list contains NATIVE_STOP_MISSING → escalate ─
  triggerCalls.length = 0;
  await __test.repairActivePositionExitRuntimeState(baseArgs({
    native_protection_refresh_status: "OK",
    exchange_projection_invariants: ["NATIVE_STOP_MISSING"],
  }));
  assert.strictEqual(triggerCalls.length, 1,
    "Case B: triggerExitWorkerRun must be called exactly once");
  assert.strictEqual(triggerCalls[0].dispatchOnly, false,
    "Case B: invariant-based missing detection must also escalate");

  // ── Case C: refresh_status FAILED → escalate ───────────────────────
  triggerCalls.length = 0;
  await __test.repairActivePositionExitRuntimeState(baseArgs({
    native_protection_refresh_status: "FAILED",
    native_protection_refresh_reason: "NATIVE_PLACE_FAIL",
  }));
  assert.strictEqual(triggerCalls.length, 1,
    "Case C: FAILED refresh must also escalate (same-class blackout risk)");
  assert.strictEqual(triggerCalls[0].dispatchOnly, false,
    "Case C: FAILED → dispatchOnly=false");

  // ── Case D: routine refresh (no MISSING signal) → NO escalate ──────
  triggerCalls.length = 0;
  await __test.repairActivePositionExitRuntimeState(baseArgs({
    native_protection_refresh_status: "OK",
    exchange_projection_invariants: [],
    native_protection_stop_order_id: "4000001120399692",
  }));
  assert.strictEqual(triggerCalls.length, 1,
    "Case D: triggerExitWorkerRun must still be called for the refresh");
  assert.strictEqual(triggerCalls[0].dispatchOnly, true,
    "Case D: routine refresh must stay on the cheap /run path "
    + "(BE-raise ticks re-fire every cycle; fire-and-forget is fine)");
  assert.strictEqual(triggerCalls[0].timeoutMs, 5000,
    "Case D: routine refresh must keep the 5s dispatch timeout");

  // ── Case E: empty invariants array + no refresh_status → NO escalate
  triggerCalls.length = 0;
  await __test.repairActivePositionExitRuntimeState(baseArgs({
    exchange_projection_invariants: ["TRAIL_WITHOUT_TP1"],
  }));
  assert.strictEqual(triggerCalls.length, 1);
  assert.strictEqual(triggerCalls[0].dispatchOnly, true,
    "Case E: non-stop invariants (e.g. TRAIL_WITHOUT_TP1) must not "
    + "escalate — those are safe for routine retry");

  console.log("ACTIVE_POSITION_REPAIR_STOP_MISSING_ESCALATION_TEST_OK");
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
