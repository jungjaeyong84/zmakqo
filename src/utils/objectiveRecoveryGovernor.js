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

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function extractObjectiveScore(value) {
  const summary = value && typeof value === "object" ? value : {};
  const nested = summary.global_objective_score && typeof summary.global_objective_score === "object"
    ? summary.global_objective_score
    : null;
  return toNum(summary.global_score)
    ?? toNum(summary.objective_score)
    ?? toNum(summary.global_objective_score)
    ?? toNum(nested && nested.objective_score);
}

function findCandidateRow(candidates = null, candidateId = null) {
  const rows = Array.isArray(candidates && candidates.rows) ? candidates.rows : [];
  const target = String(candidateId || "").trim();
  if (!target) return null;
  return rows.find((row) => String(row && (row.display_candidate_id || row.candidate_id) || "").trim() === target)
    || rows.find((row) => String(row && row.candidate_id || "").trim() === target)
    || null;
}

function findReplayRow(replay = null, candidateId = null) {
  const rows = Array.isArray(replay && replay.validations) ? replay.validations : [];
  const target = String(candidateId || "").trim();
  if (!target) return null;
  return rows.find((row) => String(row && row.candidate_id || "").trim() === target) || null;
}

function deriveMemoryBlockContext(memory = null, candidateId = null, candidateRow = null) {
  const memoryReport = unwrapRawReport(memory) || {};
  const memorySummary = readSummary(memoryReport);
  const currentRows = Array.isArray(memoryReport.current_rows) ? memoryReport.current_rows : [];
  const blockedIds = Array.isArray(memorySummary.blocked_candidate_ids)
    ? memorySummary.blocked_candidate_ids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const targetId = String(candidateId || "").trim();
  const targetMemoryRow = targetId
    ? (currentRows.find((row) => String(row && row.candidate_id || "").trim() === targetId) || null)
    : null;
  const targetBlocked = Boolean(
    (targetId && blockedIds.includes(targetId))
    || (candidateRow && candidateRow.memory_blocked === true)
    || (targetMemoryRow && targetMemoryRow.memory_blocked === true)
  );
  const unrelatedBlockedIds = blockedIds.filter((item) => item !== targetId);

  return {
    blocked_candidate_n: toNum(memorySummary.blocked_candidate_n) || 0,
    blocked_candidate_ids: blockedIds,
    target_blocked: targetBlocked,
    target_block_reason: String(
      (candidateRow && candidateRow.memory_block_reason)
      || (targetMemoryRow && targetMemoryRow.memory_block_reason)
      || ""
    ).trim() || null,
    target_previous_fail_week_key: String(targetMemoryRow && targetMemoryRow.previous_fail_week_key || "").trim() || null,
    target_previous_fail_age_weeks: toNum(targetMemoryRow && targetMemoryRow.previous_fail_age_weeks),
    unrelated_blocked_candidate_n: unrelatedBlockedIds.length,
    unrelated_blocked_candidate_ids: unrelatedBlockedIds,
  };
}

function buildNextActions({ status = null, candidateId = null, reason = null } = {}) {
  const actions = [];
  switch (status) {
    case "RECOVERY_TARGET_MEMORY_BLOCKED":
      actions.push(`Clear the recovery-target memory blocker for ${candidateId || "the recovery candidate"} before allowing degraded authority promotion.`);
      break;
    case "RECOVERY_REPLAY_BLOCKED":
      actions.push(`Resolve replay blockers for ${candidateId || "the recovery candidate"} before any promote path.`);
      break;
    case "RECOVERY_CANARY_BLOCKED":
      actions.push("Keep the candidate in canary until open-wave readiness closes.");
      break;
    case "RECOVERY_DEPLOYMENT_GUARDS_BLOCKED":
      actions.push("Clear deployment guard blockers before permitting degraded authority promotion.");
      break;
    case "OPENCLAW_OPS_BLOCKED":
      actions.push("Restore OpenClaw scheduler/watchdog health before relying on autonomous recovery.");
      break;
    case "RECOVERY_PROMOTION_READY":
      actions.push(`Promote ${candidateId || "the recovery candidate"} when degraded timeout policy conditions are satisfied.`);
      break;
    default:
      if (reason) actions.push(`Review governor blocker '${reason}' before the next cycle.`);
      break;
  }
  return actions;
}

