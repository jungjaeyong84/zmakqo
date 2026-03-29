"use strict";

const assert = require("assert");
const {
  normalizePositionSide,
  sideToPositionDir,
  resolvePositionSide,
  resolvePositionSideFromPosition,
  resolveCloseSide,
} = require("../utils/positionSide");

function run() {
  assert.strictEqual(normalizePositionSide("buy"), "LONG");
  assert.strictEqual(normalizePositionSide("SELL"), "SHORT");
  assert.strictEqual(sideToPositionDir("BUY"), "LONG");
  assert.strictEqual(resolvePositionSide(null, "", "short"), "SHORT");
  assert.strictEqual(
    resolvePositionSideFromPosition(
      { position_side: "", positionSide: null, side: "BUY" },
      { external_side: "SHORT" }
    ),
    "LONG"
  );
  assert.strictEqual(
    resolvePositionSideFromPosition(
      { position_side: null, positionSide: null, side: null },
      { position_side: null, external_side: "SELL", external_position_side: "LONG" }
    ),
    "SHORT"
  );
  assert.strictEqual(resolveCloseSide("SHORT"), "BUY");
  assert.strictEqual(resolveCloseSide("LONG"), "SELL");
  console.log("POSITION_SIDE_TEST_OK");
}

run();
