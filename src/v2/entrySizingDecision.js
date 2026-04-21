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

function validateEntryIntent(entryIntent) {
  const intent = entryIntent && typeof entryIntent === "object" ? entryIntent : null;
  if (!intent) throw new Error("ENTRY_INTENT_REQUIRED");
  const entryIntentId = trimOrNull(intent.entry_intent_id);
  const symbol = upper(intent.symbol);
  const side = upper(intent.side);
  if (!entryIntentId) throw new Error("ENTRY_INTENT_ID_REQUIRED");
  if (!symbol) throw new Error("SYMBOL_REQUIRED");
  if (side !== "LONG" && side !== "SHORT") throw new Error("POSITION_SIDE_REQUIRED");
  return Object.freeze({ entryIntentId, symbol, side });
}

function decimalPlacesFromStep(step) {
  const n = Number(step);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const raw = String(step == null ? "" : step).trim();
  if (raw && !/[eE]/.test(raw)) {
    const idx = raw.indexOf(".");
    if (idx === -1) return 0;
    return raw.slice(idx + 1).replace(/0+$/, "").length;
  }
  for (let p = 0; p <= 12; p += 1) {
    const scaled = n * Math.pow(10, p);
    if (Math.abs(scaled - Math.round(scaled)) < 1e-8) return p;
  }
  return 10;
}

function ceilToStep(value, step) {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(s) || s <= 0) return v;
  const precision = decimalPlacesFromStep(s);
  const units = Math.ceil((v - (s * 1e-12)) / s);
  const ceiled = units * s;
  return Number(ceiled.toFixed(Math.max(0, Math.min(12, precision))));
}

function buildBlockedDecision({
  entryIntent,
  reason,
  referencePrice = null,
  requestedNotionalQuote = null,
  maxNotionalQuote = null,
  minNotionalQuote = null,
  minQtyAbs = null,
  stepSize = null,
  detail = null,
} = {}) {
  const intent = validateEntryIntent(entryIntent);
  return Object.freeze({
    ok: false,
    status: "BLOCKED",
    reason: upper(reason) || "ENTRY_SIZING_BLOCKED",
    entry_intent_id: intent.entryIntentId,
    symbol: intent.symbol,
    side: intent.side,
    entry_qty_abs: null,
    notional_quote: null,
    reference_price: toNumberOrNull(referencePrice),
    requested_notional_quote: toNumberOrNull(requestedNotionalQuote),
    max_notional_quote: toNumberOrNull(maxNotionalQuote),
    min_notional_quote: toNumberOrNull(minNotionalQuote),
    min_qty_abs: toNumberOrNull(minQtyAbs),
    step_size: toNumberOrNull(stepSize),
    detail: detail && typeof detail === "object" ? Object.freeze({ ...detail }) : Object.freeze({}),
  });
}

