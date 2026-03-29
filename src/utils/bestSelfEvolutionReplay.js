"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function pctDelta(value) {
  const n = toNum(value);
  return n == null ? 0 : n;
}

function hasFlag(candidate, flag) {
  return Array.isArray(candidate && candidate.risk_flags) && candidate.risk_flags.includes(flag);
}

function deriveCandidateObjectiveDelta(candidate = {}, context = {}) {
  const objective = context.objective || {};
  const attribution = context.attribution || {};
  const currentObjectiveScore = toNum(objective.objective_score) || 0;
  const countFloorPass = objective.count_floor_pass !== false;
  const replacementFloorPass = objective.replacement_floor_pass !== false;
  const latencyBudgetPass = objective.latency_budget_pass !== false;
  const direction = String(candidate.direction || "SHIFT").toUpperCase();
  const scope = String(candidate.scope || "UNKNOWN").toUpperCase();
  const deltaParts = [];
  const blockers = [];

  if (hasFlag(candidate, "COUNT_GUARD_ACTIVE") && direction === "TIGHTEN") blockers.push("COUNT_GUARD_ACTIVE");
  if (hasFlag(candidate, "RECOVERY_PRIORITY_ACTIVE") && direction === "TIGHTEN") blockers.push("RECOVERY_PRIORITY_ACTIVE");
  if (!countFloorPass && direction === "TIGHTEN") blockers.push("SELF_EVOLUTION_COUNT_FLOOR_FAIL");
  if (!replacementFloorPass && direction === "TIGHTEN") blockers.push("SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL");
  if (!latencyBudgetPass) blockers.push("SELF_EVOLUTION_LATENCY_BUDGET_FAIL");

  const supportN = toNum(candidate.evidence && candidate.evidence.support_n) || 0;
  const supportRate = toNum(candidate.evidence && candidate.evidence.support_rate);
  const priorityScore = toNum(candidate.evidence && candidate.evidence.priority_score);
  const avgDroppedRet = toNum(candidate.evidence && candidate.evidence.avg_dropped_ret_net);
  const projectedCount = toNum(candidate.count_guard_effect && candidate.count_guard_effect.projected_count_ratio_global);
  const projectedReplacement = toNum(candidate.replacement_effect && candidate.replacement_effect.projected_replacement_ratio);
  const impliedAvgRetNetDelta = avgDroppedRet == null
    ? null
    : Number(((direction === "TIGHTEN" ? -avgDroppedRet : avgDroppedRet)).toFixed(4));

  if (priorityScore != null) deltaParts.push(clamp(priorityScore * 1.5, -1.0, 1.5));
  if (supportRate != null) deltaParts.push(clamp((supportRate - 0.5) * 3, -1.0, 1.0));
  if (supportN > 0) deltaParts.push(clamp(Math.log10(supportN + 1) * 0.25, 0, 0.5));
  if (avgDroppedRet != null) {
    if (direction === "TIGHTEN") deltaParts.push(clamp((-avgDroppedRet) * 40, -1.5, 1.5));
    else if (direction === "LOOSEN") deltaParts.push(clamp(avgDroppedRet * 40, -1.5, 1.5));
  }
  if (projectedCount != null) deltaParts.push(clamp((projectedCount - 1.0) * 4, -2.0, 1.0));
  if (projectedReplacement != null) deltaParts.push(clamp((projectedReplacement - 0.8) * 3, -1.5, 1.0));

  const dropTop = attribution.drop_top_layer && String(attribution.drop_top_layer.key || "").toUpperCase();
  const lateLossMarket = attribution.late_loss_top_market && String(attribution.late_loss_top_market.key || "").toUpperCase();
  const falseFireMarket = attribution.false_fire_top_market && String(attribution.false_fire_top_market.key || "").toUpperCase();
  const missedRecoveryReason = attribution.missed_recovery_top_reason && String(attribution.missed_recovery_top_reason.key || "").toUpperCase();
  const fallbackCostMarket = attribution.fallback_cost_top_market && String(attribution.fallback_cost_top_market.key || "").toUpperCase();
  const candidateMarkets = Array.isArray(candidate.markets) ? candidate.markets.map((row) => String(row || "").toUpperCase()) : [];

  if (scope === "WAIT") {
    if (lateLossMarket) deltaParts.push(direction === "LOOSEN" ? 0.8 : -0.4);
    if (falseFireMarket) deltaParts.push(direction === "TIGHTEN" ? 0.5 : -0.3);
  } else if (scope === "EV") {
    if (dropTop === "EV") deltaParts.push(direction === "LOOSEN" ? 0.7 : -0.5);
  } else if (scope === "ML") {
    if (dropTop === "QUALITY") deltaParts.push(direction === "LOOSEN" ? 0.6 : -0.6);
  } else if (scope === "AI") {
    if (dropTop === "AI") deltaParts.push(direction === "LOOSEN" ? 0.5 : -0.4);
  } else if (scope === "PINE") {
    if (dropTop === "QUALITY") deltaParts.push(direction === "TIGHTEN" ? -0.8 : 0.5);
    if (missedRecoveryReason) deltaParts.push(direction === "LOOSEN" ? 0.4 : -0.2);
  }

  if (candidateMarkets.includes(lateLossMarket) && scope === "WAIT" && direction === "LOOSEN") deltaParts.push(0.3);
  if (candidateMarkets.includes(falseFireMarket) && scope === "WAIT" && direction === "TIGHTEN") deltaParts.push(0.3);
  if (candidateMarkets.includes(fallbackCostMarket)) deltaParts.push(direction === "TIGHTEN" ? -0.2 : 0.1);

  const delta = Number(deltaParts.reduce((acc, n) => acc + n, 0).toFixed(4));
  let validationVerdict = "WARN";
  if (blockers.length) validationVerdict = "BLOCK";
  else if (delta >= 0.5) validationVerdict = "PASS";
  else if (delta <= -0.5) validationVerdict = "BLOCK";

  return {
    validation_mode: "OFFLINE_PROXY_V1",
    candidate_id: candidate.candidate_id || null,
    display_candidate_id: candidate.display_candidate_id || candidate.candidate_id || null,
    scope,
    direction,
    current_objective_score: Number(currentObjectiveScore.toFixed(4)),
    candidate_objective_delta: delta,
    count_delta: projectedCount == null ? null : Number((projectedCount - 1).toFixed(4)),
    replacement_delta: projectedReplacement == null ? null : Number((projectedReplacement - 0.8).toFixed(4)),
    avg_ret_net_delta: impliedAvgRetNetDelta,
    projected_objective_score: Number((currentObjectiveScore + delta).toFixed(4)),
    validation_verdict: validationVerdict,
    blockers,
    risk_flags: Array.isArray(candidate.risk_flags) ? candidate.risk_flags.slice() : [],
    count_guard_effect: candidate.count_guard_effect || null,
    replacement_effect: candidate.replacement_effect || null,
    summary: String(candidate.evidence && candidate.evidence.rationale || candidate.status || "N/A"),
  };
}

