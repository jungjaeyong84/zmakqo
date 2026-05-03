"use strict";

const {
  V2_EXIT_STAGES,
  V2_HEALTH_STATUSES,
  V2_REDUCER_EVIDENCE_KINDS,
} = require("./constants");
const {
  buildCanonicalExitTransitionDoc,
  buildExitRuntimeProjectionDoc,
} = require("./contracts");

const EPSILON = 1e-8;
const TERMINAL_STAGES = new Set(["EXITED_TP1", "EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function assertProjectionIntegrity(positionCycle, projection) {
  if (!positionCycle || typeof positionCycle !== "object") throw new Error("POSITION_CYCLE_REQUIRED");
  if (!projection || typeof projection !== "object") throw new Error("PROJECTION_REQUIRED");
  if (!trimOrNull(positionCycle.position_cycle_id)) throw new Error("position_cycle_id_REQUIRED");
  if (!trimOrNull(positionCycle.entry_event_id)) throw new Error("entry_event_id_REQUIRED");
  if (trimOrNull(positionCycle.position_cycle_id) !== trimOrNull(projection.position_cycle_id)) {
    throw new Error("POSITION_CYCLE_PROJECTION_MISMATCH");
  }
  const stage = upper(projection.stage);
  if (!V2_EXIT_STAGES.includes(stage)) throw new Error("stage_INVALID");
  if (TERMINAL_STAGES.has(stage)) throw new Error("TERMINAL_STAGE_LOCKED");
  const entryQtyAbs = toNumber(projection.entry_qty_abs);
  const tp1TargetQtyAbs = toNumber(projection.tp1_target_qty_abs);
  const tp1FilledQtyAbs = toNumber(projection.tp1_filled_qty_abs);
  const runnerRemainingQtyAbs = toNumber(projection.runner_remaining_qty_abs);
  if (!(entryQtyAbs > 0)) throw new Error("ENTRY_QTY_ABS_INVALID");
  if (!(tp1TargetQtyAbs > 0)) throw new Error("TP1_TARGET_QTY_ABS_INVALID");
  if (!(tp1FilledQtyAbs >= 0)) throw new Error("TP1_FILLED_QTY_ABS_INVALID");
  if (!(runnerRemainingQtyAbs >= 0)) throw new Error("RUNNER_REMAINING_QTY_ABS_INVALID");
  if (tp1FilledQtyAbs - tp1TargetQtyAbs > EPSILON) throw new Error("TP1_FILLED_QTY_OVER_TARGET");
  if (tp1FilledQtyAbs + runnerRemainingQtyAbs - entryQtyAbs > EPSILON) throw new Error("LEDGER_SUM_EXCEEDS_ENTRY");
  return {
    stage,
    entryQtyAbs,
    tp1TargetQtyAbs,
    tp1FilledQtyAbs,
    runnerRemainingQtyAbs,
  };
}

function assertEvidence(evidence, positionCycleId) {
  if (!evidence || typeof evidence !== "object") throw new Error("EVIDENCE_REQUIRED");
  const kind = upper(evidence.kind);
  if (kind === "LEGACY_EARLY_PARTIAL_EXIT") {
    throw new Error("LEGACY_PARTIAL_TAKE_PROFIT_UNSUPPORTED");
  }
  if (!V2_REDUCER_EVIDENCE_KINDS.includes(kind)) throw new Error("EVIDENCE_KIND_INVALID");
  const evidenceCycleId = trimOrNull(evidence.positionCycleId || evidence.position_cycle_id);
  if (evidenceCycleId && evidenceCycleId !== positionCycleId) {
    throw new Error("EVIDENCE_POSITION_CYCLE_MISMATCH");
  }
  const sourceFillId = trimOrNull(evidence.sourceFillId || evidence.source_fill_id);
  const sourceOrderId = trimOrNull(evidence.sourceOrderId || evidence.source_order_id);
  if (!sourceFillId) throw new Error("source_fill_id_REQUIRED");
  if (!sourceOrderId) throw new Error("source_order_id_REQUIRED");
  return {
    kind,
    sourceFillId,
    sourceOrderId,
    fillQtyAbs: toNumber(evidence.fillQtyAbs || evidence.fill_qty_abs),
    fillPrice: toNumber(evidence.fillPrice || evidence.fill_price),
    nextStopPrice: toNumber(evidence.nextStopPrice || evidence.next_stop_price),
    nativeRefreshStatus: upper(evidence.nativeRefreshStatus || evidence.native_refresh_status),
  };
}

function hasPlacedOrder(runtime, orderKey, statusKey) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  const orderId = trimOrNull(row[orderKey]);
  const status = upper(row[statusKey]);
  if (!orderId) return false;
  if (status && status !== "PLACED") return false;
  return true;
}

