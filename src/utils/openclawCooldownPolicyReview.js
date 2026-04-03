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

function buildCooldownPolicyReview({
  quality = null,
  cutover = null,
  driftRemediationPlan = null,
} = {}) {
  const qualitySummary = firstObject(quality && quality.summary);
  const qualityRows = firstObject(quality && quality.rows);
  const cutoverSummary = firstObject(cutover && cutover.summary);
  const planSummary = firstObject(driftRemediationPlan && driftRemediationPlan.summary);
  const planRows = firstObject(driftRemediationPlan && driftRemediationPlan.rows);

  const familyRows = firstArray(qualityRows.final_downstream_family_actions);
  const cooldownFamily = familyRows.find((row) => String(row && row.family || "").trim().toUpperCase() === "COOLDOWN_POLICY") || null;
  const mismatchN = cooldownFamily ? toNum(cooldownFamily.mismatch_n) || 0 : 0;
  const dominantFamily = String(cutoverSummary.dominant_mismatch_family || "").trim().toUpperCase() || null;
  const cooldownMarkets = firstArray(planRows.cooldown_policy_by_market);
  const topMarket = cooldownMarkets[0] || null;

  const status = mismatchN <= 0
    ? "NO_COOLDOWN_DRIFT"
    : dominantFamily === "COOLDOWN_POLICY"
      ? "PRIORITY_REVIEW"
      : "MONITOR_WITH_TARGETED_REVIEW";

  return {
    ok: true,
    summary: {
      status,
      cooldown_policy_mismatch_n: mismatchN,
      dominant_mismatch_family: dominantFamily,
      recommended_action: cooldownFamily && cooldownFamily.recommended_action || "RELAX_OPPOSITE_COOLDOWN_REVIEW",
      cooldown_policy_market_patch_n: toNum(planSummary.cooldown_policy_market_patch_n) || 0,
      top_market: topMarket && topMarket.market || null,
      top_market_mismatch_n: topMarket && (toNum(topMarket.mismatch_n) || toNum(topMarket.n) || 0) || 0,
      verification_target: mismatchN > 0
        ? {
          metric: "final_downstream_mismatch_n",
          expected: "< baseline",
          baseline_value: toNum(qualitySummary.final_downstream_mismatch_n),
          family: "COOLDOWN_POLICY",
        }
        : null,
    },
    rows: {
      cooldown_policy_by_market: cooldownMarkets,
      next_actions: [
        mismatchN > 0
          ? `Track COOLDOWN_POLICY mismatch against final_downstream_mismatch_n baseline ${toNum(qualitySummary.final_downstream_mismatch_n) || 0}.`
          : "No COOLDOWN_POLICY mismatch now.",
        topMarket && topMarket.market
          ? `Review cooldown relaxation impact on ${topMarket.market}.`
          : "No cooldown mismatch market now.",
      ],
    },
  };
}

module.exports = {
  buildCooldownPolicyReview,
};
