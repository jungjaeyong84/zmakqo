"use strict";

const assert = require("assert");
const {
  V2_STRATEGY_FILTERS,
  V2_HARD_GUARDS,
} = require("../v2/constants");
const { evaluateHtfDirectionAlignment } = require("../v2/singleStrategyFilter");

(function onlyOneStrategyFilterExists() {
  assert.deepStrictEqual(V2_STRATEGY_FILTERS, ["HTF_DIRECTION_ALIGNMENT"]);
  assert.deepStrictEqual(V2_HARD_GUARDS, [
    "BUDGET_MIN_ORDER",
    "ENTRY_LINEAGE_REQUIRED",
    "EXCHANGE_PROTECTION_HEALTH",
  ]);
})();

(function alignedDirectionPasses() {
  const result = evaluateHtfDirectionAlignment({
    signalSide: "LONG",
    htfDirection: "LONG",
    htfConfidence: 0.72,
    minConfidence: 0.6,
  });
  assert.strictEqual(result.verdict, "PASS");
  assert.strictEqual(result.reason, "HTF_DIRECTION_CONFIRMED");
  assert.strictEqual("chosen_stop_price" in result, false);
  assert.strictEqual("runner_remaining_qty_abs" in result, false);
})();

(function oppositeDirectionBlocks() {
  const result = evaluateHtfDirectionAlignment({
    signalSide: "SHORT",
    htfDirection: "LONG",
    htfConfidence: 0.84,
    minConfidence: 0.6,
  });
  assert.strictEqual(result.verdict, "BLOCK");
  assert.strictEqual(result.reason, "HTF_DIRECTION_MISMATCH");
})();

(function neutralDirectionBlocks() {
  const result = evaluateHtfDirectionAlignment({
    signalSide: "LONG",
    htfDirection: "NEUTRAL",
    htfConfidence: 0.91,
    minConfidence: 0.6,
  });
  assert.strictEqual(result.verdict, "BLOCK");
  assert.strictEqual(result.reason, "HTF_DIRECTION_NEUTRAL");
})();

(function lowConfidenceBlocks() {
  const result = evaluateHtfDirectionAlignment({
    signalSide: "SHORT",
    htfDirection: "SHORT",
    htfConfidence: 0.52,
    minConfidence: 0.6,
  });
  assert.strictEqual(result.verdict, "BLOCK");
  assert.strictEqual(result.reason, "HTF_CONFIDENCE_TOO_LOW");
})();

(function shadowModeDoesNotPromoteToPass() {
  const result = evaluateHtfDirectionAlignment({
    signalSide: "LONG",
    htfDirection: "SHORT",
    htfConfidence: 0.81,
    minConfidence: 0.6,
    decisionMode: "SHADOW",
  });
  assert.strictEqual(result.verdict, "SHADOW");
  assert.strictEqual(result.reason, "HTF_DIRECTION_MISMATCH");
})();

console.log("V2_SINGLE_STRATEGY_FILTER_TEST_OK");
