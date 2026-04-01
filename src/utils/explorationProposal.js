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

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function byMarketMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const market = upper(row && row.market);
    if (!market || map.has(market)) continue;
    map.set(market, row);
  }
  return map;
}

function deriveProposalStage({ dropRow = null, deltaRow = null } = {}) {
  const dominantFamily = upper(dropRow && (dropRow.dominant_family || dropRow.family));
  const dropAction = upper(dropRow && dropRow.recommended_action);
  const deltaAction = upper(deltaRow && deltaRow.recommended_action);
  if (dominantFamily === "EV_POLICY" || dropAction === "RELAX_EV_POLICY_REVIEW" || deltaAction === "RELAX_EV_POLICY_REVIEW") {
    return "EV";
  }
  if (dominantFamily === "COOLDOWN_POLICY" || dropAction === "RELAX_COOLDOWN_POLICY_REVIEW") {
    return "WAIT";
  }
  return "REVIEW";
}

function deriveExplorationProposal({
  explorationBudget = null,
  marketObjectiveScore = null,
  serverVsPinePerformanceDelta = null,
  dropValidation = null,
} = {}) {
  const budgetSummary = readSummary(explorationBudget);
  const objectiveSummary = readSummary(marketObjectiveScore);
  const deltaSummary = readSummary(serverVsPinePerformanceDelta);
  const dropSummary = readSummary(dropValidation);

  const explorationMarkets = Array.isArray(budgetSummary.exploration_markets)
    ? budgetSummary.exploration_markets.map((row) => upper(row)).filter(Boolean)
    : [];

  const objectiveByMarket = byMarketMap(objectiveSummary.top_watch_markets);
  const deltaByMarket = byMarketMap(deltaSummary.top_watch_markets);
  const dropByMarket = byMarketMap(dropSummary.top_watch_markets);

  const proposals = explorationMarkets.map((market) => {
    const objectiveRow = objectiveByMarket.get(market) || null;
    const deltaRow = deltaByMarket.get(market) || null;
    const dropRow = dropByMarket.get(market) || null;
    const stage = deriveProposalStage({ dropRow, deltaRow });
    const proposedAction = stage === "EV"
      ? "DRYRUN_RELAX_EV_POLICY"
      : (stage === "WAIT" ? "DRYRUN_RELAX_COOLDOWN_POLICY" : "DRYRUN_REVIEW_SERVER_POLICY");
    return {
      market,
      stage,
      proposed_action: proposedAction,
      dry_run_only: true,
      objective_score: toNum(objectiveRow && objectiveRow.objective_score),
      objective_band: upper(objectiveRow && objectiveRow.objective_band),
      recovery_priority_score: toNum(objectiveRow && objectiveRow.recovery_priority_score),
      delta_score: toNum(deltaRow && deltaRow.performance_delta_score),
      delta_verdict: upper(deltaRow && deltaRow.verdict),
      delta_action: upper(deltaRow && deltaRow.recommended_action),
      drop_verdict: upper(dropRow && dropRow.verdict),
      drop_family: upper(dropRow && (dropRow.dominant_family || dropRow.family)),
      drop_reason: upper(dropRow && (dropRow.dominant_reason || dropRow.reason)),
      drop_action: upper(dropRow && dropRow.recommended_action),
    };
  });

  const status = proposals.length > 0 ? "EXPLORATION_DRY_RUN_READY" : "NO_EXPLORATION_PROPOSAL";
  return {
    status,
    proposal_n: proposals.length,
    top_market: proposals[0] ? proposals[0].market : null,
    top_stage: proposals[0] ? proposals[0].stage : null,
    top_action: proposals[0] ? proposals[0].proposed_action : null,
    proposals,
  };
}

module.exports = {
  deriveExplorationProposal,
};
