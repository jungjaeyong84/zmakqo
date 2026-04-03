"use strict";

function toNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value.slice();
  }
  return [];
}

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const key = String(value || "").trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function deriveStatus({
  entryN,
  blockerN,
  finalDownstreamMismatchN,
  qualityStatus,
} = {}) {
  if ((toNum(blockerN) || 0) > 0) return "CUTOVER_BLOCKED";
  if ((toNum(finalDownstreamMismatchN) || 0) > 0) return "DRIFT_MONITORING";
  if (String(qualityStatus || "").trim().toUpperCase() === "OK") return "HEALTHY";
  if ((toNum(entryN) || 0) <= 0) return "NO_SERVER_SIGNAL_24H";
  return "OBSERVE";
}

function deriveServerSignalObservation24h({
  runtime = null,
  quality = null,
  cutover = null,
  policyPlan = null,
  remediationApply = null,
} = {}) {
  const runtimeSummary = firstObject(runtime && runtime.summary);
  const qualitySummary = firstObject(quality && quality.summary);
  const cutoverSummary = firstObject(cutover && cutover.summary);
  const planSummary = firstObject(policyPlan && policyPlan.summary);
  const remediationEffective = firstObject(remediationApply && remediationApply.effective);
  const remediationInputs = firstObject(remediationApply && remediationApply.inputs);
  const qualityRows = firstObject(quality && quality.rows);
  const learningEpochExceptionRelease = remediationInputs.learning_epoch_exception_release === true;
  const evPolicyPatchRequestedN = toNum(remediationApply && remediationApply.ev_policy_patch_requested_n) || 0;
  const evPolicyPatchApplied = remediationApply && remediationApply.ev_policy_patch_applied === true;
  const evPolicyPatchReportOnlyApplied = remediationApply && remediationApply.ev_policy_patch_report_only_applied === true;

  const watchOnlyMarkets = learningEpochExceptionRelease
    ? dedupeStrings([
      ...firstArray(remediationEffective.other_server_policy_watch_only_markets),
    ])
    : dedupeStrings([
      ...firstArray(remediationEffective.other_server_policy_watch_only_markets),
      ...firstArray(planSummary.top_other_server_policy_watch_only_markets),
    ]);
  const familyActions = firstArray(qualityRows.final_downstream_family_actions);
  const otherServerPolicyReasonActions = firstArray(qualityRows.other_server_policy_reason_actions);
  const topFamilyAction = familyActions.length > 0 ? familyActions[0] : null;
  const topOtherServerPolicyReasonAction = firstObject(
    qualitySummary.top_other_server_policy_reason_action,
    otherServerPolicyReasonActions[0]
  );

  const summary = {
    status: deriveStatus({
      entryN: qualitySummary.authoritative_entry_signal_24h_n,
      blockerN: cutoverSummary.blocker_n,
      finalDownstreamMismatchN: qualitySummary.final_downstream_mismatch_n,
      qualityStatus: qualitySummary.quality_status,
    }),
    readiness_status: cutoverSummary.readiness_status || null,
    runtime_status: runtimeSummary.runtime_status || null,
    quality_status: qualitySummary.quality_status || null,
    watchdog_verdict: runtimeSummary.watchdog_verdict || null,
    live_execution_policy_mode: runtimeSummary.live_execution_policy_mode || null,
    authoritative_entry_signal_24h_n: toNum(qualitySummary.authoritative_entry_signal_24h_n) || 0,
    order_intent_24h_n: toNum(qualitySummary.order_intent_24h_n) || 0,
    fill_24h_n: toNum(qualitySummary.fill_24h_n) || 0,
    trade_24h_n: toNum(qualitySummary.trade_24h_n) || 0,
    parity_mismatch_n: toNum(qualitySummary.parity_mismatch_n) || 0,
    final_downstream_mismatch_n: toNum(qualitySummary.final_downstream_mismatch_n) || 0,
    cutover_blocker_n: toNum(cutoverSummary.blocker_n) || 0,
    drift_remediation_applied: remediationApply && remediationApply.applied === true,
    drift_remediation_last_applied_at_kst: remediationApply && remediationApply.last_applied_at_kst || null,
    learning_epoch_exception_release: learningEpochExceptionRelease,
    ev_policy_patch_requested_n: evPolicyPatchRequestedN,
    ev_policy_patch_applied: evPolicyPatchApplied,
    ev_policy_patch_report_only_applied: evPolicyPatchReportOnlyApplied,
    execution_quality_status: planSummary.execution_quality_status || null,
    policy_plan_status: planSummary.status || null,
    policy_plan_mode: planSummary.mode || null,
    other_server_policy_watch_only_market_n: watchOnlyMarkets.length,
    top_other_server_policy_watch_only_markets: watchOnlyMarkets.slice(0, 8),
    top_final_downstream_family_action: topFamilyAction
      ? {
        family: topFamilyAction.family || null,
        mismatch_n: toNum(topFamilyAction.mismatch_n) || 0,
        recommended_action: topFamilyAction.recommended_action || null,
      }
      : null,
    top_other_server_policy_reason_action: topOtherServerPolicyReasonAction && Object.keys(topOtherServerPolicyReasonAction).length > 0
      ? {
        reason: topOtherServerPolicyReasonAction.reason || null,
        mismatch_n: toNum(topOtherServerPolicyReasonAction.mismatch_n) || 0,
        recommended_action: topOtherServerPolicyReasonAction.recommended_action || null,
      }
      : null,
  };

  const nextActions = [];
  if (summary.cutover_blocker_n > 0) {
    nextActions.push("Resolve cutover blockers before changing live execution policy.");
  }
  if (summary.final_downstream_mismatch_n > 0 && summary.top_final_downstream_family_action) {
    nextActions.push(
      `Review ${summary.top_final_downstream_family_action.family} mismatch family first (${summary.top_final_downstream_family_action.recommended_action}).`
    );
  }
  if (summary.learning_epoch_exception_release) {
    nextActions.push("Historical market exceptions are released during the current learning epoch; collect fresh server-native data before reapplying market-level blocks.");
    if (summary.ev_policy_patch_report_only_applied) {
      nextActions.push("EV market rescue is active in REPORT_ONLY mode during the learning epoch; judge parity delta against fresh market-scoped samples.");
    }
  } else if (summary.other_server_policy_watch_only_market_n > 0) {
    nextActions.push(`Keep WATCH_ONLY review on ${watchOnlyMarkets.join("|")} until mismatch family clears.`);
  }
  if (summary.top_other_server_policy_reason_action && summary.top_other_server_policy_reason_action.recommended_action) {
    nextActions.push(
      `Review OTHER_SERVER_POLICY sub-reason ${summary.top_other_server_policy_reason_action.reason} (${summary.top_other_server_policy_reason_action.recommended_action}).`
    );
  }
  if (summary.authoritative_entry_signal_24h_n <= 0) {
    nextActions.push("No server entry signal in 24h. Recheck signal generation and bar-close cadence.");
  }

  return {
    ok: true,
    summary,
    rows: {
      final_downstream_family_actions: familyActions,
      other_server_policy_reason_actions: otherServerPolicyReasonActions,
      watch_only_review_markets: watchOnlyMarkets.map((market) => ({
        market,
        source: remediationEffective.other_server_policy_watch_only_markets && remediationEffective.other_server_policy_watch_only_markets.includes(market)
          ? "DRIFT_REMEDIATION_EFFECTIVE"
          : "POLICY_PLAN",
      })),
      blocker_actions: firstArray(cutoverSummary.blocker_actions),
      next_actions: nextActions,
    },
  };
}

module.exports = {
  deriveServerSignalObservation24h,
};
