"use strict";

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

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toComparableString(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function resolveEvVerificationMinSamples(cutoverSummary = {}) {
  const configured = toNum(cutoverSummary.ev_policy_remediation_min_post_samples);
  const floor = Math.max(3, Number(process.env.OPENCLAW_EV_POLICY_VERIFICATION_MIN_SAMPLES || 5));
  return Math.max(configured || 3, floor);
}

function deriveDominantIssue({ objectiveSupervisor = null, autonomyContract = null, quality = null, cutover = null } = {}) {
  const objective = unwrapRawReport(objectiveSupervisor) || {};
  const autonomy = readSummary(autonomyContract);
  const runtimeAuthorityState = toUpper(autonomy.runtime_authority_state || autonomy.authority_state);
  const qualitySummary = readSummary(quality);
  const cutoverSummary = readSummary(cutover);

  const rootCause = toUpper(objective.root_cause);
  const dominantMismatchFamily = toUpper(
    cutoverSummary.dominant_mismatch_family
    || (qualitySummary.top_final_downstream_drop_reason_family && qualitySummary.top_final_downstream_drop_reason_family.key)
    || (qualitySummary.top_drop_reason_family && qualitySummary.top_drop_reason_family.key)
  );

  if (rootCause) {
    return {
      dominant_issue: rootCause,
      dominant_issue_source: "OBJECTIVE_SUPERVISOR",
      secondary_issue: dominantMismatchFamily,
    };
  }
  if (dominantMismatchFamily) {
    return {
      dominant_issue: dominantMismatchFamily,
      dominant_issue_source: "SERVER_SIGNAL",
      secondary_issue: runtimeAuthorityState,
    };
  }
  if (runtimeAuthorityState) {
    return {
      dominant_issue: `AUTHORITY_${runtimeAuthorityState}`,
      dominant_issue_source: "AUTONOMY_CONTRACT",
      secondary_issue: null,
    };
  }
  return {
    dominant_issue: "UNKNOWN",
    dominant_issue_source: "UNKNOWN",
    secondary_issue: null,
  };
}

function readDisplay(value) {
  return value && value.display && typeof value.display === "object" ? value.display : {};
}

function readRetrospectiveMicrostructure(value) {
  const display = readDisplay(value);
  if (display.execution_microstructure && typeof display.execution_microstructure === "object") {
    return display.execution_microstructure;
  }
  const daily = display.periods && display.periods.DAILY && typeof display.periods.DAILY === "object"
    ? display.periods.DAILY
    : null;
  if (daily && daily.execution_microstructure && typeof daily.execution_microstructure === "object") {
    return daily.execution_microstructure;
  }
  return {};
}

function deriveRecommendedAction({ quality = null, cutover = null, policyPlan = null } = {}) {
  const qualitySummary = readSummary(quality);
  const cutoverSummary = readSummary(cutover);
  const policySummary = readSummary(policyPlan);
  return (
    String(cutoverSummary.recommended_action || "").trim()
    || String(
      qualitySummary.top_other_server_policy_reason_action
      && qualitySummary.top_other_server_policy_reason_action.recommended_action
      || ""
    ).trim()
    || String(policySummary.ev_policy_action || "").trim()
    || (String(policySummary.status || "").trim() ? `PLAN_${String(policySummary.status).trim().toUpperCase()}` : "")
    || "MONITOR_ONLY"
  );
}

function derivePendingVerification({ cutover = null, quality = null, autonomyContract = null } = {}) {
  const cutoverSummary = readSummary(cutover);
  const qualitySummary = readSummary(quality);
  const autonomySummary = readSummary(autonomyContract);
  const dominantFamily = toUpper(cutoverSummary.dominant_mismatch_family);
  const changeAuthorityState = toUpper(autonomySummary.change_authority_state || autonomySummary.authority_state);
  const evPolicyPatchApplied = cutoverSummary.ev_policy_effective_patch_applied === true
    || cutoverSummary.ev_policy_patch_applied === true
    || cutoverSummary.ev_policy_patch_report_only_applied === true;
  const finalMismatchN = toNum(
    qualitySummary.final_downstream_mismatch_n != null
      ? qualitySummary.final_downstream_mismatch_n
      : cutoverSummary.final_downstream_mismatch_n
  );

  if (dominantFamily === "EV_POLICY") {
    if (evPolicyPatchApplied !== true) {
      return {
        metric: "ev_policy_effective_patch_applied",
        expected: "= TRUE",
        deadline_hint: "NEXT_CYCLE",
        baseline_value: evPolicyPatchApplied ? "TRUE" : "FALSE",
        qualitative_goal: "materialize EV remediation patch before post-apply verification",
      };
    }
    return {
      metric: "ev_policy_post_apply_comparable_n",
      expected: `>= ${resolveEvVerificationMinSamples(cutoverSummary)}`,
      deadline_hint: "NEXT_24H",
      baseline_value: toNum(cutoverSummary.ev_policy_post_apply_comparable_n),
      fast_track: {
        metric: "ev_policy_post_apply_mismatch_rate",
        expected: `<= ${Number(process.env.OPENCLAW_EV_POLICY_POST_APPLY_MISMATCH_RATE_MAX || 0.6)}`,
        baseline_value: toNum(cutoverSummary.ev_policy_post_apply_mismatch_rate),
      },
    };
  }
  if (dominantFamily === "OTHER_SERVER_POLICY") {
    return {
      metric: "other_server_policy_mismatch_n",
      expected: "< baseline",
      deadline_hint: "NEXT_24H",
      baseline_value: toNum(qualitySummary.other_server_policy_mismatch_n),
    };
  }
  if (changeAuthorityState === "PENDING") {
    return {
      metric: "final_downstream_mismatch_n",
      expected: "< baseline",
      deadline_hint: "NEXT_24H_TO_48H",
      qualitative_goal: "toward READY with parity evidence",
      baseline_value: finalMismatchN,
    };
  }
  return {
    metric: "final_downstream_mismatch_n",
    expected: "< baseline",
    deadline_hint: "NEXT_24H",
    baseline_value: toNum(qualitySummary.final_downstream_mismatch_n),
  };
}

function deriveHypothesis({ dominantIssue = null, dominantIssueSource = null, recommendedAction = null, autonomyContract = null } = {}) {
  const autonomySummary = readSummary(autonomyContract);
  const runtimeAuthorityState = toUpper(autonomySummary.runtime_authority_state || autonomySummary.authority_state);
  const changeAuthorityState = toUpper(autonomySummary.change_authority_state || autonomySummary.authority_state);
  if (dominantIssue === "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK") {
    return "Ops substrate is healthy, but autonomous recovery remains blocked by external authority hold.";
  }
  if (dominantIssue === "EV_POLICY") {
    return "EV policy remains the dominant downstream mismatch family; keep remediation under observation until comparable post-apply samples accumulate.";
  }
  if (dominantIssue === "OTHER_SERVER_POLICY") {
    return "Other server policy mismatches remain localized and should be judged on fresh evidence before reapplying market-specific blocks.";
  }
  if (changeAuthorityState === "PENDING") {
    return `Runtime authority is ${runtimeAuthorityState || "N/A"} while strategic change approval remains ${changeAuthorityState}; recommendation ${recommendedAction || "MONITOR_ONLY"} must accumulate evidence before READY.`;
  }
  return `Current dominant issue is ${dominantIssueSource || "UNKNOWN"}:${dominantIssue || "UNKNOWN"}; continue ${recommendedAction || "MONITOR_ONLY"} while gathering fresh evidence.`;
}

function describeVerificationTarget(pendingVerification = null) {
  if (!pendingVerification || !pendingVerification.metric) return "No verification target.";
  const expected = pendingVerification.expected || "N/A";
  const baseline = pendingVerification.baseline_value != null ? ` (baseline=${pendingVerification.baseline_value})` : "";
  const fastTrack = pendingVerification.fast_track && pendingVerification.fast_track.metric
    ? ` | fast=${pendingVerification.fast_track.metric} ${pendingVerification.fast_track.expected || "N/A"}${pendingVerification.fast_track.baseline_value != null ? ` (baseline=${pendingVerification.fast_track.baseline_value})` : ""}`
    : "";
  return `${pendingVerification.metric} ${expected}${baseline}${fastTrack}`;
}

function deriveVerificationFriendlyHypothesis({
  dominantIssue = null,
  dominantIssueSource = null,
  recommendedAction = null,
  pendingVerification = null,
  autonomyContract = null,
} = {}) {
  const base = deriveHypothesis({ dominantIssue, dominantIssueSource, recommendedAction, autonomyContract });
  const target = describeVerificationTarget(pendingVerification);
  return {
    text: `${base} Verification target: ${target}.`,
    verification_focus: target,
    hypothesis_class: pendingVerification && pendingVerification.metric ? "MEASURABLE" : "NARRATIVE",
  };
}

function countContradictions(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  let contradictions = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1] || {};
    const cur = rows[i] || {};
    if (
      prev.dominant_issue
      && prev.dominant_issue === cur.dominant_issue
      && prev.recommended_action
      && cur.recommended_action
      && prev.recommended_action !== cur.recommended_action
    ) {
      contradictions += 1;
    }
  }
  return contradictions;
}

