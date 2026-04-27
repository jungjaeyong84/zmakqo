"use strict";

const { buildPositionCycleDoc, buildExitRuntimeProjectionDoc } = require("./contracts");
const { buildInitialProtectionPlan, observeProtectionLeveragePlan } = require("./protectionModel");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function buildV2EntryBootstrap({
  exchange = "BINANCEFUT",
  symbol,
  entryEventId,
  entryOrderId,
  entryFillGroupId,
  entryIntentId = null,
  signalIntentId = null,
  openclawDecisionId = null,
  positionSide,
  entryPrice,
  entryQtyAbs,
  stopLossPct = 0.0165,
  tp1TargetPct = 0.025,
  tp1QtyRatio = 0.5,
  leverage = null,
  protectionLeverageNormalize = undefined,
} = {}) {
  const positionCycle = buildPositionCycleDoc({
    exchange,
    symbol,
    entryEventId,
    entryOrderId,
    entryFillGroupId,
    entryIntentId,
    signalIntentId,
    openclawDecisionId,
    positionSide,
    entryPrice,
    entryQtyAbs,
    status: "PROTECTION_PENDING",
  });

  const protectionPlan = buildInitialProtectionPlan({
    exchange,
    symbol,
    positionSide,
    entryPrice,
    entryQtyAbs,
    stopLossPct,
    tp1TargetPct,
    tp1QtyRatio,
    leverage,
    ...(protectionLeverageNormalize !== undefined ? { protectionLeverageNormalize } : {}),
  });

  // Stage B — opportunistic warn-only diff between V2 raw and V1-normalized
  // SL/TP1 prices. Only fires when caller hands us a real `leverage > 1`,
  // so callers that haven't been wired through Stage C yet stay silent.
  observeProtectionLeveragePlan({
    plan: protectionPlan,
    entryPrice,
    positionSide,
    stopLossPct,
    tp1TargetPct,
    leverage,
    exchange,
    symbol,
    positionCycleId: positionCycle.position_cycle_id,
    ...(protectionLeverageNormalize !== undefined ? { protectionLeverageNormalize } : {}),
  });

  const projection = buildExitRuntimeProjectionDoc({
    positionCycleId: positionCycle.position_cycle_id,
    stage: "PRE_TP1",
    tp1Done: false,
    trailActive: false,
    entryQtyAbs,
    tp1TargetPrice: protectionPlan.tp1_trigger_price,
    tp1TargetQtyAbs: protectionPlan.tp1_qty_abs,
    tp1FilledQtyAbs: 0,
    runnerRemainingQtyAbs: protectionPlan.runner_remaining_qty_abs,
    runnerFloorStop: null,
    trailStopByR: null,
    chosenStopSource: "SL",
    chosenStopPrice: protectionPlan.sl_trigger_price,
    finalEffectiveStop: protectionPlan.sl_trigger_price,
    nativeStopPrice: null,
    healthStatus: "HEALTHY",
    initialStopPrice: protectionPlan.initial_stop_price,
    entryRDistance: protectionPlan.entry_r_distance,
  });

  return Object.freeze({
    positionCycle,
    protectionPlan,
    projection,
  });
}

function buildProtectedActivePositionCycleDoc({
  positionCycle,
  protectionWriteResult,
  activatedAt = null,
} = {}) {
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : null;
  const result = protectionWriteResult && typeof protectionWriteResult === "object" ? protectionWriteResult : null;
  const runtime = result && result.runtimeDoc && typeof result.runtimeDoc === "object" ? result.runtimeDoc : null;
  const decision = result && result.writeDecision && typeof result.writeDecision === "object" ? result.writeDecision : null;
  if (!cycle) throw new Error("POSITION_CYCLE_REQUIRED");
  if (!runtime) throw new Error("PROTECTION_RUNTIME_DOC_REQUIRED");
  if (!decision) throw new Error("PROTECTION_WRITE_DECISION_REQUIRED");
  if (upper(cycle.status) !== "PROTECTION_PENDING") {
    throw new Error("ENTRY_PROTECTION_PENDING_STATUS_REQUIRED");
  }
  if (trimOrNull(runtime.position_cycle_id) !== trimOrNull(cycle.position_cycle_id)) {
    throw new Error("ENTRY_PROTECTION_POSITION_CYCLE_MISMATCH");
  }
  if (decision.ok !== true) throw new Error("ENTRY_PROTECTION_NOT_READY");
  if (upper(runtime.health_status) !== "HEALTHY") throw new Error("ENTRY_PROTECTION_NOT_HEALTHY");
  if (!trimOrNull(runtime.sl_order_id)) throw new Error("ENTRY_PROTECTION_SL_ORDER_REQUIRED");
  if (!trimOrNull(runtime.tp1_order_id)) throw new Error("ENTRY_PROTECTION_TP1_ORDER_REQUIRED");
  return Object.freeze({
    ...cycle,
    status: "ACTIVE_PROTECTED",
    protection_runtime_id: trimOrNull(runtime.protection_runtime_id),
    protection_activated_at: trimOrNull(activatedAt) || trimOrNull(runtime.last_refresh_at) || new Date().toISOString(),
    native_protection_health_status: "HEALTHY",
  });
}

module.exports = {
  buildV2EntryBootstrap,
  buildProtectedActivePositionCycleDoc,
  __test: {
    trimOrNull,
    upper,
  },
};
