"use strict";

const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const { buildV2EntrySizingDecision } = require("./entrySizingDecision");
const { LIVE_CONFIRM_PHRASE } = require("./productionEntryLiveEndpoint");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function buildBlock(reason, extra = {}) {
  return Object.freeze({
    ok: false,
    reason,
    body: null,
    entrySizingDecision: null,
    ...extra,
  });
}

function buildV2ProductionEntryLiveRequest({
  bundle,
  sizing = {},
  confirm = LIVE_CONFIRM_PHRASE,
  now = () => new Date().toISOString(),
} = {}) {
  const sourceBundle = asObject(bundle);
  if (!sourceBundle) return buildBlock("V2_PRODUCTION_ENTRY_LIVE_BUNDLE_REQUIRED");

  const routedDecision = resolveEntryIntentFromOpenClaw(sourceBundle);
  if (!routedDecision || routedDecision.ok !== true) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE", {
      routedDecision,
    });
  }

  const sizingDecision = buildV2EntrySizingDecision({
    entryIntent: routedDecision.entryIntent,
    referencePrice: sizing.referencePrice ?? sizing.reference_price,
    requestedNotionalQuote: sizing.requestedNotionalQuote ?? sizing.requested_notional_quote,
    maxNotionalQuote: sizing.maxNotionalQuote ?? sizing.max_notional_quote,
    minNotionalQuote: sizing.minNotionalQuote ?? sizing.min_notional_quote,
    minQtyAbs: sizing.minQtyAbs ?? sizing.min_qty_abs,
    stepSize: sizing.stepSize ?? sizing.step_size,
    allowMinOrderBump: sizing.allowMinOrderBump === true || sizing.allow_min_order_bump === true,
    createdAt: trimOrNull(sizing.createdAt || sizing.created_at) || trimOrNull(now()) || new Date().toISOString(),
  });

  if (!sizingDecision.ok) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_SIZING_NOT_APPROVED", {
      routedDecision,
      entrySizingDecision: sizingDecision,
    });
  }

  const enrichedBundle = Object.freeze({
    ...sourceBundle,
    entrySizingDecision: sizingDecision,
  });

  return Object.freeze({
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_LIVE_REQUEST_READY",
    routedDecision,
    entrySizingDecision: sizingDecision,
    body: Object.freeze({
      confirm,
      bundle: enrichedBundle,
      entrySizingDecision: sizingDecision,
      request_contract: Object.freeze({
        ok: true,
        reason: "V2_PRODUCTION_ENTRY_LIVE_REQUEST_EMBEDS_SIZING",
        entry_intent_id: sizingDecision.entry_intent_id,
        symbol: sizingDecision.symbol,
        side: sizingDecision.side,
        entry_qty_abs: sizingDecision.entry_qty_abs,
        notional_quote: sizingDecision.notional_quote,
      }),
    }),
  });
}

module.exports = {
  buildV2ProductionEntryLiveRequest,
  __test: {
    trimOrNull,
    asObject,
  },
};