function buildCompactedContext(entries = []) {
  const rows = (Array.isArray(entries) ? entries : []).slice(0, 3);
  if (!rows.length) return "No prior reasoning entries.";
  return rows.map((row, idx) => {
    const pending = row.pending_verification && row.pending_verification.metric
      ? `${row.pending_verification.metric}:${row.pending_verification.expected || "N/A"}`
      : "none";
    const verification = row.verification_outcome && row.verification_outcome.status
      ? row.verification_outcome.status
      : "UNRESOLVED";
    return `${idx + 1}) ${row.cycle_id || "N/A"} issue=${row.dominant_issue || "UNKNOWN"} action=${row.recommended_action || "MONITOR_ONLY"} pending=${pending} verification=${verification}`;
  }).join(" | ");
}

function collectCurrentVerificationState({ quality = null, cutover = null, autonomyContract = null } = {}) {
  const qualitySummary = readSummary(quality);
  const cutoverSummary = readSummary(cutover);
  const autonomySummary = readSummary(autonomyContract);
  return {
    ev_policy_post_apply_comparable_n: toNum(cutoverSummary.ev_policy_post_apply_comparable_n),
    ev_policy_effective_patch_applied: (cutoverSummary.ev_policy_effective_patch_applied === true
      || cutoverSummary.ev_policy_patch_applied === true
      || cutoverSummary.ev_policy_patch_report_only_applied === true)
      ? "TRUE"
      : "FALSE",
    learning_epoch_exception_release_applied: cutoverSummary.learning_epoch_exception_release_applied === true ? "TRUE" : "FALSE",
    ev_policy_patch_report_only_applied: cutoverSummary.ev_policy_patch_report_only_applied === true ? "TRUE" : "FALSE",
    ev_policy_remediation_min_post_samples: resolveEvVerificationMinSamples(cutoverSummary),
    ev_policy_post_apply_mismatch_n: toNum(cutoverSummary.ev_policy_post_apply_mismatch_n),
    ev_policy_post_apply_mismatch_rate: (() => {
      const comparableN = toNum(cutoverSummary.ev_policy_post_apply_comparable_n);
      const mismatchN = toNum(cutoverSummary.ev_policy_post_apply_mismatch_n);
      if (comparableN == null || mismatchN == null || comparableN <= 0) return null;
      return Number((mismatchN / comparableN).toFixed(4));
    })(),
    other_server_policy_mismatch_n: toNum(
      qualitySummary.other_server_policy_mismatch_n != null
        ? qualitySummary.other_server_policy_mismatch_n
        : cutoverSummary.other_server_policy_mismatch_n
    ),
    final_downstream_mismatch_n: toNum(
      qualitySummary.final_downstream_mismatch_n != null
        ? qualitySummary.final_downstream_mismatch_n
        : cutoverSummary.final_downstream_mismatch_n
    ),
    authority_state: toComparableString(autonomySummary.runtime_authority_state || autonomySummary.authority_state),
  };
}

