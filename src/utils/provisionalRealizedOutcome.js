"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function summarizeProvisionalRealizedOutcome(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const byMarket = Array.isArray(report && report.by_market) ? report.by_market : [];
  return {
    available: !!report,
    status: String(summary.status || "").trim().toUpperCase() || null,
    total_entry_n: toNum(summary.total_entry_n) || 0,
    final_realized_n: toNum(summary.final_realized_n) || 0,
    provisional_realized_n: toNum(summary.provisional_realized_n) || 0,
    unresolved_open_n: toNum(summary.unresolved_open_n) || 0,
    unresolved_stale_n: toNum(summary.unresolved_stale_n) || 0,
    effective_realized_n: toNum(summary.effective_realized_n) || 0,
    effective_win_rate: toNum(summary.effective_win_rate),
    effective_avg_ret_net: toNum(summary.effective_avg_ret_net),
    effective_net_pnl_krw: toNum(summary.effective_net_pnl_krw),
    top_provisional_market: String(summary.top_provisional_market || "").trim().toUpperCase() || null,
    by_market: byMarket,
    top_watch_markets: byMarket.slice(0, 8).map((row) => ({
      market: String(row && row.market || "").trim().toUpperCase() || null,
      provisional_n: toNum(row && row.provisional_n) || 0,
      effective_realized_n: toNum(row && row.effective_realized_n) || 0,
      effective_avg_ret_net: toNum(row && row.effective_avg_ret_net),
      effective_net_pnl_krw: toNum(row && row.effective_net_pnl_krw),
    })).filter((row) => row.market),
  };
}

module.exports = {
  summarizeProvisionalRealizedOutcome,
};
