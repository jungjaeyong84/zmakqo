"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readRows(value, key = "by_market") {
  const raw = unwrapRawReport(value) || {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  return Array.isArray(summary[key]) ? summary[key] : [];
}

function deriveReasons(row = {}) {
  const reasons = [];
  if (row.deferred_penalty === true) reasons.push("DEFERRED_PENALTY");
  if (row.execution_quality_penalty === true) reasons.push("EXECUTION_QUALITY_PENALTY");
  if (row.reverse_policy_penalty === true) reasons.push("REVERSE_POLICY_PENALTY");
  if (upper(row.objective_band) === "SEVERE_DRAG") reasons.push("SEVERE_DRAG");
  if ((toNum(row.allocation_score) || 0) <= -3) reasons.push("ALLOCATION_SCORE_COLLAPSE");
  if (reasons.length === 0) reasons.push("CAPITAL_ALLOCATOR_QUARANTINE");
  return reasons;
}

function deriveSeverity(reasons = []) {
  if (reasons.includes("ALLOCATION_SCORE_COLLAPSE") || reasons.includes("SEVERE_DRAG")) return "HIGH";
  if (reasons.length >= 2) return "HIGH";
  return "MEDIUM";
}

function deriveServerMarketQuarantine({
  serverMarketCapitalAllocator = null,
} = {}) {
  const allocatorRows = readRows(serverMarketCapitalAllocator, "by_market");
  const quarantineRows = allocatorRows
    .filter((row) => row && row.active === true && upper(row.recommended_action) === "QUARANTINE")
    .map((row) => {
      const reasons = deriveReasons(row);
      return {
        market: upper(row.market),
        allocation_score: toNum(row.allocation_score),
        objective_score: toNum(row.objective_score),
        recovery_priority_score: toNum(row.recovery_priority_score),
        avg_horizon_pnl_quote_proxy: toNum(row.avg_horizon_pnl_quote_proxy),
        production_slot: row.production_slot === true,
        exploration_slot: row.exploration_slot === true,
        deferred_penalty: row.deferred_penalty === true,
        execution_quality_penalty: row.execution_quality_penalty === true,
        reverse_policy_penalty: row.reverse_policy_penalty === true,
        quarantine_reasons: reasons,
        quarantine_reason: reasons[0] || "CAPITAL_ALLOCATOR_QUARANTINE",
        quarantine_severity: deriveSeverity(reasons),
        recommended_action: "WATCH_ONLY_NO_EXCLUDE",
        release_action: "REVIEW_AFTER_OBJECTIVE_AND_QUALITY_RECOVERY",
      };
    })
    .sort((a, b) => (a.allocation_score || 0) - (b.allocation_score || 0) || String(a.market).localeCompare(String(b.market)));

  const topQuarantine = quarantineRows[0] || null;

  return {
    status: quarantineRows.length > 0 ? "QUARANTINE_WATCH_ONLY_ACTIVE" : "QUARANTINE_CLEAR",
    enforced: false,
    server_signal_learning_mode: true,
    quarantine_market_n: quarantineRows.length,
    top_quarantine_market: topQuarantine ? topQuarantine.market : null,
    top_quarantine_reason: topQuarantine ? topQuarantine.quarantine_reason : null,
    top_quarantine_severity: topQuarantine ? topQuarantine.quarantine_severity : null,
    top_watch_markets: quarantineRows.slice(0, 8).map((row) => ({
      market: row.market,
      quarantine_reason: row.quarantine_reason,
      quarantine_severity: row.quarantine_severity,
      allocation_score: row.allocation_score,
      recommended_action: row.recommended_action,
    })),
    by_market: quarantineRows,
  };
}

module.exports = {
  deriveServerMarketQuarantine,
};
