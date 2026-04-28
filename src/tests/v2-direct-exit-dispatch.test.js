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
  assert.deepStrictEqual(__test.resolveCloseFraction(["SL"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL_OR_BE" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["TRAIL"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL_OR_BE" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["BE"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL_OR_BE" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["TP_P1"]), { fraction: 0.5, reason: "PARTIAL_CLOSE_TP1" });
  assert.deepStrictEqual(__test.resolveCloseFraction(["TP_C"]), { fraction: 0.5, reason: "PARTIAL_CLOSE_TP1" });
  // Both fire — full close (safer)
  assert.deepStrictEqual(__test.resolveCloseFraction(["TP_P1", "SL"]), { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL_OR_BE" });
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

(function testPartialCloseTP1() {
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
  assert.strictEqual(out.fraction, 0.5);
  assert.strictEqual(out.qty, 0.5);
})();

(function testRoundDownBelowDustGuard() {
  // dust fraction 0.001 default, position 100, half = 50, but minQty 60
  // → qty 50 < minQty 60, dustRatio 0.5 (NOT dust) → still dispatch (50)
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
  // qty=50, dustRatio = 50/100 = 0.5, far above 0.001 → dispatch
  assert.strictEqual(out.dispatch, true);
  assert.strictEqual(out.qty, 50);

  // Dust guard: fires when qty < minQty AND qty/position < dustFraction.
  // Construct that case:
  //   position=100000, fraction=0.5 → qty=50000
  //   minQty=60000  (qty < minQty ✓)
  //   minQtyDustFraction=0.6  → 0.5 ratio < 0.6 → skip
  const dust = buildV2DirectExitDispatch({
    triggeredKinds: ["TP_P1"],
    positionSide: "LONG",
    positionQtyBase: 100000,
    symbol: "DOGEUSDT",
    runId: "RUN_DUST",
    stepSize: 1,
    minQty: 60000,
    minQtyDustFraction: 0.6,
  });
  assert.strictEqual(dust.dispatch, false);
  assert.strictEqual(dust.reason, "QTY_BELOW_MIN_QTY_DUST");
})();

// (C) negative paths
(function testInvalidInputs() {
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["SL"], positionSide: "LONG", positionQtyBase: 1 }).dispatch, false, "missing symbol");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["SL"], positionSide: null, positionQtyBase: 1, symbol: "X" }).dispatch, false, "invalid side");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["SL"], positionSide: "LONG", positionQtyBase: 0, symbol: "X" }).dispatch, false, "zero qty");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: [], positionSide: "LONG", positionQtyBase: 1, symbol: "X" }).dispatch, false, "no triggers");
  assert.strictEqual(buildV2DirectExitDispatch({ triggeredKinds: ["UNKNOWN"], positionSide: "LONG", positionQtyBase: 1, symbol: "X" }).dispatch, false, "unknown kind");
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
