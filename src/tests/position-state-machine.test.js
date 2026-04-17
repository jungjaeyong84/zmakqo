"use strict";

const assert = require("assert");
const {
  validatePositionSnapshotTransition,
  resolveCanonicalExitAuthorityDecision,
  resolveCanonicalExitTransitionEvents,
  resolveCanonicalAlertExitStage,
  resolveCanonicalPositionExitStage,
  resolveCanonicalExitStageFromCycleEvidence,
  resolveCanonicalExitWritePayload,
  buildExitQuantityContractLedger,
  validateExitQuantityContractLedger,
} = require("../services/positionStateMachine");

function run() {
  const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const valid = validatePositionSnapshotTransition({
    prev: {
      state: "COMMIT",
      position_state: "COMMIT",
      size_pct: 1,
      qty_base: 2,
      meta: { tp_p1_done: false, trail_active: false },
    },
    next: {
      state: "ACTIVE",
      position_state: "SCALE_OUT",
      size_pct: 0.49,
      qty_base: 0.98,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
  });
  assert.strictEqual(valid.ok, true);
  assert.deepStrictEqual(valid.issues, []);

  const invalid = validatePositionSnapshotTransition({
    prev: {
      state: "ACTIVE",
      position_state: "COMMIT",
      size_pct: 1,
      qty_base: 1,
      meta: { tp_p1_done: false, trail_active: false },
    },
    next: {
      state: "ACTIVE",
      position_state: "COMMIT",
      size_pct: 0.5,
      qty_base: 0.5,
      meta: { tp_p1_done: false, trail_active: true },
    },
  });
  assert.strictEqual(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => issue.code === "TRAIL_WITHOUT_TP1"));

  const invalidTp1WithoutTp0 = validatePositionSnapshotTransition({
    prev: {
      state: "ACTIVE",
      position_state: "COMMIT",
      size_pct: 1,
      qty_base: 1,
      meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false },
    },
    next: {
      state: "ACTIVE",
      position_state: "SCALE_OUT",
      size_pct: 0.5,
      qty_base: 0.5,
      meta: { tp_p0_done: false, tp_p1_done: true, trail_active: true },
    },
  });
  assert.strictEqual(invalidTp1WithoutTp0.ok, false);
  assert.ok(invalidTp1WithoutTp0.issues.some((issue) => issue.code === "TP1_WITHOUT_TP0"));

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const validSimplifiedV2Tp1WithoutTp0 = validatePositionSnapshotTransition({
    prev: {
      state: "ACTIVE",
      position_state: "COMMIT",
      size_pct: 1,
      qty_base: 1,
      meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false, simplified_exit_v2_enabled: true },
    },
    next: {
      state: "ACTIVE",
      position_state: "SCALE_OUT",
      size_pct: 0.5,
      qty_base: 0.5,
      meta: { tp_p0_done: false, tp_p1_done: true, trail_active: true, simplified_exit_v2_enabled: true },
    },
  });
  assert.strictEqual(validSimplifiedV2Tp1WithoutTp0.ok, true);
  assert.ok(!validSimplifiedV2Tp1WithoutTp0.issues.some((issue) => issue.code === "TP1_WITHOUT_TP0"));
  assert.ok(!validSimplifiedV2Tp1WithoutTp0.issues.some((issue) => issue.code === "TRAIL_WITHOUT_TP0"));

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const postTp0Decision = resolveCanonicalExitAuthorityDecision({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    currentStage: "TP0",
    entryEventId: "ENTRY__ETH",
    positionSnapshot: {
      qty_base: 0.5,
      meta: { tp_p0_done: true, tp_p1_done: false, trail_active: false },
    },
    authorityState: { tp0: 0.25, total: 0.25 },
    recentStages: { tp0: "TP0" },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.strictEqual(postTp0Decision.stage, "TP1");
  assert.strictEqual(postTp0Decision.reason, "POST_TP0_STAGE_LOCK");

  const postTp1Decision = resolveCanonicalExitAuthorityDecision({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    currentStage: "TP1",
    entryEventId: "ENTRY__ETH",
    positionSnapshot: {
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
    authorityState: { tp0: 0.25, tp1: 0.375, trail: 0.187, total: 0.812 },
    recentStages: { tp1: "TP1", trail: "TRAIL" },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.strictEqual(postTp1Decision.stage, "TRAIL");
  assert.strictEqual(postTp1Decision.blockedInvariant, true);

  const postTp1WriteDecision = resolveCanonicalExitWritePayload({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    entryEventId: "ENTRY__ETH",
    positionSnapshot: {
      qty_base: 0.167,
      entry_qty_base: 0.887,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
    authorityState: { tp0: 0.25, tp1: 0.375, trail: 0.187, total: 0.812 },
    recentStages: { tp1: "TP1", trail: "TRAIL" },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6 },
    observedQtyRatio: 0.188,
    fullExit: false,
  });
  assert.strictEqual(postTp1WriteDecision.stage, "TRAIL");
  assert.strictEqual(postTp1WriteDecision.event, "EXIT_TRAIL");
  assert.ok(postTp1WriteDecision.transitionEvents.includes("TRAIL_FINAL_EXIT"));

  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: {
      entry_qty_base: 1,
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
    authorityState: { tp0: 0.25, tp1: 0.375, trail: 0.208, total: 0.833 },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.strictEqual(ledger.tp0_allowed_abs, 0.25);
  assert.strictEqual(ledger.tp0_consumed_abs, 0.25);
  assert.strictEqual(ledger.tp1_allowed_abs, 0.375);
  assert.strictEqual(ledger.tp1_consumed_abs, 0.375);
  assert.strictEqual(ledger.runner_allowed_abs, 0.375);
  assert.ok(Math.abs(ledger.trail_consumed_abs - 0.208) < 0.000001);
  assert.ok(Math.abs(ledger.total_consumed_ratio - 0.833) < 0.000001);
  assert.ok(Math.abs(ledger.runner_remaining_ratio - 0.167) < 0.001);
  const validLedger = validateExitQuantityContractLedger({
    ledger,
    positionSnapshot: {
      entry_qty_base: 1,
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
  });
  assert.strictEqual(validLedger.ok, true);
  assert.deepStrictEqual(validLedger.issues, []);

  const invalidLedger = validateExitQuantityContractLedger({
    ledger: {
      entry_qty_abs: 1,
      tp0_allowed_ratio: 0.25,
      tp0_consumed_ratio: 0.25,
      tp0_allowed_abs: 0.25,
      tp0_consumed_abs: 0.25,
      tp1_allowed_ratio: 0.375,
      tp1_consumed_ratio: 0.45,
      tp1_allowed_abs: 0.375,
      tp1_consumed_abs: 0.45,
      runner_allowed_ratio: 0.375,
      trail_consumed_ratio: 0.45,
      runner_allowed_abs: 0.375,
      trail_consumed_abs: 0.45,
      total_consumed_ratio: 1.15,
      runner_remaining_ratio: -0.15,
      runner_remaining_abs: 0.2,
    },
    positionSnapshot: {
      entry_qty_base: 1,
      qty_base: 0.01,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
  });
  assert.strictEqual(invalidLedger.ok, false);
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "TP1_CONSUMED_EXCEEDS_ALLOWED"));
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "TRAIL_CONSUMED_EXCEEDS_RUNNER"));
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "EXIT_TOTAL_CONSUMED_EXCEEDS_ENTRY"));
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "RUNNER_REMAINING_QTY_MISMATCH"));
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "TP1_CONSUMED_ABS_EXCEEDS_ALLOWED"));
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "TRAIL_CONSUMED_ABS_EXCEEDS_RUNNER"));
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "EXIT_TOTAL_CONSUMED_ABS_EXCEEDS_ENTRY"));
  assert.ok(invalidLedger.issues.some((issue) => issue.code === "RUNNER_REMAINING_ABS_MISMATCH"));

  const ledgerBlockedDecision = resolveCanonicalExitWritePayload({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    entryEventId: "ENTRY__ETH",
    positionSnapshot: {
      qty_base: 0.167,
      entry_qty_base: 1,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
    authorityState: { tp0: 0.25, tp1: 0.45, trail: 0.45, total: 1.15 },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6 },
    observedQtyRatio: 0.45,
    fullExit: false,
  });
  assert.strictEqual(ledgerBlockedDecision.ledgerBlockedInvariant, true);
  assert.deepStrictEqual(ledgerBlockedDecision.transitionEvents, []);
  assert.strictEqual(ledgerBlockedDecision.primaryTransitionEvent, null);

  const missingEntryLineageDecision = resolveCanonicalExitWritePayload({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    positionSnapshot: {
      qty_base: 0.75,
      entry_qty_base: 1,
      meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false },
    },
    authorityState: { total: 0.25, tp0: 0.25 },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    observedQtyRatio: 0.25,
    fullExit: false,
  });
  assert.strictEqual(missingEntryLineageDecision.stage, null);
  assert.strictEqual(missingEntryLineageDecision.event, null);
  assert.strictEqual(missingEntryLineageDecision.reason, "ENTRY_LINEAGE_REQUIRED");
  assert.strictEqual(missingEntryLineageDecision.entryLineageRequired, true);
  assert.strictEqual(missingEntryLineageDecision.entryLineageMissing, true);
  assert.deepStrictEqual(missingEntryLineageDecision.transitionEvents, []);
  assert.strictEqual(missingEntryLineageDecision.primaryTransitionEvent, null);

  const derivedEntryLedger = buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.ok(Math.abs(derivedEntryLedger.entry_qty_abs - 0.4453333333) < 0.001);
  assert.ok(Math.abs(derivedEntryLedger.runner_remaining_abs - 0.167) < 0.001);

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const simplifiedV2Ledger = buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: 0.5,
      meta: { tp_p0_done: false, tp_p1_done: true, trail_active: false, simplified_exit_v2_enabled: true },
    },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    simplifiedExitV2Enabled: true,
  });
  assert.strictEqual(simplifiedV2Ledger.tp0_allowed_ratio, 0);
  assert.strictEqual(simplifiedV2Ledger.tp0_consumed_ratio, 0);
  assert.strictEqual(simplifiedV2Ledger.tp0_allowed_abs, 0);
  assert.strictEqual(simplifiedV2Ledger.tp0_consumed_abs, 0);
  assert.strictEqual(simplifiedV2Ledger.tp1_allowed_ratio, 0.5);
  assert.strictEqual(simplifiedV2Ledger.tp1_consumed_ratio, 0.5);
  assert.strictEqual(simplifiedV2Ledger.runner_allowed_ratio, 0.5);
  assert.ok(Math.abs(simplifiedV2Ledger.entry_qty_abs - 1) < 0.000001);
  assert.ok(Math.abs(simplifiedV2Ledger.runner_remaining_abs - 0.5) < 0.000001);

  const missingEntryLedger = validateExitQuantityContractLedger({
    ledger: {
      tp0_allowed_ratio: 0.25,
      tp0_consumed_ratio: 0.25,
      tp1_allowed_ratio: 0.375,
      tp1_consumed_ratio: 0.375,
      runner_allowed_ratio: 0.375,
      trail_consumed_ratio: 0.1,
      total_consumed_ratio: 0.725,
      runner_remaining_ratio: 0.275,
      runner_remaining_abs: 0.167,
    },
    positionSnapshot: {
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
  });
  assert.strictEqual(missingEntryLedger.ok, false);
  assert.ok(missingEntryLedger.issues.some((issue) => issue.code === "ENTRY_QTY_ABS_REQUIRED"));

  const trailTransition = resolveCanonicalExitTransitionEvents({
    resolvedStage: "TRAIL",
    positionSnapshot: {
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
    ledger,
    observedQtyRatio: 0.19,
    fullExit: false,
  });
  assert.ok(trailTransition.transitionEvents.includes("TRAIL_FINAL_EXIT"));

  const simplifiedTp0Transition = resolveCanonicalExitTransitionEvents({
    resolvedStage: "TP0",
    positionSnapshot: {
      qty_base: 0.75,
      meta: { tp_p0_done: true, tp_p1_done: false, trail_active: false },
    },
    simplifiedExitV2Enabled: true,
  });
  assert.deepStrictEqual(simplifiedTp0Transition.transitionEvents, ["TP1_REACHED", "TRAIL_ACTIVATED"]);
  assert.strictEqual(simplifiedTp0Transition.primaryTransitionEvent, "TRAIL_ACTIVATED");

  const simplifiedTp1Transition = resolveCanonicalExitTransitionEvents({
    resolvedStage: "TP1",
    positionSnapshot: {
      qty_base: 0.75,
      meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false },
    },
    simplifiedExitV2Enabled: true,
  });
  assert.deepStrictEqual(simplifiedTp1Transition.transitionEvents, ["TP1_REACHED", "TRAIL_ACTIVATED"]);
  assert.strictEqual(simplifiedTp1Transition.primaryTransitionEvent, "TRAIL_ACTIVATED");

  const simplifiedTrailTransition = resolveCanonicalExitTransitionEvents({
    resolvedStage: "TRAIL",
    positionSnapshot: {
      qty_base: 0.167,
      meta: { tp_p0_done: false, tp_p1_done: true, trail_active: true },
    },
    ledger,
    observedQtyRatio: 0.19,
    fullExit: false,
    simplifiedExitV2Enabled: true,
  });
  assert.deepStrictEqual(simplifiedTrailTransition.transitionEvents, ["TRAIL_FINAL_EXIT"]);
  assert.strictEqual(simplifiedTrailTransition.primaryTransitionEvent, "TRAIL_FINAL_EXIT");

  const alertStage = resolveCanonicalAlertExitStage({
    transitionEvents: ["TP1_REACHED", "TRAIL_ACTIVATED"],
  });
  assert.strictEqual(alertStage, "TP1");
  assert.strictEqual(resolveCanonicalAlertExitStage({ fallbackStage: "TP1" }), null);

  const canonicalPositionStage = resolveCanonicalPositionExitStage({
    positionSnapshot: {
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true, canonical_exit_stage: "TP1" },
    },
  });
  assert.deepStrictEqual(canonicalPositionStage, {
    stage: "TRAIL",
    source: "POSITION_STATE_MACHINE_TRAIL_ACTIVE",
  });
  assert.deepStrictEqual(resolveCanonicalPositionExitStage({
    positionSnapshot: {
      qty_base: 0.167,
      meta: { event: "EXIT_TP_P1_1.65P" },
    },
  }), {
    stage: null,
    source: null,
  });
  const inferredRunnerStage = resolveCanonicalPositionExitStage({
    positionSnapshot: {
      qty_base: 0.5,
      entry_qty_base: 1,
      meta: {
        tp_p0_done: false,
        tp_p1_done: false,
        trail_active: false,
        simplified_exit_v2_enabled: true,
        exit_rules_override: { TP_P1_QTY: 0.5 },
      },
    },
    simplifiedExitV2Enabled: true,
  });
  assert.strictEqual(inferredRunnerStage.stage, "TRAIL");
  assert.strictEqual(inferredRunnerStage.source, "POSITION_STATE_MACHINE_V2_RUNNER_QTY");
  assert.strictEqual(inferredRunnerStage.entry_qty_abs, 1);
  assert.strictEqual(inferredRunnerStage.current_qty_abs, 0.5);
  assert.strictEqual(inferredRunnerStage.expected_runner_qty_abs, 0.5);

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const cycleStage = resolveCanonicalExitStageFromCycleEvidence({
    cycleTrades: [
      { signedQty: 0.887, qty: 0.887 },
      { signedQty: -0.221, qty: 0.221 },
      { signedQty: -0.332, qty: 0.332 },
    ],
    positionQty: 0.334,
    tp0QtyRatio: 0.25,
    tp1QtyRatio: 0.5,
  });
  assert.strictEqual(cycleStage.stage, "TRAIL");

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const simplifiedV2CycleStage = resolveCanonicalExitStageFromCycleEvidence({
    cycleTrades: [
      { signedQty: 1, qty: 1 },
      { signedQty: -0.5, qty: 0.5 },
    ],
    positionQty: 0.5,
    tp0QtyRatio: 0.25,
    tp1QtyRatio: 0.5,
    simplifiedExitV2Enabled: true,
  });
  assert.strictEqual(simplifiedV2CycleStage.stage, "TRAIL");

  const simplifiedV2Tp0RemappedDecision = resolveCanonicalExitAuthorityDecision({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    currentStage: "TP0",
    entryEventId: "ENTRY__ETH_V2",
    positionSnapshot: {
      qty_base: 0.5,
      entry_qty_base: 1,
      meta: {
        tp_p0_done: false,
        tp_p1_done: false,
        trail_active: false,
        simplified_exit_v2_enabled: true,
        exit_rules_override: { TP_P1_QTY: 0.5 },
      },
    },
    authorityState: { tp1: 0, total: 0 },
    rules: { TP_P1_QTY: 0.5, TP_P1: 0.0168 },
    observedQtyRatio: 0.5,
    fullExit: false,
  });
  assert.strictEqual(simplifiedV2Tp0RemappedDecision.stage, "TP1");
  assert.strictEqual(simplifiedV2Tp0RemappedDecision.reason, "V2_TP0_REMAPPED_TO_TP1");

  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
  console.log("POSITION_STATE_MACHINE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("POSITION_STATE_MACHINE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
