"use strict";

const { V2_SIMPLE_EXIT_CONTRACT } = require("./exitPolicy");

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
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

function floorToStep(value, step) {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(s) || s <= 0) return v;
  const precision = decimalPlacesFromStep(s);
  const units = Math.floor((v + (s * 1e-12)) / s);
  const floored = units * s;
  return Number(floored.toFixed(Math.max(0, Math.min(12, precision))));
}

function resolveMaxSizeRatio({
  maxSizeRatio = null,
  max_size_ratio = null,
  sizingCap = null,
  sizing_cap = null,
  executionPermit = null,
  execution_permit = null,
} = {}) {
  const cap = asObject(sizingCap) || asObject(sizing_cap) || asObject(asObject(executionPermit) && executionPermit.sizing_cap) || asObject(asObject(execution_permit) && execution_permit.sizing_cap);
  const candidates = [
    maxSizeRatio,
    max_size_ratio,
    cap && cap.max_size_ratio,
    cap && cap.size_ratio_max,
    cap && cap.ml_max_size_ratio,
  ];
  for (const candidate of candidates) {
    const n = toNumberOrNull(candidate);
    if (n !== null) return n;
  }
  return null;
}

function evaluateTpFullMinNotional({
  entryQtyAbs = null,
  referencePrice = null,
  minNotionalQuote = null,
  stepSize = null,
  tp1QtyRatio = V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio,
} = {}) {
  const qty = toNumberOrNull(entryQtyAbs);
  const price = toNumberOrNull(referencePrice);
  const minNotional = toNumberOrNull(minNotionalQuote);
  const step = toNumberOrNull(stepSize);
  const ratio = toNumberOrNull(tp1QtyRatio);
  const tp1QtyAbs = floorToStep(Number.isFinite(qty) && Number.isFinite(ratio) ? qty * ratio : null, step);
  const tp1NotionalQuote = Number.isFinite(tp1QtyAbs) && Number.isFinite(price)
    ? tp1QtyAbs * price
    : null;
  const evidenceOk = Number.isFinite(qty)
    && Number.isFinite(price)
    && Number.isFinite(minNotional)
    && Number.isFinite(step)
    && Number.isFinite(ratio)
    && ratio > 0
    && ratio <= 1;
  return Object.freeze({
    ok: evidenceOk && tp1NotionalQuote + 1e-9 >= minNotional,
    evidence_ok: evidenceOk,
    entry_qty_abs: qty,
    reference_price: price,
    min_notional_quote: minNotional,
    step_size: step,
    tp1_qty_ratio: ratio,
    tp1_qty_abs: Number.isFinite(tp1QtyAbs) ? tp1QtyAbs : null,
    tp1_notional_quote: Number.isFinite(tp1NotionalQuote) ? tp1NotionalQuote : null,
  });
}

