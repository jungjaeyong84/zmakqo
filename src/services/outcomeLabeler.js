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
  const tp1First = toBool(row.tp1_first);
  const slFirst = toBool(row.sl_first);
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
    tp1_first: tp1First,
    sl_first: slFirst,
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
