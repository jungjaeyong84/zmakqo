"use strict";

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

function toBoolOrNull(value) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function clampMs(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function isInitialProtectionDeadlineErrorCode(code) {
  const normalized = upper(code);
  return normalized === "BINANCE_INITIAL_SL_WRITE_DEADLINE_EXCEEDED" ||
    normalized === "BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED" ||
    (/^BINANCE_INITIAL_/.test(normalized || "") && /DEADLINE_EXCEEDED$/.test(normalized || ""));
}

function isDeadlineFailedAck(ack) {
  const row = ack && typeof ack === "object" ? ack : {};
  return upper(row.status) === "FAILED" && isInitialProtectionDeadlineErrorCode(row.error_code);
}

function normalizeOrderId(order) {
  const row = order && typeof order === "object" ? order : {};
  return trimOrNull(row.orderId || row.order_id || row.algoId || row.algo_id);
}

function normalizeOrderClientId(order) {
  const row = order && typeof order === "object" ? order : {};
  return trimOrNull(row.clientOrderId || row.client_order_id || row.origClientOrderId || row.orig_client_order_id);
}

function normalizeOrderTriggerPrice(order) {
  const row = order && typeof order === "object" ? order : {};
  return toNumberOrNull(row.stopPrice)
    ?? toNumberOrNull(row.triggerPrice)
    ?? toNumberOrNull(row.stop_price)
    ?? toNumberOrNull(row.trigger_price);
}

function resolveExpectedOrderShape({ name, command } = {}) {
  const leg = upper(name);
  const row = command && typeof command === "object" ? command : {};
  if (leg === "SL") {
    return Object.freeze({
      type: "STOP_MARKET",
      closePosition: true,
      reduceOnly: null,
      quantityRequired: false,
    });
  }
  if (leg === "TP1") {
    return Object.freeze({
      type: "TAKE_PROFIT_MARKET",
      closePosition: false,
      reduceOnly: true,
      quantityRequired: Number(row.quantity_abs) > 0,
    });
  }
  throw new Error("INITIAL_PROTECTION_LEG_INVALID");
}

function orderMatchesCommand({ name, command, order } = {}) {
  const row = order && typeof order === "object" ? order : null;
  if (!row) return Object.freeze({ ok: false, reason: "ORDER_NOT_FOUND" });
  const cmd = command && typeof command === "object" ? command : {};
  const orderId = normalizeOrderId(row);
  if (!orderId) return Object.freeze({ ok: false, reason: "ORDER_ID_MISSING" });

  const expectedClientId = trimOrNull(cmd.client_order_key);
  const orderClientId = normalizeOrderClientId(row);
  if (expectedClientId && orderClientId && orderClientId !== expectedClientId) {
    return Object.freeze({ ok: false, reason: "CLIENT_ORDER_ID_MISMATCH" });
  }

  const orderStatus = upper(row.status || row.orderStatus || row.order_status);
  if (orderStatus && !["NEW", "PARTIALLY_FILLED"].includes(orderStatus)) {
    return Object.freeze({ ok: false, reason: "ORDER_STATUS_NOT_OPEN" });
  }

  const symbol = upper(row.symbol);
  if (upper(cmd.symbol) && symbol && symbol !== upper(cmd.symbol)) {
    return Object.freeze({ ok: false, reason: "SYMBOL_MISMATCH" });
  }

  const side = upper(row.side);
  if (upper(cmd.close_side) && side && side !== upper(cmd.close_side)) {
    return Object.freeze({ ok: false, reason: "SIDE_MISMATCH" });
  }

  const expected = resolveExpectedOrderShape({ name, command: cmd });
  const orderType = upper(row.type || row.orderType || row.order_type);
  if (orderType && orderType !== expected.type) {
    return Object.freeze({ ok: false, reason: "ORDER_TYPE_MISMATCH" });
  }

  const closePosition = toBoolOrNull(row.closePosition ?? row.close_position);
  if (expected.closePosition !== null && closePosition !== null && closePosition !== expected.closePosition) {
    return Object.freeze({ ok: false, reason: "CLOSE_POSITION_MISMATCH" });
  }
  const reduceOnly = toBoolOrNull(row.reduceOnly ?? row.reduce_only);
  if (expected.reduceOnly !== null && reduceOnly !== null && reduceOnly !== expected.reduceOnly) {
    return Object.freeze({ ok: false, reason: "REDUCE_ONLY_MISMATCH" });
  }
  if (expected.quantityRequired) {
    const qty = toNumberOrNull(row.origQty ?? row.orig_qty ?? row.quantity ?? row.qty);
    const expectedQty = toNumberOrNull(cmd.quantity_abs);
    if (qty != null && expectedQty != null && Math.abs(qty - expectedQty) > Math.max(1e-12, expectedQty * 1e-8)) {
      return Object.freeze({ ok: false, reason: "QUANTITY_MISMATCH" });
    }
  }

  return Object.freeze({ ok: true, reason: "MATCHED" });
}

function buildLatePlacedAck({ name, command, order, originalAck, observedAt } = {}) {
  const triggerPrice = normalizeOrderTriggerPrice(order)
    ?? toNumberOrNull(command && command.trigger_price)
    ?? toNumberOrNull(originalAck && originalAck.trigger_price);
  return Object.freeze({
    status: "PLACED",
    order_id: normalizeOrderId(order),
    trigger_price: triggerPrice,
    error_code: null,
    ack_at: trimOrNull(observedAt) || new Date().toISOString(),
    late_placed_after_abort: true,
    original_error_code: trimOrNull(originalAck && originalAck.error_code),
    late_placed_observed_at: trimOrNull(observedAt) || new Date().toISOString(),
    late_placed_client_order_key: trimOrNull(command && command.client_order_key),
    late_placed_reconcile_status: `${upper(name)}_LATE_PLACED_MATCHED`,
  });
}

function markLatePlacedReconcileStatus({ ack, name, status, reason } = {}) {
  const row = ack && typeof ack === "object" ? ack : {};
  return Object.freeze({
    ...row,
    late_placed_after_abort: false,
    late_placed_reconcile_status: trimOrNull(status) || `${upper(name)}_LATE_PLACED_NOT_FOUND`,
    late_placed_reconcile_reason: trimOrNull(reason),
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLatePlacedOrder({
  name,
  command,
  originalAck,
  fetchOrderByClientOrderId,
  now = () => new Date().toISOString(),
  sleepFn = sleep,
  maxPollMs = 60000,
  pollDelayMs = 2000,
} = {}) {
  if (!isDeadlineFailedAck(originalAck)) {
    return Object.freeze({
      ack: originalAck,
      observation: Object.freeze({
        leg: upper(name),
        attempted: false,
        reason: "ACK_NOT_DEADLINE_FAILED",
      }),
    });
  }
  if (typeof fetchOrderByClientOrderId !== "function") {
    return Object.freeze({
      ack: markLatePlacedReconcileStatus({
        ack: originalAck,
        name,
        status: `${upper(name)}_LATE_PLACED_RECONCILE_UNAVAILABLE`,
        reason: "FETCH_ORDER_FN_MISSING",
      }),
      observation: Object.freeze({
        leg: upper(name),
        attempted: false,
        reason: "FETCH_ORDER_FN_MISSING",
      }),
    });
  }

  const startedMs = Date.now();
  let attemptN = 0;
  let lastReason = "ORDER_NOT_FOUND";
  for (;;) {
    attemptN += 1;
    try {
      const order = await fetchOrderByClientOrderId({ name, command, originalAck });
      const match = orderMatchesCommand({ name, command, order });
      if (match.ok === true) {
        const observedAt = trimOrNull(now()) || new Date().toISOString();
        return Object.freeze({
          ack: buildLatePlacedAck({ name, command, order, originalAck, observedAt }),
          observation: Object.freeze({
            leg: upper(name),
            attempted: true,
            found: true,
            attempt_n: attemptN,
            reason: "LATE_PLACED_MATCHED",
            observed_at: observedAt,
          }),
        });
      }
      lastReason = match.reason;
    } catch (error) {
      lastReason = trimOrNull(error && error.message) || "FETCH_ORDER_FAILED";
    }

    const elapsed = Date.now() - startedMs;
    if (elapsed >= maxPollMs) break;
    const waitMs = Math.min(Math.max(0, pollDelayMs), Math.max(0, maxPollMs - elapsed));
    if (waitMs <= 0) break;
    await sleepFn(waitMs);
  }

  return Object.freeze({
    ack: markLatePlacedReconcileStatus({
      ack: originalAck,
      name,
      status: `${upper(name)}_LATE_PLACED_NOT_FOUND`,
      reason: lastReason,
    }),
    observation: Object.freeze({
      leg: upper(name),
      attempted: true,
      found: false,
      attempt_n: attemptN,
      reason: lastReason,
    }),
  });
}

async function reconcileInitialProtectionLatePlaced({
  slAck,
  tp1Ack,
  commands = {},
  fetchOrderByClientOrderId,
  env = process.env,
  now = () => new Date().toISOString(),
  sleepFn = sleep,
  maxPollMs = null,
  pollDelayMs = null,
} = {}) {
  if (!parseBool(env && env.DONBEOLJA_V2_INITIAL_PROTECTION_DEADLINE_ENABLED, true)) {
    return Object.freeze({
      slAck,
      tp1Ack,
      late_placed_after_abort: false,
      late_placed_legs: Object.freeze([]),
      observations: Object.freeze([Object.freeze({ attempted: false, reason: "INITIAL_PROTECTION_DEADLINE_RECONCILE_DISABLED" })]),
    });
  }
  const resolvedMaxPollMs = clampMs(
    maxPollMs ?? (env && env.DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_MAX_POLL_MS),
    60000,
    0,
    300000
  );
  const resolvedPollDelayMs = clampMs(
    pollDelayMs ?? (env && env.DONBEOLJA_V2_INITIAL_PROTECTION_LATE_PLACED_POLL_DELAY_MS),
    2000,
    0,
    60000
  );

  const [slResult, tp1Result] = await Promise.all([
    pollLatePlacedOrder({
      name: "SL",
      command: commands.sl,
      originalAck: slAck,
      fetchOrderByClientOrderId,
      now,
      sleepFn,
      maxPollMs: resolvedMaxPollMs,
      pollDelayMs: resolvedPollDelayMs,
    }),
    pollLatePlacedOrder({
      name: "TP1",
      command: commands.tp1,
      originalAck: tp1Ack,
      fetchOrderByClientOrderId,
      now,
      sleepFn,
      maxPollMs: resolvedMaxPollMs,
      pollDelayMs: resolvedPollDelayMs,
    }),
  ]);
  const latePlacedLegs = [
    slResult.ack && slResult.ack.late_placed_after_abort === true ? "SL" : null,
    tp1Result.ack && tp1Result.ack.late_placed_after_abort === true ? "TP1" : null,
  ].filter(Boolean);

  return Object.freeze({
    slAck: slResult.ack,
    tp1Ack: tp1Result.ack,
    late_placed_after_abort: latePlacedLegs.length > 0,
    late_placed_legs: Object.freeze(latePlacedLegs),
    observations: Object.freeze([slResult.observation, tp1Result.observation]),
  });
}

module.exports = {
  reconcileInitialProtectionLatePlaced,
  isInitialProtectionDeadlineErrorCode,
  orderMatchesCommand,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    toBoolOrNull,
    parseBool,
    clampMs,
    isDeadlineFailedAck,
    normalizeOrderId,
    normalizeOrderClientId,
    normalizeOrderTriggerPrice,
    buildLatePlacedAck,
    markLatePlacedReconcileStatus,
    pollLatePlacedOrder,
  },
};
