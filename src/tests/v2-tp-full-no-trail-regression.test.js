"use strict";

const assert = require("assert");
const fillsSync = require("../services/binanceFuturesFillsSync");
const reconciler = require("../services/binancePositionReconciler");
const positionStateMachine = require("../services/positionStateMachine");
const liveTrailingStageRepair = require("../services/liveTrailingStageRepair");
const fillProjectionAudit = require("../services/binanceFillProjectionAudit");

const fullTpRules = Object.freeze({
  SL: -0.0165,
  TP_P1: 0.025,
  TP_P1_QTY: 1,
  exit_contract_mode: "TP_FULL_ONLY",
});

function fullTpMeta(overrides = {}) {
  return {
    simplified_exit_v2_enabled: true,
    exit_contract_mode: "TP_FULL_ONLY",
    tp_full_only: true,
    entry_qty_base: 100,
    entry_qty_abs: 100,
    exit_rules_override: { ...fullTpRules },
    tp_p1_done: false,
    trail_active: false,
    ...overrides,
  };
}

(function stageHintsDoNotArmTrailForTpFullOnly() {
  const hinted = fillsSync.__test.buildStageHintedMeta(
    fullTpMeta({ tp_p1_pending: true }),
    "EXIT_TP_P1_2.5P",
    { time: 1_777_777_000_000, price: 100 }
  );

  assert.strictEqual(hinted.tp_p1_done, true);
  assert.strictEqual(hinted.trail_active, false, "TP_FULL_ONLY TP fill must not arm trail_active");
  assert.strictEqual(hinted.runner_remaining_qty_abs, 0);
  assert.strictEqual(hinted.tp_p1_pending, false);
  assert.strictEqual(hinted.exit_contract_mode, "TP_FULL_ONLY");
  assert.strictEqual(hinted.tp_full_only, true);

  const trailHint = fillsSync.__test.buildStageHintedMeta(
    fullTpMeta(),
    "EXIT_TRAIL",
    { time: 1_777_777_000_000, price: 100 }
  );
  assert.strictEqual(trailHint.trail_active, false, "TP_FULL_ONLY must ignore stale trail hints");
})();

(function recentHintsDoNotArmTrailForTpFullOnly() {
  const merged = fillsSync.__test.mergeRecentExitHintsIntoMeta(fullTpMeta(), {
    recentTp1: { event: "EXIT_TP_P1_2.5P" },
    recentTrail: { event: "EXIT_TRAIL" },
  });

  assert.strictEqual(merged.tp_p1_done, true);
  assert.strictEqual(merged.trail_active, false, "TP_FULL_ONLY recent TP hint must not re-arm trail");
  assert.strictEqual(merged.runner_remaining_qty_abs, 0);
})();

(function trailEventsNormalizeOutOfTpFullOnlyContract() {
  const ctx = {
    executionMode: "LIVE",
    simplifiedExitV2Enabled: true,
    exit_contract_mode: "TP_FULL_ONLY",
    meta: fullTpMeta({ tp_p1_done: true, trail_active: false }),
  };

  assert.strictEqual(
    fillsSync.__test.normalizeExitEventForRules("EXIT_TP_P1_2.5P", fullTpRules, ctx),
    "EXIT_TP_FULL_2.5P",
  );
  assert.strictEqual(
    fillsSync.__test.normalizeExitEventForRules("EXIT_TRAIL", fullTpRules, ctx),
    "EXIT_EXTERNAL_SYNC",
    "TP_FULL_ONLY must not preserve stale EXIT_TRAIL labels",
  );
  assert.strictEqual(
    fillsSync.__test.applyActiveExitStageBackstopOverride({
      event: "EXIT_TP_P1_2.5P",
      positionCtx: ctx,
      rules: fullTpRules,
      recentTrail: { event: "EXIT_TRAIL" },
    }),
    "EXIT_TP_FULL_2.5P",
    "recent stale trail hint must not relabel TP_FULL fills as trail",
  );
})();

(function qtyReductionRecoveryDoesNotCreateRunnerForTpFullOnly() {
  const out = reconciler.__test.recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
    meta: fullTpMeta(),
    positionSide: "LONG",
    qtyBase: 50,
    previousQtyBase: 100,
    entryPrice: 100,
    stopOrder: { orderId: "SL1", triggerPrice: 98.35 },
    tpOrder: null,
    currentMarkPrice: 102.5,
  });
  assert.strictEqual(out, null, "TP_FULL_ONLY partial qty reduction must not synthesize a runner/trail state");
})();