function buildReplayValidationReport({ candidateChangeSet = null, objective = null, attribution = null } = {}) {
  const rows = Array.isArray(candidateChangeSet && candidateChangeSet.rows) ? candidateChangeSet.rows : [];
  const objectiveSummary = objective && typeof objective === "object" ? objective : {};
  const attributionSummary = attribution && typeof attribution === "object" ? attribution : {};
  const validations = rows.map((row) => deriveCandidateObjectiveDelta(row, { objective: objectiveSummary, attribution: attributionSummary }));
  validations.sort((a, b) =>
    ((b.candidate_objective_delta || -Infinity) - (a.candidate_objective_delta || -Infinity))
    || String(a.candidate_id || "").localeCompare(String(b.candidate_id || ""))
  );
  const passN = validations.filter((row) => row.validation_verdict === "PASS").length;
  const warnN = validations.filter((row) => row.validation_verdict === "WARN").length;
  const blockN = validations.filter((row) => row.validation_verdict === "BLOCK").length;
  const best = validations[0] || null;
  return {
    validation_mode: "OFFLINE_PROXY_V1",
    summary: {
      total_n: validations.length,
      pass_n: passN,
      warn_n: warnN,
      block_n: blockN,
      best_candidate_id: best && best.candidate_id || null,
      best_verdict: best && best.validation_verdict || null,
      best_objective_delta: best && best.candidate_objective_delta != null ? best.candidate_objective_delta : null,
    },
    validations,
  };
}

module.exports = {
  deriveCandidateObjectiveDelta,
  buildReplayValidationReport,
};
