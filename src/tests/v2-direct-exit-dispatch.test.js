"use strict";

// 2026-04-29 Stage U-followup-1 (option A) unit test.
//
// Covers buildV2DirectExitDispatch — the pure decision helper that
// turns triggered fast-lane kinds into a placeFuturesMarketOrder
// payload (or a clear "no dispatch" reason).

const assert = require("assert");
const {
  buildV2DirectExitDispatch,
  __test,
} = require("../services/v2DirectExitDispatch");

// (A) helpers
(function testCloseSide() {
  assert.strictEqual(__test.resolveCloseSide("LONG"), "SELL");
  assert.strictEqual(__test.resolveCloseSide("SHORT"), "BUY");
  assert.strictEqual(__test.resolveCloseSide("long"), "SELL");
  assert.strictEqual(__test.resolveCloseSide(""), null);
  assert.strictEqual(__test.resolveCloseSide(null), null);
})();

(function testCloseFraction() {
  assert.deepStrictEqual(__test.resolveCloseFraction(["SL"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["TRAIL"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["BE"]), { fraction: 0, reason: "BE_NATIVE_STOP_MANAGEMENT_ONLY" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["TP_P1"]), { fraction: 1.0, reason: "FULL_CLOSE_TP1" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["TP_C"]), { fraction: 1.0, reason: "FULL_CLOSE_TP1" });
  // Both fire — full close (safer)
  assert.deepStrictEqual(__test.resolveCloseFraction(["TP_P1", "SL"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["BE", "TRAIL"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL" });
  assert.deepStrictEqual(__test.resolveCloseFraction([]), { fraction: 0, reason: "NO_ACTIONABLE_TRIGGER" });
})();

(function testStepRound() {
  assert.strictEqual(__test.roundQtyToStep(0.123456, 0.001), 0.123);
  assert.strictEqual(__test.roundQtyToStep(0.123456, 0.01), 0.12);
  assert.strictEqual(__test.roundQtyToStep(1.5, 0.5), 1.5);
  assert.strictEqual(__test.roundQtyToStep(0.0001, 0.001), 0);
  assert.strictEqual(__test.roundQtyToStep(0.5, 0), 0.5, "step=0 disables rounding");
  assert.strictEqual(__test.roundQtyToStep(0.5, null), 0.5, "step=null disables rounding");
  assert.strictEqual(__test.roundQtyToStep(0, 0.001), 0);
  assert.strictEqual(__test.roundQtyToStep(NaN, 0.001), 0);
})();

(function testIdempotencyKey() {
  const k1 = __test.buildIdempotencyKey({ symbol: "BTCUSDT", runId: "RUN_1", triggeredKinds: ["TP_P1"] });
  const k2 = __test.buildIdempotencyKey({ symbol: "BTCUSDT", runId: "RUN_1", triggeredKinds: ["TP_P1"] });
  const k3 = __test.buildIdempotencyKey({ symbol: "BTCUSDT", runId: "RUN_2", triggeredKinds: ["TP_P1"] });
  const kSorted = __test.buildIdempotencyKey({ symbol: "BTCUSDT", runId: "RUN_1", triggeredKinds: ["TRAIL", "SL"] });
  assert.strictEqual(k1, k2, "same inputs → same key");
  assert.notStrictEqual(k1, k3, "different runId → different key");
  assert.ok(kSorted.endsWith("__SL_TRAIL"), "kinds are sorted in the key");
})();

// (B) buildV2DirectExitDispatch — happy paths
(function testFullCloseSL() {
  const out = buildV2DirectExitDispatch({
    triggeredKinds: ["SL"],
    positionSide: "LONG",
    positionQtyBase: 0.5,
    symbol: "BTCUSDT",
    runId: "RUN_X",
    stepSize: 0.001,
  });
  assert.strictEqual(out.dispatch, true);
  assert.strictEqual(out.closeSide, "SELL");
  assert.strictEqual(out.fraction, 1.0);
  assert.strictEqual(out.qty, 0.5);
  assert.strictEqual(out.symbol, "BTCUSDT");
  assert.deepStrictEqual(out.triggeredKinds, ["SL"]);
  assert.ok(out.idempotencyKey.includes("BTCUSDT"));
})();

(function testFullCloseTP1() {
  const out = buildV2DirectExitDispatch({
    triggeredKinds: ["TP_P1"],
    positionSide: "SHORT",
    positionQtyBase: 1.0,
    symbol: "ETHUSDT",
    runId: "RUN_Y",
    stepSize: 0.001,
  });
  assert.strictEqual(out.dispatch, true);
  assert.strictEqual(out.closeSide, "BUY");
  assert.strictEqual(out.fraction, 1.0);
  assert.strictEqual(out.qty, 1.0);
})();

(function testRoundDownBelowDustGuard() {
  // V2 full-TP contract closes the whole position. A minQty guard must not
  // silently convert a full TP trigger back into the old 50% partial close.
  // dustRatio < 0.001 means qty is < 0.1% of position which would be dust.
  const out = buildV2DirectExitDispatch({
    triggeredKinds: ["TP_P1"],
    positionSide: "LONG",
    positionQtyBase: 100,
    symbol: "DOGEUSDT",
    runId: "RUN_Z",
    stepSize: 1,
    minQty: 60,
  });
  // qty=100, dustRatio = 1, far above 0.001 → dispatch
  assert.strictEqual(out.dispatch, true);
  assert.strictEqual(out.qty, 100);
})();

// (C) negative paths
(function testInvalidInputs() {
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["SL"], positionSide: "LONG", positionQtyBase: 1 }).dispatch, false, "missing symbol");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["SL"], positionSide: null, positionQtyBase: 1, symbol: "X" }).dispatch, false, "invalid side");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["SL"], positionSide: "LONG", positionQtyBase: 0, symbol: "X" }).dispatch, false, "zero qty");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: [], positionSide: "LONG", positionQtyBase: 1, symbol: "X" }).dispatch, false, "no triggers");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["UNKNOWN"], positionSide: "LONG", positionQtyBase: 1, symbol: "X" }).dispatch, false, "unknown kind");
  const beOnly = buildV2DirectExitDispatch({ triggeredKinds: ["BE"], positionSide: "LONG", positionQtyBase: 1, symbol: "X" });
  assert.strictEqual(beOnly.dispatch, false, "BE alone is native stop management, not direct market close");
  assert.strictEqual(beOnly.reason, "BE_NATIVE_STOP_MANAGEMENT_ONLY");
})();

// (D) determinism
(function testDeterministic() {
  const args = {
    triggeredKinds: ["TP_P1"],
    positionSide: "LONG",
    positionQtyBase: 0.5,
    symbol: "BTCUSDT",
    runId: "RUN_DET",
    stepSize: 0.001,
  };
  const a = buildV2DirectExitDispatch(args);
  const b = buildV2DirectExitDispatch(args);
  assert.deepStrictEqual(a, b, "same inputs → same output");
})();

console.log("V2_DIRECT_EXIT_DISPATCH_TEST_OK");
