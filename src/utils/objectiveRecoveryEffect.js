"use strict";
const { unwrapRawReport, toNum, extractObjectiveScore, deriveObjectiveScoreSnapshot } = require("./objectiveScoreSnapshot");

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function findCandidateRow(candidates = null, candidateId = null) {
  const rows = Array.isArray(candidates && candidates.rows) ? candidates.rows : [];
  const target = String(candidateId || "").trim();
  if (!target) return null;
  return rows.find((row) => String(row && row.candidate_id || "").trim() === target)
    || rows.find((row) => String(row && row.display_candidate_id || "").trim() === target)
    || null;
}

function findReplayRow(replay = null, candidateId = null) {
  const rows = Array.isArray(replay && replay.validations) ? replay.validations : [];
  const target = String(candidateId || "").trim();
  if (!target) return null;
  return rows.find((row) => String(row && row.candidate_id || "").trim() === target)
    || rows.find((row) => String(row && row.display_candidate_id || "").trim() === target)
    || null;
}

function isReadyCandidate(candidateRow = null) {
  if (!candidateRow || typeof candidateRow !== "object") return false;
  if (candidateRow.ready_for_auto_apply !== true) return false;
  if (candidateRow.memory_blocked === true) return false;
  if (candidateRow.failed_fingerprint_repeat === true) return false;
  return true;
}

function displayCandidateId(candidateRow = null, fallback = null) {
  return String(
    candidateRow && (candidateRow.display_candidate_id || candidateRow.canonical_candidate_id || candidateRow.candidate_id)
    || fallback
    || ""
  ).trim() || null;
}

function normalizeReplayRows(replay = null, candidates = null) {
  const rows = Array.isArray(replay && replay.validations) ? replay.validations : [];
  return rows
    .map((row) => {
      const candidateId = String(row && row.candidate_id || "").trim() || null;
      const candidateRow = findCandidateRow(candidates, candidateId);
      return {
        row,
        candidate_id: candidateId,
        display_candidate_id: String(row && row.display_candidate_id || displayCandidateId(candidateRow, candidateId) || "").trim() || null,
        candidate_row: candidateRow,
        delta: toNum(row && row.candidate_objective_delta),
        verdict: toUpper(row && row.validation_verdict),
        ready_for_auto_apply: isReadyCandidate(candidateRow),
      };
    })
    .filter((item) => item.candidate_id)
    .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
}

function computeGapClosure(currentScore = null, projectedScore = null) {
  const currentGap = currentScore != null && currentScore < 0 ? Math.abs(currentScore) : 0;
  const projectedGap = projectedScore != null && projectedScore < 0 ? Math.abs(projectedScore) : 0;
  if (!(currentGap > 0)) {
    return {
      current_gap_to_zero: currentGap,
      projected_gap_to_zero: projectedGap,
      gap_closed: 0,
      gap_closure_rate: null,
    };
  }
  const gapClosed = Math.max(currentGap - projectedGap, 0);
  return {
    current_gap_to_zero: currentGap,
    projected_gap_to_zero: projectedGap,
    gap_closed: gapClosed,
    gap_closure_rate: gapClosed / currentGap,
  };
}

function buildNextActions({
  trackingStatus = null,
  targetDisplayId = null,
  targetDelta = null,
  projectedScore = null,
  higherDeltaCandidate = null,
  monthlyFailedChecks = [],
  monthlyTopDropReason = null,
} = {}) {
  const actions = [];
  if (trackingStatus === "TARGET_REPLAY_EVIDENCE_MISSING") {
    actions.push(`Generate replay evidence for ${targetDisplayId || "the recovery target"} before trusting the recovery path.`);
    return actions;
  }
  if (trackingStatus === "NO_RECOVERY_REQUIRED") {
    actions.push("Objective recovery tracking is idle because the contract does not currently require recovery.");
    return actions;
  }
  if (targetDisplayId) {
    if (targetDelta != null) {
      actions.push(`Track ${targetDisplayId} as the active recovery target; projected objective delta is ${targetDelta >= 0 ? "+" : ""}${targetDelta.toFixed(4)}.`);
    } else {
      actions.push(`Track ${targetDisplayId} as the active recovery target; projected objective delta is not available yet.`);
    }
  }
  if (projectedScore != null && projectedScore < 0) {
    actions.push(`Projected objective score remains below zero (${projectedScore.toFixed(4)}); one recovery promotion will not close the full objective gap.`);
  }
  if (higherDeltaCandidate && higherDeltaCandidate.candidate_id) {
    actions.push(`A higher-delta candidate exists (${higherDeltaCandidate.display_candidate_id || higherDeltaCandidate.candidate_id}), but it is not ready for auto-apply (${higherDeltaCandidate.hold_reason || "UNSPECIFIED_NOT_READY"}).`);
  }
  if (monthlyFailedChecks.length) {
    actions.push(`Retrospective monthly blockers remain ${monthlyFailedChecks.slice(0, 3).join("|")}${monthlyFailedChecks.length > 3 ? "..." : ""}.`);
  }
  if (monthlyTopDropReason) {
    actions.push(`Top monthly drop reason is ${monthlyTopDropReason}; keep measuring whether the recovery target actually reduces that drag source.`);
  }
  return actions;
}