function evaluateExpected(expected, actualValue, baselineValue = null) {
  const raw = String(expected || "").trim();
  if (!raw) return { status: "UNKNOWN", reason: "expected missing" };

  const numericActual = toNum(actualValue);
  const normalizedActual = toComparableString(actualValue);

  const gte = raw.match(/^>=\s*(-?\d+(?:\.\d+)?)$/);
  if (gte) {
    if (numericActual == null) return { status: "UNKNOWN", reason: "actual not numeric" };
    return { status: numericActual >= Number(gte[1]) ? "VERIFIED" : "NOT_MET" };
  }

  const lte = raw.match(/^<=\s*(-?\d+(?:\.\d+)?)$/);
  if (lte) {
    if (numericActual == null) return { status: "UNKNOWN", reason: "actual not numeric" };
    return { status: numericActual <= Number(lte[1]) ? "VERIFIED" : "NOT_MET" };
  }

  const lt = raw.match(/^<\s*(-?\d+(?:\.\d+)?)$/);
  if (lt) {
    if (numericActual == null) return { status: "UNKNOWN", reason: "actual not numeric" };
    return { status: numericActual < Number(lt[1]) ? "VERIFIED" : "NOT_MET" };
  }

  const eq = raw.match(/^=\s*(.+)$/);
  if (eq) {
    if (!normalizedActual) return { status: "UNKNOWN", reason: "actual missing" };
    return { status: normalizedActual === toComparableString(eq[1]) ? "VERIFIED" : "NOT_MET" };
  }

  if (raw === "< baseline") {
    const numericBaseline = toNum(baselineValue);
    if (numericActual == null || numericBaseline == null) return { status: "UNKNOWN", reason: "baseline comparison unavailable" };
    return { status: numericActual < numericBaseline ? "VERIFIED" : "NOT_MET" };
  }

  if (raw === "> baseline") {
    const numericBaseline = toNum(baselineValue);
    if (numericActual == null || numericBaseline == null) return { status: "UNKNOWN", reason: "baseline comparison unavailable" };
    return { status: numericActual > numericBaseline ? "VERIFIED" : "NOT_MET" };
  }

  return { status: "UNKNOWN", reason: "expected not machine-readable" };
}

function shouldDeferByPolicy(entry, currentState = {}) {
  const pv = entry && entry.pending_verification;
  if (!pv || !pv.metric) return false;
  const learningEpochRelease = currentState.learning_epoch_exception_release_applied === "TRUE";
  const evReportOnly = currentState.ev_policy_patch_report_only_applied === "TRUE";
  if (!learningEpochRelease || !evReportOnly) return false;
  if (pv.metric === "ev_policy_post_apply_comparable_n") return true;
  if (pv.metric === "final_downstream_mismatch_n") return true;
  if (pv.fast_track && pv.fast_track.metric === "final_downstream_mismatch_n") return true;
  return false;
}