function summarizeDropValidation(dropValidation = null) {
  const summary = readSummary(dropValidation);
  const recommendedActions = Array.isArray(summary.recommended_actions) ? summary.recommended_actions : [];
  const evRescueRow = recommendedActions.find((row) => toUpper(row && row.family) === "EV_POLICY") || null;
  return {
    status: toUpper(summary.status),
    top_rescue_family: toUpper(summary.top_rescue_family),
    top_rescue_reason: String(summary.top_rescue_reason || "").trim() || null,
    top_rescue_market: String(summary.top_rescue_market || "").trim() || null,
    top_rescue_avg_horizon_ret_net: toNum(summary.top_rescue_avg_horizon_ret_net),
    top_rescue_avg_horizon_pnl_quote_proxy: toNum(summary.top_rescue_avg_horizon_pnl_quote_proxy),
    top_rescue_net_horizon_pnl_quote_proxy_sum: toNum(summary.top_rescue_net_horizon_pnl_quote_proxy_sum),
    proxy_notional_quote: toNum(summary.proxy_notional_quote),
    top_rescue_tp1_first_rate: toNum(summary.top_rescue_tp1_first_rate),
    top_rescue_sl_first_rate: toNum(summary.top_rescue_sl_first_rate),
    ev_policy_action: toUpper(evRescueRow && evRescueRow.action),
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
  };
}

function summarizeExecutionQuality(executionQuality = null) {
  const summary = readSummary(executionQuality);
  return {
    status: toUpper(summary.status),
    created_to_fill_p95_ms: toNum(summary.created_to_fill_p95_ms),
    adverse_slippage_p95_bps: toNum(summary.adverse_slippage_p95_bps),
    partial_fill_rate_pct: toNum(summary.partial_fill_rate_pct),
    webhook_to_fill_p95_ms: toNum(summary.webhook_to_fill_p95_ms),
    top_latency_market: String(summary.top_latency_market || "").trim().toUpperCase() || null,
    top_slippage_market: String(summary.top_slippage_market || "").trim().toUpperCase() || null,
    top_partial_market: String(summary.top_partial_market || "").trim().toUpperCase() || null,
    review_reasons: Array.isArray(summary.review_reasons) ? summary.review_reasons : [],
    top_watch_markets: Array.isArray(summary.top_watch_markets) ? summary.top_watch_markets : [],
  };
}

