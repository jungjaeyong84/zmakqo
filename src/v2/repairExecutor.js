"use strict";

const TERMINAL_STAGES = new Set(["EXITED_TP1", "EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveTp1RepairTargetPrice({ repairRequest, projection, protectionRuntime } = {}) {
  const detail = repairRequest && repairRequest.detail && typeof repairRequest.detail === "object"
    ? repairRequest.detail
    : {};
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  return toNumberOrNull(detail.tp1_target_price)
    ?? toNumberOrNull(detail.tp1_trigger_price)
    ?? toNumberOrNull(projection && projection.tp1_target_price)
    ?? toNumberOrNull(runtime.native_tp1_price);
}

function resolveTp1RepairQuantityAbs({ repairRequest, projection } = {}) {
  const detail = repairRequest && repairRequest.detail && typeof repairRequest.detail === "object"
    ? repairRequest.detail
    : {};
  return toNumberOrNull(detail.tp1_qty_abs)
    ?? toNumberOrNull(detail.expected_tp_qty_base)
    ?? toNumberOrNull(detail.expected_tp1_qty_abs)
    ?? toNumberOrNull(detail.requested_tp1_qty_abs)
    ?? toNumberOrNull(projection && projection.tp1_target_qty_abs);
}

function hasPlacedRuntimeOrder(runtime, orderKey, statusKey) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  const orderId = trimOrNull(row[orderKey]);
  const status = upper(row[statusKey]);
  if (!orderId) return false;
  if (!status) return true;
  return status === "PLACED";
}

function resolveFullProtectionStopPrice({ repairRequest, projection } = {}) {
  const detail = repairRequest && repairRequest.detail && typeof repairRequest.detail === "object"
    ? repairRequest.detail
    : {};
  return toNumberOrNull(detail.chosen_stop_price)
    ?? toNumberOrNull(detail.final_effective_stop)
    ?? toNumberOrNull(projection && projection.final_effective_stop)
    ?? toNumberOrNull(projection && projection.chosen_stop_price);
}

