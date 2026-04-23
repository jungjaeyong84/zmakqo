"use strict";

const { buildRepairRequestDoc } = require("./contracts");

const TERMINAL_STAGES = new Set(["EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function hasPlacedOrder(runtime, orderKey, statusKey) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  const status = upper(row[statusKey]);
  if (status) {
    return status === "PLACED" && !!trimOrNull(row[orderKey]);
  }
  return !!trimOrNull(row[orderKey]);
}

function isTerminalTransition(transition = null) {
  return TERMINAL_STAGES.has(upper(transition && transition.next_stage));
}

function evaluateActiveExitWatchdog({
  positionCycle,
  projection,
  protectionRuntime,
  exchangeState,
  latestTransition = null,
  createdAt = null,
} = {}) {
  if (!positionCycle || typeof positionCycle !== "object") throw new Error("POSITION_CYCLE_REQUIRED");
  if (!projection || typeof projection !== "object") throw new Error("PROJECTION_REQUIRED");
  const stage = upper(projection.stage);
  if (!stage) throw new Error("stage_REQUIRED");
  if (trimOrNull(positionCycle.position_cycle_id) !== trimOrNull(projection.position_cycle_id)) {
    throw new Error("WATCHDOG_POSITION_CYCLE_MISMATCH");
  }
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  const exchange = exchangeState && typeof exchangeState === "object" ? exchangeState : {};
  const issueCodes = [];
  const repairRequests = [];

  const hasExchangePosition = exchange.has_active_position === true;
  const latestTransitionStage = upper(latestTransition && latestTransition.next_stage);
  const latestTransitionTerminal = isTerminalTransition(latestTransition);
  const hasSlOrder = hasPlacedOrder(runtime, "sl_order_id", "sl_order_status");
  const hasTp1Order = hasPlacedOrder(runtime, "tp1_order_id", "tp1_order_status");
  const nativeStopPrice = runtime.native_stop_price;
  const refreshStatus = upper(runtime.native_refresh_status);
  const healthStatus = upper(runtime.health_status || projection.health_status || "DEGRADED_REPAIRABLE");

  if (TERMINAL_STAGES.has(stage)) {
    if (hasExchangePosition) issueCodes.push("TERMINAL_STAGE_WITH_ACTIVE_POSITION");
    return Object.freeze({
      ok: true,
      issueCodes: Array.from(new Set(issueCodes)),
      repairRequests: [],
    });
  }

  if (latestTransitionTerminal && latestTransitionStage !== stage) {
    issueCodes.push("TERMINAL_PROJECTION_MISMATCH");
  }

  if (!hasExchangePosition) {
    if (latestTransitionTerminal !== true) {
      issueCodes.push("TERMINAL_TRANSITION_MISSING");
    }
    return Object.freeze({
      ok: true,
      issueCodes: Array.from(new Set(issueCodes)),
      repairRequests: [],
    });
  }

  if (stage === "PRE_TP1" && !hasTp1Order) {
    issueCodes.push("TP1_ORDER_MISSING");
    repairRequests.push(buildRepairRequestDoc({
      positionCycleId: positionCycle.position_cycle_id,
      stage,
      issueCode: "TP1_ORDER_MISSING",
      healthStatus: healthStatus === "HEALTHY" ? "DEGRADED_REPAIRABLE" : healthStatus,
      requestedAction: "ENSURE_TP1_ORDER",
      detail: {
        tp1_order_id: runtime.tp1_order_id || null,
        tp1_target_price: projection.tp1_target_price || runtime.native_tp1_price || null,
        tp1_qty_abs: projection.tp1_target_qty_abs || null,
      },
      createdAt,
    }));
  }

  if (stage === "TRAIL_ACTIVE" && !(nativeStopPrice > 0)) {
    issueCodes.push("TRAIL_STOP_MISSING");
    repairRequests.push(buildRepairRequestDoc({
      positionCycleId: positionCycle.position_cycle_id,
      stage,
      issueCode: "TRAIL_STOP_MISSING",
      healthStatus: healthStatus === "HEALTHY" ? "DEGRADED_UNPROTECTED" : healthStatus,
      requestedAction: "REFRESH_NATIVE_STOP",
      detail: {
        native_stop_price: runtime.native_stop_price || null,
        chosen_stop_price: projection.chosen_stop_price || null,
      },
      createdAt,
    }));
  }

  if (refreshStatus && refreshStatus !== "OK" && refreshStatus !== "HEALTHY") {
    issueCodes.push("NATIVE_REFRESH_UNHEALTHY");
    repairRequests.push(buildRepairRequestDoc({
      positionCycleId: positionCycle.position_cycle_id,
      stage,
      issueCode: "NATIVE_REFRESH_UNHEALTHY",
      healthStatus: healthStatus === "HEALTHY" ? "DEGRADED_REPAIRABLE" : healthStatus,
      requestedAction: "REFRESH_NATIVE_STOP",
      detail: {
        native_refresh_status: refreshStatus,
      },
      createdAt,
    }));
  }

  if (hasExchangePosition && (!hasSlOrder || (stage === "PRE_TP1" && !hasTp1Order) || (stage === "TRAIL_ACTIVE" && !(nativeStopPrice > 0)))) {
    issueCodes.push("UNPROTECTED_ACTIVE_POSITION");
    repairRequests.push(buildRepairRequestDoc({
      positionCycleId: positionCycle.position_cycle_id,
      stage,
      issueCode: "UNPROTECTED_ACTIVE_POSITION",
      healthStatus: "DEGRADED_UNPROTECTED",
      requestedAction: "ENSURE_FULL_PROTECTION",
      detail: {
        has_sl_order: hasSlOrder,
        has_tp1_order: hasTp1Order,
        native_stop_price: runtime.native_stop_price || null,
      },
      createdAt,
    }));
  }

  return Object.freeze({
    ok: true,
    issueCodes: Array.from(new Set(issueCodes)),
    repairRequests,
  });
}

module.exports = {
  evaluateActiveExitWatchdog,
  __test: {
    hasPlacedOrder,
  },
};
