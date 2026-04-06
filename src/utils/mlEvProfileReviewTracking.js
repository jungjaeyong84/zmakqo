"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function buildTarget(role, profile, driver, contribution = {}, diagnostics = {}) {
  if (!profile) return null;
  return {
    role,
    profile: norm(profile),
    driver: norm(driver),
    rows_delta: toNum(contribution.rows_delta),
    avg_ret_net_delta: toNum(contribution.avg_ret_net_delta),
    avg_ev_lb: toNum(diagnostics.avg_ev_lb),
    avg_delay_cost: toNum(diagnostics.avg_delay_cost),
    avg_late_risk: toNum(diagnostics.avg_late_risk),
    avg_failure_risk: toNum(diagnostics.avg_failure_risk),
  };
}

function buildMlEvProfileReviewTracking({
  policyParameterPlan = null,
  mlReplayEvidence = null,
  mlEvReplayProfileContribution = null,
  mlEvReplayStalePosDiagnostics = null,
} = {}) {
  const policy = readSummary(policyParameterPlan);
  const replay = readSummary(mlReplayEvidence);
  const contribution = readSummary(mlEvReplayProfileContribution);
  const stale = readSummary(mlEvReplayStalePosDiagnostics);

  const reviewMode = norm(replay.best_candidate_review_mode || policy.ev_policy_review_mode) || "GLOBAL_REVIEW_ONLY";
  const returnDragProfile = norm(replay.best_candidate_top_return_drag_profile || policy.ev_policy_top_return_drag_profile);
  const returnDragDriver = norm(replay.best_candidate_top_return_drag_driver || policy.ev_policy_top_return_drag_driver);
  const mixedProfile = norm(replay.best_candidate_top_mixed_profile || policy.ev_policy_top_mixed_profile);
  const mixedDriver = norm(replay.best_candidate_top_mixed_driver || policy.ev_policy_top_mixed_driver);

  const targets = [
    buildTarget(
      "TOP_RETURN_DRAG",
      returnDragProfile,
      returnDragDriver,
      {
        rows_delta: contribution.top_return_drag_profile_rows_delta,
        avg_ret_net_delta: contribution.top_return_drag_profile_avg_ret_net_delta,
      },
      {
        avg_ev_lb: stale.top_return_drag_avg_ev_lb,
        avg_delay_cost: stale.top_return_drag_avg_delay_cost,
        avg_late_risk: stale.top_return_drag_avg_late_risk,
        avg_failure_risk: stale.top_return_drag_avg_failure_risk,
      }
    ),
    buildTarget(
      "TOP_MIXED",
      mixedProfile,
      mixedDriver,
      {
        rows_delta: contribution.top_mixed_profile_rows_delta,
        avg_ret_net_delta: contribution.top_mixed_profile_avg_ret_net_delta,
      },
      {
        avg_ev_lb: stale.top_mixed_avg_ev_lb,
        avg_delay_cost: stale.top_mixed_avg_delay_cost,
        avg_late_risk: stale.top_mixed_avg_late_risk,
        avg_failure_risk: stale.top_mixed_avg_failure_risk,
      }
    ),
  ].filter(Boolean);

  const splitReady = targets.length >= 2 && targets.every((row) => Math.abs(Number(row.rows_delta || 0)) >= 2);
  const splitBlocker = splitReady ? null : "PROFILE_REALIZED_DELTA_TOO_SMALL";

  return {
    status: "ML_EV_PROFILE_REVIEW_TRACKING_READY",
    evidence_status: "PROFILE_REVIEW_TRACKING_READY",
    review_mode: reviewMode,
    target_n: targets.length,
    split_ready: splitReady,
    split_blocker: splitBlocker,
    top_return_drag_profile: returnDragProfile,
    top_return_drag_driver: returnDragDriver,
    top_mixed_profile: mixedProfile,
    top_mixed_driver: mixedDriver,
    targets,
  };
}

module.exports = {
  buildMlEvProfileReviewTracking,
};
