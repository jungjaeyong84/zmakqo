"use strict";

const DISCOVERY_CONFIRM_PHRASE = "EXECUTE_V2_DISCOVERY_CANARY";
const {
  resolveDiscoverySymbolNotionalQuoteMap,
  resolveDiscoverySymbolNotionalQuote,
} = require("./discoveryCanaryNotionalPolicy");

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

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  const text = trimOrNull(value);
  return text ? text.split(/[|,]/).map((x) => x.trim()).filter(Boolean) : [];
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function floorToStep(value, step) {
  const v = toNumberOrNull(value);
  const s = toNumberOrNull(step);
  if (!(v > 0)) return null;
  if (!(s > 0)) return v;
  return Math.floor(v / s) * s;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function isUnlimitedLimit(value) {
  const raw = String(value == null ? "" : value).trim().toUpperCase();
  return raw === "UNLIMITED" || raw === "INF" || raw === "INFINITY" || raw === "*";
}

function isUnlimitedTradeLimit(value) {
  return String(value == null ? "" : value).trim().toUpperCase() === "UNLIMITED";
}

function resolveDiscoveryCanaryPolicy(env = process.env) {
  const maxNotional = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE);
  const maxPositions = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT);
  const maxTradesUnlimited = isUnlimitedLimit(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY);
  const maxTrades = maxTradesUnlimited ? null : toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY);
  const dailyLossHalt = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE);
  const maxSymbols = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT);
  return Object.freeze({
    enabled: parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, false),
    allowed_symbols: Object.freeze(ensureArray(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS).map(upper).filter(Boolean)),
    max_symbol_count: Number.isFinite(maxSymbols) && maxSymbols > 0 ? maxSymbols : 2,
    max_notional_quote: Number.isFinite(maxNotional) && maxNotional > 0 ? maxNotional : 25,
    symbol_notional_quote_map: resolveDiscoverySymbolNotionalQuoteMap(env),
    // 2026-04-29 — Default raised 5 → 8 (operator request). Operator
    // safe-mode in src/v2/operatorSafeMode.js still pins this to 5 as
    // an emergency reduce.
    max_position_count: Number.isFinite(maxPositions) && maxPositions >= 0 ? maxPositions : 8,
    max_trades_per_day: maxTradesUnlimited
      ? "UNLIMITED"
      : (Number.isFinite(maxTrades) && maxTrades >= 0 ? maxTrades : "UNLIMITED"),
    max_trades_per_day_unlimited: maxTradesUnlimited || !Number.isFinite(maxTrades),
    daily_loss_halt_quote: Number.isFinite(dailyLossHalt) && dailyLossHalt >= 0 ? dailyLossHalt : 10,
    require_canary_only: true,
    required_decision_mode: "CANARY",
  });
}

function extractDiscoveryCanaryState({ body = null, bundle = null, state = null } = {}) {
  return asObject(state)
    || asObject(asObject(body) && (body.discoveryCanaryState || body.discovery_canary_state))
    || asObject(asObject(bundle) && (bundle.discoveryCanaryState || bundle.discovery_canary_state))
    || null;
}

function extractSizingDecision({ body = null, bundle = null, sizingDecision = null } = {}) {
  return asObject(sizingDecision)
    || asObject(asObject(body) && (body.entrySizingDecision || body.entry_sizing_decision || body.sizingDecision || body.sizing_decision))
    || asObject(asObject(bundle) && (bundle.entrySizingDecision || bundle.entry_sizing_decision || bundle.sizingDecision || bundle.sizing_decision))
    || null;
}