function assertTp1ProtectionGate({ positionCycle, protectionRuntime } = {}) {
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : null;
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : null;
  if (!cycle) throw new Error("POSITION_CYCLE_REQUIRED");
  if (!runtime) throw new Error("TP1_PROTECTION_RUNTIME_REQUIRED");
  if (upper(cycle.status) !== "ACTIVE_PROTECTED") throw new Error("TP1_POSITION_NOT_ACTIVE_PROTECTED");
  if (trimOrNull(runtime.position_cycle_id) !== trimOrNull(cycle.position_cycle_id)) {
    throw new Error("TP1_PROTECTION_RUNTIME_CYCLE_MISMATCH");
  }
  if (upper(runtime.health_status) !== "HEALTHY") throw new Error("TP1_PROTECTION_RUNTIME_NOT_HEALTHY");
  if (upper(runtime.native_refresh_status) !== "OK") throw new Error("TP1_NATIVE_REFRESH_NOT_OK");
  if (!hasPlacedOrder(runtime, "sl_order_id", "sl_order_status")) throw new Error("TP1_SL_ORDER_MISSING");
  if (!hasPlacedOrder(runtime, "tp1_order_id", "tp1_order_status")) throw new Error("TP1_ORDER_MISSING");
  return true;
}

function buildProjectionFromPatch(baseProjection, patch) {
  return buildExitRuntimeProjectionDoc({
    positionCycleId: baseProjection.position_cycle_id,
    stage: patch.stage,
    tp1Done: patch.tp1_done,
    trailActive: patch.trail_active,
    entryQtyAbs: patch.entry_qty_abs,
    tp1TargetPrice: patch.tp1_target_price,
    tp1TargetQtyAbs: patch.tp1_target_qty_abs,
    tp1FilledQtyAbs: patch.tp1_filled_qty_abs,
    runnerRemainingQtyAbs: patch.runner_remaining_qty_abs,
    runnerFloorStop: patch.runner_floor_stop,
    trailStopByR: patch.trail_stop_by_r,
    chosenStopSource: patch.chosen_stop_source,
    chosenStopPrice: patch.chosen_stop_price,
    finalEffectiveStop: patch.final_effective_stop,
    nativeStopPrice: patch.native_stop_price,
    healthStatus: patch.health_status,
  });
}

function resolveOpenPositionQtyAbs(current) {
  return Number((current.entryQtyAbs - current.tp1FilledQtyAbs).toFixed(8));
}