function deriveObjectiveRecoveryGovernor({
  autonomyContract = null,
  objective = null,
  objectiveSupervisor = null,
  candidates = null,
  replay = null,
  canary = null,
  deploymentGuards = null,
  memory = null,
  serverPrimaryAcceptanceWatch = null,
  watchdog = null,
  dropValidation = null,
  executionQuality = null,
} = {}) {
  const contract = unwrapRawReport(autonomyContract) || {};
  const contractStatus = contract.current_status && typeof contract.current_status === "object" ? contract.current_status : {};
  const degradedPolicy = contract.authority_policy && contract.authority_policy.degraded_timeout_policy && typeof contract.authority_policy.degraded_timeout_policy === "object"
    ? contract.authority_policy.degraded_timeout_policy
    : {};
  const objectiveSummary = readSummary(objective);
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const promotion = supervisor.promotion && typeof supervisor.promotion === "object" ? supervisor.promotion : {};
  const candidateReport = unwrapRawReport(candidates) || {};
  const candidateSummary = readSummary(candidateReport);
  const replayReport = unwrapRawReport(replay) || {};
  const replaySummary = readSummary(replayReport);
  const canarySummary = readSummary(canary);
  const deploymentGuardsSummary = readSummary(deploymentGuards);
  const acceptanceSummary = readSummary(serverPrimaryAcceptanceWatch);
  const watchdogSummary = readSummary(watchdog);
  const dropValidationSummary = summarizeDropValidation(dropValidation);
  const executionQualitySummary = summarizeExecutionQuality(executionQuality);

  const targetCandidateId = String(
    promotion.display_candidate_id
    || promotion.candidate_id
    || candidateSummary.top_candidate_id
    || replaySummary.best_candidate_id
    || ""
  ).trim() || null;
  const candidateRow = findCandidateRow(candidateReport, targetCandidateId);
  const replayRow = findReplayRow(replayReport, targetCandidateId);
  const memoryContext = deriveMemoryBlockContext(memory, targetCandidateId, candidateRow);
  const objectiveScore = toNum(contractStatus.objective_score) ?? extractObjectiveScore(objectiveSummary);
  const recoveryRequired = contractStatus.recovery_required === true || (objectiveScore != null && objectiveScore < 0);
  const replayPass = String(
    promotion.replay_verdict
    || (replayRow && replayRow.validation_verdict)
    || replaySummary.best_verdict
    || ""
  ).trim().toUpperCase() === "PASS";
  const canaryReady = canarySummary.apply_pass === true && (toNum(canarySummary.ready_n) || 0) > 0;
  const deploymentPass = deploymentGuardsSummary.deploy_pass === true;
  const targetMemoryBlocked = memoryContext.target_blocked === true;
  const watchdogPass = toUpper(watchdogSummary.verdict || watchdogSummary.status || watchdogSummary.summary_verdict) === "PASS";
  const targetDeployUnit = toUpper(candidateRow && candidateRow.target_deploy_unit);
  const targetDeployUnitAllowed = Array.isArray(degradedPolicy.allow_target_deploy_units) && degradedPolicy.allow_target_deploy_units.length
    ? degradedPolicy.allow_target_deploy_units.includes(targetDeployUnit)
    : true;

  let governorStatus = "OBJECTIVE_ON_TRACK";
  let governorReason = "OBJECTIVE_ON_TRACK";
  if (recoveryRequired) {
    if (!targetCandidateId) {
      governorStatus = "NO_RECOVERY_CANDIDATE";
      governorReason = "NO_RECOVERY_CANDIDATE";
    } else if (!replayPass && degradedPolicy.require_replay_pass !== false) {
      governorStatus = "RECOVERY_REPLAY_BLOCKED";
      governorReason = "RECOVERY_REPLAY_BLOCKED";
    } else if (!canaryReady && degradedPolicy.require_canary_ready !== false) {
      governorStatus = "RECOVERY_CANARY_BLOCKED";
      governorReason = "RECOVERY_CANARY_BLOCKED";
    } else if (!deploymentPass && degradedPolicy.require_deployment_guards_pass !== false) {
      governorStatus = "RECOVERY_DEPLOYMENT_GUARDS_BLOCKED";
      governorReason = "RECOVERY_DEPLOYMENT_GUARDS_BLOCKED";
    } else if (!watchdogPass && degradedPolicy.require_openclaw_ops_healthy !== false) {
      governorStatus = "OPENCLAW_OPS_BLOCKED";
      governorReason = "OPENCLAW_OPS_BLOCKED";
    } else if (targetMemoryBlocked && degradedPolicy.require_memory_clear !== false) {
      governorStatus = "RECOVERY_TARGET_MEMORY_BLOCKED";
      governorReason = memoryContext.target_block_reason
        ? `RECOVERY_TARGET_MEMORY_BLOCKED:${memoryContext.target_block_reason}`
        : "RECOVERY_TARGET_MEMORY_BLOCKED";
    } else if (!targetDeployUnitAllowed) {
      governorStatus = "DEGRADED_AUTHORITY_TARGET_UNIT_BLOCKED";
      governorReason = `TARGET_UNIT_BLOCKED:${targetDeployUnit || "N/A"}`;
    } else {
      governorStatus = "RECOVERY_PROMOTION_READY";
      governorReason = "BOUNDED_TIMEOUT_RECOVERY_PROMOTION_READY";
    }
  }

  return {
    summary: {
      contract_goal_state: String(contract.summary && contract.summary.goal_state || "").trim().toUpperCase() || null,
      recovery_required: recoveryRequired,
      objective_score: objectiveScore,
      target_candidate_id: targetCandidateId,
      display_candidate_id: String(promotion.display_candidate_id || targetCandidateId || "").trim() || null,
      target_deploy_unit: targetDeployUnit,
      target_migration_class: toUpper(candidateRow && candidateRow.canonical_migration_class),
      replay_pass: replayPass,
      canary_ready: canaryReady,
      deployment_guards_pass: deploymentPass,
      memory_blocked: targetMemoryBlocked,
      memory_blocked_candidate_n: memoryContext.blocked_candidate_n,
      memory_blocked_candidate_ids: memoryContext.blocked_candidate_ids,
      target_memory_blocked: targetMemoryBlocked,
      target_memory_block_reason: memoryContext.target_block_reason,
      target_memory_previous_fail_week_key: memoryContext.target_previous_fail_week_key,
      target_memory_previous_fail_age_weeks: memoryContext.target_previous_fail_age_weeks,
      unrelated_memory_blocked_candidate_n: memoryContext.unrelated_blocked_candidate_n,
      unrelated_memory_blocked_candidate_ids: memoryContext.unrelated_blocked_candidate_ids,
      openclaw_ops_healthy: watchdogPass,
      drop_validation_status: dropValidationSummary.status,
      drop_validation_top_rescue_family: dropValidationSummary.top_rescue_family,
      drop_validation_top_rescue_reason: dropValidationSummary.top_rescue_reason,
      drop_validation_top_rescue_market: dropValidationSummary.top_rescue_market,
      drop_validation_top_rescue_avg_horizon_ret_net: dropValidationSummary.top_rescue_avg_horizon_ret_net,
      drop_validation_top_rescue_avg_horizon_pnl_quote_proxy: dropValidationSummary.top_rescue_avg_horizon_pnl_quote_proxy,
      drop_validation_top_rescue_tp1_first_rate: dropValidationSummary.top_rescue_tp1_first_rate,
      drop_validation_top_rescue_sl_first_rate: dropValidationSummary.top_rescue_sl_first_rate,
      drop_validation_ev_policy_action: dropValidationSummary.ev_policy_action,
      execution_quality_status: executionQualitySummary.status,
      execution_quality_created_to_fill_p95_ms: executionQualitySummary.created_to_fill_p95_ms,
      execution_quality_adverse_slippage_p95_bps: executionQualitySummary.adverse_slippage_p95_bps,
      execution_quality_partial_fill_rate_pct: executionQualitySummary.partial_fill_rate_pct,
      execution_quality_top_latency_market: executionQualitySummary.top_latency_market,
      execution_quality_top_slippage_market: executionQualitySummary.top_slippage_market,
      execution_quality_top_partial_market: executionQualitySummary.top_partial_market,
      execution_quality_review_reasons: executionQualitySummary.review_reasons,
      phase_d_status: String(acceptanceSummary.phase_d_status || "").trim().toUpperCase() || null,
      phase_d_ready: acceptanceSummary.phase_d_ready === true,
      governor_status: governorStatus,
      governor_reason: governorReason,
      degraded_authority_enabled: degradedPolicy.enabled === true,
      degraded_authority_eligible: degradedPolicy.enabled === true && governorStatus === "RECOVERY_PROMOTION_READY",
      degraded_authority_reason: degradedPolicy.enabled === true && governorStatus === "RECOVERY_PROMOTION_READY"
        ? governorReason
        : governorStatus,
      next_actions: [
        ...buildNextActions({ status: governorStatus, candidateId: targetCandidateId, reason: governorReason }),
        ...(recoveryRequired
          && dropValidationSummary.top_rescue_family === "EV_POLICY"
          && dropValidationSummary.ev_policy_action === "RELAX_EV_POLICY_REVIEW"
          ? [
            `Use drop-validation rescue evidence to relax EV policy first (${dropValidationSummary.top_rescue_reason || "EV_POLICY"} / ${dropValidationSummary.top_rescue_market || "N/A"} / avg_ret ${dropValidationSummary.top_rescue_avg_horizon_ret_net != null ? dropValidationSummary.top_rescue_avg_horizon_ret_net : "N/A"} / avg_pnl_proxy ${dropValidationSummary.top_rescue_avg_horizon_pnl_quote_proxy != null ? dropValidationSummary.top_rescue_avg_horizon_pnl_quote_proxy : "N/A"}).`,
          ]
          : []),
        ...(recoveryRequired
          && executionQualitySummary.status === "EXECUTION_QUALITY_REVIEW"
          ? [
            `Before broad recovery promotion, review execution quality (${executionQualitySummary.top_latency_market || executionQualitySummary.top_slippage_market || executionQualitySummary.top_partial_market || "N/A"} / latency_p95 ${executionQualitySummary.created_to_fill_p95_ms != null ? executionQualitySummary.created_to_fill_p95_ms : "N/A"} / slippage_p95 ${executionQualitySummary.adverse_slippage_p95_bps != null ? executionQualitySummary.adverse_slippage_p95_bps : "N/A"} / partial ${executionQualitySummary.partial_fill_rate_pct != null ? executionQualitySummary.partial_fill_rate_pct : "N/A"}).`,
          ]
          : []),
        ...dropValidationSummary.next_actions,
      ],
    },
  };
}

module.exports = {
  deriveObjectiveRecoveryGovernor,
};
