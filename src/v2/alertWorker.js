"use strict";

const { buildTradeAlertOutboxDoc } = require("./contracts");
const { V2_ALERT_STATUSES } = require("./constants");
const EPSILON = 1e-8;

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

function isTerminalStage(stage) {
  const normalized = upper(stage);
  return normalized === "EXITED_SL"
    || normalized === "EXITED_TRAIL"
    || normalized === "EXITED_EXTERNAL"
    || normalized === "EXITED_MANUAL";
}

function validateTerminalAlertLedger({ positionCycle, transition, projection } = {}) {
  const stage = upper(transition && transition.next_stage);
  if (!isTerminalStage(stage)) return null;
  if (upper(projection && projection.health_status) !== "TERMINAL_EXITED") {
    throw new Error("ALERT_TERMINAL_HEALTH_STATUS_MISMATCH");
  }
  const runnerRemainingQtyAbs = toNumberOrNull(projection && projection.runner_remaining_qty_abs);
  if (runnerRemainingQtyAbs !== 0) {
    throw new Error("ALERT_TERMINAL_RUNNER_REMAINING_MISMATCH");
  }
  const entryQtyAbs = toNumberOrNull(positionCycle && positionCycle.entry_qty_abs);
  const tp1FilledQtyAbs = toNumberOrNull(projection && projection.tp1_filled_qty_abs) || 0;
  const finalExitQtyAbs = toNumberOrNull(
    transition
    && transition.ledger_patch
    && transition.ledger_patch.final_exit_qty_abs
  );
  if (!(entryQtyAbs > 0)) throw new Error("ALERT_ENTRY_QTY_REQUIRED");
  if (!(finalExitQtyAbs >= 0)) throw new Error("ALERT_TERMINAL_EXIT_QTY_MISSING");
  const expectedFinalExitQtyAbs = Number((entryQtyAbs - tp1FilledQtyAbs).toFixed(8));
  if (Math.abs(finalExitQtyAbs - expectedFinalExitQtyAbs) > EPSILON) {
    throw new Error("ALERT_TERMINAL_EXIT_QTY_MISMATCH");
  }
  return finalExitQtyAbs;
}

function resolveTransitionLabel(event) {
  const kind = upper(event);
  if (kind === "TP1_REACHED") return "TP1";
  if (kind === "TRAIL_ACTIVATED") return "TRAIL_START";
  if (kind === "SL_HIT") return "SL";
  if (kind === "TRAIL_HIT") return "TRAIL_EXIT";
  if (kind === "EXTERNAL_CLOSE_SYNC") return "EXTERNAL_EXIT";
  if (kind === "MANUAL_CLOSE_SYNC") return "MANUAL_EXIT";
  return null;
}

function buildPrepFailureOutbox({ transition, reason, attemptCount = 0 } = {}) {
  return buildTradeAlertOutboxDoc({
    canonicalTransitionId: transition.canonical_transition_id,
    positionCycleId: transition.position_cycle_id,
    alertType: "EXIT_TRANSITION_ALERT",
    status: "FAILED",
    attemptCount,
    lastReason: reason,
  });
}

function prepareExitTransitionAlert({
  positionCycle,
  transition,
  projection,
  attemptCount = 0,
} = {}) {
  if (!transition || typeof transition !== "object") {
    throw new Error("CANONICAL_TRANSITION_REQUIRED");
  }
  const canonicalTransitionId = trimOrNull(transition.canonical_transition_id);
  const positionCycleId = trimOrNull(transition.position_cycle_id);
  if (!canonicalTransitionId) throw new Error("canonical_transition_id_REQUIRED");
  if (!positionCycleId) throw new Error("position_cycle_id_REQUIRED");

  const pendingOutbox = buildTradeAlertOutboxDoc({
    canonicalTransitionId,
    positionCycleId,
    alertType: "EXIT_TRANSITION_ALERT",
    status: "PENDING",
    attemptCount,
  });

  try {
    if (!positionCycle || typeof positionCycle !== "object") throw new Error("POSITION_CYCLE_REQUIRED");
    if (!projection || typeof projection !== "object") throw new Error("PROJECTION_REQUIRED");
    if (trimOrNull(positionCycle.position_cycle_id) !== positionCycleId) {
      throw new Error("ALERT_POSITION_CYCLE_MISMATCH");
    }
    if (trimOrNull(projection.position_cycle_id) !== positionCycleId) {
      throw new Error("ALERT_PROJECTION_MISMATCH");
    }
    if (upper(projection.stage) !== upper(transition.next_stage)) {
      throw new Error("ALERT_STAGE_MISMATCH");
    }
    const symbol = trimOrNull(positionCycle.symbol);
    const side = upper(positionCycle.position_side);
    const event = upper(transition.transition_event);
    const label = resolveTransitionLabel(event);
    const terminalExitQtyAbs = validateTerminalAlertLedger({ positionCycle, transition, projection });
    if (!symbol) throw new Error("ALERT_SYMBOL_REQUIRED");
    if (!side) throw new Error("ALERT_POSITION_SIDE_REQUIRED");
    if (!label) throw new Error("ALERT_TRANSITION_EVENT_UNSUPPORTED");

    const bodyLines = [
      `event=${event}`,
      `stage=${upper(transition.next_stage)}`,
      `side=${side}`,
      `cycle=${positionCycleId}`,
    ];
    if (terminalExitQtyAbs != null) {
      bodyLines.push(`final_exit_qty_abs=${terminalExitQtyAbs}`);
    }

    const payload = Object.freeze({
      canonical_transition_id: canonicalTransitionId,
      position_cycle_id: positionCycleId,
      event,
      stage: upper(transition.next_stage),
      symbol,
      side,
      title: `[${symbol}] ${label}`,
      body: bodyLines.join("\n"),
    });

    return Object.freeze({
      ok: true,
      outbox: pendingOutbox,
      payload,
      reason: null,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      outbox: buildPrepFailureOutbox({
        transition,
        reason: error && error.message ? error.message : "ALERT_PREP_FAILED",
        attemptCount,
      }),
      payload: null,
      reason: error && error.message ? error.message : "ALERT_PREP_FAILED",
    });
  }
}

function applyAlertDeliveryResult({
  outbox,
  deliveryOk,
  deliveryReason = null,
  sentAt = null,
} = {}) {
  if (!outbox || typeof outbox !== "object") throw new Error("ALERT_OUTBOX_REQUIRED");
  const nextAttemptCount = Math.max(0, Number(outbox.attempt_count) || 0) + 1;
  const status = deliveryOk === true ? "SENT" : "FAILED";
  if (!V2_ALERT_STATUSES.includes(status)) throw new Error("ALERT_STATUS_INVALID");
  return Object.freeze({
    ...outbox,
    status,
    attempt_count: nextAttemptCount,
    last_reason: deliveryOk === true ? null : trimOrNull(deliveryReason) || "ALERT_DELIVERY_FAILED",
    sent_at: deliveryOk === true ? (trimOrNull(sentAt) || new Date().toISOString()) : null,
    last_attempt_at: trimOrNull(sentAt) || new Date().toISOString(),
  });
}

module.exports = {
  prepareExitTransitionAlert,
  applyAlertDeliveryResult,
  __test: {
    resolveTransitionLabel,
    isTerminalStage,
    validateTerminalAlertLedger,
  },
};
