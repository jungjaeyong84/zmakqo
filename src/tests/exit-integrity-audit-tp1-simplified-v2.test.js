"use strict";

const assert = require("assert");
const { __test } = require("../services/exitIntegrityAudit");
const { DEFAULT_TP1_TARGET_PCT } = require("../services/simplifiedExitV2");

const { computeExpectedNativeTpPx, computeExpectedNativeStopPx } = __test;

(() => {
  // Baseline: rules.TP_P1 honored when simplifiedExitV2Active is false/omitted.
  // Cohort RESCUE places TP1 at 1.65% — pre-patch behavior.
  const longRescue = computeExpectedNativeTpPx({
    positionSide: "LONG",
    entryPrice: 100,
    leverage: 2,
    rules: { TP_P1: 0.0165 },
  });
  assert.ok(Math.abs(longRescue - 100 * (1 + 0.0165 / 2)) < 1e-9,
    `RESCUE long expected ${100 * (1 + 0.0165 / 2)} got ${longRescue}`);

  // simplifiedExitV2Active=true must override rules.TP_P1 with the policy 1.68%.
  // This is the price the writer actually places — audit must match it or every
  // active V2 position emits NATIVE_TP1_TRIGGER_MISMATCH.
  const longSimpV2 = computeExpectedNativeTpPx({
    positionSide: "LONG",
    entryPrice: 100,
    leverage: 2,
    rules: { TP_P1: 0.0165 },
    simplifiedExitV2Active: true,
  });
  assert.ok(Math.abs(longSimpV2 - 100 * (1 + DEFAULT_TP1_TARGET_PCT / 2)) < 1e-9,
    `simplifiedExitV2 long expected ${100 * (1 + DEFAULT_TP1_TARGET_PCT / 2)} got ${longSimpV2}`);
  assert.notStrictEqual(longSimpV2, longRescue,
    "simplifiedExitV2 path must produce a different price than the RESCUE rules path");

  // SHORT side mirror: simplifiedExitV2 1.68% applied symmetrically.
  const shortSimpV2 = computeExpectedNativeTpPx({
    positionSide: "SHORT",
    entryPrice: 100,
    leverage: 2,
    rules: { TP_P1: 0.0165 },
    simplifiedExitV2Active: true,
  });
  assert.ok(Math.abs(shortSimpV2 - 100 * (1 - DEFAULT_TP1_TARGET_PCT / 2)) < 1e-9);

  // simplifiedExitV2 must work even when rules carry no TP_P1 — the override
  // is policy-driven, not rule-derived.
  const noRulesSimpV2 = computeExpectedNativeTpPx({
    positionSide: "LONG",
    entryPrice: 50,
    leverage: 5,
    rules: null,
    simplifiedExitV2Active: true,
  });
  assert.ok(Math.abs(noRulesSimpV2 - 50 * (1 + DEFAULT_TP1_TARGET_PCT / 5)) < 1e-9);

  // SL path is unchanged — sanity check that we did not break it.
  const slLong = computeExpectedNativeStopPx({
    positionSide: "LONG",
    entryPrice: 100,
    leverage: 2,
    rules: { SL: -0.0165 },
  });
  assert.ok(Math.abs(slLong - 100 * (1 - 0.0165 / 2)) < 1e-9);
})();

console.log("EXIT_INTEGRITY_AUDIT_TP1_SIMPLIFIED_V2_TEST_OK");
