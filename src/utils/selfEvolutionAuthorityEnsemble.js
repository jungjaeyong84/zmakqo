"use strict";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeReview(input = null, fallbackOwner = "CODEX") {
  const raw = unwrapRawReport(input) || {};
  return {
    available: !!input,
    owner: String(raw.owner || raw.authority_owner || fallbackOwner).trim() || fallbackOwner,
    status: String(raw.status || "N/A").trim().toUpperCase() || "N/A",
    verdict: String(raw.verdict || "HOLD").trim().toUpperCase() || "HOLD",
    recommended_candidate_id: String(raw.recommended_candidate_id || "").trim() || null,
    display_candidate_id: String(raw.display_candidate_id || "").trim() || null,
    recommended_rollback_file_path: String(raw.recommended_rollback_file_path || "").trim() || null,
    confidence: toNum(raw.confidence),
    reason: String(raw.reason || raw.summary || "N/A").trim() || "N/A",
    summary: String(raw.summary || raw.reason || "N/A").trim() || "N/A",
    checks: Array.isArray(raw.checks) ? raw.checks.map((row) => String(row || "").trim()).filter(Boolean) : [],
    risks: Array.isArray(raw.risks) ? raw.risks.map((row) => String(row || "").trim()).filter(Boolean) : [],
    review_unit: String(raw.review_unit || "").trim() || null,
    source_mode_change: String(raw.source_mode_change || "").trim() || null,
    canonical_threshold_signature: String(raw.canonical_threshold_signature || "").trim() || null,
    cycle_id: String(raw.cycle_id || raw.generation_id || "").trim() || null,
    fresh: input && input.fresh === true
      ? true
      : (raw.fresh === true || String(raw.status || "").trim().toUpperCase() === "FRESH"),
  };
}

function isTimeoutHoldReview(review = null) {
  const normalized = review && review.owner ? review : normalizeReview(review);
  const status = String(normalized.status || "").trim().toUpperCase();
  const reason = String(normalized.reason || "").trim().toUpperCase();
  return normalized.verdict === "HOLD" && (status.includes("TIMEOUT") || reason.includes("TIMEOUT"));
}

function deriveDegradedAuthorityDecision({
  codex = null,
  claude = null,
  autonomyContract = null,
  recoveryGovernor = null,
  timeoutContext = null,
} = {}) {
  const contract = unwrapRawReport(autonomyContract) || {};
  const governor = unwrapRawReport(recoveryGovernor) || {};
  const governorSummary = governor.summary && typeof governor.summary === "object" ? governor.summary : governor;
  const policy = contract.authority_policy && contract.authority_policy.degraded_timeout_policy && typeof contract.authority_policy.degraded_timeout_policy === "object"
    ? contract.authority_policy.degraded_timeout_policy
    : {};
  const enabled = policy.enabled === true;
  const timeoutStreakMin = Math.max(
    0,
    toNum(timeoutContext && timeoutContext.ensemble_timeout_streak) || 0,
    Math.min(
      toNum(timeoutContext && timeoutContext.codex_timeout_streak) || 0,
      toNum(timeoutContext && timeoutContext.claude_timeout_streak) || 0
    )
  );
  const targetCandidateId = String(governorSummary.target_candidate_id || governorSummary.display_candidate_id || "").trim() || null;
  const targetDeployUnit = String(governorSummary.target_deploy_unit || "").trim().toUpperCase() || null;
  const allowedUnits = Array.isArray(policy.allow_target_deploy_units) ? policy.allow_target_deploy_units : [];
  const targetAllowed = !allowedUnits.length || allowedUnits.includes(targetDeployUnit);
  const governorEligible = governorSummary.degraded_authority_eligible === true;
  const bothTimeoutHold = isTimeoutHoldReview(codex) && isTimeoutHoldReview(claude);
  const minTimeoutStreak = Math.max(1, toNum(policy.min_timeout_streak) || 1);

  let eligible = false;
  let reason = "DEGRADED_AUTHORITY_DISABLED";
  if (!enabled) {
    reason = "DEGRADED_AUTHORITY_DISABLED";
  } else if (!bothTimeoutHold) {
    reason = "DEGRADED_TIMEOUT_CONSENSUS_NOT_PRESENT";
  } else if (timeoutStreakMin < minTimeoutStreak) {
    reason = "DEGRADED_TIMEOUT_STREAK_SHORT";
  } else if (!governorEligible) {
    reason = String(governorSummary.governor_reason || governorSummary.governor_status || "DEGRADED_GOVERNOR_NOT_READY").trim().toUpperCase() || "DEGRADED_GOVERNOR_NOT_READY";
  } else if (!targetCandidateId) {
    reason = "DEGRADED_TARGET_CANDIDATE_MISSING";
  } else if (!targetAllowed) {
    reason = `DEGRADED_TARGET_UNIT_BLOCKED:${targetDeployUnit || "N/A"}`;
  } else {
    eligible = true;
    reason = "DEGRADED_TIMEOUT_RECOVERY_PROMOTION_READY";
  }

  return {
    enabled,
    eligible,
    applied: eligible,
    reason,
    timeout_streak_min: timeoutStreakMin,
    min_timeout_streak: minTimeoutStreak,
    target_candidate_id: targetCandidateId,
    target_deploy_unit: targetDeployUnit,
    confidence_floor: toNum(policy.confidence_floor) || 0.35,
    governor_status: String(governorSummary.governor_status || "").trim().toUpperCase() || null,
  };
}

