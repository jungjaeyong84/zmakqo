"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function resolveDefaultLiveFuturesConfig(args = {}) {
  const paperRunner = require("../engine/paperBinanceRunner");
  if (typeof paperRunner.resolveLiveFuturesConfig !== "function") {
    throw new Error("BINANCE_REPAIR_LIVE_CFG_RESOLVER_NOT_AVAILABLE");
  }
  return paperRunner.resolveLiveFuturesConfig(args);
}

function validatePositionCycleForLiveCfg(positionCycle = null) {
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : null;
  if (!cycle) throw new Error("BINANCE_REPAIR_POSITION_CYCLE_REQUIRED");
  const exchange = upper(cycle.exchange) || "BINANCEFUT";
  const symbol = upper(cycle.symbol);
  if (!exchange.includes("BINANCE")) {
    throw new Error("BINANCE_REPAIR_EXCHANGE_NOT_BINANCE");
  }
  if (!symbol) {
    throw new Error("BINANCE_REPAIR_SYMBOL_REQUIRED");
  }
  return Object.freeze({
    exchange,
    symbol,
  });
}

function validateResolvedLiveCfg(liveCfg = null) {
  const cfg = liveCfg && typeof liveCfg === "object" ? liveCfg : null;
  if (!cfg) throw new Error("BINANCE_REPAIR_LIVE_CFG_REQUIRED");
  if (!trimOrNull(cfg.apiKey) || !trimOrNull(cfg.apiSecret)) {
    throw new Error("BINANCE_REPAIR_LIVE_KEYS_MISSING");
  }
  if (cfg.liveEnabled !== true && cfg.liveDryRun !== true) {
    throw new Error("BINANCE_REPAIR_LIVE_CFG_NOT_ENABLED");
  }
  return Object.freeze({
    ...cfg,
    apiKey: trimOrNull(cfg.apiKey),
    apiSecret: trimOrNull(cfg.apiSecret),
    executionMode: upper(cfg.executionMode) || null,
    reason: trimOrNull(cfg.reason),
  });
}

async function resolveBinanceRepairLiveCfg({
  env = process.env,
  positionCycle,
  resolveLiveFuturesConfigFn = resolveDefaultLiveFuturesConfig,
} = {}) {
  if (typeof resolveLiveFuturesConfigFn !== "function") {
    throw new Error("BINANCE_REPAIR_LIVE_CFG_RESOLVER_REQUIRED");
  }
  const context = validatePositionCycleForLiveCfg(positionCycle);
  const liveCfg = await resolveLiveFuturesConfigFn({
    exchange: context.exchange,
    symbol: context.symbol,
    env,
  });
  return validateResolvedLiveCfg(liveCfg);
}

module.exports = {
  resolveBinanceRepairLiveCfg,
  resolveDefaultLiveFuturesConfig,
  __test: {
    trimOrNull,
    upper,
    validatePositionCycleForLiveCfg,
    validateResolvedLiveCfg,
  },
};
