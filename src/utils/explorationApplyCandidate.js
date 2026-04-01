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

function clampIntEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = toNum(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function deriveManualAction(proposedAction = null) {
  const action = upper(proposedAction);
  if (action === "DRYRUN_RELAX_EV_POLICY") return "MANUAL_APPLY_RELAX_EV_POLICY";
  if (action === "DRYRUN_RELAX_COOLDOWN_POLICY") return "MANUAL_APPLY_RELAX_COOLDOWN_POLICY";
  return "MANUAL_REVIEW_SERVER_POLICY";
}

function deriveAutoAction(proposedAction = null) {
  const action = upper(proposedAction);
  if (action === "DRYRUN_RELAX_EV_POLICY") return "AUTO_APPLY_RELAX_EV_POLICY";
  if (action === "DRYRUN_RELAX_COOLDOWN_POLICY") return "AUTO_APPLY_RELAX_COOLDOWN_POLICY";
  return "AUTO_REVIEW_SERVER_POLICY";
}

function includesMarket(list = [], market = null) {
  const key = upper(market);
  if (!key) return false;
  return (Array.isArray(list) ? list : []).some((row) => upper(row) === key);
}

function deriveExplorationApplyCandidate({
  explorationProposal = null,
  explorationBudget = null,
  executionQuality = null,
  reversePolicy = null,
  provisionalRealizedOutcome = null,
  serverPrimaryLearningEpoch = null,
} = {}) {
  const proposalSummary = readSummary(explorationProposal);
  const budgetSummary = readSummary(explorationBudget);
  const executionSummary = readSummary(executionQuality);
  const reverseSummary = readSummary(reversePolicy);
  const provisionalSummary = readSummary(provisionalRealizedOutcome);
  const epochSummary = readSummary(serverPrimaryLearningEpoch);

  const proposals = Array.isArray(proposalSummary.proposals) ? proposalSummary.proposals : [];
  const top = proposals[0] || null;
  const maxMarketApplyPerCycle = clampIntEnv("OPENCLAW_EXPLORATION_MAX_MARKET_APPLY_PER_CYCLE", 2, 1, 2);
  const epochActive = epochSummary.active === true || upper(epochSummary.status) === "SERVER_PRIMARY_EPOCH_ACTIVE";
  const floorScale = epochActive ? (toNum(epochSummary.realized_sample_floor_scale) || 0.65) : 1;
  const minEffectiveRealizedN = clampIntEnv(
    "OPENCLAW_EXPLORATION_MIN_EFFECTIVE_REALIZED_N",
    Math.max(1, Math.round(6 * floorScale)),
    1,
    100
  );

  if (!top) {
    return {
      status: "NO_APPLY_CANDIDATE",
      candidate_n: 0,
      manual_confirm_required: true,
      auto_apply_allowed: false,
      max_market_apply_per_cycle: maxMarketApplyPerCycle,
      top_market: null,
      top_stage: null,
      top_action: null,
      blockers: ["NO_EXPLORATION_PROPOSAL"],
      candidates: [],
    };
  }

  const market = upper(top.market);
  const stage = upper(top.stage);
  const sourceAction = upper(top.proposed_action);
  const blockers = [];
  const penaltyMode = upper(budgetSummary.penalty_mode) || "ENFORCED";
  const advisoryWarnings = [];

  if (!includesMarket(budgetSummary.exploration_markets, market)) blockers.push("NOT_IN_EXPLORATION_SLOT");
  if (penaltyMode === "ENFORCED" && includesMarket(budgetSummary.deferred_penalty_markets, market)) {
    blockers.push("EXPLORATION_DEFERRED_PENALTY");
  }

  const executionPenaltyMarkets = [
    executionSummary.top_latency_market,
    executionSummary.top_slippage_market,
    executionSummary.top_partial_market,
  ].map((row) => upper(row)).filter(Boolean);
  if (executionPenaltyMarkets.includes(market)) {
    if (penaltyMode === "ADVISORY_ONLY") advisoryWarnings.push("EXECUTION_QUALITY_REVIEW");
    else blockers.push("EXECUTION_QUALITY_REVIEW");
  }

  if (upper(reverseSummary.top_watch_market) === market && upper(reverseSummary.status) === "REVERSE_POLICY_REVIEW") {
    if (penaltyMode === "ADVISORY_ONLY") advisoryWarnings.push("REVERSE_POLICY_REVIEW");
    else blockers.push("REVERSE_POLICY_REVIEW");
  }

  const effectiveRealizedN = toNum(provisionalSummary.effective_realized_n);
  if (!Number.isFinite(effectiveRealizedN) || effectiveRealizedN < minEffectiveRealizedN) {
    blockers.push("EFFECTIVE_REALIZED_SAMPLE_THIN");
  }

  const autoApplyAllowed = blockers.length === 0;
  const manualConfirmRequired = !autoApplyAllowed;
  const proposedAction = autoApplyAllowed ? deriveAutoAction(sourceAction) : deriveManualAction(sourceAction);

  const candidate = {
    market,
    stage,
    proposed_action: proposedAction,
    source_proposed_action: sourceAction,
    manual_confirm_required: manualConfirmRequired,
    auto_apply_allowed: autoApplyAllowed,
    max_market_apply_per_cycle: maxMarketApplyPerCycle,
    penalty_mode: penaltyMode,
    learning_epoch_status: upper(epochSummary.status),
    learning_epoch_active: epochActive,
    advisory_warnings: advisoryWarnings,
    dry_run_status: upper(proposalSummary.status),
    objective_score: toNum(top.objective_score),
    recovery_priority_score: toNum(top.recovery_priority_score),
    delta_score: toNum(top.delta_score),
    drop_family: upper(top.drop_family),
    drop_reason: upper(top.drop_reason),
    drop_action: upper(top.drop_action),
    blockers,
  };

  return {
    status: autoApplyAllowed ? "AUTO_APPLY_CANDIDATE_READY" : "APPLY_CANDIDATE_READY",
    candidate_n: 1,
    manual_confirm_required: manualConfirmRequired,
    auto_apply_allowed: autoApplyAllowed,
    max_market_apply_per_cycle: maxMarketApplyPerCycle,
    top_market: candidate.market,
    top_stage: candidate.stage,
    top_action: candidate.proposed_action,
    blockers,
    penalty_mode: penaltyMode,
    learning_epoch_status: upper(epochSummary.status),
    learning_epoch_active: epochActive,
    advisory_warnings: advisoryWarnings,
    effective_realized_n: Number.isFinite(effectiveRealizedN) ? effectiveRealizedN : null,
    min_effective_realized_n: minEffectiveRealizedN,
    candidates: [candidate],
  };
}

module.exports = {
  deriveExplorationApplyCandidate,
};