function buildV2EntrySizingDecision({
  entryIntent,
  referencePrice,
  requestedNotionalQuote,
  maxNotionalQuote,
  minNotionalQuote = 0,
  minQtyAbs = 0,
  stepSize = null,
  allowMinOrderBump = false,
  createdAt = null,
} = {}) {
  const intent = validateEntryIntent(entryIntent);
  const price = toNumberOrNull(referencePrice);
  const requested = toNumberOrNull(requestedNotionalQuote);
  const maxNotional = toNumberOrNull(maxNotionalQuote);
  const minNotional = Math.max(0, toNumberOrNull(minNotionalQuote) || 0);
  const minQty = Math.max(0, toNumberOrNull(minQtyAbs) || 0);
  const step = toNumberOrNull(stepSize);

  if (!(price > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "REFERENCE_PRICE_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize });
  }
  if (!(requested > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "REQUESTED_NOTIONAL_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize });
  }
  if (!(maxNotional > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "MAX_NOTIONAL_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize });
  }
  if (requested > maxNotional) {
    return buildBlockedDecision({ entryIntent, reason: "REQUESTED_NOTIONAL_EXCEEDS_BUDGET", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize });
  }

  let targetNotional = requested;
  let sizingReason = "REQUESTED_NOTIONAL_ACCEPTED";
  if (targetNotional < minNotional) {
    if (allowMinOrderBump === true && minNotional <= maxNotional) {
      targetNotional = minNotional;
      sizingReason = "MIN_NOTIONAL_BUMPED";
    } else {
      return buildBlockedDecision({
        entryIntent,
        reason: "MIN_ORDER_EXCEEDS_BUDGET",
        referencePrice,
        requestedNotionalQuote,
        maxNotionalQuote,
        minNotionalQuote,
        minQtyAbs,
        stepSize,
        detail: { required_notional_quote: minNotional },
      });
    }
  }

  let qty = ceilToStep(targetNotional / price, step);
  if (!(qty > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "ENTRY_QTY_ABS_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize });
  }

  if (qty < minQty) {
    const minQtyNotional = minQty * price;
    if (allowMinOrderBump === true && minQtyNotional <= maxNotional) {
      qty = ceilToStep(minQty, step);
      targetNotional = qty * price;
      sizingReason = "MIN_QTY_BUMPED";
    } else {
      return buildBlockedDecision({
        entryIntent,
        reason: "MIN_QTY_EXCEEDS_BUDGET",
        referencePrice,
        requestedNotionalQuote,
        maxNotionalQuote,
        minNotionalQuote,
        minQtyAbs,
        stepSize,
        detail: { required_notional_quote: minQtyNotional },
      });
    }
  }

  const finalNotional = qty * price;
  if (finalNotional > maxNotional + 1e-9) {
    return buildBlockedDecision({
      entryIntent,
      reason: "STEP_SIZE_EXCEEDS_BUDGET",
      referencePrice,
      requestedNotionalQuote,
      maxNotionalQuote,
      minNotionalQuote,
      minQtyAbs,
      stepSize,
      detail: { final_notional_quote: finalNotional },
    });
  }
  if (finalNotional + 1e-9 < minNotional) {
    return buildBlockedDecision({
      entryIntent,
      reason: "FINAL_NOTIONAL_BELOW_MIN_ORDER",
      referencePrice,
      requestedNotionalQuote,
      maxNotionalQuote,
      minNotionalQuote,
      minQtyAbs,
      stepSize,
      detail: { final_notional_quote: finalNotional },
    });
  }

  return Object.freeze({
    ok: true,
    status: "APPROVED",
    reason: sizingReason,
    entry_intent_id: intent.entryIntentId,
    symbol: intent.symbol,
    side: intent.side,
    entry_qty_abs: qty,
    notional_quote: finalNotional,
    reference_price: price,
    requested_notional_quote: requested,
    max_notional_quote: maxNotional,
    min_notional_quote: minNotional,
    min_qty_abs: minQty,
    step_size: step,
    allow_min_order_bump: allowMinOrderBump === true,
    created_at: trimOrNull(createdAt) || new Date().toISOString(),
  });
}

function buildEntryQuantityResolverFromSizingDecision(sizingDecision) {
  const decision = sizingDecision && typeof sizingDecision === "object" ? sizingDecision : null;
  if (!decision) throw new Error("ENTRY_SIZING_DECISION_REQUIRED");
  if (decision.ok !== true || upper(decision.status) !== "APPROVED") {
    throw new Error("ENTRY_SIZING_DECISION_NOT_APPROVED");
  }
  const qty = toNumberOrNull(decision.entry_qty_abs);
  if (!(qty > 0)) throw new Error("ENTRY_SIZING_QTY_ABS_REQUIRED");
  const decisionIntentId = trimOrNull(decision.entry_intent_id);
  const decisionSymbol = upper(decision.symbol);
  const decisionSide = upper(decision.side);
  return function resolveEntryQuantity({ entryIntent } = {}) {
    const intent = validateEntryIntent(entryIntent);
    if (intent.entryIntentId !== decisionIntentId) throw new Error("ENTRY_SIZING_INTENT_MISMATCH");
    if (intent.symbol !== decisionSymbol) throw new Error("ENTRY_SIZING_SYMBOL_MISMATCH");
    if (intent.side !== decisionSide) throw new Error("ENTRY_SIZING_SIDE_MISMATCH");
    return qty;
  };
}

module.exports = {
  buildV2EntrySizingDecision,
  buildEntryQuantityResolverFromSizingDecision,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    validateEntryIntent,
    decimalPlacesFromStep,
    ceilToStep,
    buildBlockedDecision,
  },
};
