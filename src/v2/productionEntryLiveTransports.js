"use strict";

const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const { buildEntryQuantityResolverFromSizingDecision } = require("./entrySizingDecision");
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

function extractSizingDecision({ body = null, bundle = null } = {}) {
  const sourceRows = [asObject(body), asObject(bundle)].filter(Boolean);
  for (const row of sourceRows) {
    const direct = asObject(row.entrySizingDecision)
      || asObject(row.entry_sizing_decision)
      || asObject(row.sizingDecision)
      || asObject(row.sizing_decision);
    if (direct) return direct;
  }
  return null;
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
  },
};
