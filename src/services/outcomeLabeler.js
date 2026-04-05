"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value) {
  return value === true;
}

function labelOutcome(row = {}) {
  const outcomeState = String(row.outcome_state || "").trim().toUpperCase() || "UNKNOWN";
  const realizedRetNet = toNum(row.realized_ret_net);
  const realizedPnlQuote = toNum(row.realized_pnl_quote);
  const tp0Hit = toBool(row.tp0_hit);
  const tp0First = toBool(row.tp0_first);
  const tp1First = toBool(row.tp1_first);
  const slFirst = toBool(row.sl_first);
  const timeStopHit = toBool(row.time_stop_hit);
  const timeStopFirst = toBool(row.time_stop_first);
  const holdMinutes = toNum(row.hold_minutes);
  const sourceRowType = String(row.source_row_type || "").trim().toUpperCase() || "UNKNOWN";

  return {
    outcome_state: outcomeState,
    source_row_type: sourceRowType,
    is_realized: Number.isFinite(realizedRetNet),
    is_open: outcomeState === "OPEN_PENDING" || outcomeState === "FALLBACK_PENDING",
    is_drop: sourceRowType === "DROP",
    is_rejected: sourceRowType === "REJECTED",
    is_executed: sourceRowType === "EXECUTED" || sourceRowType === "PARTIAL" || sourceRowType === "FALLBACK",
    tp0_hit: tp0Hit,
    tp0_first: tp0First,
    tp1_first: tp1First,
    sl_first: slFirst,
    time_stop_hit: timeStopHit,
    time_stop_first: timeStopFirst,
    realized_ret_net: realizedRetNet,
    realized_pnl_quote: realizedPnlQuote,
    hold_minutes: holdMinutes,
    realized_direction: Number.isFinite(realizedRetNet)
      ? (realizedRetNet > 0 ? "POSITIVE" : (realizedRetNet < 0 ? "NEGATIVE" : "FLAT"))
      : null,
  };
}

module.exports = {
  labelOutcome,
};