function assertTpFullMinNotionalSupported(sizingDecision, { tp1QtyRatio = V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio } = {}) {
  const decision = sizingDecision && typeof sizingDecision === "object" ? sizingDecision : null;
  if (!decision) throw new Error("ENTRY_SIZING_DECISION_REQUIRED");
  const check = evaluateTpFullMinNotional({
    entryQtyAbs: decision.entry_qty_abs,
    referencePrice: decision.reference_price,
    minNotionalQuote: decision.min_notional_quote,
    stepSize: decision.step_size,
    tp1QtyRatio,
  });
  if (check.evidence_ok !== true) {
    const error = new Error("ENTRY_SIZING_TP_FULL_EVIDENCE_REQUIRED");
    error.tpFullMinNotional = check;
    throw error;
  }
  if (check.ok !== true) {
    const error = new Error("ENTRY_SIZING_TP_FULL_MIN_NOTIONAL_REQUIRED");
    error.tpFullMinNotional = check;
    throw error;
  }
  return check;
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
  maxSizeRatio = null,
  sizingCapNotionalQuote = null,
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
    max_size_ratio: toNumberOrNull(maxSizeRatio),
    sizing_cap_notional_quote: toNumberOrNull(sizingCapNotionalQuote),
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
  maxSizeRatio = null,
  max_size_ratio = null,
  sizingCap = null,
  sizing_cap = null,
  executionPermit = null,
  execution_permit = null,
  allowMinOrderBump = false,
  requirePartialTp1MinNotional = false,
  require_partial_tp1_min_notional = false,
  tp1QtyRatio = V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio,
  tp1_qty_ratio = null,
  createdAt = null,
} = {}) {
  const intent = validateEntryIntent(entryIntent);
  const price = toNumberOrNull(referencePrice);
  const requested = toNumberOrNull(requestedNotionalQuote);
  const maxNotional = toNumberOrNull(maxNotionalQuote);
  const minNotional = Math.max(0, toNumberOrNull(minNotionalQuote) || 0);
  const minQty = Math.max(0, toNumberOrNull(minQtyAbs) || 0);
  const step = toNumberOrNull(stepSize);
  const resolvedMaxSizeRatio = resolveMaxSizeRatio({
    maxSizeRatio,
    max_size_ratio,
    sizingCap,
    sizing_cap,
    executionPermit,
    execution_permit,
  });

  if (!(price > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "REFERENCE_PRICE_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize, maxSizeRatio: resolvedMaxSizeRatio });
  }
  if (!(requested > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "REQUESTED_NOTIONAL_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize, maxSizeRatio: resolvedMaxSizeRatio });
  }
  if (!(maxNotional > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "MAX_NOTIONAL_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize, maxSizeRatio: resolvedMaxSizeRatio });
  }
  if (resolvedMaxSizeRatio !== null && !(resolvedMaxSizeRatio > 0 && resolvedMaxSizeRatio <= 1)) {
    return buildBlockedDecision({
      entryIntent,
      reason: "ML_MAX_SIZE_RATIO_INVALID",
      referencePrice,
      requestedNotionalQuote,
      maxNotionalQuote,
      minNotionalQuote,
      minQtyAbs,
      stepSize,
      maxSizeRatio: resolvedMaxSizeRatio,
    });
  }
  if (requested > maxNotional) {
    return buildBlockedDecision({ entryIntent, reason: "REQUESTED_NOTIONAL_EXCEEDS_BUDGET", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize, maxSizeRatio: resolvedMaxSizeRatio });
  }

  const sizingCapNotional = resolvedMaxSizeRatio !== null ? maxNotional * resolvedMaxSizeRatio : maxNotional;
  let targetNotional = Math.min(requested, sizingCapNotional);
  let sizingReason = "REQUESTED_NOTIONAL_ACCEPTED";
  if (targetNotional < requested) {
    sizingReason = "ML_SIZE_RATIO_CAPPED";
  }
  if (targetNotional < minNotional) {
    if (allowMinOrderBump === true && minNotional <= maxNotional && minNotional <= sizingCapNotional) {
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
        maxSizeRatio: resolvedMaxSizeRatio,
        sizingCapNotionalQuote: sizingCapNotional,
        detail: { required_notional_quote: minNotional },
      });
    }
  }

  let qty = ceilToStep(targetNotional / price, step);
  if (!(qty > 0)) {
    return buildBlockedDecision({ entryIntent, reason: "ENTRY_QTY_ABS_REQUIRED", referencePrice, requestedNotionalQuote, maxNotionalQuote, minNotionalQuote, minQtyAbs, stepSize, maxSizeRatio: resolvedMaxSizeRatio, sizingCapNotionalQuote: sizingCapNotional });
  }

  if (qty < minQty) {
    const minQtyNotional = minQty * price;
    if (allowMinOrderBump === true && minQtyNotional <= maxNotional && minQtyNotional <= sizingCapNotional) {
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
        maxSizeRatio: resolvedMaxSizeRatio,
        sizingCapNotionalQuote: sizingCapNotional,
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
      maxSizeRatio: resolvedMaxSizeRatio,
      sizingCapNotionalQuote: sizingCapNotional,
      detail: { final_notional_quote: finalNotional },
    });
  }
  if (finalNotional > sizingCapNotional + 1e-9) {
    return buildBlockedDecision({
      entryIntent,
      reason: "STEP_SIZE_EXCEEDS_ML_SIZE_CAP",
      referencePrice,
      requestedNotionalQuote,
      maxNotionalQuote,
      minNotionalQuote,
      minQtyAbs,
      stepSize,
      maxSizeRatio: resolvedMaxSizeRatio,
      sizingCapNotionalQuote: sizingCapNotional,
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
      maxSizeRatio: resolvedMaxSizeRatio,
      sizingCapNotionalQuote: sizingCapNotional,
      detail: { final_notional_quote: finalNotional },
    });
  }

  const tpFullRequired = requirePartialTp1MinNotional === true || require_partial_tp1_min_notional === true;
  const resolvedTp1QtyRatio = toNumberOrNull(tp1_qty_ratio) ?? toNumberOrNull(tp1QtyRatio) ?? V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio;
  if (tpFullRequired) {
    const tpFullCheck = evaluateTpFullMinNotional({
      entryQtyAbs: qty,
      referencePrice: price,
      minNotionalQuote: minNotional,
      stepSize: step,
      tp1QtyRatio: resolvedTp1QtyRatio,
    });
    if (tpFullCheck.evidence_ok !== true) {
      return buildBlockedDecision({
        entryIntent,
        reason: "TP_FULL_EVIDENCE_REQUIRED",
        referencePrice,
        requestedNotionalQuote,
        maxNotionalQuote,
        minNotionalQuote,
        minQtyAbs,
        stepSize,
        maxSizeRatio: resolvedMaxSizeRatio,
        sizingCapNotionalQuote: sizingCapNotional,
        detail: tpFullCheck,
      });
    }
    if (tpFullCheck.ok !== true) {
      return buildBlockedDecision({
        entryIntent,
        reason: "TP_FULL_MIN_NOTIONAL_REQUIRED",
        referencePrice,
        requestedNotionalQuote,
        maxNotionalQuote,
        minNotionalQuote,
        minQtyAbs,
        stepSize,
        maxSizeRatio: resolvedMaxSizeRatio,
        sizingCapNotionalQuote: sizingCapNotional,
        detail: tpFullCheck,
      });
    }
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
    max_size_ratio: resolvedMaxSizeRatio,
    sizing_cap_notional_quote: sizingCapNotional,
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
  evaluateTpFullMinNotional,
  assertTpFullMinNotionalSupported,
  evaluatePartialTp1MinNotional: evaluateTpFullMinNotional,
  assertPartialTp1MinNotionalSupported: assertTpFullMinNotionalSupported,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    asObject,
    validateEntryIntent,
    decimalPlacesFromStep,
    ceilToStep,
    floorToStep,
    resolveMaxSizeRatio,
    evaluateTpFullMinNotional,
    evaluatePartialTp1MinNotional: evaluateTpFullMinNotional,
    buildBlockedDecision,
  },
};
