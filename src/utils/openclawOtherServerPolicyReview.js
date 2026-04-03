"use strict";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value.slice();
  }
  return [];
}

function mergeObjects(...values) {
  return values.reduce((acc, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(acc, value);
    }
    return acc;
  }, {});
}

function deriveStatus({ mismatchN, topReasonAction, dominantFamily } = {}) {
  if ((toNum(mismatchN) || 0) <= 0) return "NO_OTHER_SERVER_POLICY_DRIFT";
  if (String(dominantFamily || "").trim().toUpperCase() === "OTHER_SERVER_POLICY") return "PRIORITY_REVIEW";
  if (topReasonAction) return "MONITOR_WITH_TARGETED_REVIEW";
  return "MONITOR_ONLY";
}

function buildOtherServerPolicyReview({
  quality = null,
  observation = null,
  cutover = null,
} = {}) {
  const qualitySummary = firstObject(quality && quality.summary);
  const qualityRows = firstObject(quality && quality.rows);
  const observationSummary = firstObject(observation && observation.summary);
  const cutoverSummary = firstObject(cutover && cutover.summary);

  const mismatchN = toNum(qualitySummary.other_server_policy_mismatch_n) || 0;
  const dominantFamily = String(cutoverSummary.dominant_mismatch_family || "").trim().toUpperCase() || null;
  const topReasonAction = mergeObjects(
    observationSummary.top_other_server_policy_reason_action,
    qualitySummary.top_other_server_policy_reason_action,
    firstArray(qualityRows.other_server_policy_reason_actions)[0]
  );
  const status = deriveStatus({ mismatchN, topReasonAction, dominantFamily });
  const topMarkets = firstArray(topReasonAction.top_markets).map((row) => ({
    market: row.market || null,
    mismatch_n: toNum(row.mismatch_n) || 0,
  }));

  const verificationTarget = topReasonAction && topReasonAction.reason
    ? {
      metric: "other_server_policy_mismatch_n",
      expected: "< baseline",
      baseline_value: mismatchN,
      reason: topReasonAction.reason || null,
    }
    : null;

  return {
    ok: true,
    summary: {
      status,
      other_server_policy_mismatch_n: mismatchN,
      dominant_mismatch_family: dominantFamily,
      top_reason: topReasonAction.reason || null,
      top_reason_mismatch_n: toNum(topReasonAction.mismatch_n) || 0,
      top_reason_recommended_action: topReasonAction.recommended_action || null,
      verification_target: verificationTarget,
    },
    rows: {
      reason_actions: firstArray(qualityRows.other_server_policy_reason_actions),
      top_markets: topMarkets,
      next_actions: [
        mismatchN > 0
          ? `Track OTHER_SERVER_POLICY mismatch against baseline ${mismatchN}.`
          : "No OTHER_SERVER_POLICY mismatch now.",
        topReasonAction.reason
          ? `Prioritize sub-reason ${topReasonAction.reason} with action ${topReasonAction.recommended_action || "MONITOR_ONLY"}.`
          : "No dominant OTHER_SERVER_POLICY sub-reason now.",
      ],
    },
  };
}

module.exports = {
  buildOtherServerPolicyReview,
};
