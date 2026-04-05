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

function findBestReadyReplayCandidateId(replay = null, candidates = null) {
  const rows = Array.isArray(replay && replay.validations) ? replay.validations : [];
  const ranked = rows
    .map((row) => {
      const candidateId = String(row && row.candidate_id || "").trim() || null;
      const candidateRow = findCandidateRow(candidates, candidateId);
      return {
        candidate_id: candidateId,
        verdict: toUpper(row && row.validation_verdict),
        delta: toNum(row && row.candidate_objective_delta),
        ready: isReadyCandidate(candidateRow),
      };
    })
    .filter((row) => row.candidate_id && row.verdict === "PASS" && row.ready)
    .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  return ranked.length ? ranked[0].candidate_id : null;
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

function buildNextActions({ status = null, candidateId = null, candidateDisplayId = null, reason = null } = {}) {
  const actions = [];
  const target = candidateDisplayId || candidateId || "the recovery candidate";
  switch (status) {
    case "RECOVERY_TARGET_MEMORY_BLOCKED":
      actions.push(`Clear the recovery-target memory blocker for ${target} before allowing degraded authority promotion.`);
      break;
    case "RECOVERY_REPLAY_BLOCKED":
      actions.push(`Resolve replay blockers for ${target} before any promote path.`);
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
      actions.push(`Promote ${target} when degraded timeout policy conditions are satisfied.`);
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

function summarizeReversePolicy(reversePolicy = null) {
  const summary = readSummary(reversePolicy);
  return {
    status: toUpper(summary.status),
    reverse_drop_n: toNum(summary.reverse_drop_n) || 0,
    reverse_revive_n: toNum(summary.reverse_revive_n) || 0,
    reverse_revive_rate: toNum(summary.reverse_revive_rate),
    top_watch_market: String(summary.top_watch_market || "").trim().toUpperCase() || null,
    top_watch_reason: String(summary.top_watch_reason || "").trim().toUpperCase() || null,
    top_watch_action: String(summary.top_watch_action || "").trim().toUpperCase() || null,
    top_watch_markets: Array.isArray(summary.top_watch_markets) ? summary.top_watch_markets : [],
  };
}

function summarizeExplorationBudget(explorationBudget = null) {
  const summary = readSummary(explorationBudget);
  return {
    status: toUpper(summary.status),
    production_slot_n: toNum(summary.production_slot_n) || 0,
    exploration_slot_n: toNum(summary.exploration_slot_n) || 0,
    production_markets: Array.isArray(summary.production_markets) ? summary.production_markets : [],
    exploration_markets: Array.isArray(summary.exploration_markets) ? summary.exploration_markets : [],
    deferred_penalty_markets: Array.isArray(summary.deferred_penalty_markets) ? summary.deferred_penalty_markets : [],
    top_production_market: String(summary.top_production_market || "").trim().toUpperCase() || null,
    top_exploration_market: String(summary.top_exploration_market || "").trim().toUpperCase() || null,
  };
}

function summarizeExplorationProposal(explorationProposal = null) {
  const summary = readSummary(explorationProposal);
  return {
    status: toUpper(summary.status),
    proposal_n: toNum(summary.proposal_n) || 0,
    top_market: String(summary.top_market || "").trim().toUpperCase() || null,
    top_stage: String(summary.top_stage || "").trim().toUpperCase() || null,
    top_action: String(summary.top_action || "").trim().toUpperCase() || null,
    proposals: Array.isArray(summary.proposals) ? summary.proposals : [],
  };
}

function summarizeExplorationApplyCandidate(explorationApplyCandidate = null) {
  const summary = readSummary(explorationApplyCandidate);
  return {
    status: toUpper(summary.status),
    candidate_n: toNum(summary.candidate_n) || 0,
    manual_confirm_required: summary.manual_confirm_required === true,
    auto_apply_allowed: summary.auto_apply_allowed === true,
    max_market_apply_per_cycle: toNum(summary.max_market_apply_per_cycle) || 0,
    top_market: String(summary.top_market || "").trim().toUpperCase() || null,
    top_stage: String(summary.top_stage || "").trim().toUpperCase() || null,
    top_action: String(summary.top_action || "").trim().toUpperCase() || null,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    candidates: Array.isArray(summary.candidates) ? summary.candidates : [],
  };
}

function summarizeRetrospective(retrospective = null) {
  const raw = unwrapRawReport(retrospective) || {};
  const activePeriods = Array.isArray(raw.active_periods) ? raw.active_periods : ["DAILY"];
  const selfCritique = raw.self_critique && Array.isArray(raw.self_critique.lines) ? raw.self_critique.lines : [];
  const nextDayStrategy = raw.next_day_strategy && Array.isArray(raw.next_day_strategy.lines) ? raw.next_day_strategy.lines : [];
  const dailyEval = raw.daily_trade_evaluation && typeof raw.daily_trade_evaluation === "object" ? raw.daily_trade_evaluation : {};
  const bestMarket = dailyEval.best_market && String(dailyEval.best_market.symbol || "").trim().toUpperCase() || null;
  const worstMarket = dailyEval.worst_market && String(dailyEval.worst_market.symbol || "").trim().toUpperCase() || null;
  const failedPeriods = raw.reflection_summary && Array.isArray(raw.reflection_summary.failed_periods)
    ? raw.reflection_summary.failed_periods
    : [];
  return {
    active_periods: activePeriods,
    failed_periods: failedPeriods,
    best_market: bestMarket,
    worst_market: worstMarket,
    self_critique_lines: selfCritique,
    next_day_strategy_lines: nextDayStrategy,
  };
}

function summarizeServerPrimaryCanary(serverPrimaryCanary = null) {
  const summary = readSummary(serverPrimaryCanary);
  return {
    apply_pass: summary.apply_pass === true,
    server_primary_executed_n: toNum(summary.server_primary_executed_n) || 0,
    acceptance_ready: summary.acceptance_ready === true,
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
  serverPrimaryCanary = null,
  serverPrimaryAcceptanceWatch = null,
  watchdog = null,
  dropValidation = null,
  executionQuality = null,
  reversePolicy = null,
  explorationBudget = null,
  explorationProposal = null,
  explorationApplyCandidate = null,
  retrospective = null,
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
  const deploymentGuardBlockers = Array.isArray(deploymentGuardsSummary.blockers) ? deploymentGuardsSummary.blockers.filter(Boolean) : [];
  const serverPrimaryCanarySummary = summarizeServerPrimaryCanary(serverPrimaryCanary);
  const acceptanceSummary = readSummary(serverPrimaryAcceptanceWatch);
  const watchdogSummary = readSummary(watchdog);
  const dropValidationSummary = summarizeDropValidation(dropValidation);
  const executionQualitySummary = summarizeExecutionQuality(executionQuality);
  const reversePolicySummary = summarizeReversePolicy(reversePolicy);
  const explorationBudgetSummary = summarizeExplorationBudget(explorationBudget);
  const explorationProposalSummary = summarizeExplorationProposal(explorationProposal);
  const explorationApplyCandidateSummary = summarizeExplorationApplyCandidate(explorationApplyCandidate);
  const retrospectiveSummary = summarizeRetrospective(retrospective);

  const explicitPromotionCandidateId = String(
    promotion.candidate_id
    || promotion.display_candidate_id
    || ""
  ).trim() || null;
  const bestReadyReplayCandidateId = findBestReadyReplayCandidateId(replayReport, candidateReport);
  const targetCandidateId = String(
    explicitPromotionCandidateId
    || bestReadyReplayCandidateId
    || candidateSummary.top_candidate_id
    || replaySummary.best_candidate_id
    || ""
  ).trim() || null;
  const candidateRow = findCandidateRow(candidateReport, targetCandidateId);
  const replayRow = findReplayRow(replayReport, targetCandidateId);
  const memoryContext = deriveMemoryBlockContext(memory, targetCandidateId, candidateRow);
  const objectiveScoreSnapshot = deriveObjectiveScoreSnapshot({
    objective: objectiveSummary,
    objectiveSupervisor: supervisor,
    autonomyContract: contract,
  });
  const objectiveScore = objectiveScoreSnapshot.objective_score;
  const recoveryRequired = contractStatus.recovery_required === true || (objectiveScore != null && objectiveScore < 0);
  const targetDeployUnit = toUpper(candidateRow && candidateRow.target_deploy_unit);
  const targetDisplayId = String(
    promotion.display_candidate_id
    || displayCandidateId(candidateRow, targetCandidateId)
    || targetCandidateId
    || ""
  ).trim() || null;
  const replayPass = String(
    promotion.replay_verdict
    || (replayRow && replayRow.validation_verdict)
    || replaySummary.best_verdict
    || ""
  ).trim().toUpperCase() === "PASS";
  const effectiveCanaryReady = canarySummary.apply_pass === true && (toNum(canarySummary.ready_n) || 0) > 0
    || (
      targetDeployUnit === "SERVER_SETTINGS"
      && (
        serverPrimaryCanarySummary.apply_pass === true
        || acceptanceSummary.phase_d_ready === true
        || acceptanceSummary.acceptance_ready === true
        || serverPrimaryCanarySummary.acceptance_ready === true
      )
    );
  const deploymentPass = deploymentGuardsSummary.deploy_pass === true || deploymentGuardBlockers.length === 0;
  const targetMemoryBlocked = memoryContext.target_blocked === true;
  const watchdogPass = toUpper(watchdogSummary.verdict || watchdogSummary.status || watchdogSummary.summary_verdict) === "PASS";
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
    } else if (!effectiveCanaryReady && degradedPolicy.require_canary_ready !== false) {
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
      objective_score_source: objectiveScoreSnapshot.objective_score_source,
      target_candidate_id: targetCandidateId,
      display_candidate_id: targetDisplayId,
      target_deploy_unit: targetDeployUnit,
      target_migration_class: toUpper(candidateRow && candidateRow.canonical_migration_class),
      replay_pass: replayPass,
      canary_ready: effectiveCanaryReady,
      canary_ready_mode: canarySummary.apply_pass === true && (toNum(canarySummary.ready_n) || 0) > 0
        ? "LEGACY_CANARY"
        : (
          targetDeployUnit === "SERVER_SETTINGS"
          && (
            serverPrimaryCanarySummary.apply_pass === true
            || acceptanceSummary.phase_d_ready === true
            || acceptanceSummary.acceptance_ready === true
            || serverPrimaryCanarySummary.acceptance_ready === true
          )
            ? "SERVER_PRIMARY_ACCEPTANCE"
            : "BLOCKED"
        ),
      deployment_guards_pass: deploymentPass,
      deployment_guard_blockers: deploymentGuardBlockers,
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
      reverse_policy_status: reversePolicySummary.status,
      reverse_policy_drop_n: reversePolicySummary.reverse_drop_n,
      reverse_policy_revive_n: reversePolicySummary.reverse_revive_n,
      reverse_policy_revive_rate: reversePolicySummary.reverse_revive_rate,
      reverse_policy_top_watch_market: reversePolicySummary.top_watch_market,
      reverse_policy_top_watch_reason: reversePolicySummary.top_watch_reason,
      reverse_policy_top_watch_action: reversePolicySummary.top_watch_action,
      exploration_budget_status: explorationBudgetSummary.status,
      exploration_budget_production_slot_n: explorationBudgetSummary.production_slot_n,
      exploration_budget_exploration_slot_n: explorationBudgetSummary.exploration_slot_n,
      exploration_budget_production_markets: explorationBudgetSummary.production_markets,
      exploration_budget_exploration_markets: explorationBudgetSummary.exploration_markets,
      exploration_budget_deferred_penalty_markets: explorationBudgetSummary.deferred_penalty_markets,
      exploration_budget_top_production_market: explorationBudgetSummary.top_production_market,
      exploration_budget_top_exploration_market: explorationBudgetSummary.top_exploration_market,
      exploration_proposal_status: explorationProposalSummary.status,
      exploration_proposal_proposal_n: explorationProposalSummary.proposal_n,
      exploration_proposal_top_market: explorationProposalSummary.top_market,
      exploration_proposal_top_stage: explorationProposalSummary.top_stage,
      exploration_proposal_top_action: explorationProposalSummary.top_action,
      exploration_apply_candidate_status: explorationApplyCandidateSummary.status,
      exploration_apply_candidate_candidate_n: explorationApplyCandidateSummary.candidate_n,
      exploration_apply_candidate_manual_confirm_required: explorationApplyCandidateSummary.manual_confirm_required,
      exploration_apply_candidate_auto_apply_allowed: explorationApplyCandidateSummary.auto_apply_allowed,
      exploration_apply_candidate_top_market: explorationApplyCandidateSummary.top_market,
      exploration_apply_candidate_top_stage: explorationApplyCandidateSummary.top_stage,
      exploration_apply_candidate_top_action: explorationApplyCandidateSummary.top_action,
      retrospective_active_periods: retrospectiveSummary.active_periods,
      retrospective_failed_periods: retrospectiveSummary.failed_periods,
      retrospective_best_market: retrospectiveSummary.best_market,
      retrospective_worst_market: retrospectiveSummary.worst_market,
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
        ...buildNextActions({ status: governorStatus, candidateId: targetCandidateId, candidateDisplayId: targetDisplayId, reason: governorReason }),
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
        ...(recoveryRequired
          && reversePolicySummary.status === "REVERSE_POLICY_REVIEW"
          ? [
            `Review reverse policy path first (${reversePolicySummary.top_watch_market || "N/A"} / ${reversePolicySummary.top_watch_reason || "N/A"} / ${reversePolicySummary.top_watch_action || "N/A"} / drop ${reversePolicySummary.reverse_drop_n} / revive ${reversePolicySummary.reverse_revive_n}).`,
          ]
          : []),
        ...(explorationBudgetSummary.status
          ? [
            `Use exploration budget explicitly (prod ${explorationBudgetSummary.production_markets.length ? explorationBudgetSummary.production_markets.join("|") : "none"} / explore ${explorationBudgetSummary.exploration_markets.length ? explorationBudgetSummary.exploration_markets.join("|") : "none"} / deferred ${explorationBudgetSummary.deferred_penalty_markets.length ? explorationBudgetSummary.deferred_penalty_markets.join("|") : "none"}).`,
          ]
          : []),
        ...(explorationProposalSummary.status === "EXPLORATION_DRY_RUN_READY"
          ? [
            `Keep exploration proposal as dry-run only for now (${explorationProposalSummary.top_market || "N/A"} / ${explorationProposalSummary.top_stage || "N/A"} / ${explorationProposalSummary.top_action || "N/A"} / n=${explorationProposalSummary.proposal_n}).`,
          ]
          : []),
        ...(explorationApplyCandidateSummary.status === "AUTO_APPLY_CANDIDATE_READY"
          ? [
            `Exploration apply candidate is auto-eligible (${explorationApplyCandidateSummary.top_market || "N/A"} / ${explorationApplyCandidateSummary.top_stage || "N/A"} / ${explorationApplyCandidateSummary.top_action || "N/A"} / manual=${explorationApplyCandidateSummary.manual_confirm_required ? "YES" : "NO"} / auto=${explorationApplyCandidateSummary.auto_apply_allowed ? "YES" : "NO"}).`,
          ]
          : (explorationApplyCandidateSummary.status === "APPLY_CANDIDATE_READY"
            ? [
              `Exploration apply candidate remains manual-only (${explorationApplyCandidateSummary.top_market || "N/A"} / ${explorationApplyCandidateSummary.top_stage || "N/A"} / ${explorationApplyCandidateSummary.top_action || "N/A"} / manual=${explorationApplyCandidateSummary.manual_confirm_required ? "YES" : "NO"} / auto=${explorationApplyCandidateSummary.auto_apply_allowed ? "YES" : "NO"}).`,
            ]
            : [])),
        ...(retrospectiveSummary.failed_periods.length
          ? [
            `Retrospective priority says focus on ${retrospectiveSummary.worst_market || "the weakest market"} first, while keeping ${retrospectiveSummary.best_market || "the strongest market"} as the lead production market.`,
          ]
          : []),
        ...retrospectiveSummary.next_day_strategy_lines.slice(0, 3),
        ...dropValidationSummary.next_actions,
      ],
    },
  };
}

module.exports = {
  deriveObjectiveRecoveryGovernor,
};
