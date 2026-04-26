"use strict";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function uniqueUpper(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(upper)
    .filter(Boolean)));
}

function compactObject(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return Object.freeze(out);
}

function riskGovernorBlockerCode(blocker) {
  const raw = upper(blocker);
  if (!raw) return null;
  const code = raw.startsWith("RISK_GOVERNOR:")
    ? raw.slice("RISK_GOVERNOR:".length)
    : raw;
  if (code === "CORRELATED_GROUP_NOTIONAL_EXCEEDED") return "GROUP_NOTIONAL_EXCEEDED";
  if (code === "ACCOUNT_STATE_REQUIRED") return "ACCOUNT_REQUIRED";
  if (code === "CANDIDATE_NOTIONAL_REQUIRED") return "NOTIONAL_REQUIRED";
  return code;
}

function normalizeRiskGovernorSurface(riskGovernor = null) {
  const row = riskGovernor && typeof riskGovernor === "object" ? riskGovernor : null;
  if (!row) {
    return Object.freeze({
      present: false,
      ok: null,
      reason: null,
      primary_blocker: null,
      primary_code: null,
      blockers: Object.freeze([]),
      blocker_codes: Object.freeze([]),
      warnings: Object.freeze([]),
      metrics: Object.freeze({}),
      limits: Object.freeze({}),
      telegram_line: null,
    });
  }

  if (row.present === true && row.primary_code) {
    const blockers = uniqueUpper(row.blockers);
    const blockerCodes = uniqueUpper(row.blocker_codes);
    const primaryCode = upper(row.primary_code);
    return Object.freeze({
      present: true,
      ok: row.ok === true,
      reason: upper(row.reason),
      primary_blocker: upper(row.primary_blocker) || blockers[0] || null,
      primary_code: primaryCode,
      blockers: Object.freeze(blockers),
      blocker_codes: Object.freeze(blockerCodes.length ? blockerCodes : (primaryCode ? [primaryCode] : [])),
      warnings: Object.freeze(uniqueUpper(row.warnings)),
      metrics: Object.freeze({ ...(row.metrics || {}) }),
      limits: Object.freeze({ ...(row.limits || {}) }),
      telegram_line: trimOrNull(row.telegram_line) || (primaryCode ? `riskGovernor: ${primaryCode}` : null),
    });
  }

  const blockers = uniqueUpper(row.blockers);
  const blockerCodes = Object.freeze(blockers.map(riskGovernorBlockerCode).filter(Boolean));
  const primaryBlocker = blockers[0] || null;
  const primaryCode = blockerCodes[0] || null;
  const policy = row.policy && typeof row.policy === "object" ? row.policy : {};
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};

  return Object.freeze({
    present: true,
    ok: row.ok === true,
    reason: upper(row.reason),
    primary_blocker: primaryBlocker,
    primary_code: primaryCode,
    blockers: Object.freeze(blockers),
    blocker_codes: blockerCodes,
    warnings: Object.freeze(uniqueUpper(row.warnings)),
    metrics: compactObject({
      symbol: upper(metrics.symbol),
      group: upper(metrics.group),
      candidate_notional_quote: toNumberOrNull(metrics.candidate_notional_quote),
      total_open_notional_quote: toNumberOrNull(metrics.total_open_notional_quote),
      total_after_notional_quote: toNumberOrNull(metrics.total_after_notional_quote),
      symbol_after_notional_quote: toNumberOrNull(metrics.symbol_after_notional_quote),
      group_after_notional_quote: toNumberOrNull(metrics.group_after_notional_quote),
      leverage_after: toNumberOrNull(metrics.leverage_after),
      daily_loss_quote: toNumberOrNull(metrics.daily_loss_quote),
      consecutive_loss_n: toNumberOrNull(metrics.consecutive_loss_n),
      trade_count_24h: toNumberOrNull(metrics.trade_count_24h),
      volatility_bps: toNumberOrNull(metrics.volatility_bps),
    }),
    limits: compactObject({
      max_total_notional_quote: toNumberOrNull(policy.max_total_notional_quote),
      max_symbol_notional_quote: toNumberOrNull(policy.max_symbol_notional_quote),
      max_correlated_group_notional_quote: toNumberOrNull(policy.max_correlated_group_notional_quote),
      daily_loss_halt_quote: toNumberOrNull(policy.daily_loss_halt_quote),
      max_trades_per_day: policy.max_trades_per_day === "UNLIMITED" ? "UNLIMITED" : toNumberOrNull(policy.max_trades_per_day),
      max_account_leverage: toNumberOrNull(policy.max_account_leverage),
      volatility_halt_bps: toNumberOrNull(policy.volatility_halt_bps),
    }),
    telegram_line: primaryCode ? `riskGovernor: ${primaryCode}` : null,
  });
}

function riskGovernorTelegramLine(riskGovernor = null) {
  const surface = normalizeRiskGovernorSurface(riskGovernor);
  return surface.telegram_line || null;
}

module.exports = {
  riskGovernorBlockerCode,
  normalizeRiskGovernorSurface,
  riskGovernorTelegramLine,
  __test: { trimOrNull, upper, toNumberOrNull, uniqueUpper, compactObject },
};
