const assert = require("assert");
const { resolveContractExitQtyPct } = require("../engine/signalEngine");
const { __test: runnerTest } = require("../engine/paperBinanceRunner");

assert.strictEqual(resolveContractExitQtyPct(1, 0.25), 0.25);
assert.strictEqual(resolveContractExitQtyPct(0.75, 0.5), 0.375);
assert.strictEqual(resolveContractExitQtyPct(0.25, 0.5), 0.125);
assert.strictEqual(resolveContractExitQtyPct(0.5, null), 0.5);
assert.strictEqual(resolveContractExitQtyPct(0, 0.5), 0);

const nativeProtectionAtEntry = runnerTest.computeBinanceNativeProtectionPrices({
  positionSide: "LONG",
  entryPrice: 100,
  leverage: 2,
  rules: {
    SL: -0.0165,
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P1: 0.0165,
    TP_P1_QTY: 0.5,
  },
  posMeta: {},
});
assert.ok(Math.abs(nativeProtectionAtEntry.tpOrderQtyRatio - 0.375) < 1e-9);

const nativeProtectionAfterTp0 = runnerTest.computeBinanceNativeProtectionPrices({
  positionSide: "LONG",
  entryPrice: 100,
  leverage: 2,
  rules: {
    SL: -0.0165,
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P1: 0.0165,
    TP_P1_QTY: 0.5,
  },
  posMeta: {
    tp_p0_done: true,
    tp_p0_qty_ratio: 0.25,
  },
});
assert.ok(Math.abs(nativeProtectionAfterTp0.tpOrderQtyRatio - 0.5) < 1e-9);

assert.deepStrictEqual(
  runnerTest.resolveCanonicalExitAlertBlock({
    canonicalExitStage: "TRAIL",
    canonicalExitLedgerBlockedInvariant: true,
    canonicalExitLedgerIssueCodes: ["RUNNER_REMAINING_ABS_MISMATCH"],
    canonicalTransitionEvents: ["TRAIL_PARTIAL"],
  }),
  {
    blocked: true,
    reason: "CANONICAL_EXIT_LEDGER_BLOCKED",
    issueCodes: ["RUNNER_REMAINING_ABS_MISMATCH"],
  },
);
assert.strictEqual(
  runnerTest.shouldEmitCanonicalExitAlert({
    canonicalExitStage: "TRAIL",
    canonicalExitLedgerBlockedInvariant: true,
    canonicalExitLedgerIssueCodes: ["RUNNER_REMAINING_ABS_MISMATCH"],
    canonicalTransitionEvents: ["TRAIL_PARTIAL"],
  }),
  false,
);
assert.deepStrictEqual(
  runnerTest.resolveCanonicalExitAlertBlock({
    canonicalExitStage: "TP1",
    canonicalTransitionEvents: [],
  }),
  {
    blocked: true,
    reason: "CANONICAL_EXIT_TRANSITION_MISSING",
    issueCodes: [],
  },
);
assert.strictEqual(
  runnerTest.shouldEmitCanonicalExitAlert({
    canonicalExitStage: "TRAIL",
    canonicalTransitionEvents: ["TRAIL_PARTIAL"],
  }),
  true,
);

console.log("TP_QTY_CONTRACT_TEST_OK");
