"use strict";

const assert = require("assert");
const {
  validatePositionSnapshotTransition,
  resolveCanonicalExitAuthorityDecision,
  resolveCanonicalExitTransitionEvents,
  buildExitQuantityContractLedger,
} = require("../services/positionStateMachine");

function run() {
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
    authorityState: { tp0: 0.25, tp1: 0.375, total: 0.625 },
    recentStages: { tp1: "TP1", trail: "TRAIL" },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.strictEqual(postTp1Decision.stage, "TRAIL");
  assert.strictEqual(postTp1Decision.blockedInvariant, true);

  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: {
      entry_qty_base: 1,
      qty_base: 0.167,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true },
    },
    authorityState: { tp0: 0.25, tp1: 0.375, trail: 0.188, total: 0.813 },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.strictEqual(ledger.tp0_allowed_abs, 0.25);
  assert.strictEqual(ledger.tp1_allowed_abs, 0.375);
  assert.ok(Math.abs(ledger.runner_remaining_ratio - 0.187) < 0.001);

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

  console.log("POSITION_STATE_MACHINE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("POSITION_STATE_MACHINE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
