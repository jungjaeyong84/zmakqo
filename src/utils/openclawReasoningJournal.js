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

function readCurrentStatus(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.current_status && typeof raw.current_status === "object" ? raw.current_status : {};
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
    || String(policySummary.ev_policy_action_canonical || "").trim()
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
  const autonomyCurrentStatus = readCurrentStatus(autonomyContract);
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
      ev_gate_policy_status: String(autonomySummary.ev_gate_policy_status || "").trim() || null,
      ev_gate_policy_basis: String(autonomySummary.ev_gate_policy_basis || "").trim() || null,
      ev_gate_canonical_policy_version: String(autonomySummary.ev_gate_canonical_policy_version || "").trim() || null,
      ev_gate_compatibility_policy_version: String(autonomySummary.ev_gate_compatibility_policy_version || "").trim() || null,
      ev_gate_threshold_metric: String(autonomySummary.ev_gate_threshold_metric || "").trim() || null,
      ev_gate_compatibility_drop_reason: String(autonomySummary.ev_gate_compatibility_drop_reason || "").trim() || null,
      ev_gate_default_tp0_pct: toNum(autonomySummary.ev_gate_default_tp0_pct),
      ev_gate_default_tp0_qty_ratio: toNum(autonomySummary.ev_gate_default_tp0_qty_ratio),
      ev_candidate_id: String(autonomySummary.ev_candidate_id || "").trim() || null,
      ev_candidate_canonical_id: String(autonomySummary.ev_candidate_canonical_id || "").trim() || null,
      ev_policy_review_mode: String(policySummary.ev_policy_review_mode || "").trim() || null,
      ev_policy_top_return_drag_profile: String(policySummary.ev_policy_top_return_drag_profile || "").trim() || null,
      ev_policy_top_return_drag_driver: String(policySummary.ev_policy_top_return_drag_driver || "").trim() || null,
      ev_policy_top_mixed_profile: String(policySummary.ev_policy_top_mixed_profile || "").trim() || null,
      ev_policy_top_mixed_driver: String(policySummary.ev_policy_top_mixed_driver || "").trim() || null,
      server_signal_runtime_ev_gate_unknown_gen_relax_enabled: autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_enabled === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_started_at: String(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_started_at || "").trim() || null,
      server_signal_runtime_ev_gate_unknown_gen_relax_window_hours: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_window_hours),
      server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours),
      server_signal_runtime_ev_gate_unknown_gen_relax_active_window: autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_active_window === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled: autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta),
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta),
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta),
      self_evolution_top_candidate_id: String(autonomySummary.self_evolution_top_candidate_id || "").trim() || null,
      self_evolution_top_candidate_canonical_id: String(autonomySummary.self_evolution_top_candidate_canonical_id || "").trim() || null,
      execution_quality_latency_p95_ms: toNum(executionQualitySummary.created_to_fill_p95_ms),
      execution_quality_slippage_p95_bps: toNum(executionQualitySummary.adverse_slippage_p95_bps),
      execution_quality_partial_fill_rate_pct: toNum(executionQualitySummary.partial_fill_rate_pct),
      execution_quality_top_operational_webhook_delay_cause: String(executionQualitySummary.top_operational_webhook_delay_cause || "").trim() || null,
      execution_quality_top_operational_immediate_intent_delay_group: String(executionQualitySummary.top_operational_immediate_intent_delay_group || "").trim() || null,
      execution_quality_top_no_fill_reason: String(executionQualitySummary.top_no_fill_reason || "").trim() || null,
      execution_quality_top_no_fill_subtype: String(executionQualitySummary.top_no_fill_subtype || "").trim() || null,
      execution_structure_upgrade_contract_status: String(autonomySummary.execution_structure_upgrade_contract_status || "").trim() || null,
      execution_structure_upgrade_mode: String(autonomySummary.execution_structure_upgrade_mode || "").trim() || null,
      execution_structure_upgrade_stage_sequence_ready: autonomySummary.execution_structure_upgrade_stage_sequence_ready === true,
      execution_structure_upgrade_survivability_ready: autonomySummary.execution_structure_upgrade_survivability_ready === true,
      execution_structure_upgrade_label_support_ready: autonomySummary.execution_structure_upgrade_label_support_ready === true,
      execution_structure_upgrade_tp0_stage_active: autonomySummary.execution_structure_upgrade_tp0_stage_active === true,
      execution_structure_upgrade_tp1_stage_active: autonomySummary.execution_structure_upgrade_tp1_stage_active === true,
      execution_structure_upgrade_trail_stage_active: autonomySummary.execution_structure_upgrade_trail_stage_active === true,
      execution_structure_upgrade_blocking_reason_n: toNum(autonomySummary.execution_structure_upgrade_blocking_reason_n),
      cost_control_engine_contract_status: String(autonomySummary.cost_control_engine_contract_status || "").trim() || null,
      cost_control_engine_contract_mode: String(autonomySummary.cost_control_engine_contract_mode || "").trim() || null,
      cost_control_engine_automatic_entry_suppression_ready: autonomySummary.cost_control_engine_automatic_entry_suppression_ready === true,
      cost_control_engine_system_reentry_control_ready: autonomySummary.cost_control_engine_system_reentry_control_ready === true,
      cost_control_engine_expectancy_gate_active: autonomySummary.cost_control_engine_expectancy_gate_active === true,
      cost_control_engine_cost_block_mode_active: autonomySummary.cost_control_engine_cost_block_mode_active === true,
      cost_control_engine_cooldown_reentry_control_active: autonomySummary.cost_control_engine_cooldown_reentry_control_active === true,
      cost_control_engine_reverse_reentry_control_active: autonomySummary.cost_control_engine_reverse_reentry_control_active === true,
      cost_control_engine_blocking_reason_n: toNum(autonomySummary.cost_control_engine_blocking_reason_n),
      validation_deployment_pipeline_contract_status: String(autonomySummary.validation_deployment_pipeline_contract_status || "").trim() || null,
      validation_deployment_pipeline_contract_mode: String(autonomySummary.validation_deployment_pipeline_contract_mode || "").trim() || null,
      validation_deployment_pipeline_current_deployment_stage: String(autonomySummary.validation_deployment_pipeline_current_deployment_stage || "").trim() || null,
      validation_deployment_pipeline_shadow_numeric_gate_ready: autonomySummary.validation_deployment_pipeline_shadow_numeric_gate_ready === true,
      validation_deployment_pipeline_canary_numeric_gate_ready: autonomySummary.validation_deployment_pipeline_canary_numeric_gate_ready === true,
      validation_deployment_pipeline_live_numeric_gate_ready: autonomySummary.validation_deployment_pipeline_live_numeric_gate_ready === true,
      validation_deployment_pipeline_numeric_judgement_ready: autonomySummary.validation_deployment_pipeline_numeric_judgement_ready === true,
      validation_deployment_pipeline_automatic_rollback_ready: autonomySummary.validation_deployment_pipeline_automatic_rollback_ready === true,
      validation_deployment_pipeline_blocking_reason_n: toNum(autonomySummary.validation_deployment_pipeline_blocking_reason_n),
      cohort_regime_parameter_split_contract_status: String(autonomySummary.cohort_regime_parameter_split_contract_status || "").trim() || null,
      cohort_regime_parameter_split_contract_mode: String(autonomySummary.cohort_regime_parameter_split_contract_mode || "").trim() || null,
      cohort_regime_parameter_split_cohort_scope: String(autonomySummary.cohort_regime_parameter_split_cohort_scope || "").trim() || null,
      cohort_regime_parameter_split_active_cohort_n: toNum(autonomySummary.cohort_regime_parameter_split_active_cohort_n),
      cohort_regime_parameter_split_cohort_parameterization_ready: autonomySummary.cohort_regime_parameter_split_cohort_parameterization_ready === true,
      cohort_regime_parameter_split_regime_switch_ready: autonomySummary.cohort_regime_parameter_split_regime_switch_ready === true,
      cohort_regime_parameter_split_policy_scoped_ready: autonomySummary.cohort_regime_parameter_split_policy_scoped_ready === true,
      cohort_regime_parameter_split_automatic_transition_ready: autonomySummary.cohort_regime_parameter_split_automatic_transition_ready === true,
      cohort_regime_parameter_split_blocking_reason_n: toNum(autonomySummary.cohort_regime_parameter_split_blocking_reason_n),
      execution_scope_quality_gate_status: String(executionQualitySummary.execution_scope_quality_gate_status || "").trim() || null,
      execution_scope_quality_gate_ready: executionQualitySummary.execution_scope_quality_gate_ready === true,
      execution_scope_inference_mismatch_rate: toNum(executionQualitySummary.execution_scope_inference_mismatch_rate),
      execution_scope_top_false_positive_group: String(executionQualitySummary.execution_scope_top_false_positive_group || "").trim() || null,
      execution_scope_fp_diagnostics_status: String(executionQualitySummary.execution_scope_fp_diagnostics_status || "").trim() || null,
      execution_scope_fp_diagnostics_top_shared_feature: String(executionQualitySummary.execution_scope_fp_diagnostics_top_shared_feature || "").trim() || null,
      execution_scope_fp_diagnostics_top_context_profile: String(executionQualitySummary.execution_scope_fp_diagnostics_top_context_profile || "").trim() || null,
      execution_scope_fp_diagnostics_reference_rows_n: toNum(executionQualitySummary.execution_scope_fp_diagnostics_reference_rows_n),
      execution_scope_test_early_macro_recall: toNum(executionQualitySummary.execution_scope_test_early_macro_recall),
      execution_scope_test_core_macro_recall: toNum(executionQualitySummary.execution_scope_test_core_macro_recall),
      execution_scope_tier_comparison_status: String(executionQualitySummary.execution_scope_tier_comparison_status || "").trim() || null,
      execution_scope_tier_weaker_tier: String(executionQualitySummary.execution_scope_tier_weaker_tier || "").trim() || null,
      execution_scope_tier_weaker_tier_by_mismatch: String(executionQualitySummary.execution_scope_tier_weaker_tier_by_mismatch || "").trim() || null,
      execution_scope_tier_weaker_tier_by_macro_recall: String(executionQualitySummary.execution_scope_tier_weaker_tier_by_macro_recall || "").trim() || null,
      execution_scope_tier_mismatch_rate_gap: toNum(executionQualitySummary.execution_scope_tier_mismatch_rate_gap),
      execution_scope_tier_macro_recall_gap: toNum(executionQualitySummary.execution_scope_tier_macro_recall_gap),
      execution_scope_tier_early_weakness_score: toNum(executionQualitySummary.execution_scope_tier_early_weakness_score),
      execution_scope_tier_core_weakness_score: toNum(executionQualitySummary.execution_scope_tier_core_weakness_score),
      execution_scope_tier_diagnostics_status: String(executionQualitySummary.execution_scope_tier_diagnostics_status || "").trim() || null,
      execution_scope_tier_diagnostics_top_false_positive_group: String(executionQualitySummary.execution_scope_tier_diagnostics_top_false_positive_group || "").trim() || null,
      execution_scope_tier_diagnostics_top_false_negative_group: String(executionQualitySummary.execution_scope_tier_diagnostics_top_false_negative_group || "").trim() || null,
      execution_scope_tier_diagnostics_policy_blocked_top_source: String(executionQualitySummary.execution_scope_tier_diagnostics_policy_blocked_top_source || "").trim() || null,
      execution_scope_tier_diagnostics_policy_blocked_top_no_fill_reason: String(executionQualitySummary.execution_scope_tier_diagnostics_policy_blocked_top_no_fill_reason || "").trim() || null,
      execution_scope_tier_diagnostics_policy_blocked_lowest_coverage_feature: String(executionQualitySummary.execution_scope_tier_diagnostics_policy_blocked_lowest_coverage_feature || "").trim() || null,
      execution_scope_tier_raw_diff_status: String(executionQualitySummary.execution_scope_tier_raw_diff_status || "").trim() || null,
      execution_scope_tier_raw_diff_top_false_positive_group: String(executionQualitySummary.execution_scope_tier_raw_diff_top_false_positive_group || "").trim() || null,
      execution_scope_tier_raw_diff_top_reason: String(executionQualitySummary.execution_scope_tier_raw_diff_top_reason || "").trim() || null,
      execution_scope_tier_raw_diff_top_action: String(executionQualitySummary.execution_scope_tier_raw_diff_top_action || "").trim() || null,
      execution_scope_tier_raw_diff_top_pos_state: String(executionQualitySummary.execution_scope_tier_raw_diff_top_pos_state || "").trim() || null,
      execution_scope_tier_raw_diff_top_schedule_profile: String(executionQualitySummary.execution_scope_tier_raw_diff_top_schedule_profile || "").trim() || null,
      execution_scope_tier_raw_diff_top_signal_to_intent_bucket: String(executionQualitySummary.execution_scope_tier_raw_diff_top_signal_to_intent_bucket || "").trim() || null,
      execution_scope_tier_raw_diff_top_policy_block_hint: String(executionQualitySummary.execution_scope_tier_raw_diff_top_policy_block_hint || "").trim() || null,
      execution_scope_tier_raw_diff_top_webhook_execution_profile: String(executionQualitySummary.execution_scope_tier_raw_diff_top_webhook_execution_profile || "").trim() || null,
      execution_scope_tier_raw_diff_top_webhook_bar_timing_profile: String(executionQualitySummary.execution_scope_tier_raw_diff_top_webhook_bar_timing_profile || "").trim() || null,
      execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n: toNum(executionQualitySummary.execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n),
      execution_scope_tier_raw_diff_saved_no_probe_rows_n: toNum(executionQualitySummary.execution_scope_tier_raw_diff_saved_no_probe_rows_n),
      execution_scope_tier_raw_diff_pre_bar_close_rows_n: toNum(executionQualitySummary.execution_scope_tier_raw_diff_pre_bar_close_rows_n),
      lineage_verdict: String(lineageSummary.verdict || "").trim() || null,
      lineage_fills_intent_null_rate: toNum(lineageSummary.fills_intent_id_null_rate),
      lineage_entry_fills_intent_null_rate: toNum(lineageSummary.entry_fills_intent_id_null_rate),
      lineage_external_reconciled_fill_intent_null_n: toNum(lineageSummary.external_reconciled_fills_intent_id_null_n),
      lineage_external_reconciled_fill_intent_null_present: Array.isArray(lineageSummary.warning_reasons)
        && lineageSummary.warning_reasons.includes("EXTERNAL_RECONCILED_FILL_INTENT_NULL_PRESENT"),
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
      current_execution_structure_upgrade_contract_status: String(autonomySummary.execution_structure_upgrade_contract_status || "").trim() || null,
      current_execution_structure_upgrade_mode: String(autonomySummary.execution_structure_upgrade_mode || "").trim() || null,
      current_execution_structure_upgrade_stage_sequence_ready: autonomySummary.execution_structure_upgrade_stage_sequence_ready === true,
      current_execution_structure_upgrade_survivability_ready: autonomySummary.execution_structure_upgrade_survivability_ready === true,
      current_execution_structure_upgrade_label_support_ready: autonomySummary.execution_structure_upgrade_label_support_ready === true,
      current_execution_structure_upgrade_tp0_stage_active: autonomySummary.execution_structure_upgrade_tp0_stage_active === true,
      current_execution_structure_upgrade_tp1_stage_active: autonomySummary.execution_structure_upgrade_tp1_stage_active === true,
      current_execution_structure_upgrade_trail_stage_active: autonomySummary.execution_structure_upgrade_trail_stage_active === true,
      current_execution_structure_upgrade_blocking_reason_n: toNum(autonomySummary.execution_structure_upgrade_blocking_reason_n),
      current_cost_control_engine_contract_status: String(autonomySummary.cost_control_engine_contract_status || "").trim() || null,
      current_cost_control_engine_contract_mode: String(autonomySummary.cost_control_engine_contract_mode || "").trim() || null,
      current_cost_control_engine_automatic_entry_suppression_ready: autonomySummary.cost_control_engine_automatic_entry_suppression_ready === true,
      current_cost_control_engine_system_reentry_control_ready: autonomySummary.cost_control_engine_system_reentry_control_ready === true,
      current_cost_control_engine_expectancy_gate_active: autonomySummary.cost_control_engine_expectancy_gate_active === true,
      current_cost_control_engine_cost_block_mode_active: autonomySummary.cost_control_engine_cost_block_mode_active === true,
      current_cost_control_engine_cooldown_reentry_control_active: autonomySummary.cost_control_engine_cooldown_reentry_control_active === true,
      current_cost_control_engine_reverse_reentry_control_active: autonomySummary.cost_control_engine_reverse_reentry_control_active === true,
      current_cost_control_engine_blocking_reason_n: toNum(autonomySummary.cost_control_engine_blocking_reason_n),
      current_validation_deployment_pipeline_contract_status: String(autonomySummary.validation_deployment_pipeline_contract_status || "").trim() || null,
      current_validation_deployment_pipeline_contract_mode: String(autonomySummary.validation_deployment_pipeline_contract_mode || "").trim() || null,
      current_validation_deployment_pipeline_current_deployment_stage: String(autonomySummary.validation_deployment_pipeline_current_deployment_stage || "").trim() || null,
      current_validation_deployment_pipeline_shadow_numeric_gate_ready: autonomySummary.validation_deployment_pipeline_shadow_numeric_gate_ready === true,
      current_validation_deployment_pipeline_canary_numeric_gate_ready: autonomySummary.validation_deployment_pipeline_canary_numeric_gate_ready === true,
      current_validation_deployment_pipeline_live_numeric_gate_ready: autonomySummary.validation_deployment_pipeline_live_numeric_gate_ready === true,
      current_validation_deployment_pipeline_numeric_judgement_ready: autonomySummary.validation_deployment_pipeline_numeric_judgement_ready === true,
      current_validation_deployment_pipeline_automatic_rollback_ready: autonomySummary.validation_deployment_pipeline_automatic_rollback_ready === true,
      current_validation_deployment_pipeline_blocking_reason_n: toNum(autonomySummary.validation_deployment_pipeline_blocking_reason_n),
      current_performance_kpi_upgrade_contract_status: String(autonomySummary.performance_kpi_upgrade_contract_status || "").trim() || null,
      current_performance_kpi_upgrade_contract_mode: String(autonomySummary.performance_kpi_upgrade_contract_mode || "").trim() || null,
      current_performance_kpi_upgrade_microstructure_kpi_ready: autonomySummary.performance_kpi_upgrade_microstructure_kpi_ready === true,
      current_performance_kpi_upgrade_survivability_kpi_ready: autonomySummary.performance_kpi_upgrade_survivability_kpi_ready === true,
      current_performance_kpi_upgrade_expectancy_kpi_ready: autonomySummary.performance_kpi_upgrade_expectancy_kpi_ready === true,
      current_performance_kpi_upgrade_structure_alignment_ready: autonomySummary.performance_kpi_upgrade_structure_alignment_ready === true,
      current_performance_kpi_upgrade_cost_alignment_ready: autonomySummary.performance_kpi_upgrade_cost_alignment_ready === true,
      current_performance_kpi_upgrade_tp0_hit_rate: toNum(autonomySummary.performance_kpi_upgrade_tp0_hit_rate),
      current_performance_kpi_upgrade_tp1_hit_rate: toNum(autonomySummary.performance_kpi_upgrade_tp1_hit_rate),
      current_performance_kpi_upgrade_tp0_to_tp1_conversion_rate: toNum(autonomySummary.performance_kpi_upgrade_tp0_to_tp1_conversion_rate),
      current_performance_kpi_upgrade_pre_tp1_time_stop_rate: toNum(autonomySummary.performance_kpi_upgrade_pre_tp1_time_stop_rate),
      current_performance_kpi_upgrade_fee_adjusted_expectancy: toNum(autonomySummary.performance_kpi_upgrade_fee_adjusted_expectancy),
      current_performance_kpi_upgrade_realized_trade_n: toNum(autonomySummary.performance_kpi_upgrade_realized_trade_n),
      current_performance_kpi_upgrade_legacy_win_rate_reference: toNum(autonomySummary.performance_kpi_upgrade_legacy_win_rate_reference),
      current_performance_kpi_upgrade_objective_verdict: String(autonomySummary.performance_kpi_upgrade_objective_verdict || "").trim() || null,
      current_performance_kpi_upgrade_blocking_reason_n: toNum(autonomySummary.performance_kpi_upgrade_blocking_reason_n),
      current_cohort_regime_parameter_split_contract_status: String(autonomySummary.cohort_regime_parameter_split_contract_status || "").trim() || null,
      current_cohort_regime_parameter_split_contract_mode: String(autonomySummary.cohort_regime_parameter_split_contract_mode || "").trim() || null,
      current_cohort_regime_parameter_split_cohort_scope: String(autonomySummary.cohort_regime_parameter_split_cohort_scope || "").trim() || null,
      current_cohort_regime_parameter_split_active_cohort_n: toNum(autonomySummary.cohort_regime_parameter_split_active_cohort_n),
      current_cohort_regime_parameter_split_cohort_parameterization_ready: autonomySummary.cohort_regime_parameter_split_cohort_parameterization_ready === true,
      current_cohort_regime_parameter_split_regime_switch_ready: autonomySummary.cohort_regime_parameter_split_regime_switch_ready === true,
      current_cohort_regime_parameter_split_policy_scoped_ready: autonomySummary.cohort_regime_parameter_split_policy_scoped_ready === true,
      current_cohort_regime_parameter_split_automatic_transition_ready: autonomySummary.cohort_regime_parameter_split_automatic_transition_ready === true,
      current_cohort_regime_parameter_split_blocking_reason_n: toNum(autonomySummary.cohort_regime_parameter_split_blocking_reason_n),
      current_ev_gate_policy_status: String(autonomySummary.ev_gate_policy_status || "").trim() || null,
      current_ev_gate_policy_basis: String(autonomySummary.ev_gate_policy_basis || "").trim() || null,
      current_ev_gate_canonical_policy_version: String(autonomySummary.ev_gate_canonical_policy_version || "").trim() || null,
      current_ev_gate_compatibility_policy_version: String(autonomySummary.ev_gate_compatibility_policy_version || "").trim() || null,
      current_ev_gate_threshold_metric: String(autonomySummary.ev_gate_threshold_metric || "").trim() || null,
      current_ev_gate_compatibility_drop_reason: String(autonomySummary.ev_gate_compatibility_drop_reason || "").trim() || null,
      current_ev_gate_default_tp0_pct: toNum(autonomySummary.ev_gate_default_tp0_pct),
      current_ev_gate_default_tp0_qty_ratio: toNum(autonomySummary.ev_gate_default_tp0_qty_ratio),
      current_ev_candidate_id: String(autonomySummary.ev_candidate_id || "").trim() || null,
      current_ev_candidate_canonical_id: String(autonomySummary.ev_candidate_canonical_id || "").trim() || null,
      current_ev_policy_review_mode: String(policySummary.ev_policy_review_mode || "").trim() || null,
      current_ev_policy_top_return_drag_profile: String(policySummary.ev_policy_top_return_drag_profile || "").trim() || null,
      current_ev_policy_top_return_drag_driver: String(policySummary.ev_policy_top_return_drag_driver || "").trim() || null,
      current_ev_policy_top_mixed_profile: String(policySummary.ev_policy_top_mixed_profile || "").trim() || null,
      current_ev_policy_top_mixed_driver: String(policySummary.ev_policy_top_mixed_driver || "").trim() || null,
      current_server_signal_runtime_ev_gate_unknown_gen_relax_enabled: autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_enabled === true,
      current_server_signal_runtime_ev_gate_unknown_gen_relax_started_at: String(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_started_at || "").trim() || null,
      current_server_signal_runtime_ev_gate_unknown_gen_relax_window_hours: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_window_hours),
      current_server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours),
      current_server_signal_runtime_ev_gate_unknown_gen_relax_active_window: autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_active_window === true,
      current_server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled: autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled === true,
      current_server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta),
      current_server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta),
      current_server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta: toNum(autonomySummary.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta),
      current_top_candidate_id: String(autonomySummary.self_evolution_top_candidate_id || "").trim() || null,
      current_top_candidate_canonical_id: String(autonomySummary.self_evolution_top_candidate_canonical_id || "").trim() || null,
      current_lineage_status: currentEntry.current_snapshot.lineage_verdict,
      current_lineage_entry_fills_intent_null_rate: toNum(autonomyCurrentStatus.lineage_entry_fills_intent_null_rate != null ? autonomyCurrentStatus.lineage_entry_fills_intent_null_rate : autonomySummary.lineage_entry_fills_intent_null_rate),
      current_lineage_external_reconciled_fill_intent_null_n: toNum(autonomyCurrentStatus.lineage_external_reconciled_fill_intent_null_n != null ? autonomyCurrentStatus.lineage_external_reconciled_fill_intent_null_n : autonomySummary.lineage_external_reconciled_fill_intent_null_n),
      current_lineage_external_reconciled_fill_intent_null_present: autonomyCurrentStatus.lineage_external_reconciled_fill_intent_null_present === true || autonomySummary.lineage_external_reconciled_fill_intent_null_present === true,
      current_lineage_slo_drop_monitor_status: String(autonomyCurrentStatus.lineage_slo_drop_monitor_status || autonomySummary.lineage_slo_drop_monitor_status || "").trim() || null,
      current_lineage_slo_drop_monitor_evidence_status: String(autonomyCurrentStatus.lineage_slo_drop_monitor_evidence_status || autonomySummary.lineage_slo_drop_monitor_evidence_status || "").trim() || null,
      current_lineage_slo_drop_monitor_post_fix_lineage_slo_drop_n: toNum(autonomyCurrentStatus.lineage_slo_drop_monitor_post_fix_lineage_slo_drop_n != null ? autonomyCurrentStatus.lineage_slo_drop_monitor_post_fix_lineage_slo_drop_n : autonomySummary.lineage_slo_drop_monitor_post_fix_lineage_slo_drop_n),
      current_lineage_slo_drop_monitor_pre_fix_lineage_slo_drop_n: toNum(autonomyCurrentStatus.lineage_slo_drop_monitor_pre_fix_lineage_slo_drop_n != null ? autonomyCurrentStatus.lineage_slo_drop_monitor_pre_fix_lineage_slo_drop_n : autonomySummary.lineage_slo_drop_monitor_pre_fix_lineage_slo_drop_n),
      current_lineage_slo_drop_monitor_post_fix_clear: autonomyCurrentStatus.lineage_slo_drop_monitor_post_fix_clear === true || autonomySummary.lineage_slo_drop_monitor_post_fix_clear === true,
      current_account_integrity_status: currentEntry.current_snapshot.account_integrity_ok === true
        ? "PASS"
        : (currentEntry.current_snapshot.account_integrity_issue_n != null ? "WARN" : null),
      current_model_readiness_status: toUpper(autonomySummary.model_readiness_status),
      current_truth_preservation_audit_status: String(autonomySummary.truth_preservation_audit_status || "").trim() || null,
      current_truth_preservation_ready: autonomySummary.truth_preservation_ready === true,
      current_truth_preservation_lineage_status: String(autonomySummary.truth_preservation_lineage_status || "").trim() || null,
      current_truth_preservation_stale_comparison_active: autonomySummary.truth_preservation_stale_comparison_active === true,
      current_truth_preservation_legacy_webhook_outcome_only_rows_n: toNum(autonomySummary.truth_preservation_legacy_webhook_outcome_only_rows_n),
      current_truth_preservation_blocking_reason_n: toNum(autonomySummary.truth_preservation_blocking_reason_n),
      current_truth_preservation_warning_reason_n: toNum(autonomySummary.truth_preservation_warning_reason_n),
      current_feature_store_status: toUpper(autonomySummary.feature_store_status),
      current_execution_model_dataset_status: toUpper(autonomySummary.execution_model_dataset_status),
      current_execution_fill_inference_status: String(autonomySummary.execution_fill_inference_status || "").trim() || null,
      current_execution_fill_inference_mismatch_rate: toNum(autonomySummary.execution_fill_inference_mismatch_rate),
      current_execution_fill_inference_filled_avg_pred_fill_prob: toNum(autonomySummary.execution_fill_inference_filled_avg_pred_fill_prob),
      current_execution_fill_inference_policy_blocked_avg_pred_fill_prob: toNum(autonomySummary.execution_fill_inference_policy_blocked_avg_pred_fill_prob),
      current_execution_scope_inference_status: String(autonomySummary.execution_scope_inference_status || "").trim() || null,
      current_execution_scope_inference_mismatch_rate: toNum(autonomySummary.execution_scope_inference_mismatch_rate),
      current_execution_scope_inference_top_false_positive_group: String(autonomySummary.execution_scope_inference_top_false_positive_group || "").trim() || null,
      current_execution_scope_fp_diagnostics_status: String(autonomySummary.execution_scope_fp_diagnostics_status || "").trim() || null,
      current_execution_scope_fp_diagnostics_top_shared_feature: String(autonomySummary.execution_scope_fp_diagnostics_top_shared_feature || "").trim() || null,
      current_execution_scope_fp_diagnostics_top_context_profile: String(autonomySummary.execution_scope_fp_diagnostics_top_context_profile || "").trim() || null,
      current_execution_scope_fp_diagnostics_reference_rows_n: toNum(autonomySummary.execution_scope_fp_diagnostics_reference_rows_n),
      current_execution_scope_test_early_macro_recall: toNum(autonomySummary.execution_scope_test_early_macro_recall),
      current_execution_scope_test_core_macro_recall: toNum(autonomySummary.execution_scope_test_core_macro_recall),
      current_execution_scope_tier_comparison_status: String(autonomySummary.execution_scope_tier_comparison_status || "").trim() || null,
      current_execution_scope_tier_weaker_tier: String(autonomySummary.execution_scope_tier_weaker_tier || "").trim() || null,
      current_execution_scope_tier_weaker_tier_by_mismatch: String(autonomySummary.execution_scope_tier_weaker_tier_by_mismatch || "").trim() || null,
      current_execution_scope_tier_weaker_tier_by_macro_recall: String(autonomySummary.execution_scope_tier_weaker_tier_by_macro_recall || "").trim() || null,
      current_execution_scope_tier_mismatch_rate_gap: toNum(autonomySummary.execution_scope_tier_mismatch_rate_gap),
      current_execution_scope_tier_macro_recall_gap: toNum(autonomySummary.execution_scope_tier_macro_recall_gap),
      current_execution_scope_tier_early_weakness_score: toNum(autonomySummary.execution_scope_tier_early_weakness_score),
      current_execution_scope_tier_core_weakness_score: toNum(autonomySummary.execution_scope_tier_core_weakness_score),
      current_execution_scope_tier_diagnostics_status: String(autonomySummary.execution_scope_tier_diagnostics_status || "").trim() || null,
      current_execution_scope_tier_diagnostics_top_false_positive_group: String(autonomySummary.execution_scope_tier_diagnostics_top_false_positive_group || "").trim() || null,
      current_execution_scope_tier_diagnostics_top_false_negative_group: String(autonomySummary.execution_scope_tier_diagnostics_top_false_negative_group || "").trim() || null,
      current_execution_scope_tier_diagnostics_policy_blocked_top_source: String(autonomySummary.execution_scope_tier_diagnostics_policy_blocked_top_source || "").trim() || null,
      current_execution_scope_tier_diagnostics_policy_blocked_top_no_fill_reason: String(autonomySummary.execution_scope_tier_diagnostics_policy_blocked_top_no_fill_reason || "").trim() || null,
      current_execution_scope_tier_diagnostics_policy_blocked_lowest_coverage_feature: String(autonomySummary.execution_scope_tier_diagnostics_policy_blocked_lowest_coverage_feature || "").trim() || null,
      current_execution_scope_tier_raw_diff_status: String(autonomySummary.execution_scope_tier_raw_diff_status || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_false_positive_group: String(autonomySummary.execution_scope_tier_raw_diff_top_false_positive_group || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_reason: String(autonomySummary.execution_scope_tier_raw_diff_top_reason || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_action: String(autonomySummary.execution_scope_tier_raw_diff_top_action || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_pos_state: String(autonomySummary.execution_scope_tier_raw_diff_top_pos_state || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_schedule_profile: String(autonomySummary.execution_scope_tier_raw_diff_top_schedule_profile || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_signal_to_intent_bucket: String(autonomySummary.execution_scope_tier_raw_diff_top_signal_to_intent_bucket || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_policy_block_hint: String(autonomySummary.execution_scope_tier_raw_diff_top_policy_block_hint || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_webhook_execution_profile: String(autonomySummary.execution_scope_tier_raw_diff_top_webhook_execution_profile || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_webhook_bar_timing_profile: String(autonomySummary.execution_scope_tier_raw_diff_top_webhook_bar_timing_profile || "").trim() || null,
      current_execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n: toNum(autonomySummary.execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n),
      current_execution_scope_tier_raw_diff_saved_no_probe_rows_n: toNum(autonomySummary.execution_scope_tier_raw_diff_saved_no_probe_rows_n),
      current_execution_scope_tier_raw_diff_pre_bar_close_rows_n: toNum(autonomySummary.execution_scope_tier_raw_diff_pre_bar_close_rows_n),
      current_execution_scope_train_run_status: String(autonomySummary.execution_scope_train_run_status || "").trim() || null,
      current_execution_scope_train_run_id: String(autonomySummary.execution_scope_train_run_id || "").trim() || null,
      current_execution_scope_train_run_model_artifact_id: String(autonomySummary.execution_scope_train_run_model_artifact_id || "").trim() || null,
      current_execution_scope_train_run_model_kind: String(autonomySummary.execution_scope_train_run_model_kind || "").trim() || null,
      current_execution_scope_train_run_quality_gate_status: String(autonomySummary.execution_scope_train_run_quality_gate_status || "").trim() || null,
      current_execution_scope_train_run_quality_gate_ready: autonomySummary.execution_scope_train_run_quality_gate_ready === true,
      current_execution_scope_train_run_top_policy_blocked_test_source: String(autonomySummary.execution_scope_train_run_top_policy_blocked_test_source || "").trim() || null,
      current_execution_scope_train_run_top_policy_blocked_test_source_train_n: toNum(autonomySummary.execution_scope_train_run_top_policy_blocked_test_source_train_n),
      current_execution_scope_train_run_top_policy_blocked_test_source_test_n: toNum(autonomySummary.execution_scope_train_run_top_policy_blocked_test_source_test_n),
      current_execution_scope_train_run_top_policy_blocked_test_source_test_share: toNum(autonomySummary.execution_scope_train_run_top_policy_blocked_test_source_test_share),
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
      current_execution_serving_contract_status: String(autonomySummary.execution_serving_contract_status || "").trim() || null,
      current_execution_serving_stage: String(autonomySummary.execution_serving_stage || "").trim() || null,
      current_execution_serving_decision: String(autonomySummary.execution_serving_decision || "").trim() || null,
      current_execution_serving_shadow_ready: autonomySummary.execution_serving_shadow_ready === true,
      current_execution_serving_scope_train_run_aligned: autonomySummary.execution_serving_scope_train_run_aligned === true,
      current_execution_serving_scope_registry_aligned: autonomySummary.execution_serving_scope_registry_aligned === true,
      current_execution_serving_preferred_model_family: String(autonomySummary.execution_serving_preferred_model_family || "").trim() || null,
      current_execution_serving_preferred_model_artifact_id: String(autonomySummary.execution_serving_preferred_model_artifact_id || "").trim() || null,
      current_ml_global_canary_status: String(autonomyCurrentStatus.ml_global_canary_status || autonomySummary.ml_global_canary_status || "").trim() || null,
      current_ml_global_canary_ready: autonomyCurrentStatus.ml_global_canary_ready === true || autonomySummary.ml_global_canary_ready === true,
      current_ml_global_canary_evidence_status: String(autonomyCurrentStatus.ml_global_canary_evidence_status || autonomySummary.ml_global_canary_evidence_status || "").trim() || null,
      current_ml_global_canary_dominant_blocker: String(autonomyCurrentStatus.ml_global_canary_dominant_blocker || autonomySummary.ml_global_canary_dominant_blocker || "").trim() || null,
      current_ml_global_canary_replay_evidence_status: String(autonomyCurrentStatus.ml_global_canary_replay_evidence_status || autonomySummary.ml_global_canary_replay_evidence_status || "").trim() || null,
      current_ml_global_canary_replay_dominant_issue: String(autonomyCurrentStatus.ml_global_canary_replay_dominant_issue || autonomySummary.ml_global_canary_replay_dominant_issue || "").trim() || null,
      current_ml_global_canary_replay_best_candidate_id: String(autonomyCurrentStatus.ml_global_canary_replay_best_candidate_id || autonomySummary.ml_global_canary_replay_best_candidate_id || "").trim() || null,
      current_ml_global_canary_replay_best_display_candidate_id: String(autonomyCurrentStatus.ml_global_canary_replay_best_display_candidate_id || autonomySummary.ml_global_canary_replay_best_display_candidate_id || "").trim() || null,
      current_ml_global_canary_replay_best_candidate_review_mode: String(autonomyCurrentStatus.ml_global_canary_replay_best_candidate_review_mode || autonomySummary.ml_global_canary_replay_best_candidate_review_mode || "").trim() || null,
      current_ml_global_canary_replay_best_candidate_profile_target_n: toNum(autonomyCurrentStatus.ml_global_canary_replay_best_candidate_profile_target_n ?? autonomySummary.ml_global_canary_replay_best_candidate_profile_target_n),
      current_ml_global_canary_replay_best_candidate_top_return_drag_profile: String(autonomyCurrentStatus.ml_global_canary_replay_best_candidate_top_return_drag_profile || autonomySummary.ml_global_canary_replay_best_candidate_top_return_drag_profile || "").trim() || null,
      current_ml_global_canary_replay_best_candidate_top_return_drag_driver: String(autonomyCurrentStatus.ml_global_canary_replay_best_candidate_top_return_drag_driver || autonomySummary.ml_global_canary_replay_best_candidate_top_return_drag_driver || "").trim() || null,
      current_ml_global_canary_replay_best_candidate_top_mixed_profile: String(autonomyCurrentStatus.ml_global_canary_replay_best_candidate_top_mixed_profile || autonomySummary.ml_global_canary_replay_best_candidate_top_mixed_profile || "").trim() || null,
      current_ml_global_canary_replay_best_candidate_top_mixed_driver: String(autonomyCurrentStatus.ml_global_canary_replay_best_candidate_top_mixed_driver || autonomySummary.ml_global_canary_replay_best_candidate_top_mixed_driver || "").trim() || null,
      current_ml_global_canary_replay_sample_gap_status: String(autonomyCurrentStatus.ml_global_canary_replay_sample_gap_status || autonomySummary.ml_global_canary_replay_sample_gap_status || "").trim() || null,
      current_ml_global_canary_replay_sample_required_realized_n: toNum(autonomyCurrentStatus.ml_global_canary_replay_sample_required_realized_n ?? autonomySummary.ml_global_canary_replay_sample_required_realized_n),
      current_ml_global_canary_replay_sample_current_effective_realized_n: toNum(autonomyCurrentStatus.ml_global_canary_replay_sample_current_effective_realized_n ?? autonomySummary.ml_global_canary_replay_sample_current_effective_realized_n),
      current_ml_global_canary_replay_sample_gap_n: toNum(autonomyCurrentStatus.ml_global_canary_replay_sample_gap_n ?? autonomySummary.ml_global_canary_replay_sample_gap_n),
      current_ml_global_canary_replay_sample_dominant_dimension: String(autonomyCurrentStatus.ml_global_canary_replay_sample_dominant_dimension || autonomySummary.ml_global_canary_replay_sample_dominant_dimension || "").trim() || null,
      current_ml_global_canary_replay_projected_ready_if_sample_gap_closed: autonomyCurrentStatus.ml_global_canary_replay_projected_ready_if_sample_gap_closed === true || autonomySummary.ml_global_canary_replay_projected_ready_if_sample_gap_closed === true,
      current_ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed: String(autonomyCurrentStatus.ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed || autonomySummary.ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      current_ml_ev_replay_delta_diagnostics_status: String(autonomyCurrentStatus.ml_ev_replay_delta_diagnostics_status || autonomySummary.ml_ev_replay_delta_diagnostics_status || "").trim() || null,
      current_ml_ev_replay_delta_driver_class: String(autonomyCurrentStatus.ml_ev_replay_delta_driver_class || autonomySummary.ml_ev_replay_delta_driver_class || "").trim() || null,
      current_ml_ev_replay_delta_historical_applied_gap_role: String(autonomyCurrentStatus.ml_ev_replay_delta_historical_applied_gap_role || autonomySummary.ml_ev_replay_delta_historical_applied_gap_role || "").trim() || null,
      current_ml_ev_replay_delta_top_positive_market: String(autonomyCurrentStatus.ml_ev_replay_delta_top_positive_market || autonomySummary.ml_ev_replay_delta_top_positive_market || "").trim() || null,
      current_ml_ev_replay_delta_top_negative_market: String(autonomyCurrentStatus.ml_ev_replay_delta_top_negative_market || autonomySummary.ml_ev_replay_delta_top_negative_market || "").trim() || null,
      current_ml_ev_replay_market_contribution_status: String(autonomyCurrentStatus.ml_ev_replay_market_contribution_status || autonomySummary.ml_ev_replay_market_contribution_status || "").trim() || null,
      current_ml_ev_replay_market_dominant_drag_pattern: String(autonomyCurrentStatus.ml_ev_replay_market_dominant_drag_pattern || autonomySummary.ml_ev_replay_market_dominant_drag_pattern || "").trim() || null,
      current_ml_ev_replay_market_positive_objective_market_n: toNum(autonomyCurrentStatus.ml_ev_replay_market_positive_objective_market_n ?? autonomySummary.ml_ev_replay_market_positive_objective_market_n),
      current_ml_ev_replay_market_return_drag_market_n: toNum(autonomyCurrentStatus.ml_ev_replay_market_return_drag_market_n ?? autonomySummary.ml_ev_replay_market_return_drag_market_n),
      current_ml_ev_replay_market_positive_with_return_drag_market_n: toNum(autonomyCurrentStatus.ml_ev_replay_market_positive_with_return_drag_market_n ?? autonomySummary.ml_ev_replay_market_positive_with_return_drag_market_n),
      current_ml_ev_replay_market_top_positive_market: String(autonomyCurrentStatus.ml_ev_replay_market_top_positive_market || autonomySummary.ml_ev_replay_market_top_positive_market || "").trim() || null,
      current_ml_ev_replay_market_top_return_drag_market: String(autonomyCurrentStatus.ml_ev_replay_market_top_return_drag_market || autonomySummary.ml_ev_replay_market_top_return_drag_market || "").trim() || null,
      current_ml_ev_replay_market_top_mixed_market: String(autonomyCurrentStatus.ml_ev_replay_market_top_mixed_market || autonomySummary.ml_ev_replay_market_top_mixed_market || "").trim() || null,
      current_ml_ev_replay_profile_contribution_status: String(autonomyCurrentStatus.ml_ev_replay_profile_contribution_status || autonomySummary.ml_ev_replay_profile_contribution_status || "").trim() || null,
      current_ml_ev_replay_profile_evidence_status: String(autonomyCurrentStatus.ml_ev_replay_profile_evidence_status || autonomySummary.ml_ev_replay_profile_evidence_status || "").trim() || null,
      current_ml_ev_replay_profile_top_return_drag_market: String(autonomyCurrentStatus.ml_ev_replay_profile_top_return_drag_market || autonomySummary.ml_ev_replay_profile_top_return_drag_market || "").trim() || null,
      current_ml_ev_replay_profile_top_return_drag_profile: String(autonomyCurrentStatus.ml_ev_replay_profile_top_return_drag_profile || autonomySummary.ml_ev_replay_profile_top_return_drag_profile || "").trim() || null,
      current_ml_ev_replay_profile_top_return_drag_profile_rows_delta: toNum(autonomyCurrentStatus.ml_ev_replay_profile_top_return_drag_profile_rows_delta ?? autonomySummary.ml_ev_replay_profile_top_return_drag_profile_rows_delta),
      current_ml_ev_replay_profile_top_return_drag_profile_avg_ret_net_delta: toNum(autonomyCurrentStatus.ml_ev_replay_profile_top_return_drag_profile_avg_ret_net_delta ?? autonomySummary.ml_ev_replay_profile_top_return_drag_profile_avg_ret_net_delta),
      current_ml_ev_replay_profile_top_mixed_market: String(autonomyCurrentStatus.ml_ev_replay_profile_top_mixed_market || autonomySummary.ml_ev_replay_profile_top_mixed_market || "").trim() || null,
      current_ml_ev_replay_profile_top_mixed_profile: String(autonomyCurrentStatus.ml_ev_replay_profile_top_mixed_profile || autonomySummary.ml_ev_replay_profile_top_mixed_profile || "").trim() || null,
      current_ml_ev_replay_profile_top_mixed_profile_rows_delta: toNum(autonomyCurrentStatus.ml_ev_replay_profile_top_mixed_profile_rows_delta ?? autonomySummary.ml_ev_replay_profile_top_mixed_profile_rows_delta),
      current_ml_ev_replay_profile_top_mixed_profile_avg_ret_net_delta: toNum(autonomyCurrentStatus.ml_ev_replay_profile_top_mixed_profile_avg_ret_net_delta ?? autonomySummary.ml_ev_replay_profile_top_mixed_profile_avg_ret_net_delta),
      current_ml_ev_replay_stale_pos_diagnostics_status: String(autonomyCurrentStatus.ml_ev_replay_stale_pos_diagnostics_status || autonomySummary.ml_ev_replay_stale_pos_diagnostics_status || "").trim() || null,
      current_ml_ev_replay_stale_pos_evidence_status: String(autonomyCurrentStatus.ml_ev_replay_stale_pos_evidence_status || autonomySummary.ml_ev_replay_stale_pos_evidence_status || "").trim() || null,
      current_ml_ev_replay_stale_pos_top_return_drag_profile: String(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_return_drag_profile || autonomySummary.ml_ev_replay_stale_pos_top_return_drag_profile || "").trim() || null,
      current_ml_ev_replay_stale_pos_top_return_drag_avg_ev_lb: toNum(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_return_drag_avg_ev_lb ?? autonomySummary.ml_ev_replay_stale_pos_top_return_drag_avg_ev_lb),
      current_ml_ev_replay_stale_pos_top_return_drag_avg_delay_cost: toNum(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_return_drag_avg_delay_cost ?? autonomySummary.ml_ev_replay_stale_pos_top_return_drag_avg_delay_cost),
      current_ml_ev_replay_stale_pos_top_return_drag_avg_late_risk: toNum(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_return_drag_avg_late_risk ?? autonomySummary.ml_ev_replay_stale_pos_top_return_drag_avg_late_risk),
      current_ml_ev_replay_stale_pos_top_mixed_profile: String(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_mixed_profile || autonomySummary.ml_ev_replay_stale_pos_top_mixed_profile || "").trim() || null,
      current_ml_ev_replay_stale_pos_top_mixed_avg_ev_lb: toNum(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_mixed_avg_ev_lb ?? autonomySummary.ml_ev_replay_stale_pos_top_mixed_avg_ev_lb),
      current_ml_ev_replay_stale_pos_top_mixed_avg_delay_cost: toNum(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_mixed_avg_delay_cost ?? autonomySummary.ml_ev_replay_stale_pos_top_mixed_avg_delay_cost),
      current_ml_ev_replay_stale_pos_top_mixed_avg_late_risk: toNum(autonomyCurrentStatus.ml_ev_replay_stale_pos_top_mixed_avg_late_risk ?? autonomySummary.ml_ev_replay_stale_pos_top_mixed_avg_late_risk),
      current_ml_ev_profile_review_tracking_status: String(autonomyCurrentStatus.ml_ev_profile_review_tracking_status || autonomySummary.ml_ev_profile_review_tracking_status || "").trim() || null,
      current_ml_ev_profile_review_tracking_evidence_status: String(autonomyCurrentStatus.ml_ev_profile_review_tracking_evidence_status || autonomySummary.ml_ev_profile_review_tracking_evidence_status || "").trim() || null,
      current_ml_ev_profile_review_mode: String(autonomyCurrentStatus.ml_ev_profile_review_mode || autonomySummary.ml_ev_profile_review_mode || "").trim() || null,
      current_ml_ev_profile_review_target_n: toNum(autonomyCurrentStatus.ml_ev_profile_review_target_n ?? autonomySummary.ml_ev_profile_review_target_n),
      current_ml_ev_profile_review_split_ready: autonomyCurrentStatus.ml_ev_profile_review_split_ready === true || autonomySummary.ml_ev_profile_review_split_ready === true,
      current_ml_ev_profile_review_split_blocker: String(autonomyCurrentStatus.ml_ev_profile_review_split_blocker || autonomySummary.ml_ev_profile_review_split_blocker || "").trim() || null,
      current_ml_ev_profile_review_top_return_drag_profile: String(autonomyCurrentStatus.ml_ev_profile_review_top_return_drag_profile || autonomySummary.ml_ev_profile_review_top_return_drag_profile || "").trim() || null,
      current_ml_ev_profile_review_top_return_drag_driver: String(autonomyCurrentStatus.ml_ev_profile_review_top_return_drag_driver || autonomySummary.ml_ev_profile_review_top_return_drag_driver || "").trim() || null,
      current_ml_ev_profile_review_top_mixed_profile: String(autonomyCurrentStatus.ml_ev_profile_review_top_mixed_profile || autonomySummary.ml_ev_profile_review_top_mixed_profile || "").trim() || null,
      current_ml_ev_profile_review_top_mixed_driver: String(autonomyCurrentStatus.ml_ev_profile_review_top_mixed_driver || autonomySummary.ml_ev_profile_review_top_mixed_driver || "").trim() || null,
      current_ml_model_specific_canary_status: String(autonomySummary.ml_model_specific_canary_status || "").trim() || null,
      current_ml_model_specific_canary_binding_mode: String(autonomySummary.ml_model_specific_canary_binding_mode || "").trim() || null,
      current_ml_model_specific_canary_evidence_status: String(autonomySummary.ml_model_specific_canary_evidence_status || "").trim() || null,
      current_ml_model_specific_canary_ready: autonomySummary.ml_model_specific_canary_ready === true,
      current_ml_model_specific_canary_preferred_model_artifact_id: String(autonomySummary.ml_model_specific_canary_preferred_model_artifact_id || "").trim() || null,
      current_ml_model_specific_canary_preferred_train_run_id: String(autonomySummary.ml_model_specific_canary_preferred_train_run_id || "").trim() || null,
      current_ml_model_specific_canary_bound_model_artifact_id: String(autonomySummary.ml_model_specific_canary_bound_model_artifact_id || "").trim() || null,
      current_ml_model_specific_canary_bound_train_run_id: String(autonomySummary.ml_model_specific_canary_bound_train_run_id || "").trim() || null,
      current_ml_rollback_arm_status: String(autonomySummary.ml_rollback_arm_status || "").trim() || null,
      current_ml_rollback_arm_binding_source: String(autonomySummary.ml_rollback_arm_binding_source || "").trim() || null,
      current_ml_rollback_arm_evidence_status: String(autonomySummary.ml_rollback_arm_evidence_status || "").trim() || null,
      current_ml_rollback_arm_ready: autonomySummary.ml_rollback_arm_ready === true,
      current_ml_rollback_arm_target_path: String(autonomySummary.ml_rollback_arm_target_path || "").trim() || null,
      current_ml_rollback_arm_engine_bundle_id: String(autonomySummary.ml_rollback_arm_engine_bundle_id || "").trim() || null,
      current_ml_rollback_arm_trigger_status: String(autonomySummary.ml_rollback_arm_trigger_status || "").trim() || null,
      current_ml_model_contract_status: String(autonomySummary.ml_model_contract_status || "").trim() || null,
      current_ml_model_contract_deployment_stage: String(autonomySummary.ml_model_contract_deployment_stage || "").trim() || null,
      current_ml_model_contract_canary_gate_status: String(autonomySummary.ml_model_contract_canary_gate_status || "").trim() || null,
      current_ml_model_contract_promotion_status: String(autonomySummary.ml_model_contract_promotion_status || "").trim() || null,
      current_ml_model_contract_model_artifact_id: String(autonomySummary.ml_model_contract_model_artifact_id || "").trim() || null,
      current_ml_promotion_gate_status: String(autonomySummary.ml_promotion_gate_status || "").trim() || null,
      current_ml_promotion_stage: String(autonomySummary.ml_promotion_stage || "").trim() || null,
      current_ml_promotion_decision: String(autonomySummary.ml_promotion_decision || "").trim() || null,
      current_ml_promotion_global_canary_gate_status: String(autonomyCurrentStatus.ml_promotion_global_canary_gate_status || autonomySummary.ml_promotion_global_canary_gate_status || "").trim() || null,
      current_ml_promotion_global_canary_evidence_status: String(autonomyCurrentStatus.ml_promotion_global_canary_evidence_status || autonomySummary.ml_promotion_global_canary_evidence_status || "").trim() || null,
      current_ml_promotion_global_canary_dominant_blocker: String(autonomyCurrentStatus.ml_promotion_global_canary_dominant_blocker || autonomySummary.ml_promotion_global_canary_dominant_blocker || "").trim() || null,
      current_ml_promotion_global_canary_replay_evidence_status: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_evidence_status || autonomySummary.ml_promotion_global_canary_replay_evidence_status || "").trim() || null,
      current_ml_promotion_global_canary_replay_dominant_issue: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_dominant_issue || autonomySummary.ml_promotion_global_canary_replay_dominant_issue || "").trim() || null,
      current_ml_promotion_global_canary_replay_best_candidate_id: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_candidate_id || autonomySummary.ml_promotion_global_canary_replay_best_candidate_id || "").trim() || null,
      current_ml_promotion_global_canary_replay_best_display_candidate_id: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_display_candidate_id || autonomySummary.ml_promotion_global_canary_replay_best_display_candidate_id || "").trim() || null,
      current_ml_promotion_global_canary_replay_best_candidate_review_mode: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_candidate_review_mode || autonomySummary.ml_promotion_global_canary_replay_best_candidate_review_mode || "").trim() || null,
      current_ml_promotion_global_canary_replay_best_candidate_profile_target_n: toNum(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_candidate_profile_target_n ?? autonomySummary.ml_promotion_global_canary_replay_best_candidate_profile_target_n),
      current_ml_promotion_global_canary_replay_best_candidate_top_return_drag_profile: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_candidate_top_return_drag_profile || autonomySummary.ml_promotion_global_canary_replay_best_candidate_top_return_drag_profile || "").trim() || null,
      current_ml_promotion_global_canary_replay_best_candidate_top_return_drag_driver: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_candidate_top_return_drag_driver || autonomySummary.ml_promotion_global_canary_replay_best_candidate_top_return_drag_driver || "").trim() || null,
      current_ml_promotion_global_canary_replay_best_candidate_top_mixed_profile: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_candidate_top_mixed_profile || autonomySummary.ml_promotion_global_canary_replay_best_candidate_top_mixed_profile || "").trim() || null,
      current_ml_promotion_global_canary_replay_best_candidate_top_mixed_driver: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_best_candidate_top_mixed_driver || autonomySummary.ml_promotion_global_canary_replay_best_candidate_top_mixed_driver || "").trim() || null,
      current_ml_promotion_global_canary_replay_sample_gap_status: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_sample_gap_status || autonomySummary.ml_promotion_global_canary_replay_sample_gap_status || "").trim() || null,
      current_ml_promotion_global_canary_replay_sample_required_realized_n: toNum(autonomyCurrentStatus.ml_promotion_global_canary_replay_sample_required_realized_n ?? autonomySummary.ml_promotion_global_canary_replay_sample_required_realized_n),
      current_ml_promotion_global_canary_replay_sample_current_effective_realized_n: toNum(autonomyCurrentStatus.ml_promotion_global_canary_replay_sample_current_effective_realized_n ?? autonomySummary.ml_promotion_global_canary_replay_sample_current_effective_realized_n),
      current_ml_promotion_global_canary_replay_sample_gap_n: toNum(autonomyCurrentStatus.ml_promotion_global_canary_replay_sample_gap_n ?? autonomySummary.ml_promotion_global_canary_replay_sample_gap_n),
      current_ml_promotion_global_canary_replay_sample_dominant_dimension: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_sample_dominant_dimension || autonomySummary.ml_promotion_global_canary_replay_sample_dominant_dimension || "").trim() || null,
      current_ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed: autonomyCurrentStatus.ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed === true || autonomySummary.ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed === true,
      current_ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed: String(autonomyCurrentStatus.ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed || autonomySummary.ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      current_ml_promotion_model_specific_canary_gate_status: String(autonomySummary.ml_promotion_model_specific_canary_gate_status || "").trim() || null,
      current_ml_promotion_model_specific_canary_ready: autonomySummary.ml_promotion_model_specific_canary_ready === true,
      current_ml_promotion_model_specific_canary_binding_mode: String(autonomySummary.ml_promotion_model_specific_canary_binding_mode || "").trim() || null,
      current_ml_promotion_model_specific_canary_evidence_status: String(autonomySummary.ml_promotion_model_specific_canary_evidence_status || "").trim() || null,
      current_ml_promotion_rollback_gate_status: String(autonomySummary.ml_promotion_rollback_gate_status || "").trim() || null,
      current_ml_promotion_rollback_binding_source: String(autonomySummary.ml_promotion_rollback_binding_source || "").trim() || null,
      current_ml_promotion_rollback_evidence_status: String(autonomySummary.ml_promotion_rollback_evidence_status || "").trim() || null,
      current_ml_promotion_rollback_arm_ready: autonomySummary.ml_promotion_rollback_arm_ready === true,
      current_ml_promotion_preferred_model_family: String(autonomySummary.ml_promotion_preferred_model_family || "").trim() || null,
      current_ml_promotion_preferred_model_artifact_id: String(autonomySummary.ml_promotion_preferred_model_artifact_id || "").trim() || null,
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
      current_execution_quality_scope_fp_diagnostics_status: String(currentEntry.current_snapshot.execution_scope_fp_diagnostics_status || "").trim() || null,
      current_execution_quality_scope_fp_top_shared_feature: String(currentEntry.current_snapshot.execution_scope_fp_diagnostics_top_shared_feature || "").trim() || null,
      current_execution_quality_scope_fp_top_context_profile: String(currentEntry.current_snapshot.execution_scope_fp_diagnostics_top_context_profile || "").trim() || null,
      current_execution_quality_scope_fp_reference_rows_n: currentEntry.current_snapshot.execution_scope_fp_diagnostics_reference_rows_n,
      current_execution_quality_scope_test_early_macro_recall: currentEntry.current_snapshot.execution_scope_test_early_macro_recall,
      current_execution_quality_scope_test_core_macro_recall: currentEntry.current_snapshot.execution_scope_test_core_macro_recall,
      current_execution_quality_scope_tier_weaker_tier: String(currentEntry.current_snapshot.execution_scope_tier_weaker_tier || "").trim() || null,
      current_execution_quality_scope_tier_weaker_tier_by_mismatch: String(currentEntry.current_snapshot.execution_scope_tier_weaker_tier_by_mismatch || "").trim() || null,
      current_execution_quality_scope_tier_weaker_tier_by_macro_recall: String(currentEntry.current_snapshot.execution_scope_tier_weaker_tier_by_macro_recall || "").trim() || null,
      current_execution_quality_scope_tier_mismatch_rate_gap: currentEntry.current_snapshot.execution_scope_tier_mismatch_rate_gap,
      current_execution_quality_scope_tier_early_weakness_score: currentEntry.current_snapshot.execution_scope_tier_early_weakness_score,
      current_execution_quality_scope_tier_core_weakness_score: currentEntry.current_snapshot.execution_scope_tier_core_weakness_score,
      current_execution_quality_scope_tier_diagnostics_top_false_positive_group: String(currentEntry.current_snapshot.execution_scope_tier_diagnostics_top_false_positive_group || "").trim() || null,
      current_execution_quality_scope_tier_diagnostics_top_false_negative_group: String(currentEntry.current_snapshot.execution_scope_tier_diagnostics_top_false_negative_group || "").trim() || null,
      current_execution_quality_scope_tier_diagnostics_policy_blocked_top_source: String(currentEntry.current_snapshot.execution_scope_tier_diagnostics_policy_blocked_top_source || "").trim() || null,
      current_execution_quality_scope_tier_diagnostics_policy_blocked_top_no_fill_reason: String(currentEntry.current_snapshot.execution_scope_tier_diagnostics_policy_blocked_top_no_fill_reason || "").trim() || null,
      current_execution_quality_scope_tier_diagnostics_policy_blocked_lowest_coverage_feature: String(currentEntry.current_snapshot.execution_scope_tier_diagnostics_policy_blocked_lowest_coverage_feature || "").trim() || null,
      current_execution_quality_scope_tier_raw_diff_top_false_positive_group: String(currentEntry.current_snapshot.execution_scope_tier_raw_diff_top_false_positive_group || "").trim() || null,
      current_execution_quality_scope_tier_raw_diff_top_reason: String(currentEntry.current_snapshot.execution_scope_tier_raw_diff_top_reason || "").trim() || null,
      current_execution_quality_scope_tier_raw_diff_top_action: String(currentEntry.current_snapshot.execution_scope_tier_raw_diff_top_action || "").trim() || null,
      current_execution_quality_scope_tier_raw_diff_top_pos_state: String(currentEntry.current_snapshot.execution_scope_tier_raw_diff_top_pos_state || "").trim() || null,
      current_execution_quality_scope_tier_raw_diff_top_webhook_execution_profile: String(currentEntry.current_snapshot.execution_scope_tier_raw_diff_top_webhook_execution_profile || "").trim() || null,
      current_execution_quality_scope_tier_raw_diff_top_webhook_bar_timing_profile: String(currentEntry.current_snapshot.execution_scope_tier_raw_diff_top_webhook_bar_timing_profile || "").trim() || null,
      current_execution_quality_scope_tier_raw_diff_top_webhook_execution_profile_rows_n: toNum(currentEntry.current_snapshot.execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n),
      current_execution_quality_scope_tier_raw_diff_saved_no_probe_rows_n: toNum(currentEntry.current_snapshot.execution_scope_tier_raw_diff_saved_no_probe_rows_n),
      current_execution_quality_scope_tier_raw_diff_pre_bar_close_rows_n: toNum(currentEntry.current_snapshot.execution_scope_tier_raw_diff_pre_bar_close_rows_n),
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