(function activeReconcileClearsLegacyTrailForTpFullOnly() {
  const out = reconciler.reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: fullTpMeta({
      tp_p1_done: true,
      trail_active: true,
      trail_high: 102,
      trail_high_at_ms: 1_777_777_000_000,
      runner_remaining_qty_abs: 50,
    }),
    positionSide: "LONG",
    qtyBase: 50,
    previousQtyBase: 100,
    entryPrice: 100,
    openOrders: [
      { orderId: "SL1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "98.35" },
    ],
  });

  assert.strictEqual(out.meta.trail_active, false, "reconciler must clear legacy trail_active under TP_FULL_ONLY");
  assert.strictEqual(out.meta.trail_high, null);
  assert.strictEqual(out.meta.runner_remaining_qty_abs, 0);
  assert.strictEqual(out.meta.exit_contract_mode, "TP_FULL_ONLY");
})();

(function positionStateMachineDoesNotExposeRunnerForTpFullOnlyActiveState() {
  const positionSnapshot = {
    state: "ACTIVE",
    position_state: "COMMIT",
    qty_base: 72,
    entry_qty_base: 72,
    execution_mode: "LIVE",
    meta: fullTpMeta({
      tp_p1_done: true,
      trail_active: true,
      canonical_exit_stage: "TRAIL",
    }),
  };

  assert.strictEqual(
    positionStateMachine.__test.buildCanonicalExitEvent({
      stage: "TRAIL",
      rules: fullTpRules,
      positionSnapshot,
      fallbackEvent: "EXIT_TRAIL",
    }),
    "EXIT_EXTERNAL_SYNC",
    "TP_FULL_ONLY must not render canonical TRAIL events",
  );

  assert.deepStrictEqual(
    positionStateMachine.resolveCanonicalPositionExitStage({ positionSnapshot }),
    {
      stage: null,
      source: "POSITION_STATE_MACHINE_TP_FULL_ONLY_ACTIVE_MILESTONE_SUPPRESSED",
    },
    "active TP_FULL_ONLY positions cannot be treated as post-TP1 runner/trail",
  );

  const transition = positionStateMachine.__test.resolveCanonicalExitTransitionEvents({
    resolvedStage: "TRAIL",
    positionSnapshot,
    rules: fullTpRules,
    fullExit: false,
  });
  assert.deepStrictEqual(transition.transitionEvents, []);
  assert.strictEqual(transition.primaryTransitionEvent, null);

  const invalid = positionStateMachine.validatePositionSnapshotTransition({
    prev: { state: "ACTIVE", position_state: "COMMIT", qty_base: 72, meta: fullTpMeta() },
    next: positionSnapshot,
  });
  assert.strictEqual(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => issue.code === "TP_FULL_ONLY_TRAIL_STATE"));
})();

(function liveTrailingStageRepairDoesNotPromoteTpFullToTrail() {
  const positionSnapshot = {
    state: "ACTIVE",
    position_state: "COMMIT",
    qty_base: 72,
    entry_qty_base: 72,
    meta: fullTpMeta({
      tp_p1_done: true,
      trail_active: true,
      canonical_exit_stage: "TRAIL",
    }),
  };
  const target = liveTrailingStageRepair.__test.resolveRepairTargetStage({
    positionSnapshot,
    externalQty: 72,
  });
  assert.strictEqual(target.stage, null);
  assert.strictEqual(target.reason, "TP_FULL_ONLY_HAS_NO_TRAILING_REPAIR_TARGET");

  const repaired = liveTrailingStageRepair.__test.buildRepairedMeta(positionSnapshot.meta, { stage: "TRAIL" });
  assert.strictEqual(repaired.trail_active, false);
  assert.strictEqual(repaired.runner_remaining_qty_abs, 0);
  assert.strictEqual(repaired.canonical_exit_stage, null);
})();

(function fillProjectionAuditSurfacesTpFullOnlyTrailLeakInsteadOfTrailRequirement() {
  const out = fillProjectionAudit.buildBinanceFillProjectionAudit({
    nowMs: 1_777_778_000_000,
    positions: [{
      exchange: "BINANCEFUT",
      symbol: "AXSUSDT",
      state: "ACTIVE",
      qty_base: 72,
      meta: fullTpMeta({
        entry_event_id: "ENTRYV2__AXSUSDT__LONG__14875942957",
        tp_p1_done: true,
        trail_active: true,
      }),
    }],
    fills: [],
  });
  assert.strictEqual(out.tp_full_only_trail_state_leak_n, 1);
  assert.strictEqual(out.tp1_fill_trail_inactive_n, 0);
})();

console.log("V2_TP_FULL_NO_TRAIL_REGRESSION_TEST_OK");
