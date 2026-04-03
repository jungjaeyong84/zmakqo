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

function deriveDominantIssue({ objectiveSupervisor = null, autonomyContract = null, quality = null, cutover = null } = {}) {
  const objective = unwrapRawReport(objectiveSupervisor) || {};
  const autonomy = readSummary(autonomyContract);
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
      secondary_issue: toUpper(autonomy.authority_state),
    };
  }
  if (toUpper(autonomy.authority_state)) {
    return {
      dominant_issue: `AUTHORITY_${toUpper(autonomy.authority_state)}`,
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
  const authorityState = toUpper(autonomySummary.authority_state);

  if (dominantFamily === "EV_POLICY") {
    return {
      metric: "ev_policy_post_apply_comparable_n",
      expected: `>= ${toNum(cutoverSummary.ev_policy_remediation_min_post_samples) || 3}`,
      deadline_hint: "NEXT_24H",
    };
  }
  if (dominantFamily === "OTHER_SERVER_POLICY") {
    return {
      metric: "other_server_policy_mismatch_n",
      expected: "< current",
      deadline_hint: "NEXT_24H",
    };
  }
  if (authorityState === "PENDING") {
    return {
      metric: "authority_state",
      expected: "toward READY with parity evidence",
      deadline_hint: "NEXT_24H_TO_48H",
    };
  }
  return {
    metric: "final_downstream_mismatch_n",
    expected: `< ${toNum(qualitySummary.final_downstream_mismatch_n) || "current"}`,
    deadline_hint: "NEXT_24H",
  };
}

function deriveHypothesis({ dominantIssue = null, dominantIssueSource = null, recommendedAction = null, autonomyContract = null } = {}) {
  const authorityState = toUpper(readSummary(autonomyContract).authority_state);
  if (dominantIssue === "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK") {
    return "Ops substrate is healthy, but autonomous recovery remains blocked by external authority hold.";
  }
  if (dominantIssue === "EV_POLICY") {
    return "EV policy remains the dominant downstream mismatch family; keep remediation under observation until comparable post-apply samples accumulate.";
  }
  if (dominantIssue === "OTHER_SERVER_POLICY") {
    return "Other server policy mismatches remain localized and should be judged on fresh evidence before reapplying market-specific blocks.";
  }
  if (authorityState === "PENDING") {
    return `Authority is still ${authorityState}; recommendation ${recommendedAction || "MONITOR_ONLY"} must accumulate evidence before READY.`;
  }
  return `Current dominant issue is ${dominantIssueSource || "UNKNOWN"}:${dominantIssue || "UNKNOWN"}; continue ${recommendedAction || "MONITOR_ONLY"} while gathering fresh evidence.`;
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
    return `${idx + 1}) ${row.cycle_id || "N/A"} issue=${row.dominant_issue || "UNKNOWN"} action=${row.recommended_action || "MONITOR_ONLY"} pending=${pending}`;
  }).join(" | ");
}

function buildReasoningJournal({
  cycleId = null,
  nowKst = null,
  objectiveSupervisor = null,
  autonomyContract = null,
  quality = null,
  cutover = null,
  policyPlan = null,
  previousJournal = null,
} = {}) {
  const objective = unwrapRawReport(objectiveSupervisor) || {};
  const autonomySummary = readSummary(autonomyContract);
  const qualitySummary = readSummary(quality);
  const cutoverSummary = readSummary(cutover);
  const policySummary = readSummary(policyPlan);
  const issue = deriveDominantIssue({ objectiveSupervisor, autonomyContract, quality, cutover });
  const recommendedAction = deriveRecommendedAction({ quality, cutover, policyPlan });
  const pendingVerification = derivePendingVerification({ cutover, quality, autonomyContract });
  const hypothesis = deriveHypothesis({
    dominantIssue: issue.dominant_issue,
    dominantIssueSource: issue.dominant_issue_source,
    recommendedAction,
    autonomyContract,
  });

  const currentEntry = {
    cycle_id: cycleId || null,
    generated_at_kst: nowKst || null,
    objective_verdict: String(objective.verdict || "").trim() || null,
    objective_root_cause: String(objective.root_cause || "").trim() || null,
    authority_state: toUpper(autonomySummary.authority_state),
    dominant_issue: issue.dominant_issue,
    dominant_issue_source: issue.dominant_issue_source,
    secondary_issue: issue.secondary_issue,
    recommended_action: recommendedAction,
    hypothesis,
    pending_verification: pendingVerification,
    current_snapshot: {
      quality_status: String(qualitySummary.quality_status || "").trim() || null,
      final_downstream_mismatch_n: toNum(qualitySummary.final_downstream_mismatch_n),
      parity_mismatch_n: toNum(qualitySummary.parity_mismatch_n),
      cutover_status: String(cutoverSummary.readiness_status || "").trim() || null,
      cutover_blocker_n: toNum(cutoverSummary.blocker_n),
      policy_plan_status: String(policySummary.status || "").trim() || null,
    },
  };

  const previousEntries = Array.isArray(previousJournal && previousJournal.entries) ? previousJournal.entries : [];
  const deduped = [currentEntry, ...previousEntries.filter((row) => String(row && row.cycle_id || "") !== String(cycleId || ""))].slice(0, 12);
  const contradiction_n = countContradictions(deduped);
  const compacted_context = buildCompactedContext(deduped);

  return {
    summary: {
      latest_cycle_id: cycleId || null,
      entry_n: deduped.length,
      contradiction_n,
      current_objective_verdict: currentEntry.objective_verdict,
      current_authority_state: currentEntry.authority_state,
      current_dominant_issue: currentEntry.dominant_issue,
      current_dominant_issue_source: currentEntry.dominant_issue_source,
      current_recommended_action: currentEntry.recommended_action,
      pending_verification_n: deduped.filter((row) => row && row.pending_verification && row.pending_verification.metric).length,
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
    deriveDominantIssue,
    deriveRecommendedAction,
    derivePendingVerification,
  },
};