function buildResult({ blockers, policy, state, sizingDecision, symbol, decisionMode, runtime, confirm }) {
  const effectiveNotional = resolveDiscoverySymbolNotionalQuote({
    symbol,
    fallback: policy && policy.max_notional_quote,
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: Object.entries(policy && policy.symbol_notional_quote_map || {})
        .map(([sym, quote]) => `${sym}:${quote}`)
        .join("|"),
    },
  });
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_DISCOVERY_CANARY_CONTRACT_PASS" : "V2_DISCOVERY_CANARY_CONTRACT_BLOCKED",
    blockers: Object.freeze(blockers),
    blocker_n: blockers.length,
    confirm_phrase: trimOrNull(confirm),
    symbol: upper(symbol),
    decision_mode: upper(decisionMode),
    runtime: Object.freeze({ ...(runtime || {}) }),
    policy: Object.freeze({ ...policy }),
    effective_symbol_notional_quote: effectiveNotional,
    state: state ? Object.freeze({ ...state }) : null,
    sizing: sizingDecision ? Object.freeze({
      entry_intent_id: trimOrNull(sizingDecision.entry_intent_id),
      symbol: upper(sizingDecision.symbol),
      side: upper(sizingDecision.side),
      notional_quote: toNumberOrNull(sizingDecision.notional_quote),
      entry_qty_abs: toNumberOrNull(sizingDecision.entry_qty_abs),
      reference_price: toNumberOrNull(sizingDecision.reference_price),
      min_notional_quote: toNumberOrNull(sizingDecision.min_notional_quote),
      step_size: toNumberOrNull(sizingDecision.step_size),
      max_size_ratio: toNumberOrNull(sizingDecision.max_size_ratio),
    }) : null,
  });
}

