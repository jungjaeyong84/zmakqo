"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deriveWeightTuningPlan({ objective = null, attribution = null, canary = null, memoryLedger = null } = {}) {
  const objectiveSummary = objective && typeof objective === "object" ? objective : {};
  const attributionSummary = attribution && typeof attribution === "object" ? attribution : {};
  const canarySummary = canary && typeof canary === "object" ? canary : {};
  const memorySummary = memoryLedger && typeof memoryLedger === "object" ? memoryLedger : {};
  const suggestions = [];

  const countBlocked = objectiveSummary.count_floor_pass === false;
  const replacementBlocked = objectiveSummary.replacement_floor_pass === false;
  const memoryBlocked = Number(memorySummary.blocked_candidate_n || 0) > 0;
  const canaryBlocked = canarySummary.apply_pass === false;

  if (!countBlocked) {
    if (attributionSummary.late_loss_top_market) {
      suggestions.push({ axis: "delay_cost_weight", direction: "UP", delta: 0.05, reason: "LATE_LOSS_TOP_MARKET" });
      suggestions.push({ axis: "late_risk_weight", direction: "DOWN", delta: 0.02, reason: "LATE_LOSS_EARLIER_ENTRY" });
    }
    if (attributionSummary.false_fire_top_market) {
      suggestions.push({ axis: "failure_risk_weight", direction: "UP", delta: 0.05, reason: "FALSE_FIRE_TOP_MARKET" });
      suggestions.push({ axis: "lock_score_weight", direction: "UP", delta: 0.02, reason: "FALSE_FIRE_NEEDS_MORE_LOCK" });
    }
    if (attributionSummary.missed_recovery_top_reason) {
      suggestions.push({ axis: "delay_cost_weight", direction: "UP", delta: 0.03, reason: "MISSED_RECOVERY_TOP_REASON" });
      suggestions.push({ axis: "lock_score_weight", direction: "DOWN", delta: 0.02, reason: "MISSED_RECOVERY_EASE_LOCK" });
    }
    if (attributionSummary.fallback_cost_top_market) {
      suggestions.push({ axis: "late_risk_weight", direction: "UP", delta: 0.03, reason: "FALLBACK_COST_TOP_MARKET" });
    }
  }

  const advisoryMode = (countBlocked || replacementBlocked || canaryBlocked)
    ? "HOLD"
    : (suggestions.length ? (memoryBlocked ? "ADVISORY_ONLY" : "ADJUST") : "KEEP");
  const dominant = suggestions[0] ? suggestions[0].axis : null;
  const autonomousDefer = advisoryMode === "ADVISORY_ONLY";
  const deferReason = autonomousDefer
    ? (memoryBlocked ? "MEMORY_BLOCKED" : "BOUNDED_DEFER")
    : null;

  return {
    summary: {
      advisory_mode: advisoryMode,
      suggestion_n: suggestions.length,
      dominant_axis: dominant,
      count_guard_blocked: countBlocked,
      replacement_guard_blocked: replacementBlocked,
      memory_blocked: memoryBlocked,
      canary_blocked: canaryBlocked,
      autonomous_defer: autonomousDefer,
      defer_reason: deferReason,
    },
    suggestions,
  };
}

module.exports = {
  deriveWeightTuningPlan,
};
