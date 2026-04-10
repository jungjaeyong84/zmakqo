"use strict";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function parseMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isActivePosition(pos = {}) {
  const state = toUpper(pos.position_state || pos.state);
  const qtyBase = toNum(pos.qty_base);
  const sizePct = toNum(pos.size_pct);
  const hasSize = (Number.isFinite(qtyBase) && qtyBase > 0) || (Number.isFinite(sizePct) && sizePct > 0);
  return hasSize && state !== "FLAT";
}

function eventMatches(fill = {}, prefix = "") {
  return toUpper(fill.event).startsWith(String(prefix || "").toUpperCase());
}

function pickLatestFill(rows = [], predicate = () => false) {
  let best = null;
  let bestMs = -Infinity;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!predicate(row)) continue;
    const atMs = parseMs(row.exec_bar_close_time_utc_ms || row.exec_ms || row.created_at || row.updated_at);
    if (!Number.isFinite(atMs)) continue;
    if (!best || atMs > bestMs) {
      best = row;
      bestMs = atMs;
    }
  }
  return best;
}

function makeIssue({ symbol, code, detail, fill = null } = {}) {
  return {
    symbol: String(symbol || "").toUpperCase(),
    code: String(code || "").toUpperCase(),
    detail: String(detail || "").trim(),
    fill_event: fill ? (fill.event || null) : null,
    fill_created_at: fill ? (fill.created_at || null) : null,
  };
}

function countIssuesByCode(issues = []) {
  const out = {};
  for (const issue of Array.isArray(issues) ? issues : []) {
    const code = toUpper(issue && issue.code) || "UNKNOWN";
    out[code] = (out[code] || 0) + 1;
  }
  return out;
}

function buildBinanceFillProjectionAudit({
  positions = [],
  fills = [],
  nowMs = Date.now(),
  lookbackMs = 24 * 60 * 60 * 1000,
  tp1TrailGraceMs = 5 * 60 * 1000,
} = {}) {
  const activePositions = (Array.isArray(positions) ? positions : []).filter((row) => {
    return toUpper(row && row.exchange) === "BINANCEFUT" && isActivePosition(row);
  });
  const recentFills = (Array.isArray(fills) ? fills : []).filter((row) => {
    if (toUpper(row && row.exchange) !== "BINANCEFUT") return false;
    const atMs = parseMs(row && (row.exec_bar_close_time_utc_ms || row.exec_ms || row.created_at || row.updated_at));
    return Number.isFinite(atMs) && atMs >= (Number(nowMs) - Number(lookbackMs));
  });

  const issues = [];

  for (const pos of activePositions) {
    const symbol = toUpper(pos.symbol_or_pair_id || pos.symbol);
    const meta = pos && typeof pos.meta === "object" ? pos.meta : {};
    if (!symbol) continue;
    const marketFills = recentFills.filter((row) => toUpper(row.symbol || row.symbol_or_pair_id) === symbol);
    const latestTp0Fill = pickLatestFill(marketFills, (row) => eventMatches(row, "EXIT_TP_P0"));
    const latestTp1Fill = pickLatestFill(marketFills, (row) => eventMatches(row, "EXIT_TP_P1"));

    if (latestTp0Fill && meta.tp_p0_done !== true) {
      issues.push(makeIssue({
        symbol,
        code: "TP0_FILL_PROJECTION_MISSING",
        detail: "최근 TP0 fill은 있는데 포지션 메타 tp_p0_done이 아직 true가 아님",
        fill: latestTp0Fill,
      }));
    }
    if (latestTp1Fill && meta.tp_p1_done !== true) {
      issues.push(makeIssue({
        symbol,
        code: "TP1_FILL_PROJECTION_MISSING",
        detail: "최근 TP1 fill은 있는데 포지션 메타 tp_p1_done이 아직 true가 아님",
        fill: latestTp1Fill,
      }));
    }
    if (latestTp1Fill) {
      const tp1AtMs = parseMs(latestTp1Fill.exec_bar_close_time_utc_ms || latestTp1Fill.exec_ms || latestTp1Fill.created_at);
      if (
        Number.isFinite(tp1AtMs)
        && tp1AtMs <= (Number(nowMs) - Number(tp1TrailGraceMs))
        && meta.tp_p1_done === true
        && meta.trail_active !== true
      ) {
        issues.push(makeIssue({
          symbol,
          code: "TP1_FILL_TRAIL_INACTIVE",
          detail: "최근 TP1 fill 이후 유예시간이 지났는데 trail_active가 아직 true가 아님",
          fill: latestTp1Fill,
        }));
      }
    }
    if (meta.exchange_projection_in_sync === false) {
      issues.push(makeIssue({
        symbol,
        code: "PROJECTION_OUT_OF_SYNC",
        detail: "포지션 메타가 exchange projection out-of-sync 상태",
      }));
    }
    if (meta.native_protection_refresh_status && toUpper(meta.native_protection_refresh_status) !== "OK") {
      issues.push(makeIssue({
        symbol,
        code: "NATIVE_PROTECTION_NOT_OK",
        detail: `native_protection_refresh_status=${toUpper(meta.native_protection_refresh_status)}`,
      }));
    }
  }

  const byCode = countIssuesByCode(issues);
  return {
    active_position_n: activePositions.length,
    recent_fill_n: recentFills.length,
    issue_n: issues.length,
    issue_by_code: byCode,
    tp0_fill_projection_missing_n: byCode.TP0_FILL_PROJECTION_MISSING || 0,
    tp1_fill_projection_missing_n: byCode.TP1_FILL_PROJECTION_MISSING || 0,
    tp1_fill_trail_inactive_n: byCode.TP1_FILL_TRAIL_INACTIVE || 0,
    projection_out_of_sync_n: byCode.PROJECTION_OUT_OF_SYNC || 0,
    native_protection_not_ok_n: byCode.NATIVE_PROTECTION_NOT_OK || 0,
    issues,
  };
}

module.exports = {
  buildBinanceFillProjectionAudit,
  __test: {
    isActivePosition,
    pickLatestFill,
    countIssuesByCode,
  },
};