function deriveObjectiveRecoveryEffect({
  autonomyContract = null,
  objective = null,
  objectiveSupervisor = null,
  objectiveRecoveryGovernor = null,
  candidates = null,
  replay = null,
  retrospective = null,
} = {}) {
  const contract = unwrapRawReport(autonomyContract) || {};
  const contractStatus = contract.current_status && typeof contract.current_status === "object" ? contract.current_status : {};
  const objectiveReport = unwrapRawReport(objective) || {};
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const governor = unwrapRawReport(objectiveRecoveryGovernor) || {};
  const governorSummary = readSummary(governor);
  const candidateReport = unwrapRawReport(candidates) || {};
  const replayReport = unwrapRawReport(replay) || {};
  const retrospectiveReport = unwrapRawReport(retrospective) || {};

  const recoveryRequired = governorSummary.recovery_required === true
    || contractStatus.recovery_required === true
    || ((extractObjectiveScore(objectiveReport) ?? toNum(contractStatus.objective_score)) < 0);
  const objectiveScoreSnapshot = deriveObjectiveScoreSnapshot({
    objective: objectiveReport,
    objectiveSupervisor: supervisor,
    autonomyContract: contract,
    objectiveRecoveryGovernor: governor,
  });
  const currentObjectiveScore = objectiveScoreSnapshot.objective_score;
  const targetCandidateId = String(
    governorSummary.target_candidate_id
    || supervisor.promotion && (supervisor.promotion.candidate_id || supervisor.promotion.display_candidate_id)
    || candidateReport.summary && candidateReport.summary.top_candidate_id
    || ""
  ).trim() || null;
  const targetCandidateRow = findCandidateRow(candidateReport, targetCandidateId);
  const targetReplayRow = findReplayRow(replayReport, targetCandidateId);
  const replayRows = normalizeReplayRows(replayReport, candidateReport);
  const passRows = replayRows.filter((item) => item.verdict === "PASS" && item.delta != null);
  const bestReplay = passRows[0] || null;
  const bestReadyReplay = passRows.find((item) => item.ready_for_auto_apply) || null;
  const targetReplayDelta = toNum(targetReplayRow && targetReplayRow.candidate_objective_delta);
  const targetProjectedScore = toNum(targetReplayRow && targetReplayRow.projected_objective_score);
  const targetAfterMetrics = targetReplayRow && targetReplayRow.after_metrics && typeof targetReplayRow.after_metrics === "object"
    ? targetReplayRow.after_metrics
    : {};
  const targetBeforeMetrics = targetReplayRow && targetReplayRow.before_metrics && typeof targetReplayRow.before_metrics === "object"
    ? targetReplayRow.before_metrics
    : {};
  const targetTargetMarket = String(
    governorSummary.target_market
    || targetCandidateRow && (targetCandidateRow.target_market || (Array.isArray(targetCandidateRow.markets) && targetCandidateRow.markets.length === 1 ? targetCandidateRow.markets[0] : ""))
    || ""
  ).trim() || null;
  const marketConcentration = objectiveReport.market_concentration && typeof objectiveReport.market_concentration === "object"
    ? objectiveReport.market_concentration
    : {};
  const dominantNegativeMarket = String(marketConcentration.dominant_negative_market && marketConcentration.dominant_negative_market.market || "").trim() || null;
  const dominantNegativeShare = toNum(marketConcentration.dominant_negative_share);
  const dominantNegativeMarketObjectiveScore = toNum(marketConcentration.dominant_negative_market && marketConcentration.dominant_negative_market.objective_score);
  const monthlyPeriod = retrospectiveReport.periods && retrospectiveReport.periods.MONTHLY && typeof retrospectiveReport.periods.MONTHLY === "object"
    ? retrospectiveReport.periods.MONTHLY
    : {};
  const monthlyObjective = monthlyPeriod.objective && typeof monthlyPeriod.objective === "object" ? monthlyPeriod.objective : {};
  const monthlyDrops = monthlyPeriod.drops && typeof monthlyPeriod.drops === "object" ? monthlyPeriod.drops : {};
  const monthlyTopDrop = Array.isArray(monthlyDrops.top_reasons) ? monthlyDrops.top_reasons[0] : null;
  const higherDeltaCandidate = passRows.find((item) => {
    if (!item || !item.candidate_id) return false;
    if (targetReplayDelta == null || !(item.delta > targetReplayDelta)) return false;
    return item.ready_for_auto_apply !== true;
  }) || null;

  let trackingStatus = "TRACKED";
  let trackingReason = "TRACKED";
  if (!recoveryRequired) {
    trackingStatus = "NO_RECOVERY_REQUIRED";
    trackingReason = "NO_RECOVERY_REQUIRED";
  } else if (!targetCandidateId) {
    trackingStatus = "NO_RECOVERY_TARGET";
    trackingReason = "NO_RECOVERY_TARGET";
  } else if (!targetReplayRow) {
    trackingStatus = "TARGET_REPLAY_EVIDENCE_MISSING";
    trackingReason = "TARGET_REPLAY_EVIDENCE_MISSING";
  } else if (targetReplayDelta == null || !(targetReplayDelta > 0)) {
    trackingStatus = "TARGET_NO_OBJECTIVE_IMPROVEMENT";
    trackingReason = "TARGET_NO_OBJECTIVE_IMPROVEMENT";
  } else if (targetProjectedScore != null && targetProjectedScore >= 0) {
    trackingStatus = "PROJECTED_OBJECTIVE_ON_TRACK";
    trackingReason = "PROJECTED_OBJECTIVE_ON_TRACK";
  } else {
    trackingStatus = "PARTIAL_RECOVERY_ONLY";
    trackingReason = "TARGET_PROJECTED_IMPROVEMENT_STILL_BELOW_ZERO";
  }

  const gap = computeGapClosure(currentObjectiveScore, targetProjectedScore);
  const projectedWinRate = toNum(targetAfterMetrics.win_rate);
  const projectedAvgRetNet = toNum(targetAfterMetrics.avg_ret_net);
  const projectedExecutedN = toNum(targetAfterMetrics.executed_n);
  const projectedRealizedN = toNum(targetAfterMetrics.realized_n);
  const currentExecutedN = toNum(targetBeforeMetrics.executed_n);
  const currentRealizedN = toNum(targetBeforeMetrics.realized_n);
  const bestReplayDelta = toNum(bestReplay && bestReplay.row && bestReplay.row.candidate_objective_delta);
  const bestReplayProjectedScore = toNum(bestReplay && bestReplay.row && bestReplay.row.projected_objective_score);
  const bestReadyReplayDelta = toNum(bestReadyReplay && bestReadyReplay.row && bestReadyReplay.row.candidate_objective_delta);
  const targetDisplayId = String(
    governorSummary.display_candidate_id
    || displayCandidateId(targetCandidateRow, targetCandidateId)
    || targetCandidateId
    || ""
  ).trim() || null;
  const higherDeltaHoldReason = higherDeltaCandidate
    ? String(
      higherDeltaCandidate.candidate_row && higherDeltaCandidate.candidate_row.status
      || (Array.isArray(higherDeltaCandidate.candidate_row && higherDeltaCandidate.candidate_row.risk_flags) && higherDeltaCandidate.candidate_row.risk_flags.join("|"))
      || "NOT_READY"
    ).trim() || null
    : null;

  return {
    summary: {
      recovery_required: recoveryRequired,
      tracking_status: trackingStatus,
      tracking_reason: trackingReason,
      target_candidate_id: targetCandidateId,
      display_candidate_id: targetDisplayId,
      target_deploy_unit: toUpper(governorSummary.target_deploy_unit || targetCandidateRow && targetCandidateRow.target_deploy_unit),
      target_migration_class: toUpper(governorSummary.target_migration_class || targetCandidateRow && targetCandidateRow.canonical_migration_class),
      target_ready_for_auto_apply: isReadyCandidate(targetCandidateRow),
      target_replay_pass: toUpper(targetReplayRow && targetReplayRow.validation_verdict) === "PASS",
      current_objective_score: currentObjectiveScore,
      current_objective_score_source: objectiveScoreSnapshot.objective_score_source,
      target_candidate_objective_delta: targetReplayDelta,
      projected_objective_score: targetProjectedScore,
      current_gap_to_zero: gap.current_gap_to_zero,
      projected_gap_to_zero: gap.projected_gap_to_zero,
      gap_closed: gap.gap_closed,
      gap_closure_rate: gap.gap_closure_rate,
      projected_on_track: targetProjectedScore != null && targetProjectedScore >= 0,
      projected_executed_n: projectedExecutedN,
      projected_realized_n: projectedRealizedN,
      current_executed_n: currentExecutedN,
      current_realized_n: currentRealizedN,
      projected_win_rate: projectedWinRate,
      projected_avg_ret_net: projectedAvgRetNet,
      projected_win_rate_target_pass: projectedWinRate != null ? projectedWinRate >= 0.6 : null,
      projected_expectancy_pass: projectedAvgRetNet != null ? projectedAvgRetNet > 0 : null,
      dominant_negative_market: dominantNegativeMarket,
      dominant_negative_market_objective_score: dominantNegativeMarketObjectiveScore,
      dominant_negative_share: dominantNegativeShare,
      target_market: targetTargetMarket,
      target_matches_dominant_negative_market: Boolean(targetTargetMarket && dominantNegativeMarket && targetTargetMarket === dominantNegativeMarket),
      best_replay_candidate_id: bestReplay && bestReplay.candidate_id || null,
      best_replay_display_candidate_id: bestReplay && bestReplay.display_candidate_id || null,
      best_replay_objective_delta: bestReplayDelta,
      best_replay_projected_objective_score: bestReplayProjectedScore,
      best_ready_candidate_id: bestReadyReplay && bestReadyReplay.candidate_id || null,
      best_ready_display_candidate_id: bestReadyReplay && bestReadyReplay.display_candidate_id || null,
      best_ready_candidate_objective_delta: bestReadyReplayDelta,
      best_ready_matches_target: Boolean(bestReadyReplay && targetCandidateId && bestReadyReplay.candidate_id === targetCandidateId),
      higher_delta_candidate_available: Boolean(higherDeltaCandidate),
      higher_delta_candidate_id: higherDeltaCandidate && higherDeltaCandidate.candidate_id || null,
      higher_delta_display_candidate_id: higherDeltaCandidate && higherDeltaCandidate.display_candidate_id || null,
      higher_delta_candidate_objective_delta: higherDeltaCandidate ? higherDeltaCandidate.delta : null,
      higher_delta_candidate_ready_for_auto_apply: higherDeltaCandidate ? higherDeltaCandidate.ready_for_auto_apply : null,
      higher_delta_candidate_hold_reason: higherDeltaHoldReason,
      retrospective_monthly_failed_checks: Array.isArray(monthlyObjective.failed_checks) ? monthlyObjective.failed_checks : [],
      retrospective_monthly_top_drop_reason: monthlyTopDrop && (monthlyTopDrop.display_reason || monthlyTopDrop.key || monthlyTopDrop.reason) || null,
      next_actions: buildNextActions({
        trackingStatus,
        targetDisplayId,
        targetDelta: targetReplayDelta,
        projectedScore: targetProjectedScore,
        higherDeltaCandidate: higherDeltaCandidate ? {
          candidate_id: higherDeltaCandidate.candidate_id,
          display_candidate_id: higherDeltaCandidate.display_candidate_id,
          hold_reason: higherDeltaHoldReason,
        } : null,
        monthlyFailedChecks: Array.isArray(monthlyObjective.failed_checks) ? monthlyObjective.failed_checks : [],
        monthlyTopDropReason: monthlyTopDrop && (monthlyTopDrop.display_reason || monthlyTopDrop.key || monthlyTopDrop.reason) || null,
      }),
    },
  };
}

module.exports = {
  deriveObjectiveRecoveryEffect,
};
