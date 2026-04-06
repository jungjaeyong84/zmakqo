"use strict";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function countByAction(rows = [], action) {
  const target = upper(action);
  return rows.filter((row) => upper(row && row.allocation_action) === target).length;
}

function averageObjectiveScore(rows = []) {
  const nums = rows.map((row) => toNum(row && row.objective_score)).filter((value) => value != null);
  if (!nums.length) return null;
  return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(4));
}

function buildCohortActionRows(boardSummary = {}) {
  const watchRows = Array.isArray(boardSummary.top_watch_markets) ? boardSummary.top_watch_markets : [];
  const grouped = new Map();
  for (const row of watchRows) {
    const cohort = upper(row && row.cohort);
    if (!["RESCUE", "MIXED", "KEEP_DROP"].includes(cohort)) continue;
    if (!cohort) continue;
    if (!grouped.has(cohort)) grouped.set(cohort, []);
    grouped.get(cohort).push(row);
  }
  return Array.from(grouped.entries())
    .map(([cohort, rows]) => ({
      cohort,
      market_n: rows.length,
      quarantine_n: countByAction(rows, "QUARANTINE"),
      hold_n: countByAction(rows, "HOLD"),
      increase_n: countByAction(rows, "INCREASE"),
      review_n: rows.filter((row) => String(row && row.allocation_action || "").trim().toUpperCase().includes("REVIEW")).length,
      avg_objective_score: averageObjectiveScore(rows),
    }))
    .sort((a, b) => Number(b.market_n || 0) - Number(a.market_n || 0) || String(a.cohort).localeCompare(String(b.cohort)));
}

function deriveCohortRegimeParameterSplitContract({
  marketRegimeBoard = null,
  policyParameterPlan = null,
} = {}) {
  const boardSummary = readSummary(marketRegimeBoard);
  const policySummary = readSummary(policyParameterPlan);

  const rescueN = toNum(boardSummary.rescue_market_n) || 0;
  const mixedN = toNum(boardSummary.mixed_market_n) || 0;
  const keepDropN = toNum(boardSummary.keep_drop_market_n) || 0;
  const activeMarketN = toNum(boardSummary.active_market_n) || 0;
  const hasMarketSplit = boardSummary.has_market_split === true;
  const boardStatus = String(boardSummary.status || "").trim() || null;
  const cohortActionRows = buildCohortActionRows(boardSummary);
  const activeCohorts = [
    rescueN > 0 ? "RESCUE" : null,
    mixedN > 0 ? "MIXED" : null,
    keepDropN > 0 ? "KEEP_DROP" : null,
  ].filter(Boolean);
  const actionCohorts = cohortActionRows.map((row) => row.cohort);

  const boardActive = hasMarketSplit || String(boardStatus || "").toUpperCase().includes("COHORT_ACTIVE");
  const cohortParameterizationReady = activeCohorts.length === 3;
  const policyScopedReady = String(policySummary.status || "").trim().length > 0
    && toNum(policySummary.market_action_n) != null
    && toNum(policySummary.global_qty_scale) != null;
  const autoSwitchObservabilityReady = cohortActionRows.length >= 2
    && actionCohorts.every((cohort) => activeCohorts.includes(cohort));
  const regimeSwitchReady = boardActive && hasMarketSplit && activeMarketN > 0;
  const automaticTransitionReady = regimeSwitchReady && policyScopedReady && autoSwitchObservabilityReady;

  const blockingReasons = [];
  if (!boardActive) blockingReasons.push("MARKET_REGIME_BOARD_NOT_ACTIVE");
  if (!hasMarketSplit) blockingReasons.push("MARKET_REGIME_SPLIT_NOT_AVAILABLE");
  if (!cohortParameterizationReady) blockingReasons.push("COHORT_PARAMETERIZATION_INCOMPLETE");
  if (!policyScopedReady) blockingReasons.push("POLICY_PARAMETER_SCOPE_NOT_READY");
  if (!autoSwitchObservabilityReady) blockingReasons.push("COHORT_ACTION_OBSERVABILITY_NOT_READY");

  const status = blockingReasons.length === 0
    ? "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_READY"
    : (boardActive || policyScopedReady
      ? "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_BOOTSTRAPPING"
      : "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_BLOCKED");

  return {
    status,
    contract_mode: "COHORT_REGIME_AUTO_SWITCH",
    cohort_scope: "RESCUE_MIXED_KEEP_DROP",
    board_status: boardStatus,
    has_market_split: hasMarketSplit,
    active_market_n: activeMarketN,
    active_cohort_n: activeCohorts.length,
    rescue_market_n: rescueN,
    mixed_market_n: mixedN,
    keep_drop_market_n: keepDropN,
    cohort_parameterization_ready: cohortParameterizationReady,
    regime_switch_ready: regimeSwitchReady,
    policy_scoped_ready: policyScopedReady,
    auto_switch_observability_ready: autoSwitchObservabilityReady,
    automatic_transition_ready: automaticTransitionReady,
    policy_plan_mode: String(policySummary.mode || "").trim() || null,
    policy_plan_status: String(policySummary.status || "").trim() || null,
    policy_global_qty_scale: toNum(policySummary.global_qty_scale),
    policy_watch_only_review_market_n: toNum(policySummary.watch_only_review_market_n),
    policy_quarantine_market_n: toNum(policySummary.quarantine_market_n),
    cohort_action_profile_n: cohortActionRows.length,
    cohort_action_rows: cohortActionRows,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  deriveCohortRegimeParameterSplitContract,
  __test: {
    buildCohortActionRows,
  },
};