function shouldDeferLowSample(entry, currentState = {}) {
  const pv = entry && entry.pending_verification;
  if (!pv || pv.metric !== "ev_policy_post_apply_comparable_n") return false;
  const actualComparable = toNum(currentState.ev_policy_post_apply_comparable_n);
  const requiredComparable = toNum(currentState.ev_policy_remediation_min_post_samples)
    || toNum(String(pv.expected || "").replace(/[^\d.-]/g, ""))
    || 5;
  if (actualComparable == null) return true;
  return actualComparable < requiredComparable;
}

function resolveVerificationOutcome(entry, currentState = {}) {
  const pv = entry && entry.pending_verification;
  if (!pv || !pv.metric) return null;
  if (shouldDeferByPolicy(entry, currentState)) {
    return {
      status: "DEFERRED_LEARNING_EPOCH",
      metric: pv.metric,
      expected: pv.expected || null,
      actual: currentState[pv.metric],
      baseline_value: pv.baseline_value != null ? pv.baseline_value : null,
      reason: "DEFERRED_BY_LEARNING_EPOCH",
      fast_track: pv.fast_track && pv.fast_track.metric
        ? {
          metric: pv.fast_track.metric,
          expected: pv.fast_track.expected || null,
          actual: currentState[pv.fast_track.metric],
          baseline_value: pv.fast_track.baseline_value != null ? pv.fast_track.baseline_value : null,
          status: "DEFERRED_LEARNING_EPOCH",
          reason: "DEFERRED_BY_LEARNING_EPOCH",
        }
        : null,
      cycle_id: entry && entry.cycle_id || null,
    };
  }
  if (shouldDeferLowSample(entry, currentState)) {
    return {
      status: "DEFERRED_LOW_SAMPLE",
      metric: pv.metric,
      expected: pv.expected || null,
      actual: currentState[pv.metric],
      baseline_value: pv.baseline_value != null ? pv.baseline_value : null,
      reason: "DEFERRED_BY_LOW_SAMPLE",
      fast_track: pv.fast_track && pv.fast_track.metric
        ? {
          metric: pv.fast_track.metric,
          expected: pv.fast_track.expected || null,
          actual: currentState[pv.fast_track.metric],
          baseline_value: pv.fast_track.baseline_value != null ? pv.fast_track.baseline_value : null,
          status: "DEFERRED_LOW_SAMPLE",
          reason: "DEFERRED_BY_LOW_SAMPLE",
        }
        : null,
      cycle_id: entry && entry.cycle_id || null,
    };
  }
  const currentValue = currentState[pv.metric];
  const evaluation = currentValue == null
    ? { status: "UNKNOWN", reason: "metric not available" }
    : evaluateExpected(pv.expected, currentValue, pv.baseline_value);
  const fastTrackDef = pv.fast_track && pv.fast_track.metric ? pv.fast_track : null;
  const fastTrackValue = fastTrackDef ? currentState[fastTrackDef.metric] : null;
  const fastTrackEvaluation = fastTrackDef
    ? (fastTrackValue == null
      ? { status: "UNKNOWN", reason: "metric not available" }
      : evaluateExpected(fastTrackDef.expected, fastTrackValue, fastTrackDef.baseline_value))
    : null;
  let status = evaluation.status;
  let reason = evaluation.reason || null;
  if (evaluation.status === "VERIFIED" && fastTrackDef && fastTrackEvaluation && fastTrackEvaluation.status !== "VERIFIED") {
    status = "VERIFIED_SAMPLE_FORMATION";
    reason = "sample_formation_verified";
  } else if (fastTrackEvaluation && fastTrackEvaluation.status === "VERIFIED" && evaluation.status !== "VERIFIED") {
    status = "VERIFIED_FAST_TRACK";
    reason = "fast_track_verified";
  } else if (evaluation.status === "UNKNOWN" && fastTrackEvaluation && fastTrackEvaluation.status === "NOT_MET") {
    status = "NOT_MET";
    reason = fastTrackEvaluation.reason || "fast_track_not_met";
  } else if (evaluation.status === "NOT_MET" && fastTrackEvaluation && fastTrackEvaluation.status === "UNKNOWN") {
    status = "UNKNOWN";
    reason = fastTrackEvaluation.reason || evaluation.reason || "mixed_unknown";
  }
  return {
    status,
    metric: pv.metric,
    expected: pv.expected || null,
    actual: currentValue,
    baseline_value: pv.baseline_value != null ? pv.baseline_value : null,
    reason,
    fast_track: fastTrackDef
      ? {
        metric: fastTrackDef.metric,
        expected: fastTrackDef.expected || null,
        actual: fastTrackValue,
        baseline_value: fastTrackDef.baseline_value != null ? fastTrackDef.baseline_value : null,
        status: fastTrackEvaluation && fastTrackEvaluation.status || "UNKNOWN",
        reason: fastTrackEvaluation && fastTrackEvaluation.reason || null,
      }
      : null,
    cycle_id: entry && entry.cycle_id || null,
  };
}