function deriveAuthorityEnsemble({
  codexReview = null,
  claudeReview = null,
  authorityMode = "CODEX_CLAUDE_ENSEMBLE",
  autonomyContract = null,
  recoveryGovernor = null,
  timeoutContext = null,
} = {}) {
  const mode = String(authorityMode || "CODEX_CLAUDE_ENSEMBLE").trim().toUpperCase() || "CODEX_CLAUDE_ENSEMBLE";
  const codex = normalizeReview(codexReview, "CODEX");
  const claude = normalizeReview(claudeReview, "CLAUDE");
  const checks = [];
  const risks = [];
  const blockers = [];

  checks.push(`mode=${mode}`);
  checks.push(`codex=${codex.status}/${codex.verdict}/${codex.recommended_candidate_id || codex.recommended_rollback_file_path || "N/A"}`);
  checks.push(`claude=${claude.status}/${claude.verdict}/${claude.recommended_candidate_id || claude.recommended_rollback_file_path || "N/A"}`);
  const degradedDecision = deriveDegradedAuthorityDecision({
    codex,
    claude,
    autonomyContract,
    recoveryGovernor,
    timeoutContext,
  });
  checks.push(`timeout_streak_min=${degradedDecision.timeout_streak_min}`);
  checks.push(`degraded_authority=${degradedDecision.enabled ? (degradedDecision.eligible ? "READY" : degradedDecision.reason) : "DISABLED"}`);

  let owner = "CODEX";
  let status = codex.status;
  let verdict = codex.verdict;
  let reason = codex.reason;
  let summary = codex.summary;
  let recommendedCandidateId = codex.recommended_candidate_id;
  let displayCandidateId = codex.display_candidate_id || codex.recommended_candidate_id;
  let recommendedRollbackFilePath = codex.recommended_rollback_file_path;
  let confidence = codex.confidence;
  let consensus = false;

  if (mode === "CODEX_ONLY") {
    owner = "CODEX";
  } else {
    owner = "CODEX_CLAUDE_ENSEMBLE";
    const codexFresh = codex.fresh === true;
    const claudeFresh = claude.fresh === true;
    status = codexFresh && claudeFresh ? "FRESH" : (codexFresh || claudeFresh ? "DEGRADED" : "STALE");
    if (!codexFresh) blockers.push("CODEX_REVIEW_REQUIRED");
    if (!claudeFresh) blockers.push("CLAUDE_REVIEW_REQUIRED");

    if (codexFresh && claudeFresh) {
      const sameVerdict = codex.verdict === claude.verdict;
      const sameCandidate = codex.recommended_candidate_id === claude.recommended_candidate_id;
      const sameRollback = codex.recommended_rollback_file_path === claude.recommended_rollback_file_path;
      consensus = sameVerdict && (
        codex.verdict === "HOLD"
        || (codex.verdict === "PROMOTE" && sameCandidate)
        || (codex.verdict === "ROLLBACK" && sameRollback)
      );

      if (consensus) {
        if (degradedDecision.applied) {
          verdict = "PROMOTE";
          recommendedCandidateId = degradedDecision.target_candidate_id;
          displayCandidateId = degradedDecision.target_candidate_id;
          recommendedRollbackFilePath = null;
          confidence = Math.max(
            degradedDecision.confidence_floor,
            Math.min(toNum(codex.confidence) || 0, toNum(claude.confidence) || 0)
          );
          reason = `DEGRADED_TIMEOUT_PROMOTE:${degradedDecision.reason}`;
          summary = "외부 권위 timeout이 반복되어 bounded degraded authority policy로 recovery candidate를 승격했습니다.";
          risks.push("Degraded authority policy promoted a bounded recovery candidate after repeated timeout holds.");
        } else {
          verdict = codex.verdict;
          recommendedCandidateId = codex.recommended_candidate_id || claude.recommended_candidate_id;
          displayCandidateId = codex.display_candidate_id || claude.display_candidate_id || recommendedCandidateId;
          recommendedRollbackFilePath = codex.recommended_rollback_file_path || claude.recommended_rollback_file_path;
          confidence = toNum(((toNum(codex.confidence) || 0) + (toNum(claude.confidence) || 0)) / 2);
          reason = `CONSENSUS_${verdict}:${codex.reason}`;
          summary = `Codex와 Claude가 ${verdict}에 합의했습니다.`;
          if (isTimeoutHoldReview(codex) && isTimeoutHoldReview(claude) && degradedDecision.enabled) {
            blockers.push(degradedDecision.reason);
          }
        }
      } else {
        verdict = "HOLD";
        recommendedCandidateId = null;
        displayCandidateId = null;
        recommendedRollbackFilePath = null;
        confidence = Math.min(toNum(codex.confidence) || 0, toNum(claude.confidence) || 0);
        reason = "AUTHORITY_DISAGREEMENT";
        summary = "Codex와 Claude 권위 판단이 불일치하여 HOLD 처리했습니다.";
        blockers.push("AUTHORITY_DISAGREEMENT");
        risks.push(`codex=${codex.verdict}/${codex.recommended_candidate_id || codex.recommended_rollback_file_path || "N/A"}`);
        risks.push(`claude=${claude.verdict}/${claude.recommended_candidate_id || claude.recommended_rollback_file_path || "N/A"}`);
      }
    } else {
      verdict = "HOLD";
      recommendedCandidateId = null;
      displayCandidateId = null;
      recommendedRollbackFilePath = null;
      confidence = null;
      reason = blockers[0] || "EXTERNAL_AUTHORITY_REQUIRED";
      summary = "Codex와 Claude 외부 권위가 모두 최신 합의 상태가 아니어서 HOLD 처리했습니다.";
    }
  }

  return {
    owner,
    authority_mode: mode,
    status,
    verdict,
    recommended_candidate_id: recommendedCandidateId,
    display_candidate_id: displayCandidateId,
    recommended_rollback_file_path: recommendedRollbackFilePath,
    confidence,
    reason,
    summary,
    checks,
    risks,
    blockers: Array.from(new Set(blockers)),
    consensus,
    degraded_authority_enabled: degradedDecision.enabled,
    degraded_authority_eligible: degradedDecision.eligible,
    degraded_authority_applied: degradedDecision.applied,
    degraded_authority_reason: degradedDecision.reason,
    timeout_streak_min: degradedDecision.timeout_streak_min,
    timeout_context: timeoutContext || null,
    review_unit: codex.review_unit || claude.review_unit || null,
    source_mode_change: codex.source_mode_change || claude.source_mode_change || null,
    canonical_threshold_signature: codex.canonical_threshold_signature || claude.canonical_threshold_signature || null,
    codex_review: codex,
    claude_review: claude,
    cycle_id: codex.cycle_id || claude.cycle_id || null,
  };
}

module.exports = {
  unwrapRawReport,
  normalizeReview,
  isTimeoutHoldReview,
  deriveAuthorityEnsemble,
};
