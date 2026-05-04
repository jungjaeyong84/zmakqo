const assert = require("assert");
const { resolveContractExitQtyPct } = require("../engine/signalEngine");
const { __test: runnerTest } = require("../engine/paperBinanceRunner");

assert.strictEqual(resolveContractExitQtyPct(1, 0.25), 0.25);
assert.strictEqual(resolveContractExitQtyPct(0.75, 0.5), 0.5);
assert.strictEqual(resolveContractExitQtyPct(0.25, 0.5), 0.25);
assert.strictEqual(resolveContractExitQtyPct(0.5, null), 0.5);
assert.strictEqual(resolveContractExitQtyPct(0, 0.5), 0);

const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
assert.strictEqual(runnerTest.resolveSimplifiedExitV2PositionFlag({ currentMeta: {} }), true);
process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
assert.strictEqual(runnerTest.resolveSimplifiedExitV2PositionFlag({ currentMeta: {} }), false);
process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
assert.strictEqual(runnerTest.resolveSimplifiedExitV2PositionFlag({ currentMeta: {} }), true);
assert.strictEqual(runnerTest.resolveSimplifiedExitV2PositionFlag({ currentMeta: { simplified_exit_v2_enabled: true } }), true);
if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;

process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
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
assert.strictEqual(nativeProtectionAtEntry.tp0TriggerPx, null);
assert.strictEqual(nativeProtectionAtEntry.tp0OrderQtyRatio, 0);
assert.strictEqual(nativeProtectionAtEntry.tp0QtyRatio, 0);
assert.ok(Math.abs(nativeProtectionAtEntry.tpOrderQtyRatio - 0.5) < 1e-9);

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
assert.strictEqual(nativeProtectionAfterTp0.tp0TriggerPx, null);
assert.strictEqual(nativeProtectionAfterTp0.tp0OrderQtyRatio, 0);
assert.strictEqual(nativeProtectionAfterTp0.tp0QtyRatio, 0);

process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
const nativeProtectionSimplifiedV2 = runnerTest.computeBinanceNativeProtectionPrices({
  positionSide: "LONG",
  entryPrice: 100,
  leverage: 2,
  rules: {
    SL: -0.0165,
    TP_P0: 0.008,
    TP_P0_QTY: 0.9,
    TP_P1: 0.025,
    TP_P1_QTY: 0.5,
  },
  posMeta: {
    simplified_exit_v2_enabled: true,
  },
});
assert.strictEqual(nativeProtectionSimplifiedV2.tp0TriggerPx, null);
assert.strictEqual(nativeProtectionSimplifiedV2.tp0OrderQtyRatio, 0);
assert.strictEqual(nativeProtectionSimplifiedV2.tp0QtyRatio, 0);
assert.ok(Math.abs(nativeProtectionSimplifiedV2.tpOrderQtyRatio - 0.5) < 1e-9);

const legacyTp0ContractPayload = runnerTest.buildExitOrderContractRecordPayload({
  kind: "TP0",
  rules: {
    TP_P0: 0.008,
  },
  posMeta: {},
  symbol: "ETHUSDT",
});
assert.strictEqual(legacyTp0ContractPayload, null);

const simplifiedV2Tp0ContractPayload = runnerTest.buildExitOrderContractRecordPayload({
  kind: "TP0",
  rules: {
    TP_P0: 0.008,
  },
  posMeta: {
    simplified_exit_v2_enabled: true,
  },
  symbol: "ETHUSDT",
});
assert.strictEqual(simplifiedV2Tp0ContractPayload, null);

const simplifiedV2Tp1ContractPayload = runnerTest.buildExitOrderContractRecordPayload({
  kind: "TP1",
  rules: {
    TP_P1: 0.025,
  },
  posMeta: {
    simplified_exit_v2_enabled: true,
  },
  symbol: "ETHUSDT",
});
assert.strictEqual(simplifiedV2Tp1ContractPayload.stage, "TP1");
assert.strictEqual(simplifiedV2Tp1ContractPayload.event, "EXIT_TP_P1_2.5P");

const fullTpOnlyContractPayload = runnerTest.buildExitOrderContractRecordPayload({
  kind: "TP1",
  rules: {
    TP_P1: 0.025,
    TP_P1_QTY: 1,
    exit_contract_mode: "TP_FULL_ONLY",
  },
  posMeta: {
    simplified_exit_v2_enabled: true,
    exit_contract_mode: "TP_FULL_ONLY",
  },
  symbol: "ETHUSDT",
});
assert.strictEqual(fullTpOnlyContractPayload.stage, "TP1");
assert.strictEqual(fullTpOnlyContractPayload.event, "EXIT_TP_FULL_2.5P");

if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;

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