function resolvePreviousEntries(entries = [], currentState = {}) {
  return (Array.isArray(entries) ? entries : []).map((row) => {
    if (!row || typeof row !== "object") return row;
    if (row.verification_outcome && row.verification_outcome.status) return row;
    if (!row.pending_verification || !row.pending_verification.metric) return row;
    return {
      ...row,
      verification_outcome: resolveVerificationOutcome(row, currentState),
    };
  });
}

function buildVerificationStats(entries = []) {
  const resolved = (Array.isArray(entries) ? entries : [])
    .map((row) => row && row.verification_outcome && row.verification_outcome.status)
    .filter(Boolean);
  const verified_n = resolved.filter((status) => status === "VERIFIED" || status === "VERIFIED_SAMPLE_FORMATION" || status === "VERIFIED_FAST_TRACK").length;
  const sample_formation_verified_n = resolved.filter((status) => status === "VERIFIED_SAMPLE_FORMATION").length;
  const fast_track_verified_n = resolved.filter((status) => status === "VERIFIED_FAST_TRACK").length;
  const not_met_n = resolved.filter((status) => status === "NOT_MET").length;
  const unknown_n = resolved.filter((status) => status === "UNKNOWN").length;
  const deferred_n = resolved.filter((status) => status === "DEFERRED_LEARNING_EPOCH" || status === "DEFERRED_LOW_SAMPLE").length;
  const denominator = verified_n + not_met_n;
  return {
    verified_n,
    sample_formation_verified_n,
    fast_track_verified_n,
    not_met_n,
    unknown_n,
    deferred_n,
    verification_rate: denominator > 0 ? Number((verified_n / denominator).toFixed(4)) : null,
  };
}

