"use strict";

function toPositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function pickFirstPositive(...values) {
  for (const value of values) {
    const n = toPositiveNumber(value);
    if (n != null) return n;
  }
  return null;
}

function pickFirstText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function resolvePositionLeverage(position, { fallback = null } = {}) {
  const pos = position && typeof position === "object" ? position : {};
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  return pickFirstPositive(
    pos.leverage,
    pos.leverage_applied,
    pos.futures_leverage,
    meta.leverage,
    meta.external_leverage,
    meta.futures_leverage,
    fallback,
  );
}

function resolvePositionLeverageReason(position) {
  const pos = position && typeof position === "object" ? position : {};
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  return pickFirstText(
    pos.leverage_reason,
    pos.leverage_source,
    meta.leverage_reason,
    meta.leverage_source,
    meta.external_leverage_reason,
  );
}

function resolveFillLeverage(fill, { position = null, fallback = null } = {}) {
  const row = fill && typeof fill === "object" ? fill : {};
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const direct = pickFirstPositive(
    row.leverage_applied,
    row.applied_leverage,
    row.leverage,
    row.futures_leverage,
    meta.leverage_applied,
    meta.applied_leverage,
    meta.leverage,
    meta.futures_leverage,
    fallback,
  );
  if (direct != null) return direct;
  return resolvePositionLeverage(position, { fallback: null });
}

function resolveFillLeverageReason(fill, { position = null } = {}) {
  const row = fill && typeof fill === "object" ? fill : {};
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  return pickFirstText(
    row.leverage_reason,
    row.leverage_source,
    meta.leverage_reason,
    meta.leverage_source,
    resolvePositionLeverageReason(position),
  );
}

function resolveLeverageTier(leverage) {
  const lev = toPositiveNumber(leverage);
  if (lev == null) return null;
  if (lev >= 2.5) return "3x";
  if (lev >= 1.5) return "2x";
  const rounded = Math.round(lev * 10) / 10;
  return `${rounded}x`;
}

function isActivePositionState(stateLike) {
  const state = String(stateLike || "").trim().toUpperCase();
  if (!state) return false;
  if (state === "FLAT") return false;
  if (state === "CLOSED" || state === "INACTIVE" || state === "NONE") return false;
  // ACTIVE/PROBE/COMMIT/SCALE_OUT and any non-flat custom state are treated as active exposure.
  return true;
}

function resolvePositionRollback(position, { nowMs = Date.now() } = {}) {
  const pos = position && typeof position === "object" ? position : {};
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const untilMsRaw = Number(
    meta.exit_profile_rollback_until_ms ??
    meta.rollback_until_ms ??
    pos.exit_profile_rollback_until_ms
  );
  const untilMs = Number.isFinite(untilMsRaw) && untilMsRaw > 0 ? untilMsRaw : null;
  const reason = pickFirstText(
    meta.exit_profile_rollback_reason,
    meta.rollback_reason,
    pos.exit_profile_rollback_reason,
  );
  const explicitActive = meta.exit_profile_rollback_active;
  const activeByUntil = Number.isFinite(untilMs) && untilMs > Number(nowMs);
  const active = explicitActive === true || activeByUntil;
  const remainingMs = active && Number.isFinite(untilMs)
    ? Math.max(0, untilMs - Number(nowMs))
    : 0;
  return {
    active,
    until_ms: untilMs,
    remaining_ms: remainingMs,
    reason,
  };
}

function buildLeverageSummary(rows, { includeFlat = false } = {}) {
  const summary = {
    total_markets: 0,
    active_markets: 0,
    tier_3x: 0,
    tier_2x: 0,
    tier_other: 0,
    unknown: 0,
  };
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    summary.total_markets += 1;
    const state = String(
      (row && row.position_state) ||
      (row && row.position && row.position.state) ||
      "",
    ).toUpperCase();
    const active = isActivePositionState(state);
    if (active) summary.active_markets += 1;
    if (!includeFlat && !active) continue;
    const lev = pickFirstPositive(
      row && row.position_leverage,
      row && row.fill_leverage,
      row && row.last_fill && row.last_fill.leverage_applied,
      row && row.position && row.position.leverage,
    );
    if (lev == null) {
      summary.unknown += 1;
      continue;
    }
    if (lev >= 2.5) summary.tier_3x += 1;
    else if (lev >= 1.5) summary.tier_2x += 1;
    else summary.tier_other += 1;
  }
  return summary;
}

function buildRollbackSummary(rows, { includeFlat = false, nowMs = Date.now() } = {}) {
  const summary = {
    total_markets: 0,
    active_markets: 0,
    rollback_active: 0,
    next_clear_ms: null,
    max_remaining_ms: 0,
    symbols: [],
  };
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    summary.total_markets += 1;
    const state = String(
      (row && row.position_state) ||
      (row && row.position && row.position.state) ||
      "",
    ).toUpperCase();
    const activePos = isActivePositionState(state);
    if (activePos) summary.active_markets += 1;
    if (!includeFlat && !activePos) continue;
    const position = (row && row.position && typeof row.position === "object")
      ? row.position
      : (row && typeof row === "object" ? row : null);
    const rollback = resolvePositionRollback(position, { nowMs });
    if (!rollback.active) continue;
    summary.rollback_active += 1;
    if (Number.isFinite(rollback.remaining_ms)) {
      summary.max_remaining_ms = Math.max(summary.max_remaining_ms, rollback.remaining_ms);
    }
    if (Number.isFinite(rollback.until_ms)) {
      summary.next_clear_ms = summary.next_clear_ms == null
        ? rollback.until_ms
        : Math.min(summary.next_clear_ms, rollback.until_ms);
    }
    const symbol = pickFirstText(
      row && row.market,
      row && row.symbol,
      position && position.symbol_or_pair_id,
      position && position.symbol,
    );
    if (symbol) summary.symbols.push(symbol);
  }
  return summary;
}

module.exports = {
  resolvePositionLeverage,
  resolvePositionLeverageReason,
  resolveFillLeverage,
  resolveFillLeverageReason,
  resolveLeverageTier,
  buildLeverageSummary,
  resolvePositionRollback,
  buildRollbackSummary,
};