function evaluateDiscoveryCanaryContract({
  env = process.env,
  body = null,
  bundle = null,
  state = null,
  sizingDecision = null,
  confirm = null,
  runtime = {},
  decisionMode = null,
  symbol = null,
} = {}) {
  const policy = resolveDiscoveryCanaryPolicy(env);
  const blockers = [];
  const resolvedState = extractDiscoveryCanaryState({ body, bundle, state });
  const resolvedSizing = extractSizingDecision({ body, bundle, sizingDecision });
  const resolvedSymbol = upper(symbol) || upper(resolvedSizing && resolvedSizing.symbol);
  const resolvedDecisionMode = upper(decisionMode);
  const activePositionN = toNumberOrNull(resolvedState && (resolvedState.active_position_n ?? resolvedState.activePositionN));
  const tradeCount24h = toNumberOrNull(resolvedState && (resolvedState.trade_count_24h ?? resolvedState.tradeCount24h));
  const dailyLossQuote = toNumberOrNull(resolvedState && (resolvedState.daily_loss_quote ?? resolvedState.dailyLossQuote));
  const dailyRealizedPnlQuote = toNumberOrNull(resolvedState && (resolvedState.daily_realized_pnl_quote ?? resolvedState.dailyRealizedPnlQuote));
  const notionalQuote = toNumberOrNull(resolvedSizing && resolvedSizing.notional_quote);
  const entryQtyAbs = toNumberOrNull(resolvedSizing && resolvedSizing.entry_qty_abs);
  const referencePrice = toNumberOrNull(resolvedSizing && resolvedSizing.reference_price);
  const minNotionalQuote = toNumberOrNull(resolvedSizing && resolvedSizing.min_notional_quote);
  const stepSize = toNumberOrNull(resolvedSizing && resolvedSizing.step_size);
  const effectiveMaxNotionalQuote = resolveDiscoverySymbolNotionalQuote({
    env,
    symbol: resolvedSymbol,
    fallback: policy.max_notional_quote,
  });
  const tp1QtyAbs = floorToStep(Number.isFinite(entryQtyAbs) ? entryQtyAbs * 0.5 : null, stepSize);
  const tp1NotionalQuote = Number.isFinite(tp1QtyAbs) && Number.isFinite(referencePrice)
    ? tp1QtyAbs * referencePrice
    : null;

  if (policy.enabled !== true) blockers.push("DISCOVERY_CANARY:NOT_ENABLED");
  if (trimOrNull(confirm) !== DISCOVERY_CONFIRM_PHRASE) blockers.push("DISCOVERY_CANARY:CONFIRM_REQUIRED");
  if (runtime && runtime.enabled !== true) blockers.push("DISCOVERY_CANARY:V2_NOT_ENABLED");
  if (runtime && runtime.dry_run === true) blockers.push("DISCOVERY_CANARY:DRY_RUN_BLOCKED");
  if (policy.require_canary_only && (!runtime || runtime.canary_only !== true)) blockers.push("DISCOVERY_CANARY:CANARY_ONLY_REQUIRED");
  if (resolvedDecisionMode !== policy.required_decision_mode) blockers.push("DISCOVERY_CANARY:CANARY_DECISION_REQUIRED");
  if (!resolvedState) blockers.push("DISCOVERY_CANARY:STATE_REQUIRED");
  if (!resolvedSizing) blockers.push("DISCOVERY_CANARY:SIZING_DECISION_REQUIRED");
  if (!resolvedSymbol) blockers.push("DISCOVERY_CANARY:SYMBOL_REQUIRED");
  if (policy.allowed_symbols.length < 1) blockers.push("DISCOVERY_CANARY:SYMBOL_ALLOWLIST_REQUIRED");
  if (policy.allowed_symbols.length > policy.max_symbol_count) blockers.push("DISCOVERY_CANARY:MAX_SYMBOL_COUNT_EXCEEDED");
  if (resolvedSymbol && !policy.allowed_symbols.includes(resolvedSymbol)) blockers.push("DISCOVERY_CANARY:SYMBOL_NOT_ALLOWED");
  if (!Number.isFinite(activePositionN)) blockers.push("DISCOVERY_CANARY:ACTIVE_POSITION_COUNT_REQUIRED");
  if (Number.isFinite(activePositionN) && activePositionN >= policy.max_position_count) blockers.push("DISCOVERY_CANARY:MAX_POSITION_COUNT_REACHED");
  if (!Number.isFinite(tradeCount24h)) blockers.push("DISCOVERY_CANARY:TRADE_COUNT_24H_REQUIRED");
  if (
    Number.isFinite(tradeCount24h)
    && !isUnlimitedTradeLimit(policy.max_trades_per_day)
    && Number.isFinite(policy.max_trades_per_day)
    && tradeCount24h >= policy.max_trades_per_day
  ) {
    blockers.push("DISCOVERY_CANARY:MAX_TRADES_PER_DAY_REACHED");
  }
  if (!Number.isFinite(dailyLossQuote) && !Number.isFinite(dailyRealizedPnlQuote)) blockers.push("DISCOVERY_CANARY:DAILY_LOSS_EVIDENCE_REQUIRED");
  const effectiveDailyLoss = Number.isFinite(dailyLossQuote)
    ? dailyLossQuote
    : (Number.isFinite(dailyRealizedPnlQuote) && dailyRealizedPnlQuote < 0 ? Math.abs(dailyRealizedPnlQuote) : 0);
  if (Number.isFinite(effectiveDailyLoss) && effectiveDailyLoss >= policy.daily_loss_halt_quote) blockers.push("DISCOVERY_CANARY:DAILY_LOSS_HALT_REACHED");
  if (!Number.isFinite(notionalQuote)) blockers.push("DISCOVERY_CANARY:NOTIONAL_REQUIRED");
  if (!Number.isFinite(effectiveMaxNotionalQuote)) blockers.push("DISCOVERY_CANARY:SYMBOL_NOTIONAL_POLICY_REQUIRED");
  if (Number.isFinite(notionalQuote) && Number.isFinite(effectiveMaxNotionalQuote) && notionalQuote > effectiveMaxNotionalQuote) {
    blockers.push("DISCOVERY_CANARY:MAX_NOTIONAL_EXCEEDED");
  }
  if (!Number.isFinite(entryQtyAbs) || !Number.isFinite(referencePrice) || !Number.isFinite(minNotionalQuote) || !Number.isFinite(stepSize)) {
    blockers.push("DISCOVERY_CANARY:PARTIAL_TP1_EVIDENCE_REQUIRED");
  }
  if (
    Number.isFinite(tp1NotionalQuote)
    && Number.isFinite(minNotionalQuote)
    && tp1NotionalQuote + 1e-9 < minNotionalQuote
  ) {
    blockers.push("DISCOVERY_CANARY:PARTIAL_TP1_MIN_NOTIONAL_REQUIRED");
  }

  return buildResult({
    blockers: Array.from(new Set(blockers)),
    policy,
    state: resolvedState,
    sizingDecision: resolvedSizing,
    symbol: resolvedSymbol,
    decisionMode: resolvedDecisionMode,
    runtime,
    confirm,
  });
}

module.exports = {
  DISCOVERY_CONFIRM_PHRASE,
  resolveDiscoveryCanaryPolicy,
  resolveDiscoverySymbolNotionalQuote,
  resolveDiscoverySymbolNotionalQuoteMap,
  extractDiscoveryCanaryState,
  extractSizingDecision,
  evaluateDiscoveryCanaryContract,
  __test: {
    trimOrNull,
    upper,
    asObject,
    ensureArray,
    toNumberOrNull,
    parseBool,
    isUnlimitedLimit,
    isUnlimitedTradeLimit,
    floorToStep,
  },
};
