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

function deriveManualAction(proposedAction = null) {
  const action = upper(proposedAction);
  if (action === "DRYRUN_RELAX_EV_POLICY") return "MANUAL_APPLY_RELAX_EV_POLICY";
  if (action === "DRYRUN_RELAX_COOLDOWN_POLICY") return "MANUAL_APPLY_RELAX_COOLDOWN_POLICY";
  return "MANUAL_REVIEW_SERVER_POLICY";
}

function deriveExplorationApplyCandidate({ explorationProposal = null } = {}) {
  const proposalSummary = readSummary(explorationProposal);
  const proposals = Array.isArray(proposalSummary.proposals) ? proposalSummary.proposals : [];
  const top = proposals[0] || null;
  if (!top) {
    return {
      status: "NO_APPLY_CANDIDATE",
      candidate_n: 0,
      manual_confirm_required: true,
      auto_apply_allowed: false,
      max_market_apply_per_cycle: 1,
      top_market: null,
      top_stage: null,
      top_action: null,
      blockers: ["NO_EXPLORATION_PROPOSAL"],
      candidates: [],
    };
  }

  const candidate = {
    market: upper(top.market),
    stage: upper(top.stage),
    proposed_action: deriveManualAction(top.proposed_action),
    source_proposed_action: upper(top.proposed_action),
    manual_confirm_required: true,
    auto_apply_allowed: false,
    max_market_apply_per_cycle: 1,
    dry_run_status: upper(proposalSummary.status),
    objective_score: toNum(top.objective_score),
    recovery_priority_score: toNum(top.recovery_priority_score),
    delta_score: toNum(top.delta_score),
    drop_family: upper(top.drop_family),
    drop_reason: upper(top.drop_reason),
    drop_action: upper(top.drop_action),
  };

  return {
    status: "APPLY_CANDIDATE_READY",
    candidate_n: 1,
    manual_confirm_required: true,
    auto_apply_allowed: false,
    max_market_apply_per_cycle: 1,
    top_market: candidate.market,
    top_stage: candidate.stage,
    top_action: candidate.proposed_action,
    blockers: ["MANUAL_CONFIRM_REQUIRED", "AUTO_APPLY_DISABLED"],
    candidates: [candidate],
  };
}

module.exports = {
  deriveExplorationApplyCandidate,
};