function buildReasoningJournal({
  cycleId = null,
  nowKst = null,
  objectiveSupervisor = null,
  autonomyContract = null,
  quality = null,
  cutover = null,
  policyPlan = null,
  objectiveRetrospective = null,
  overallAccountReport = null,
  signalLineageHealth = null,
  executionQuality = null,
  previousJournal = null,
} = {}) {
  const objective = unwrapRawReport(objectiveSupervisor) || {};
  const autonomySummary = readSummary(autonomyContract);
  const qualitySummary = readSummary(quality);
  const cutoverSummary = readSummary(cutover);
  const policySummary = readSummary(policyPlan);
  const retrospectiveMicro = readRetrospectiveMicrostructure(objectiveRetrospective);
  const overallAccount = overallAccountReport && typeof overallAccountReport === "object" ? overallAccountReport : {};
  const overallIntegrity = overallAccount.integrity && typeof overallAccount.integrity === "object" ? overallAccount.integrity : {};
  const overallOperations = overallAccount.operations && typeof overallAccount.operations === "object" ? overallAccount.operations : {};
  const lineageSummary = readSummary(signalLineageHealth);
  const executionQualitySummary = readSummary(executionQuality);
  const issue = deriveDominantIssue({ objectiveSupervisor, autonomyContract, quality, cutover });
  const recommendedAction = deriveRecommendedAction({ quality, cutover, policyPlan });
  const pendingVerification = derivePendingVerification({ cutover, quality, autonomyContract });
  const hypothesisInfo = deriveVerificationFriendlyHypothesis({
    dominantIssue: issue.dominant_issue,
    dominantIssueSource: issue.dominant_issue_source,
    recommendedAction,
    pendingVerification,
    autonomyContract,
  });

  const currentEntry = {
    cycle_id: cycleId || null,
    generated_at_kst: nowKst || null,
    objective_verdict: String(objective.verdict || "").trim() || null,
    objective_root_cause: String(objective.root_cause || "").trim() || null,
    authority_state: toUpper(autonomySummary.runtime_authority_state || autonomySummary.authority_state),
    change_authority_state: toUpper(autonomySummary.change_authority_state || autonomySummary.authority_state),
    dominant_issue: issue.dominant_issue,
    dominant_issue_source: issue.dominant_issue_source,
    secondary_issue: issue.secondary_issue,
    recommended_action: recommendedAction,
    hypothesis: hypothesisInfo.text,
    verification_focus: hypothesisInfo.verification_focus,
    hypothesis_class: hypothesisInfo.hypothesis_class,
    pending_verification: pendingVerification,
    current_snapshot: {
      quality_status: String(qualitySummary.quality_status || "").trim() || null,
      final_downstream_mismatch_n: toNum(qualitySummary.final_downstream_mismatch_n),
      parity_mismatch_n: toNum(qualitySummary.parity_mismatch_n),
      cutover_status: String(cutoverSummary.readiness_status || "").trim() || null,
      cutover_blocker_n: toNum(cutoverSummary.blocker_n),
      policy_plan_status: String(policySummary.status || "").trim() || null,
      execution_quality_status: String(executionQualitySummary.status || "").trim() || null,
      execution_quality_latency_p95_ms: toNum(executionQualitySummary.created_to_fill_p95_ms),
      execution_quality_slippage_p95_bps: toNum(executionQualitySummary.adverse_slippage_p95_bps),
      execution_quality_partial_fill_rate_pct: toNum(executionQualitySummary.partial_fill_rate_pct),
      execution_quality_top_operational_webhook_delay_cause: String(executionQualitySummary.top_operational_webhook_delay_cause || "").trim() || null,
      execution_quality_top_operational_immediate_intent_delay_group: String(executionQualitySummary.top_operational_immediate_intent_delay_group || "").trim() || null,
      execution_quality_top_no_fill_reason: String(executionQualitySummary.top_no_fill_reason || "").trim() || null,
      execution_quality_top_no_fill_subtype: String(executionQualitySummary.top_no_fill_subtype || "").trim() || null,
      execution_scope_quality_gate_status: String(executionQualitySummary.execution_scope_quality_gate_status || "").trim() || null,
      execution_scope_quality_gate_ready: executionQualitySummary.execution_scope_quality_gate_ready === true,
      execution_scope_inference_mismatch_rate: toNum(executionQualitySummary.execution_scope_inference_mismatch_rate),
      execution_scope_top_false_positive_group: String(executionQualitySummary.execution_scope_top_false_positive_group || "").trim() || null,
      lineage_verdict: String(lineageSummary.verdict || "").trim() || null,
      lineage_fills_intent_null_rate: toNum(lineageSummary.fills_intent_id_null_rate),
      account_integrity_ok: overallIntegrity.ok === true,
      account_integrity_issue_n: toNum(overallIntegrity.issue_count),
      account_ops_status: String(overallOperations.status || "").trim() || null,
      account_ops_mode: String(overallOperations.mode || "").trim() || null,
      tp0_hit_rate: toNum(retrospectiveMicro.tp0_hit_rate),
      tp1_hit_rate: toNum(retrospectiveMicro.tp1_hit_rate),
      tp0_to_tp1_conversion_rate: toNum(retrospectiveMicro.tp0_to_tp1_conversion_rate),
      pre_tp1_time_stop_rate: toNum(retrospectiveMicro.pre_tp1_time_stop_rate),
      chase_reject_n: toNum(retrospectiveMicro.chase_reject_n),
      portfolio_cluster_reduce_n: toNum(retrospectiveMicro.portfolio_cluster_reduce_n),
      portfolio_cluster_block_n: toNum(retrospectiveMicro.portfolio_cluster_block_n),
    },
  };

  const previousEntries = Array.isArray(previousJournal && previousJournal.entries) ? previousJournal.entries : [];
  const currentVerificationState = collectCurrentVerificationState({ quality, cutover, autonomyContract });
  const resolvedPreviousEntries = resolvePreviousEntries(previousEntries, currentVerificationState);
  const deduped = [currentEntry, ...resolvedPreviousEntries.filter((row) => String(row && row.cycle_id || "") !== String(cycleId || ""))].slice(0, 12);
  const contradiction_n = countContradictions(deduped);
  const verificationStats = buildVerificationStats(deduped);
  const compacted_context = buildCompactedContext(deduped);

  return {
    summary: {
      latest_cycle_id: cycleId || null,
      entry_n: deduped.length,
      contradiction_n,
      current_objective_verdict: currentEntry.objective_verdict,
      current_authority_state: currentEntry.authority_state,
      current_change_authority_state: currentEntry.change_authority_state,
      current_dominant_issue: currentEntry.dominant_issue,
      current_dominant_issue_source: currentEntry.dominant_issue_source,
      current_recommended_action: currentEntry.recommended_action,
      current_verification_focus: currentEntry.verification_focus,
      current_execution_quality_status: currentEntry.current_snapshot.execution_quality_status,
      current_lineage_status: currentEntry.current_snapshot.lineage_verdict,
      current_account_integrity_status: currentEntry.current_snapshot.account_integrity_ok === true
        ? "PASS"
        : (currentEntry.current_snapshot.account_integrity_issue_n != null ? "WARN" : null),
      current_model_readiness_status: toUpper(autonomySummary.model_readiness_status),
      current_feature_store_status: toUpper(autonomySummary.feature_store_status),
      current_execution_model_dataset_status: toUpper(autonomySummary.execution_model_dataset_status),
      current_execution_fill_inference_status: String(autonomySummary.execution_fill_inference_status || "").trim() || null,
      current_execution_fill_inference_mismatch_rate: toNum(autonomySummary.execution_fill_inference_mismatch_rate),
      current_execution_fill_inference_filled_avg_pred_fill_prob: toNum(autonomySummary.execution_fill_inference_filled_avg_pred_fill_prob),
      current_execution_fill_inference_policy_blocked_avg_pred_fill_prob: toNum(autonomySummary.execution_fill_inference_policy_blocked_avg_pred_fill_prob),
      current_execution_scope_inference_status: String(autonomySummary.execution_scope_inference_status || "").trim() || null,
      current_execution_scope_inference_mismatch_rate: toNum(autonomySummary.execution_scope_inference_mismatch_rate),
      current_execution_scope_inference_top_false_positive_group: String(autonomySummary.execution_scope_inference_top_false_positive_group || "").trim() || null,
      current_execution_scope_train_run_status: String(autonomySummary.execution_scope_train_run_status || "").trim() || null,
      current_execution_scope_train_run_id: String(autonomySummary.execution_scope_train_run_id || "").trim() || null,
      current_execution_scope_train_run_model_artifact_id: String(autonomySummary.execution_scope_train_run_model_artifact_id || "").trim() || null,
      current_execution_scope_train_run_model_kind: String(autonomySummary.execution_scope_train_run_model_kind || "").trim() || null,
      current_execution_scope_train_run_quality_gate_status: String(autonomySummary.execution_scope_train_run_quality_gate_status || "").trim() || null,
      current_execution_scope_train_run_quality_gate_ready: autonomySummary.execution_scope_train_run_quality_gate_ready === true,
      current_execution_model_dataset_version_id: String(autonomySummary.execution_model_dataset_version_id || "").trim() || null,
      current_execution_model_top_webhook_to_intent_latency_group: String(autonomySummary.execution_model_dataset_top_webhook_to_intent_latency_group || "").trim() || null,
      current_execution_model_top_webhook_delay_reason: String(autonomySummary.execution_model_dataset_top_webhook_delay_reason || "").trim() || null,
      current_execution_model_top_webhook_delay_cause: String(autonomySummary.execution_model_dataset_top_webhook_delay_cause || "").trim() || null,
      current_execution_model_top_operational_webhook_delay_cause: String(autonomySummary.execution_model_dataset_top_operational_webhook_delay_cause || "").trim() || null,
      current_execution_model_top_operational_immediate_intent_delay_group: String(autonomySummary.execution_model_dataset_top_operational_immediate_intent_delay_group || "").trim() || null,
      current_execution_model_top_signal_to_intent_latency_group: String(autonomySummary.execution_model_dataset_top_signal_to_intent_latency_group || "").trim() || null,
      current_execution_model_top_operational_signal_to_intent_latency_group: String(autonomySummary.execution_model_dataset_top_operational_signal_to_intent_latency_group || "").trim() || null,
      current_execution_model_top_entry_latency_group: String(autonomySummary.execution_model_dataset_top_entry_latency_group || "").trim() || null,
      current_execution_model_top_fallback_latency_group: String(autonomySummary.execution_model_dataset_top_fallback_latency_group || "").trim() || null,
      current_execution_model_top_fill_source: String(autonomySummary.execution_model_dataset_top_fill_source || "").trim() || null,
      current_execution_model_top_no_fill_reason: String(autonomySummary.execution_model_dataset_top_no_fill_reason || "").trim() || null,
      current_execution_model_top_no_fill_reason_family: String(autonomySummary.execution_model_dataset_top_no_fill_reason_family || "").trim() || null,
      current_execution_model_top_no_fill_subtype: String(autonomySummary.execution_model_dataset_top_no_fill_subtype || "").trim() || null,
      current_execution_stage_latency_status: String(autonomySummary.execution_stage_latency_status || "").trim() || null,
      current_execution_stage_latency_top_signal_to_intent_group: String(autonomySummary.execution_stage_latency_top_signal_to_intent_group || "").trim() || null,
      current_execution_stage_latency_top_operational_signal_to_intent_group: String(autonomySummary.execution_stage_latency_top_operational_signal_to_intent_group || "").trim() || null,
      current_execution_stage_latency_top_webhook_saved_to_intent_group: String(autonomySummary.execution_stage_latency_top_webhook_saved_to_intent_group || "").trim() || null,
      current_execution_stage_latency_top_operational_webhook_saved_to_intent_group: String(autonomySummary.execution_stage_latency_top_operational_webhook_saved_to_intent_group || "").trim() || null,
      current_ml_experiment_registry_status: String(autonomySummary.ml_experiment_registry_status || "").trim() || null,
      current_ml_experiment_registry_experiment_id: String(autonomySummary.ml_experiment_registry_experiment_id || "").trim() || null,
      current_ml_experiment_registry_execution_dataset_version_id: String(autonomySummary.ml_experiment_registry_execution_dataset_version_id || "").trim() || null,
      current_ml_train_run_status: String(autonomySummary.ml_train_run_status || "").trim() || null,
      current_ml_train_run_id: String(autonomySummary.ml_train_run_id || "").trim() || null,
      current_ml_train_run_model_artifact_id: String(autonomySummary.ml_train_run_model_artifact_id || "").trim() || null,
      current_ml_train_run_model_kind: String(autonomySummary.ml_train_run_model_kind || "").trim() || null,
      current_ml_train_run_quality_gate_status: String(autonomySummary.ml_train_run_quality_gate_status || "").trim() || null,
      current_ml_train_run_quality_gate_ready: autonomySummary.ml_train_run_quality_gate_ready === true,
      current_ml_model_contract_status: String(autonomySummary.ml_model_contract_status || "").trim() || null,
      current_ml_model_contract_deployment_stage: String(autonomySummary.ml_model_contract_deployment_stage || "").trim() || null,
      current_ml_model_contract_canary_gate_status: String(autonomySummary.ml_model_contract_canary_gate_status || "").trim() || null,
      current_ml_model_contract_promotion_status: String(autonomySummary.ml_model_contract_promotion_status || "").trim() || null,
      current_ml_model_contract_model_artifact_id: String(autonomySummary.ml_model_contract_model_artifact_id || "").trim() || null,
      current_execution_bottleneck_delta_status: String(autonomySummary.execution_bottleneck_delta_status || "").trim() || null,
      current_execution_bottleneck_delta_comparable: autonomySummary.execution_bottleneck_delta_comparable === true,
      current_execution_bottleneck_delta_interpretation: String(autonomySummary.execution_bottleneck_delta_interpretation || "").trim() || null,
      current_execution_bottleneck_delta_top_operational_webhook_delay_cause: String(autonomySummary.execution_bottleneck_delta_top_operational_webhook_delay_cause || "").trim() || null,
      current_execution_bottleneck_delta_top_operational_signal_to_intent_group: String(autonomySummary.execution_bottleneck_delta_top_operational_signal_to_intent_group || "").trim() || null,
      current_model_readiness_mfe_mae_label_rate: toNum(autonomySummary.model_readiness_mfe_mae_label_rate),
      current_model_readiness_tp1_time_label_rate: toNum(autonomySummary.model_readiness_tp1_time_label_rate),
      current_model_readiness_tp0_time_label_rate: toNum(autonomySummary.model_readiness_tp0_time_label_rate),
      current_model_readiness_dataset_version_id: String(autonomySummary.model_readiness_dataset_version_id || "").trim() || null,
      current_feature_store_version_id: String(autonomySummary.feature_store_version_id || "").trim() || null,
      current_execution_quality_top_operational_webhook_delay_cause: String(currentEntry.current_snapshot.execution_quality_top_operational_webhook_delay_cause || "").trim() || null,
      current_execution_quality_top_operational_immediate_intent_delay_group: String(currentEntry.current_snapshot.execution_quality_top_operational_immediate_intent_delay_group || "").trim() || null,
      current_execution_quality_scope_quality_gate_status: String(currentEntry.current_snapshot.execution_scope_quality_gate_status || "").trim() || null,
      current_execution_quality_scope_quality_gate_ready: currentEntry.current_snapshot.execution_scope_quality_gate_ready === true,
      current_execution_quality_scope_inference_mismatch_rate: currentEntry.current_snapshot.execution_scope_inference_mismatch_rate,
      current_execution_quality_scope_top_false_positive_group: String(currentEntry.current_snapshot.execution_scope_top_false_positive_group || "").trim() || null,
      current_microstructure_tp0_hit_rate: currentEntry.current_snapshot.tp0_hit_rate,
      current_microstructure_tp1_hit_rate: currentEntry.current_snapshot.tp1_hit_rate,
      current_microstructure_pre_tp1_time_stop_rate: currentEntry.current_snapshot.pre_tp1_time_stop_rate,
      current_microstructure_chase_reject_n: currentEntry.current_snapshot.chase_reject_n,
      current_microstructure_cluster_reduce_n: currentEntry.current_snapshot.portfolio_cluster_reduce_n,
      current_microstructure_cluster_block_n: currentEntry.current_snapshot.portfolio_cluster_block_n,
      pending_verification_n: deduped.filter((row) => row && row.pending_verification && row.pending_verification.metric).length,
      verified_n: verificationStats.verified_n,
      sample_formation_verified_n: verificationStats.sample_formation_verified_n,
      fast_track_verified_n: verificationStats.fast_track_verified_n,
      not_met_n: verificationStats.not_met_n,
      unknown_n: verificationStats.unknown_n,
      deferred_n: verificationStats.deferred_n,
      verification_rate: verificationStats.verification_rate,
    },
    compacted_context,
    entries: deduped,
  };
}

module.exports = {
  buildReasoningJournal,
  __test: {
    buildCompactedContext,
    countContradictions,
    collectCurrentVerificationState,
    deriveDominantIssue,
    deriveHypothesis,
    deriveVerificationFriendlyHypothesis,
    evaluateExpected,
    deriveRecommendedAction,
    derivePendingVerification,
    describeVerificationTarget,
    shouldDeferByPolicy,
    shouldDeferLowSample,
    resolveVerificationOutcome,
    resolvePreviousEntries,
    buildVerificationStats,
  },
};