function reduceCanonicalExit({
  positionCycle,
  projection,
  evidence,
  protectionRuntime = null,
  requireProtectionRuntimeGate = false,
} = {}) {
  const current = assertProjectionIntegrity(positionCycle, projection);
  const ev = assertEvidence(evidence, positionCycle.position_cycle_id);

  if (ev.kind === "TP1_CONFIRMED") {
    if (requireProtectionRuntimeGate === true) {
      assertTp1ProtectionGate({ positionCycle, protectionRuntime });
    }
    if (current.stage === "TP1_DONE" || current.stage === "TRAIL_ACTIVE") {
      return Object.freeze({
        ok: true,
        duplicate: true,
        reason: "TP1_ALREADY_REACHED",
        transition: null,
        nextProjection: projection,
      });
    }
    if (current.stage !== "PRE_TP1") throw new Error("TP1_STAGE_INVALID");
    const fillQtyAbs = ev.fillQtyAbs;
    if (!(fillQtyAbs > 0)) throw new Error("TP1_FILL_QTY_REQUIRED");
    const nextFilledQtyAbs = Number((current.tp1FilledQtyAbs + fillQtyAbs).toFixed(8));
    if (nextFilledQtyAbs > current.tp1TargetQtyAbs + EPSILON) {
      throw new Error("TP1_FILL_QTY_OVER_TARGET");
    }
    const nextRunnerRemainingQtyAbs = Number((current.entryQtyAbs - nextFilledQtyAbs).toFixed(8));
    if (nextFilledQtyAbs < current.tp1TargetQtyAbs - EPSILON) {
      const nextProjection = buildProjectionFromPatch(projection, {
        ...projection,
        stage: "PRE_TP1",
        tp1_done: false,
        trail_active: false,
        tp1_filled_qty_abs: nextFilledQtyAbs,
        runner_remaining_qty_abs: nextRunnerRemainingQtyAbs,
        health_status: "HEALTHY",
      });
      return Object.freeze({
        ok: true,
        duplicate: false,
        partial: true,
        reason: "TP1_PARTIAL_FILL_ACCUMULATED",
        transition: null,
        nextProjection,
      });
    }
    const fullTpExit = nextRunnerRemainingQtyAbs <= EPSILON;
    const ledgerPatch = {
      tp1_filled_qty_abs: nextFilledQtyAbs,
      runner_remaining_qty_abs: nextRunnerRemainingQtyAbs,
      final_exit_qty_abs: fullTpExit ? nextFilledQtyAbs : null,
    };
    const transition = buildCanonicalExitTransitionDoc({
      positionCycleId: positionCycle.position_cycle_id,
      transitionEvent: fullTpExit ? "TP1_FULL_EXIT" : "TP1_REACHED",
      previousStage: "PRE_TP1",
      nextStage: fullTpExit ? "EXITED_TP1" : "TP1_DONE",
      sourceFillId: ev.sourceFillId,
      sourceOrderId: ev.sourceOrderId,
      entryEventId: positionCycle.entry_event_id,
      ledgerPatch,
    });
    const nextProjection = buildProjectionFromPatch(projection, {
      ...projection,
      stage: fullTpExit ? "EXITED_TP1" : "TP1_DONE",
      tp1_done: true,
      trail_active: false,
      tp1_filled_qty_abs: nextFilledQtyAbs,
      runner_remaining_qty_abs: nextRunnerRemainingQtyAbs,
      health_status: fullTpExit ? "TERMINAL_EXITED" : "HEALTHY",
    });
    return Object.freeze({ ok: true, duplicate: false, reason: null, transition, nextProjection });
  }

  if (ev.kind === "TRAIL_ACTIVATION_CONFIRMED") {
    if (current.stage === "TRAIL_ACTIVE") {
      return Object.freeze({
        ok: true,
        duplicate: true,
        reason: "TRAIL_ALREADY_ACTIVE",
        transition: null,
        nextProjection: projection,
      });
    }
    if (current.stage !== "TP1_DONE") throw new Error("TRAIL_ACTIVATION_STAGE_INVALID");
    if (!(ev.nextStopPrice > 0)) throw new Error("TRAIL_STOP_PRICE_REQUIRED");
    if (ev.nativeRefreshStatus !== "OK") throw new Error("TRAIL_NATIVE_REFRESH_OK_REQUIRED");
    const transition = buildCanonicalExitTransitionDoc({
      positionCycleId: positionCycle.position_cycle_id,
      transitionEvent: "TRAIL_ACTIVATED",
      previousStage: "TP1_DONE",
      nextStage: "TRAIL_ACTIVE",
      sourceFillId: ev.sourceFillId,
      sourceOrderId: ev.sourceOrderId,
      entryEventId: positionCycle.entry_event_id,
      ledgerPatch: {
        tp1_filled_qty_abs: current.tp1FilledQtyAbs,
        runner_remaining_qty_abs: current.runnerRemainingQtyAbs,
      },
    });
    const nextProjection = buildProjectionFromPatch(projection, {
      ...projection,
      stage: "TRAIL_ACTIVE",
      tp1_done: true,
      trail_active: true,
      chosen_stop_source: "TRAIL",
      chosen_stop_price: ev.nextStopPrice,
      final_effective_stop: ev.nextStopPrice,
      native_stop_price: ev.nextStopPrice,
      trail_stop_by_r: ev.nextStopPrice,
      health_status: "HEALTHY",
    });
    return Object.freeze({ ok: true, duplicate: false, reason: null, transition, nextProjection });
  }

  if (ev.kind === "STOP_EXIT_CONFIRMED") {
    const isTrailStage = current.stage === "TRAIL_ACTIVE";
    const transitionEvent = isTrailStage ? "TRAIL_HIT" : "SL_HIT";
    const nextStage = isTrailStage ? "EXITED_TRAIL" : "EXITED_SL";
    const finalExitQtyAbs = resolveOpenPositionQtyAbs(current);
    const exitPrice = ev.fillPrice;
    if (!(finalExitQtyAbs >= 0)) throw new Error("FINAL_EXIT_QTY_INVALID");
    const transition = buildCanonicalExitTransitionDoc({
      positionCycleId: positionCycle.position_cycle_id,
      transitionEvent,
      previousStage: current.stage,
      nextStage,
      sourceFillId: ev.sourceFillId,
      sourceOrderId: ev.sourceOrderId,
      entryEventId: positionCycle.entry_event_id,
      ledgerPatch: {
        final_exit_qty_abs: finalExitQtyAbs,
        runner_remaining_qty_abs: 0,
      },
    });
    const nextProjection = buildProjectionFromPatch(projection, {
      ...projection,
      stage: nextStage,
      trail_active: false,
      runner_remaining_qty_abs: 0,
      chosen_stop_price: exitPrice,
      final_effective_stop: exitPrice,
      native_stop_price: exitPrice,
      health_status: "TERMINAL_EXITED",
    });
    return Object.freeze({ ok: true, duplicate: false, reason: null, transition, nextProjection });
  }

  if (ev.kind === "EXTERNAL_CLOSE_CONFIRMED" || ev.kind === "MANUAL_CLOSE_CONFIRMED") {
    const transitionEvent = ev.kind === "EXTERNAL_CLOSE_CONFIRMED" ? "EXTERNAL_CLOSE_SYNC" : "MANUAL_CLOSE_SYNC";
    const nextStage = ev.kind === "EXTERNAL_CLOSE_CONFIRMED" ? "EXITED_EXTERNAL" : "EXITED_MANUAL";
    const finalExitQtyAbs = resolveOpenPositionQtyAbs(current);
    const transition = buildCanonicalExitTransitionDoc({
      positionCycleId: positionCycle.position_cycle_id,
      transitionEvent,
      previousStage: current.stage,
      nextStage,
      sourceFillId: ev.sourceFillId,
      sourceOrderId: ev.sourceOrderId,
      entryEventId: positionCycle.entry_event_id,
      ledgerPatch: {
        final_exit_qty_abs: finalExitQtyAbs,
        runner_remaining_qty_abs: 0,
      },
    });
    const nextProjection = buildProjectionFromPatch(projection, {
      ...projection,
      stage: nextStage,
      trail_active: false,
      runner_remaining_qty_abs: 0,
      health_status: "TERMINAL_EXITED",
    });
    return Object.freeze({ ok: true, duplicate: false, reason: null, transition, nextProjection });
  }

  throw new Error("REDUCER_EVIDENCE_UNHANDLED");
}

module.exports = {
  assertTp1ProtectionGate,
  reduceCanonicalExit,
  __test: {
    assertProjectionIntegrity,
    assertEvidence,
    hasPlacedOrder,
    resolveOpenPositionQtyAbs,
  },
};
