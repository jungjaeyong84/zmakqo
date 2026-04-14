"use strict";

const { getRiskBudgetForProvider } = require("./exchangeSettings");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { fetchFuturesExchangeInfo } = require("../exchanges/binanceFuturesPrivate");

const EXCHANGE_INFO_CACHE_TTL_MS = 60 * 60 * 1000;
const exchangeInfoCache = new Map();

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeExecutionMode(raw) {
  const mode = upper(raw) || "PAPER";
  if (mode === "LIVE" || mode === "LIVE_DRY_RUN") return mode;
  return "PAPER";
}

function normalizeFuturesLeverage(raw, maxLev = 3) {
  const cap = Number.isFinite(Number(maxLev)) && Number(maxLev) > 0
    ? Math.floor(Number(maxLev))
    : 3;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Math.min(cap, 2);
  return Math.max(1, Math.min(cap, Math.round(n)));
}

async function fetchExchangeInfoCached(symbol, {
  fetchFn = fetchFuturesExchangeInfo,
  cache = exchangeInfoCache,
  ttlMs = EXCHANGE_INFO_CACHE_TTL_MS,
  nowMs = Date.now(),
} = {}) {
  const sym = upper(symbol);
  if (!sym) return null;
  const cached = cache && cache.get(sym);
  if (cached && cached.value && Number.isFinite(cached.at) && (nowMs - cached.at) < Math.max(60 * 1000, Number(ttlMs) || EXCHANGE_INFO_CACHE_TTL_MS)) {
    return cached.value;
  }
  const value = await fetchFn(sym);
  if (cache && value && typeof value === "object") cache.set(sym, { value, at: Date.now() });
  return value;
}

async function evaluateEntryBudgetGuard({
  exchange = null,
  symbol = null,
  intent = null,
  qtyPct = null,
  getRiskBudget = getRiskBudgetForProvider,
  getSystemSettings = getSystemSettingsForProvider,
  fetchExchangeInfo = fetchFuturesExchangeInfo,
  nowMs = Date.now(),
  exchangeInfoCacheOverride = null,
} = {}) {
  const resolvedExchange = upper(exchange);
  const resolvedSymbol = upper(symbol);
  const resolvedIntent = upper(intent);
  const qtyFraction = toNum(qtyPct);
  const result = {
    applicable: false,
    ok: true,
    reason: "ENTRY_BUDGET_GUARD_SKIPPED",
    exchange: resolvedExchange,
    symbol: resolvedSymbol,
    intent: resolvedIntent,
    qtyPct: qtyFraction,
    executionMode: null,
    budgetMax: null,
    leverage: null,
    minNotional: null,
    minOrderQuote: null,
    minRequiredQuote: null,
    notionalQuote: null,
    requiredQtyPct: null,
    requiredBudget: null,
    shortfallQuote: null,
  };

  if (!(resolvedIntent === "ENTRY" || resolvedIntent === "ADD")) {
    result.reason = "NON_ENTRY";
    return result;
  }
  if (!resolvedExchange || !resolvedExchange.includes("BINANCE")) {
    result.reason = "NON_BINANCE";
    return result;
  }
  if (!resolvedSymbol || !Number.isFinite(qtyFraction) || qtyFraction <= 0) {
    result.reason = "BAD_REQUEST";
    return result;
  }

  const system = await getSystemSettings(resolvedExchange, 5000).catch(() => null);
  const cfg = system && system.data ? system.data : {};
  const executionMode = normalizeExecutionMode(cfg.execution_mode);
  result.executionMode = executionMode;
  if (executionMode !== "LIVE" && executionMode !== "LIVE_DRY_RUN") {
    result.reason = "NON_LIVE_MODE";
    return result;
  }

  const risk = await getRiskBudget(resolvedExchange, 5000).catch(() => null);
  const riskData = risk && risk.data ? risk.data : {};
  const budgetMax = toNum((riskData.by_market && riskData.by_market[resolvedSymbol]) || riskData.default_max_krw);
  result.budgetMax = budgetMax;
  if (!Number.isFinite(budgetMax) || budgetMax <= 0) {
    result.reason = "NO_MARKET_BUDGET";
    return result;
  }

  const maxLev = toNum(process.env.FUTURES_LEVERAGE_MAX) || 3;
  const leverage = normalizeFuturesLeverage(
    cfg.futures_leverage ?? process.env.FUTURES_LEVERAGE ?? process.env.FUTURES_BASE_LEVERAGE ?? 2,
    maxLev
  );
  result.leverage = leverage;

  const info = await fetchExchangeInfoCached(resolvedSymbol, {
    fetchFn: fetchExchangeInfo,
    cache: exchangeInfoCacheOverride || exchangeInfoCache,
    nowMs,
  }).catch(() => null);
  const minNotional = toNum(info && info.minNotional) || 0;
  const minOrderQuote = toNum(cfg.live_min_order_krw) || 5;
  const minRequiredQuote = Math.max(minNotional, minOrderQuote);
  const notionalQuote = budgetMax * leverage * qtyFraction;
  result.applicable = true;
  result.minNotional = minNotional;
  result.minOrderQuote = minOrderQuote;
  result.minRequiredQuote = minRequiredQuote;
  result.notionalQuote = notionalQuote;

  if (!Number.isFinite(minRequiredQuote) || minRequiredQuote <= 0) {
    result.reason = "MIN_REQUIRED_NOT_SET";
    return result;
  }
  if (!Number.isFinite(notionalQuote) || notionalQuote <= 0) {
    result.ok = false;
    result.reason = "MIN_ORDER_EXCEEDS_BUDGET";
    result.shortfallQuote = minRequiredQuote;
    result.requiredQtyPct = null;
    result.requiredBudget = null;
    return result;
  }

  result.requiredQtyPct = minRequiredQuote / (budgetMax * leverage);
  result.requiredBudget = minRequiredQuote / (qtyFraction * leverage);
  result.shortfallQuote = Math.max(0, minRequiredQuote - notionalQuote);

  if (notionalQuote + 1e-9 < minRequiredQuote) {
    result.ok = false;
    result.reason = "MIN_ORDER_EXCEEDS_BUDGET";
    return result;
  }

  result.reason = "ENTRY_BUDGET_GUARD_OK";
  return result;
}

module.exports = {
  evaluateEntryBudgetGuard,
  __test: {
    normalizeExecutionMode,
    normalizeFuturesLeverage,
    fetchExchangeInfoCached,
  },
};