function buildProtectionRepairCommand({
  repairRequest,
  projection,
  protectionRuntime,
} = {}) {
  if (!repairRequest || typeof repairRequest !== "object") throw new Error("REPAIR_REQUEST_REQUIRED");
  if (!projection || typeof projection !== "object") throw new Error("PROJECTION_REQUIRED");
  if (trimOrNull(repairRequest.position_cycle_id) !== trimOrNull(projection.position_cycle_id)) {
    throw new Error("REPAIR_REQUEST_PROJECTION_MISMATCH");
  }
  const stage = upper(projection.stage);
  if (TERMINAL_STAGES.has(stage)) {
    throw new Error("TERMINAL_STAGE_REPAIR_FORBIDDEN");
  }

  const issueCode = upper(repairRequest.issue_code);
  const requestedAction = upper(repairRequest.requested_action);
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};

  if ((issueCode === "TP1_ORDER_MISSING" || issueCode === "TP1_ORDER_QTY_MISMATCH") && requestedAction === "ENSURE_TP1_ORDER") {
    const targetPrice = resolveTp1RepairTargetPrice({
      repairRequest,
      projection,
      protectionRuntime: runtime,
    });
    const quantityAbs = resolveTp1RepairQuantityAbs({
      repairRequest,
      projection,
    });
    if (!(targetPrice > 0)) throw new Error("TP1_REPAIR_TARGET_PRICE_REQUIRED");
    if (!(quantityAbs > 0)) throw new Error("TP1_REPAIR_QUANTITY_REQUIRED");
    return Object.freeze({
      position_cycle_id: projection.position_cycle_id,
      command_type: "PLACE_OR_REPLACE_TP1",
      stage_snapshot: stage,
      target_price: targetPrice,
      quantity_abs: quantityAbs,
      detail: {
        existing_tp1_order_id: trimOrNull(runtime.tp1_order_id),
      },
    });
  }

  if ((issueCode === "TRAIL_STOP_MISSING" || issueCode === "NATIVE_REFRESH_UNHEALTHY") && requestedAction === "REFRESH_NATIVE_STOP") {
    return Object.freeze({
      position_cycle_id: projection.position_cycle_id,
      command_type: "REFRESH_NATIVE_STOP",
      stage_snapshot: stage,
      refresh_reason: issueCode,
      target_price: projection.final_effective_stop,
      detail: {
        chosen_stop_source: upper(projection.chosen_stop_source),
        previous_native_stop_price: runtime.native_stop_price || null,
      },
    });
  }

  if (issueCode === "UNPROTECTED_ACTIVE_POSITION" && requestedAction === "ENSURE_FULL_PROTECTION") {
    const includeSlOrder = (
      !hasPlacedRuntimeOrder(runtime, "sl_order_id", "sl_order_status") ||
      !(toNumberOrNull(runtime.native_stop_price) > 0)
    );
    const includeTp1Order = (
      stage === "PRE_TP1" &&
      !hasPlacedRuntimeOrder(runtime, "tp1_order_id", "tp1_order_status")
    );
    if (includeSlOrder !== true && includeTp1Order !== true) {
      throw new Error("FULL_PROTECTION_REPAIR_NOT_REQUIRED");
    }
    const stopPrice = resolveFullProtectionStopPrice({
      repairRequest,
      projection,
    });
    const stopSource = upper(projection.chosen_stop_source);
    if (includeSlOrder === true && !(stopPrice > 0)) {
      throw new Error("FULL_PROTECTION_STOP_PRICE_REQUIRED");
    }
    if (includeSlOrder === true && !stopSource) {
      throw new Error("FULL_PROTECTION_STOP_SOURCE_REQUIRED");
    }
    const tp1TargetPrice = includeTp1Order === true
      ? resolveTp1RepairTargetPrice({
          repairRequest,
          projection,
          protectionRuntime: runtime,
        })
      : null;
    const tp1QuantityAbs = includeTp1Order === true
      ? resolveTp1RepairQuantityAbs({
          repairRequest,
          projection,
        })
      : null;
    if (includeTp1Order === true && !(tp1TargetPrice > 0)) {
      throw new Error("FULL_PROTECTION_TP1_PRICE_REQUIRED");
    }
    if (includeTp1Order === true && !(tp1QuantityAbs > 0)) {
      throw new Error("FULL_PROTECTION_TP1_QUANTITY_REQUIRED");
    }
    return Object.freeze({
      position_cycle_id: projection.position_cycle_id,
      command_type: "PLACE_OR_REPLACE_FULL_PROTECTION",
      stage_snapshot: stage,
      target_price: includeSlOrder === true ? stopPrice : null,
      quantity_abs: includeTp1Order === true ? tp1QuantityAbs : null,
      detail: {
        chosen_stop_source: stopSource,
        include_sl_order: includeSlOrder,
        include_tp1_order: includeTp1Order,
        tp1_target_price: includeTp1Order === true ? tp1TargetPrice : null,
        existing_sl_order_id: trimOrNull(runtime.sl_order_id),
        existing_tp1_order_id: trimOrNull(runtime.tp1_order_id),
      },
    });
  }

  throw new Error("REPAIR_REQUEST_UNHANDLED");
}

function buildRefreshStopRequestFromRepair({
  repairCommand,
  protectionRuntime,
} = {}) {
  if (!repairCommand || typeof repairCommand !== "object") throw new Error("REPAIR_COMMAND_REQUIRED");
  if (upper(repairCommand.command_type) !== "REFRESH_NATIVE_STOP") {
    throw new Error("REPAIR_COMMAND_REFRESH_STOP_REQUIRED");
  }
  const positionCycleId = trimOrNull(repairCommand.position_cycle_id);
  if (!positionCycleId) throw new Error("position_cycle_id_REQUIRED");
  const requestedStopPrice = toNumberOrNull(repairCommand.target_price);
  if (!(requestedStopPrice > 0)) throw new Error("target_price_REQUIRED");
  const detail = repairCommand.detail && typeof repairCommand.detail === "object" ? repairCommand.detail : {};
  const requestedStopSource = upper(detail.chosen_stop_source);
  if (!requestedStopSource) throw new Error("chosen_stop_source_REQUIRED");
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  if (trimOrNull(runtime.position_cycle_id) && trimOrNull(runtime.position_cycle_id) !== positionCycleId) {
    throw new Error("REPAIR_COMMAND_PROTECTION_RUNTIME_MISMATCH");
  }
  return Object.freeze({
    position_cycle_id: positionCycleId,
    requested_stop_price: requestedStopPrice,
    requested_stop_source: requestedStopSource,
    previous_native_stop_price: toNumberOrNull(detail.previous_native_stop_price) ?? toNumberOrNull(runtime.native_stop_price),
    reason: upper(repairCommand.refresh_reason) || "NATIVE_REFRESH_UNHEALTHY",
  });
}

module.exports = {
  buildProtectionRepairCommand,
  buildRefreshStopRequestFromRepair,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    resolveTp1RepairTargetPrice,
    resolveTp1RepairQuantityAbs,
    hasPlacedRuntimeOrder,
    resolveFullProtectionStopPrice,
  },
};
