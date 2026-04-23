"use strict";

const DISCOVERY_CONFIRM_PHRASE = "EXECUTE_V2_DISCOVERY_CANARY";

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
  return text ? text.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function resolveDiscoveryCanaryPolicy(env = process.env) {
  const maxNotional = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE);
  const maxPositions = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT);
  const maxTrades = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY);
  const dailyLossHalt = toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE);
  return Object.freeze({
    enabled: parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, false),
    allowed_symbols: Object.freeze(ensureArray(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS).map(upper).filter(Boolean)),
    max_notional_quote: Number.isFinite(maxNotional) && maxNotional > 0 ? maxNotional : 25,
    max_position_count: Number.isFinite(maxPositions) && maxPositions >= 0 ? maxPositions : 1,
    max_trades_per_day: Number.isFinite(maxTrades) && maxTrades >= 0 ? maxTrades : 1,
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
    state: state ? Object.freeze({ ...state }) : null,
    sizing: sizingDecision ? Object.freeze({
      entry_intent_id: trimOrNull(sizingDecision.entry_intent_id),
      symbol: upper(sizingDecision.symbol),
      side: upper(sizingDecision.side),
      notional_quote: toNumberOrNull(sizingDecision.notional_quote),
      entry_qty_abs: toNumberOrNull(sizingDecision.entry_qty_abs),
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

  if (policy.enabled !== true) blockers.push("DISCOVERY_CANARY:NOT_ENABLED");
  if (trimOrNull(confirm) !== DISCOVERY_CONFIRM_PHRASE) blockers.push("DISCOVERY_CANARY:CONFIRM_REQUIRED");
  if (runtime && runtime.enabled !== true) blockers.push("DISCOVERY_CANARY:V2_NOT_ENABLED");
  if (runtime && runtime.dry_run === true) blockers.push("DISCOVERY_CANARY:DRY_RUN_BLOCKED");
  if (policy.require_canary_only && (!runtime || runtime.canary_only !== true)) blockers.push("DISCOVERY_CANARY:CANARY_ONLY_REQUIRED");
  if (resolvedDecisionMode !== policy.required_decision_mode) blockers.push("DISCOVERY_CANARY:CANARY_DECISION_REQUIRED");
  if (!resolvedState) blockers.push("DISCOVERY_CANARY:STATE_REQUIRED");
  if (!resolvedSizing) blockers.push("DISCOVERY_CANARY:SIZING_DECISION_REQUIRED");
  if (!resolvedSymbol) blockers.push("DISCOVERY_CANARY:SYMBOL_REQUIRED");
  if (policy.allowed_symbols.length !== 1) blockers.push("DISCOVERY_CANARY:EXACTLY_ONE_SYMBOL_REQUIRED");
  if (policy.allowed_symbols.length === 1 && resolvedSymbol && resolvedSymbol !== policy.allowed_symbols[0]) blockers.push("DISCOVERY_CANARY:SYMBOL_NOT_ALLOWED");
  if (!Number.isFinite(activePositionN)) blockers.push("DISCOVERY_CANARY:ACTIVE_POSITION_COUNT_REQUIRED");
  if (Number.isFinite(activePositionN) && activePositionN >= policy.max_position_count) blockers.push("DISCOVERY_CANARY:MAX_POSITION_COUNT_REACHED");
  if (!Number.isFinite(tradeCount24h)) blockers.push("DISCOVERY_CANARY:TRADE_COUNT_24H_REQUIRED");
  if (Number.isFinite(tradeCount24h) && tradeCount24h >= policy.max_trades_per_day) blockers.push("DISCOVERY_CANARY:MAX_TRADES_PER_DAY_REACHED");
  if (!Number.isFinite(dailyLossQuote) && !Number.isFinite(dailyRealizedPnlQuote)) blockers.push("DISCOVERY_CANARY:DAILY_LOSS_EVIDENCE_REQUIRED");
  const effectiveDailyLoss = Number.isFinite(dailyLossQuote)
    ? dailyLossQuote
    : (Number.isFinite(dailyRealizedPnlQuote) && dailyRealizedPnlQuote < 0 ? Math.abs(dailyRealizedPnlQuote) : 0);
  if (Number.isFinite(effectiveDailyLoss) && effectiveDailyLoss >= policy.daily_loss_halt_quote) blockers.push("DISCOVERY_CANARY:DAILY_LOSS_HALT_REACHED");
  if (!Number.isFinite(notionalQuote)) blockers.push("DISCOVERY_CANARY:NOTIONAL_REQUIRED");
  if (Number.isFinite(notionalQuote) && notionalQuote > policy.max_notional_quote) blockers.push("DISCOVERY_CANARY:MAX_NOTIONAL_EXCEEDED");

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
  },
};
