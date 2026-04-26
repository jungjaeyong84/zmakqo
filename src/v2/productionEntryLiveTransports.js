"use strict";

const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const {
  buildEntryQuantityResolverFromSizingDecision,
  assertPartialTp1MinNotionalSupported,
} = require("./entrySizingDecision");
const { buildBinanceEntryOrderTransport } = require("./binanceEntryOrderTransport");
const { buildBinanceInitialProtectionTransports } = require("./binanceInitialProtectionTransport");
const { resolveDefaultLiveFuturesConfig } = require("./binanceRepairLiveCfgResolver");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeSizingComparable(row = null) {
  const value = asObject(row);
  if (!value) return null;
  return Object.freeze({
    ok: value.ok === true,
    status: upper(value.status),
    entry_intent_id: trimOrNull(value.entry_intent_id),
    symbol: upper(value.symbol),
    side: upper(value.side),
    entry_qty_abs: Number(value.entry_qty_abs),
    reference_price: Number(value.reference_price),
  });
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sizingDecisionsConflict(left = null, right = null) {
  const a = normalizeSizingComparable(left);
  const b = normalizeSizingComparable(right);
  if (!a || !b) return false;
  return Object.keys(a).some((key) => {
    if (Number.isNaN(a[key]) && Number.isNaN(b[key])) return false;
    return a[key] !== b[key];
  });
}

function extractSizingDecision({ body = null, bundle = null } = {}) {
  const bodyRow = asObject(body);
  const bundleRow = asObject(bundle);
  const bodyDecision = bodyRow
    ? asObject(bodyRow.entrySizingDecision)
      || asObject(bodyRow.entry_sizing_decision)
      || asObject(bodyRow.sizingDecision)
      || asObject(bodyRow.sizing_decision)
    : null;
  const bundleDecision = bundleRow
    ? asObject(bundleRow.entrySizingDecision)
      || asObject(bundleRow.entry_sizing_decision)
      || asObject(bundleRow.sizingDecision)
      || asObject(bundleRow.sizing_decision)
    : null;
  if (bodyDecision && bundleDecision && sizingDecisionsConflict(bodyDecision, bundleDecision)) {
    throw new Error("V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_CONFLICT");
  }
  return bundleDecision || bodyDecision || null;
}

function validateLiveCfgForEntry(liveCfg = null) {
  const cfg = asObject(liveCfg);
  if (!cfg) throw new Error("V2_PRODUCTION_ENTRY_LIVE_CFG_REQUIRED");
  const apiKey = trimOrNull(cfg.apiKey);
  const apiSecret = trimOrNull(cfg.apiSecret);
  if (!apiKey || !apiSecret) throw new Error("V2_PRODUCTION_ENTRY_LIVE_KEYS_MISSING");
  if (cfg.liveEnabled !== true) throw new Error("V2_PRODUCTION_ENTRY_LIVE_CFG_NOT_ENABLED");
  if (cfg.liveDryRun === true) throw new Error("V2_PRODUCTION_ENTRY_LIVE_CFG_DRY_RUN_BLOCKED");
  return Object.freeze({
    ...cfg,
    apiKey,
    apiSecret,
    liveEnabled: true,
    liveDryRun: false,
  });
}

function summarizeLiveCfg(liveCfg = null) {
  const cfg = asObject(liveCfg) || {};
  return Object.freeze({
    exchange: upper(cfg.exchange) || "BINANCEFUT",
    symbol: upper(cfg.symbol),
    execution_mode: upper(cfg.executionMode),
    live_enabled: cfg.liveEnabled === true,
    live_dry_run: cfg.liveDryRun === true,
    api_key_present: !!trimOrNull(cfg.apiKey),
    api_secret_present: !!trimOrNull(cfg.apiSecret),
    reason: trimOrNull(cfg.reason),
  });
}

async function buildV2ProductionEntryLiveTransports({
  env = process.env,
  body = null,
  bundle,
  resolveLiveCfg = resolveDefaultLiveFuturesConfig,
  buildEntryTransport = buildBinanceEntryOrderTransport,
  buildProtectionTransports = buildBinanceInitialProtectionTransports,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof resolveLiveCfg !== "function") throw new Error("V2_PRODUCTION_ENTRY_LIVE_CFG_RESOLVER_REQUIRED");
  if (typeof buildEntryTransport !== "function") throw new Error("V2_PRODUCTION_ENTRY_TRANSPORT_FACTORY_REQUIRED");
  if (typeof buildProtectionTransports !== "function") throw new Error("V2_PRODUCTION_PROTECTION_TRANSPORT_FACTORY_REQUIRED");

  const routedDecision = resolveEntryIntentFromOpenClaw(bundle);
  if (!routedDecision || routedDecision.ok !== true) {
    throw new Error("V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE");
  }

  const entryIntent = routedDecision.entryIntent;
  const sizingDecision = extractSizingDecision({ body, bundle });
  if (!sizingDecision) throw new Error("V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_REQUIRED");
  assertPartialTp1MinNotionalSupported(sizingDecision, { tp1QtyRatio: 0.5 });

  const quantityResolver = buildEntryQuantityResolverFromSizingDecision(sizingDecision);
  const resolvedQty = Number(quantityResolver({ entryIntent }));
  if (!(Number.isFinite(resolvedQty) && resolvedQty > 0)) {
    throw new Error("V2_PRODUCTION_ENTRY_LIVE_QTY_ABS_REQUIRED");
  }

  const rawLiveCfg = await resolveLiveCfg({
    exchange: "BINANCEFUT",
    symbol: entryIntent.symbol,
    env,
  });
  const liveCfg = validateLiveCfgForEntry(rawLiveCfg);

  return Object.freeze({
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY",
    entry_intent_id: entryIntent.entry_intent_id,
    symbol: entryIntent.symbol,
    side: entryIntent.side,
    entry_qty_abs: resolvedQty,
    reference_price: toNumberOrNull(sizingDecision.reference_price),
    notional_quote: toNumberOrNull(sizingDecision.notional_quote),
    live_cfg_summary: summarizeLiveCfg({
      ...liveCfg,
      symbol: entryIntent.symbol,
      exchange: "BINANCEFUT",
    }),
    entryTransport: buildEntryTransport({
      liveCfg,
      quantityResolver,
      now,
    }),
    protectionTransports: buildProtectionTransports({
      liveCfg,
      now,
    }),
  });
}

module.exports = {
  buildV2ProductionEntryLiveTransports,
  extractSizingDecision,
  validateLiveCfgForEntry,
  summarizeLiveCfg,
  __test: {
    trimOrNull,
    upper,
    asObject,
    normalizeSizingComparable,
    sizingDecisionsConflict,
  },
};
