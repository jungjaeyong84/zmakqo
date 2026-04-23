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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  const text = trimOrNull(value);
  return text ? text.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

function resolveRiskGovernorPolicy(env = process.env) {
  return Object.freeze({
    enabled: parseBool(env.DONBEOLJA_V2_RISK_GOVERNOR_ENABLED, true),
    required: parseBool(env.DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, false),
    max_account_leverage: toNumberOrNull(env.DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE) || 2,
    max_total_notional_quote: toNumberOrNull(env.DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE) || 250,
    max_symbol_notional_quote: toNumberOrNull(env.DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE) || 100,
    max_correlated_group_notional_quote: toNumberOrNull(env.DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE) || 150,
    daily_loss_halt_quote: toNumberOrNull(env.DONBEOLJA_V2_RISK_DAILY_LOSS_HALT_QUOTE) || 25,
    max_consecutive_loss_n: Math.floor(toNumberOrNull(env.DONBEOLJA_V2_RISK_MAX_CONSECUTIVE_LOSS_N) || 3),
    max_trades_per_day: Math.floor(toNumberOrNull(env.DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY) || 4),
    volatility_halt_bps: toNumberOrNull(env.DONBEOLJA_V2_RISK_VOLATILITY_HALT_BPS) || 250,
    correlation_groups: Object.freeze({
      BTC_BETA: Object.freeze(ensureArray(env.DONBEOLJA_V2_RISK_CORR_GROUP_BTC_BETA || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,LINKUSDT")),
      MEME: Object.freeze(ensureArray(env.DONBEOLJA_V2_RISK_CORR_GROUP_MEME || "DOGEUSDT")),
      XRP: Object.freeze(ensureArray(env.DONBEOLJA_V2_RISK_CORR_GROUP_XRP || "XRPUSDT")),
    }),
  });
}

function symbolGroup(symbol, groups) {
  const sym = upper(symbol);
  for (const [group, symbols] of Object.entries(groups || {})) {
    if ((symbols || []).map(upper).includes(sym)) return group;
  }
  return "OTHER";
}

function normalizePositions(positions) {
  return (Array.isArray(positions) ? positions : []).map((row) => ({
    symbol: upper(row && row.symbol),
    side: upper(row && row.side),
    notional_quote: toNumberOrNull(row && (row.notional_quote ?? row.notionalQuote ?? row.position_notional_quote)) || 0,
  })).filter((row) => row.symbol && row.notional_quote > 0);
}

function evaluateV2RiskGovernor({
  env = process.env,
  policy = resolveRiskGovernorPolicy(env),
  account = {},
  positions = [],
  candidate = {},
  market = {},
} = {}) {
  const blockers = [];
  const warnings = [];
  const normalizedPositions = normalizePositions(positions);
  const symbol = upper(candidate && candidate.symbol);
  const candidateNotional = toNumberOrNull(candidate && (candidate.notional_quote ?? candidate.notionalQuote)) || 0;
  const equity = toNumberOrNull(account && (account.equity_quote ?? account.equityQuote ?? account.total_wallet_balance_quote)) || 0;
  const dailyLoss = toNumberOrNull(account && (account.daily_loss_quote ?? account.dailyLossQuote)) || 0;
  const consecutiveLossN = toNumberOrNull(account && (account.consecutive_loss_n ?? account.consecutiveLossN)) || 0;
  const trades24h = toNumberOrNull(account && (account.trade_count_24h ?? account.tradeCount24h)) || 0;
  const volatilityBps = toNumberOrNull(market && (market.volatility_bps ?? market.volatilityBps)) || 0;
  const totalOpenNotional = normalizedPositions.reduce((sum, row) => sum + row.notional_quote, 0);
  const totalAfter = totalOpenNotional + candidateNotional;
  const symbolAfter = normalizedPositions
    .filter((row) => row.symbol === symbol)
    .reduce((sum, row) => sum + row.notional_quote, 0) + candidateNotional;
  const group = symbolGroup(symbol, policy.correlation_groups);
  const groupAfter = normalizedPositions
    .filter((row) => symbolGroup(row.symbol, policy.correlation_groups) === group)
    .reduce((sum, row) => sum + row.notional_quote, 0) + candidateNotional;
  const leverageAfter = equity > 0 ? totalAfter / equity : null;

  if (policy.enabled !== true) warnings.push("RISK_GOVERNOR:DISABLED");
  if (policy.required === true && !asObject(account)) blockers.push("RISK_GOVERNOR:ACCOUNT_STATE_REQUIRED");
  if (!symbol) blockers.push("RISK_GOVERNOR:SYMBOL_REQUIRED");
  if (!(candidateNotional > 0)) blockers.push("RISK_GOVERNOR:CANDIDATE_NOTIONAL_REQUIRED");
  if (equity <= 0) blockers.push("RISK_GOVERNOR:EQUITY_REQUIRED");
  if (dailyLoss >= policy.daily_loss_halt_quote) blockers.push("RISK_GOVERNOR:DAILY_LOSS_HALT");
  if (consecutiveLossN >= policy.max_consecutive_loss_n) blockers.push("RISK_GOVERNOR:CONSECUTIVE_LOSS_HALT");
  if (trades24h >= policy.max_trades_per_day) blockers.push("RISK_GOVERNOR:MAX_TRADES_PER_DAY");
  if (totalAfter > policy.max_total_notional_quote) blockers.push("RISK_GOVERNOR:TOTAL_NOTIONAL_EXCEEDED");
  if (symbolAfter > policy.max_symbol_notional_quote) blockers.push("RISK_GOVERNOR:SYMBOL_NOTIONAL_EXCEEDED");
  if (groupAfter > policy.max_correlated_group_notional_quote) blockers.push("RISK_GOVERNOR:CORRELATED_GROUP_NOTIONAL_EXCEEDED");
  if (Number.isFinite(leverageAfter) && leverageAfter > policy.max_account_leverage) blockers.push("RISK_GOVERNOR:ACCOUNT_LEVERAGE_EXCEEDED");
  if (volatilityBps >= policy.volatility_halt_bps) blockers.push("RISK_GOVERNOR:VOLATILITY_HALT");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_RISK_GOVERNOR_PASS" : "V2_RISK_GOVERNOR_BLOCKED",
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(Array.from(new Set(warnings))),
    policy: Object.freeze({ ...policy, correlation_groups: policy.correlation_groups }),
    metrics: Object.freeze({
      symbol,
      group,
      equity_quote: equity,
      candidate_notional_quote: candidateNotional,
      total_open_notional_quote: totalOpenNotional,
      total_after_notional_quote: totalAfter,
      symbol_after_notional_quote: symbolAfter,
      group_after_notional_quote: groupAfter,
      leverage_after: leverageAfter,
      daily_loss_quote: dailyLoss,
      consecutive_loss_n: consecutiveLossN,
      trade_count_24h: trades24h,
      volatility_bps: volatilityBps,
    }),
  });
}

module.exports = {
  resolveRiskGovernorPolicy,
  evaluateV2RiskGovernor,
  __test: { trimOrNull, upper, toNumberOrNull, parseBool, symbolGroup, normalizePositions },
};
