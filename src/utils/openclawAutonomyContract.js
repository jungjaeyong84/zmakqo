"use strict";
const { unwrapRawReport, toNum, extractObjectiveScore, deriveObjectiveScoreSnapshot } = require("./objectiveScoreSnapshot");

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function readDisplay(value) {
  return value && value.display && typeof value.display === "object" ? value.display : null;
}

function readRetrospectiveMicrostructure(value) {
  const display = readDisplay(value) || {};
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

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function firstArrayRow(value) {
  return Array.isArray(value) && value.length ? value[0] : null;
}

function envNum(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function envList(name, fallback = []) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return Array.isArray(fallback) ? fallback.slice() : [];
  return raw.split(",").map((item) => String(item || "").trim().toUpperCase()).filter(Boolean);
}

function extractMonthlyRunRate(value) {
  const summary = value && typeof value === "object" ? value : {};
  const nested = summary.global_objective_score && typeof summary.global_objective_score === "object"
    ? summary.global_objective_score
    : null;
  return toNum(summary.monthly_run_rate_krw)
    ?? toNum(summary.monthly_run_rate)
    ?? toNum(nested && nested.monthly_run_rate_krw);
}

function extractWinRate(value) {
  const summary = value && typeof value === "object" ? value : {};
  const nested = summary.global_objective_score && typeof summary.global_objective_score === "object"
    ? summary.global_objective_score
    : null;
  const snapshot = nested && nested.snapshot && typeof nested.snapshot === "object"
    ? nested.snapshot
    : null;
  return toNum(summary.win_rate)
    ?? toNum(summary.fire_win_rate)
    ?? toNum(nested && nested.win_rate)
    ?? toNum(snapshot && snapshot.win_rate);
}

function phaseStatus(done, active) {
  if (done) return "DONE";
  if (active) return "IN_PROGRESS";
  return "PENDING";
}

function deriveServerSignalTransition({ authoritySummary = {}, qualitySummary = {} } = {}) {
  const sourceMode = toUpper(authoritySummary.source_mode) || "UNKNOWN";
  const driftStatus = toUpper(authoritySummary.drift_status) || "PARITY_UNKNOWN";
  const qualityStatus = toUpper(qualitySummary.quality_status) || "N_A";
  const authoritative24h = toNum(authoritySummary.authoritative_server_24h_n) || 0;
  const shadow24h = toNum(authoritySummary.pine_shadow_24h_n) || 0;
  const entry24h = toNum(qualitySummary.authoritative_entry_signal_24h_n) || 0;
  const intent24h = toNum(qualitySummary.order_intent_24h_n) || 0;
  const fill24h = toNum(qualitySummary.fill_24h_n) || 0;

  const phases = [
    {
      id: "SERVER_SIGNAL_GENERATION",
      label: "서버가 15분 봉 기준 신호 생성",
      status: phaseStatus(authoritative24h > 0, authoritative24h > 0 || sourceMode !== "UNKNOWN"),
    },
    {
      id: "SERVER_SIGNAL_EXECUTION",
      label: "정본 신호가 주문과 체결로 연결",
      status: phaseStatus(
        entry24h > 0 && intent24h > 0 && fill24h > 0 && qualityStatus !== "SERVER_SIGNAL_NOT_REACHING_EXECUTION",
        entry24h > 0
      ),
    },
    {
      id: "PINE_SHADOW_DEMOTION",
      label: "파인은 그림자 관측으로만 동작",
      status: phaseStatus(
        sourceMode === "SERVER_PRIMARY",
        authoritative24h > 0 || shadow24h >= 0
      ),
    },
    {
      id: "OPS_AUTHORITY_WIRING",
      label: "운영 판단이 서버 정본 기준으로 연결",
      status: phaseStatus(
        driftStatus !== "PARITY_UNKNOWN" && qualityStatus !== "N_A",
        driftStatus !== "PARITY_UNKNOWN" || qualityStatus !== "N_A"
      ),
    },
  ];

  const progressPct = Math.round((phases.reduce((sum, row) => {
    if (row.status === "DONE") return sum + 1;
    if (row.status === "IN_PROGRESS") return sum + 0.5;
    return sum;
  }, 0) / phases.length) * 100);
  const completedN = phases.filter((row) => row.status === "DONE").length;
  const inProgress = phases.find((row) => row.status === "IN_PROGRESS");
  const pending = phases.find((row) => row.status === "PENDING");

  return {
    status: progressPct >= 100 ? "COMPLETE" : (completedN > 0 || inProgress ? "IN_PROGRESS" : "NOT_STARTED"),
    progress_pct: progressPct,
    completed_n: completedN,
    total_n: phases.length,
    current_phase: (inProgress || pending || phases[phases.length - 1]).id,
    current_label: (inProgress || pending || phases[phases.length - 1]).label,
    phases,
  };
}

function deriveOpenClawAutonomyContract({
  objective = null,
  objectiveSupervisor = null,
  objectiveRecoveryGovernor = null,
  deploymentPlan = null,
  serverPrimaryCanary = null,
  watchdog = null,
  serverSignalAuthority = null,
  serverSignalQuality = null,
  serverSignalRuntime = null,
  marketRegimeBoard = null,
  executionQuality = null,
  objectiveRetrospective = null,
  overallAccountReport = null,
  signalLineageHealth = null,
  modelReadiness = null,
  featureStore = null,
  executionModelDataset = null,
  executionFillInference = null,
  executionScopeInference = null,
  executionStageLatency = null,
  mlExperimentRegistry = null,
  executionBottleneckDelta = null,
  mlTrainRun = null,
  mlTrainRunScope = null,
  mlModelContract = null,
} = {}) {
  const objectiveSummary = readSummary(objective);
  const objectiveSupervisorRaw = unwrapRawReport(objectiveSupervisor) || {};
  const objectiveRecoveryGovernorSummary = readSummary(objectiveRecoveryGovernor);
  const deploymentPlanSummary = readSummary(deploymentPlan);
  const serverPrimarySummary = readSummary(serverPrimaryCanary);
  const watchdogSummary = readSummary(watchdog);
  const serverSignalAuthoritySummary = readSummary(serverSignalAuthority);
  const serverSignalQualitySummary = readSummary(serverSignalQuality);
  const serverSignalRuntimeSummary = readSummary(serverSignalRuntime);
  const marketRegimeBoardSummary = readSummary(marketRegimeBoard);
  const executionQualitySummary = readSummary(executionQuality);
  const retrospectiveDisplay = readDisplay(objectiveRetrospective) || {};
  const retrospectiveMicro = readRetrospectiveMicrostructure(objectiveRetrospective);
  const overallAccount = overallAccountReport && typeof overallAccountReport === "object" ? overallAccountReport : {};
  const overallIntegrity = overallAccount.integrity && typeof overallAccount.integrity === "object" ? overallAccount.integrity : {};
  const overallOperations = overallAccount.operations && typeof overallAccount.operations === "object" ? overallAccount.operations : {};
  const signalLineageSummary = readSummary(signalLineageHealth);
  const modelReadinessSummary = readSummary(modelReadiness);
  const featureStoreSummary = readSummary(featureStore);
  const executionModelSummary = readSummary(executionModelDataset);
  const executionFillInferenceSummary = readSummary(executionFillInference);
  const executionScopeInferenceSummary = readSummary(executionScopeInference);
  const executionStageLatencySummary = readSummary(executionStageLatency);
  const mlExperimentRegistrySummary = readSummary(mlExperimentRegistry);
  const executionBottleneckDeltaSummary = readSummary(executionBottleneckDelta);
  const mlTrainRunSummary = readSummary(mlTrainRun);
  const mlTrainRunScopeSummary = readSummary(mlTrainRunScope);
  const mlModelContractSummary = readSummary(mlModelContract);
  const executionModelStatus = toUpper(executionModelSummary.status) || "N_A";
  const executionFillInferenceStatus = toUpper(executionFillInferenceSummary.status) || "N_A";
  const executionScopeInferenceStatus = toUpper(executionScopeInferenceSummary.status) || "N_A";
  const executionStageLatencyStatus = toUpper(executionStageLatencySummary.status) || "N_A";
  const mlExperimentRegistryStatus = toUpper(mlExperimentRegistrySummary.status) || "N_A";
  const executionBottleneckDeltaStatus = toUpper(executionBottleneckDeltaSummary.status) || "N_A";
  const mlTrainRunStatus = toUpper(mlTrainRunSummary.status) || "N_A";
  const mlTrainRunScopeStatus = toUpper(mlTrainRunScopeSummary.status) || "N_A";
  const mlModelContractStatus = toUpper(mlModelContractSummary.status) || "N_A";
  const executionBottleneckDeltaComparable = executionBottleneckDeltaStatus === "EXECUTION_BOTTLENECK_DELTA_READY";
  const executionBottleneckDeltaInterpretation = executionBottleneckDeltaComparable
    ? "USE_DELTA_SIGNAL"
    : (executionBottleneckDeltaStatus === "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON"
      ? "SKIP_STALE_COMPARISON"
      : (executionBottleneckDeltaStatus === "EXECUTION_BOTTLENECK_DELTA_INSUFFICIENT_HISTORY"
        ? "SKIP_INSUFFICIENT_HISTORY"
        : "DELTA_STATUS_UNKNOWN"));

  const objectivePolicy = {
    min_objective_score: envNum("OPENCLAW_AUTONOMY_MIN_OBJECTIVE_SCORE", 0),
    min_monthly_run_rate_krw: envNum("OPENCLAW_AUTONOMY_MIN_MONTHLY_RUN_RATE_KRW", 1500000),
    min_win_rate: envNum("OPENCLAW_AUTONOMY_MIN_WIN_RATE", 0.6),
    recovery_trigger_objective_score: envNum("OPENCLAW_AUTONOMY_RECOVERY_TRIGGER_SCORE", -0.25),
  };

  const authorityPolicy = {
    authority_mode: toUpper(process.env.SELF_EVOLUTION_AUTHORITY_MODE || "CODEX_CLAUDE_ENSEMBLE") || "CODEX_CLAUDE_ENSEMBLE",
    review_unit: toUpper(deploymentPlanSummary.review_unit || objectiveSupervisorRaw.review_unit || "ENGINE_POLICY_BUNDLE") || "ENGINE_POLICY_BUNDLE",
    degraded_timeout_policy: {
      enabled: envBool("OPENCLAW_DEGRADED_AUTHORITY_ENABLED", true),
      min_timeout_streak: Math.max(1, envNum("OPENCLAW_DEGRADED_AUTHORITY_MIN_TIMEOUT_STREAK", 3)),
      require_replay_pass: envBool("OPENCLAW_DEGRADED_AUTHORITY_REQUIRE_REPLAY_PASS", true),
      require_canary_ready: envBool("OPENCLAW_DEGRADED_AUTHORITY_REQUIRE_CANARY_READY", true),
      require_deployment_guards_pass: envBool("OPENCLAW_DEGRADED_AUTHORITY_REQUIRE_DEPLOYMENT_GUARDS_PASS", true),
      require_memory_clear: envBool("OPENCLAW_DEGRADED_AUTHORITY_REQUIRE_MEMORY_CLEAR", true),
      require_openclaw_ops_healthy: envBool("OPENCLAW_DEGRADED_AUTHORITY_REQUIRE_OPS_HEALTHY", true),
      allow_target_deploy_units: envList(
        "OPENCLAW_DEGRADED_AUTHORITY_ALLOWED_TARGET_UNITS",
        ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"]
      ),
      confidence_floor: envNum("OPENCLAW_DEGRADED_AUTHORITY_CONFIDENCE_FLOOR", 0.35),
    },
  };

  const phaseDPolicy = {
    min_server_primary_executed_n: Math.max(
      1,
      envNum("OPENCLAW_PHASE_D_MIN_SERVER_PRIMARY_EXECUTED", toNum(serverPrimarySummary.acceptance_min_executed) || 2)
    ),
    max_server_primary_disagreement_rate: Math.max(
      0,
      envNum("OPENCLAW_PHASE_D_MAX_SERVER_PRIMARY_DISAGREEMENT_RATE", 0.15)
    ),
    max_server_primary_rollback_trigger_n: Math.max(
      0,
      envNum("OPENCLAW_PHASE_D_MAX_SERVER_PRIMARY_ROLLBACK_TRIGGER_N", 0)
    ),
  };

  const controlPlane = {
    scheduler_sot: toUpper(watchdogSummary.scheduler_mode || process.env.OPENCLAW_SCHEDULER_MODE || "OPENCLAW_CRON") || "OPENCLAW_CRON",
    telegram_transport_sot: toUpper(process.env.OPENCLAW_TELEGRAM_TRANSPORT_SOT || "OPENCLAW_FIRST") || "OPENCLAW_FIRST",
    execution_sot: "SERVER_CANONICAL",
    pine_role: "SHADOW_OVERLAY_AUDIT",
  };

  const objectiveSupervisorSummary = objectiveSupervisorRaw.self_evolution_objective && typeof objectiveSupervisorRaw.self_evolution_objective === "object"
    ? objectiveSupervisorRaw.self_evolution_objective
    : {};
  const governanceObjectiveSummary = objectiveSupervisorRaw.objective && typeof objectiveSupervisorRaw.objective === "object"
    ? objectiveSupervisorRaw.objective
    : {};
  const objectiveScoreSnapshot = deriveObjectiveScoreSnapshot({
    objective: objectiveSummary,
    objectiveSupervisor: objectiveSupervisorRaw,
  });
  const currentObjectiveScore = objectiveScoreSnapshot.objective_score;
  const currentMonthlyRunRate = extractMonthlyRunRate(objectiveSummary)
    ?? extractMonthlyRunRate(objectiveSupervisorSummary)
    ?? extractMonthlyRunRate(governanceObjectiveSummary);
  const currentWinRate = extractWinRate(objectiveSummary)
    ?? extractWinRate(objectiveSupervisorSummary)
    ?? extractWinRate(governanceObjectiveSummary);
  const objectiveMet = Boolean(
    currentObjectiveScore != null && currentObjectiveScore >= objectivePolicy.min_objective_score
    && currentMonthlyRunRate != null && currentMonthlyRunRate >= objectivePolicy.min_monthly_run_rate_krw
    && currentWinRate != null && currentWinRate >= objectivePolicy.min_win_rate
  );
  const recoveryRequired = Boolean(
    !objectiveMet
    || (currentObjectiveScore != null && currentObjectiveScore <= objectivePolicy.recovery_trigger_objective_score)
  );

  const deploymentAuthorityState = toUpper(deploymentPlanSummary.authority_state);
  const authorityPending = Boolean(
    deploymentPlanSummary.external_authority_pending === true
    || deploymentAuthorityState === "PENDING"
    || toUpper(deploymentPlanSummary.plan_status) === "APPLIED_ACTIVE_PENDING_AUTHORITY"
  );
  const changeAuthorityState = deploymentAuthorityState
    || (deploymentPlanSummary.authority_approved === true ? "APPROVED" : null)
    || (authorityPending ? "PENDING" : "CLEAR");
  const activationActive = Boolean(
    deploymentPlanSummary.activation_confirmed === true
    || toUpper(deploymentPlanSummary.activation_status) === "ACTIVE"
  );
  const degradedAuthorityEligible = Boolean(
    objectiveRecoveryGovernorSummary.degraded_authority_enabled === true
    && objectiveRecoveryGovernorSummary.degraded_authority_eligible === true
    && toUpper(objectiveRecoveryGovernorSummary.governor_status) === "RECOVERY_PROMOTION_READY"
  );
  const runtimeAuthorityState = authorityPending
    ? (
      activationActive
        ? (degradedAuthorityEligible ? "DEGRADED_ACTIVE" : "ACTIVE_PENDING_REVIEW")
        : "PENDING"
    )
    : changeAuthorityState;

  const executedN = toNum(serverPrimarySummary.server_primary_executed_n) || 0;
  const disagreementRate = toNum(serverPrimarySummary.pine_shadow_disagreement_rate) || 0;
  const rollbackTriggerN = toNum(serverPrimarySummary.rollback_trigger_n) || 0;
  const phaseDReady = Boolean(
    serverPrimarySummary.acceptance_ready === true
    && executedN >= phaseDPolicy.min_server_primary_executed_n
    && disagreementRate <= phaseDPolicy.max_server_primary_disagreement_rate
    && rollbackTriggerN <= phaseDPolicy.max_server_primary_rollback_trigger_n
  );

  const watchdogVerdict = toUpper(watchdogSummary.verdict || watchdogSummary.status || watchdogSummary.summary_verdict || "N/A") || "N/A";
  const opsHealthy = controlPlane.scheduler_sot === "OPENCLAW_CRON" && watchdogVerdict === "PASS";
  const serverSignalTransition = deriveServerSignalTransition({
    authoritySummary: serverSignalAuthoritySummary,
    qualitySummary: serverSignalQualitySummary,
  });
  const runtimeTransitionPct = toNum(serverSignalRuntimeSummary.pine_shadow_transition_progress_pct);
  if (runtimeTransitionPct != null) {
    serverSignalTransition.progress_pct = Math.max(serverSignalTransition.progress_pct, runtimeTransitionPct);
    serverSignalTransition.status = serverSignalTransition.progress_pct >= 100 ? "COMPLETE" : "IN_PROGRESS";
  }
  if (toUpper(serverSignalRuntimeSummary.canonical_engine_source_mode) === "SERVER_PRIMARY") {
    serverSignalTransition.current_phase = "PINE_SHADOW_DEMOTION";
    serverSignalTransition.current_label = "파인은 그림자 관측으로만 동작";
  }

  const tp0HitRate = toNum(retrospectiveMicro.tp0_hit_rate);
  const tp1HitRate = toNum(retrospectiveMicro.tp1_hit_rate);
  const preTp1TimeStopRate = toNum(retrospectiveMicro.pre_tp1_time_stop_rate);
  const chaseRejectN = toNum(retrospectiveMicro.chase_reject_n) || 0;
  const clusterReduceN = toNum(retrospectiveMicro.portfolio_cluster_reduce_n) || 0;
  const clusterBlockN = toNum(retrospectiveMicro.portfolio_cluster_block_n) || 0;
  const accountIntegrityIssueN = toNum(overallIntegrity.issue_count) || 0;
  const lineageVerdict = toUpper(signalLineageSummary.verdict) || "N_A";
  const executionQualityStatus = toUpper(executionQualitySummary.status) || "N_A";
  const executionMicrostructureStatus = retrospectiveDisplay.generated_at_kst
    ? ((tp0HitRate != null || tp1HitRate != null || preTp1TimeStopRate != null || chaseRejectN > 0)
      ? "ACTIVE"
      : "OBSERVED")
    : "N_A";
  const portfolioClusterRiskStatus = clusterBlockN > 0
    ? "BLOCKING"
    : (clusterReduceN > 0
      ? "REDUCING"
      : (retrospectiveDisplay.generated_at_kst ? "MONITORING" : "N_A"));
  const modelReadinessStatus = toUpper(modelReadinessSummary.status) || "N_A";
  const featureStoreStatus = toUpper(featureStoreSummary.status) || "N_A";
  const topEntryLatencyGroup = firstArrayRow(executionModelSummary.top_entry_measured_latency_groups);
  const topFallbackEntryLatencyGroup = firstArrayRow(executionModelSummary.top_entry_fallback_latency_groups);
  const topSignalToIntentLatencyGroup = firstArrayRow(executionModelSummary.top_signal_to_intent_latency_groups);
  const topOperationalSignalToIntentLatencyGroup = firstArrayRow(executionModelSummary.top_operational_signal_to_intent_latency_groups);
  const topWebhookToIntentLatencyGroup = firstArrayRow(executionModelSummary.top_webhook_to_intent_latency_groups);
  const topWebhookDelayReason = firstArrayRow(executionModelSummary.top_webhook_delay_reasons);
  const topWebhookDelayCause = firstArrayRow(executionModelSummary.top_webhook_delay_causes);
  const topOperationalWebhookDelayCause = firstArrayRow(executionModelSummary.top_operational_webhook_delay_causes);
  const topOperationalImmediateIntentDelayGroup = firstArrayRow(executionModelSummary.top_operational_immediate_intent_delay_groups);
  const topFillSourceBucket = firstArrayRow(executionModelSummary.by_primary_fill_source);
  const topNoFillReason = firstArrayRow(executionModelSummary.top_no_fill_reasons);
  const topNoFillReasonFamily = firstArrayRow(executionModelSummary.top_no_fill_reason_families);
  const topNoFillSubtype = firstArrayRow(executionModelSummary.top_no_fill_subtypes);

  return {
    contract_version: "OPENCLAW_AUTONOMY_CONTRACT_V1",
    goal_id: "DONBEOLJA_OBJECTIVE_AUTONOMY",
    owner: "OPENCLAW",
    authority_mode: authorityPolicy.authority_mode,
    review_unit: authorityPolicy.review_unit,
    control_plane: controlPlane,
    objective_policy: objectivePolicy,
    authority_policy: authorityPolicy,
    phase_d_policy: phaseDPolicy,
    current_status: {
      objective_score: currentObjectiveScore,
      objective_score_source: objectiveScoreSnapshot.objective_score_source,
      monthly_run_rate_krw: currentMonthlyRunRate,
      win_rate: currentWinRate,
      objective_met: objectiveMet,
      recovery_required: recoveryRequired,
      authority_pending: authorityPending,
      authority_state: runtimeAuthorityState,
      runtime_authority_state: runtimeAuthorityState,
      change_authority_state: changeAuthorityState,
      degraded_authority_runtime_eligible: degradedAuthorityEligible,
      plan_status: toUpper(deploymentPlanSummary.plan_status),
      phase_d_acceptance_ready: phaseDReady,
      phase_d_acceptance_reason: String(serverPrimarySummary.acceptance_reason || "").trim() || null,
      server_primary_executed_n: executedN,
      server_primary_disagreement_rate: disagreementRate,
      server_primary_rollback_trigger_n: rollbackTriggerN,
      ops_healthy: opsHealthy,
      watchdog_verdict: watchdogVerdict,
      scheduler_mode: controlPlane.scheduler_sot,
      telegram_transport_sot: controlPlane.telegram_transport_sot,
      server_signal_source_mode: toUpper(serverSignalAuthoritySummary.source_mode),
      server_signal_drift_status: toUpper(serverSignalAuthoritySummary.drift_status),
      server_signal_quality_status: toUpper(serverSignalQualitySummary.quality_status),
      server_signal_runtime_status: toUpper(serverSignalRuntimeSummary.runtime_status),
      server_signal_runtime_exec_tf: String(serverSignalRuntimeSummary.exec_tf || "").trim() || null,
      server_signal_runtime_market_count: toNum(serverSignalRuntimeSummary.market_count) || 0,
      server_signal_authoritative_24h_n: toNum(serverSignalAuthoritySummary.authoritative_server_24h_n) || 0,
      server_signal_shadow_24h_n: toNum(serverSignalAuthoritySummary.pine_shadow_24h_n) || 0,
      server_signal_entry_24h_n: toNum(serverSignalQualitySummary.authoritative_entry_signal_24h_n) || 0,
      server_signal_intent_24h_n: toNum(serverSignalQualitySummary.order_intent_24h_n) || 0,
      server_signal_fill_24h_n: toNum(serverSignalQualitySummary.fill_24h_n) || 0,
      market_regime_board_status: toUpper(marketRegimeBoardSummary.status),
      market_regime_rescue_n: toNum(marketRegimeBoardSummary.rescue_market_n) || 0,
      market_regime_keep_drop_n: toNum(marketRegimeBoardSummary.keep_drop_market_n) || 0,
      market_regime_top_rescue_market: String(marketRegimeBoardSummary.top_rescue_market || "").trim() || null,
      market_regime_top_keep_drop_market: String(marketRegimeBoardSummary.top_keep_drop_market || "").trim() || null,
      execution_quality_status: executionQualityStatus,
      execution_quality_latency_p95_ms: toNum(executionQualitySummary.created_to_fill_p95_ms),
      execution_quality_slippage_p95_bps: toNum(executionQualitySummary.adverse_slippage_p95_bps),
      execution_quality_partial_fill_rate_pct: toNum(executionQualitySummary.partial_fill_rate_pct),
      execution_quality_top_watch_market: String(
        executionQualitySummary.top_latency_market
        || executionQualitySummary.top_slippage_market
        || executionQualitySummary.top_partial_market
        || ""
      ).trim() || null,
      execution_quality_top_operational_webhook_delay_cause: String(executionQualitySummary.top_operational_webhook_delay_cause || "").trim() || null,
      execution_quality_top_operational_immediate_intent_delay_group: String(executionQualitySummary.top_operational_immediate_intent_delay_group || "").trim() || null,
      execution_quality_top_no_fill_reason: String(executionQualitySummary.top_no_fill_reason || "").trim() || null,
      execution_quality_top_no_fill_subtype: String(executionQualitySummary.top_no_fill_subtype || "").trim() || null,
      lineage_status: lineageVerdict,
      lineage_fills_intent_null_rate: toNum(signalLineageSummary.fills_intent_id_null_rate),
      lineage_fills_signal_null_rate: toNum(signalLineageSummary.fills_signal_doc_id_null_rate),
      lineage_intents_signal_null_rate: toNum(signalLineageSummary.intents_signal_doc_id_null_rate),
      account_integrity_ok: overallIntegrity.ok === true,
      account_integrity_issue_n: accountIntegrityIssueN,
      account_active_market_count: toNum(overallIntegrity.active_market_count) || 0,
      account_position_doc_count: toNum(overallIntegrity.position_doc_count) || 0,
      account_ops_status: String(overallOperations.status || "").trim() || null,
      account_ops_mode: String(overallOperations.mode || "").trim() || null,
      execution_microstructure_status: executionMicrostructureStatus,
      tp0_hit_rate: tp0HitRate,
      tp1_hit_rate: tp1HitRate,
      tp0_to_tp1_conversion_rate: toNum(retrospectiveMicro.tp0_to_tp1_conversion_rate),
      pre_tp1_time_stop_rate: preTp1TimeStopRate,
      chase_reject_n: chaseRejectN,
      portfolio_cluster_reduce_n: clusterReduceN,
      portfolio_cluster_block_n: clusterBlockN,
      portfolio_cluster_risk_status: portfolioClusterRiskStatus,
      model_readiness_status: modelReadinessStatus,
      model_readiness_rows_n: toNum(modelReadinessSummary.rows_n),
      model_readiness_realized_n: toNum(modelReadinessSummary.realized_n),
      model_readiness_invalid_n: toNum(modelReadinessSummary.invalid_n),
      model_readiness_mfe_mae_labeled_n: toNum(modelReadinessSummary.mfe_mae_labeled_n),
      model_readiness_mfe_mae_label_rate: toNum(modelReadinessSummary.mfe_mae_label_rate),
      model_readiness_tp1_time_labeled_n: toNum(modelReadinessSummary.tp1_time_labeled_n),
      model_readiness_tp1_time_label_rate: toNum(modelReadinessSummary.tp1_time_label_rate),
      model_readiness_tp0_time_labeled_n: toNum(modelReadinessSummary.tp0_time_labeled_n),
      model_readiness_tp0_time_label_rate: toNum(modelReadinessSummary.tp0_time_label_rate),
      model_readiness_tp0_to_tp1_converted_n: toNum(modelReadinessSummary.tp0_to_tp1_converted_n),
      model_readiness_pre_tp1_time_stop_n: toNum(modelReadinessSummary.pre_tp1_time_stop_n),
      model_readiness_dataset_version_id: String(modelReadinessSummary.dataset_version_id || "").trim() || null,
      model_readiness_schema_version: String(modelReadinessSummary.schema_version || "").trim() || null,
      feature_store_status: featureStoreStatus,
      feature_store_rows_n: toNum(featureStoreSummary.rows_n),
      feature_store_keys_n: toNum(featureStoreSummary.feature_keys_n),
      feature_store_version_id: String(
        featureStoreSummary.version_id
        || (featureStore && featureStore.feature_store_version && featureStore.feature_store_version.version_id)
        || ""
      ).trim() || null,
      feature_store_schema_version: String(featureStoreSummary.schema_version || "").trim() || null,
      execution_stage_latency_status: executionStageLatencyStatus,
      execution_stage_latency_signal_to_intent_p95_ms: toNum(executionStageLatencySummary.signal_to_intent_p95_ms),
      execution_stage_latency_webhook_saved_to_intent_p95_ms: toNum(executionStageLatencySummary.webhook_saved_to_intent_p95_ms),
      execution_stage_latency_intent_to_fill_measured_p95_ms: toNum(executionStageLatencySummary.intent_to_fill_measured_p95_ms),
      execution_stage_latency_top_signal_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_signal_to_intent_groups)?.key || "").trim() || null,
      execution_stage_latency_top_operational_signal_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_operational_signal_to_intent_groups)?.key || "").trim() || null,
      execution_stage_latency_top_webhook_saved_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_webhook_saved_to_intent_groups)?.key || "").trim() || null,
      execution_stage_latency_top_operational_webhook_saved_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_operational_webhook_saved_to_intent_groups)?.key || "").trim() || null,
      execution_stage_latency_top_intent_to_fill_measured_group: String(firstArrayRow(executionStageLatencySummary.top_intent_to_fill_measured_groups)?.key || "").trim() || null,
      ml_experiment_registry_status: mlExperimentRegistryStatus,
      ml_experiment_registry_experiment_id: String(mlExperimentRegistrySummary.experiment_id || "").trim() || null,
      ml_experiment_registry_dataset_version_id: String(mlExperimentRegistrySummary.dataset_version_id || "").trim() || null,
      ml_experiment_registry_feature_store_version_id: String(mlExperimentRegistrySummary.feature_store_version_id || "").trim() || null,
      ml_experiment_registry_execution_dataset_version_id: String(mlExperimentRegistrySummary.execution_dataset_version_id || "").trim() || null,
      ml_train_run_status: mlTrainRunStatus,
      ml_train_run_id: String(mlTrainRunSummary.train_run_id || "").trim() || null,
      ml_train_run_model_artifact_id: String(mlTrainRunSummary.model_artifact_id || "").trim() || null,
      ml_train_run_model_kind: String(mlTrainRunSummary.model_kind || "").trim() || null,
      ml_train_run_split_strategy: String(mlTrainRunSummary.split_strategy || "").trim() || null,
      ml_train_run_quality_gate_status: String(mlTrainRunSummary.quality_gate_status || "").trim() || null,
      ml_train_run_quality_gate_ready: mlTrainRunSummary.quality_gate_ready === true,
      ml_model_contract_status: mlModelContractStatus,
      ml_model_contract_deployment_stage: String(mlModelContractSummary.deployment_stage || "").trim() || null,
      ml_model_contract_canary_gate_status: String(mlModelContractSummary.canary_gate_status || "").trim() || null,
      ml_model_contract_promotion_status: String(mlModelContractSummary.promotion_status || "").trim() || null,
      ml_model_contract_model_artifact_id: String(mlModelContractSummary.model_artifact_id || "").trim() || null,
      execution_bottleneck_delta_status: executionBottleneckDeltaStatus,
      execution_bottleneck_delta_comparable: executionBottleneckDeltaComparable,
      execution_bottleneck_delta_interpretation: executionBottleneckDeltaInterpretation,
      execution_bottleneck_delta_signal_to_intent_p95_delta_ms: executionBottleneckDeltaComparable ? toNum(executionBottleneckDeltaSummary.signal_to_intent_p95_delta_ms) : null,
      execution_bottleneck_delta_webhook_saved_to_intent_p95_delta_ms: executionBottleneckDeltaComparable ? toNum(executionBottleneckDeltaSummary.webhook_saved_to_intent_p95_delta_ms) : null,
      execution_bottleneck_delta_created_to_fill_p95_delta_ms: executionBottleneckDeltaComparable ? toNum(executionBottleneckDeltaSummary.created_to_fill_p95_delta_ms) : null,
      execution_bottleneck_delta_top_operational_webhook_delay_cause: executionBottleneckDeltaComparable ? (String(executionBottleneckDeltaSummary.current_top_operational_webhook_delay_cause || "").trim() || null) : null,
      execution_bottleneck_delta_top_operational_signal_to_intent_group: executionBottleneckDeltaComparable ? (String(executionBottleneckDeltaSummary.current_top_operational_signal_to_intent_group || "").trim() || null) : null,
      execution_model_dataset_status: executionModelStatus,
      execution_fill_inference_status: executionFillInferenceStatus,
      execution_fill_inference_model_artifact_id: String(executionFillInferenceSummary.model_artifact_id || "").trim() || null,
      execution_fill_inference_mismatch_rate: toNum(executionFillInferenceSummary.mismatch_rate),
      execution_fill_inference_filled_avg_pred_fill_prob: toNum(firstArrayRow((executionFillInferenceSummary.by_scope || []).filter((row) => String(row.key || "").trim().toUpperCase() === "FILLED"))?.avg_pred_fill_prob),
      execution_fill_inference_policy_blocked_avg_pred_fill_prob: toNum(firstArrayRow((executionFillInferenceSummary.by_scope || []).filter((row) => String(row.key || "").trim().toUpperCase() === "POLICY_BLOCKED"))?.avg_pred_fill_prob),
      execution_scope_inference_status: executionScopeInferenceStatus,
      execution_scope_inference_model_artifact_id: String(executionScopeInferenceSummary.model_artifact_id || "").trim() || null,
      execution_scope_inference_mismatch_rate: toNum(executionScopeInferenceSummary.mismatch_rate),
      execution_scope_inference_top_false_positive_group: String(firstArrayRow(executionScopeInferenceSummary.top_false_positive_groups)?.key || "").trim() || null,
      execution_scope_fp_diagnostics_status: String(executionQualitySummary.execution_scope_fp_diagnostics_status || "").trim() || null,
      execution_scope_fp_diagnostics_top_shared_feature: String(executionQualitySummary.execution_scope_fp_diagnostics_top_shared_feature || "").trim() || null,
      execution_scope_fp_diagnostics_top_context_profile: String(executionQualitySummary.execution_scope_fp_diagnostics_top_context_profile || "").trim() || null,
      execution_scope_fp_diagnostics_reference_rows_n: toNum(executionQualitySummary.execution_scope_fp_diagnostics_reference_rows_n),
      execution_scope_fp_diagnostics_reference_group_mode: String(executionQualitySummary.execution_scope_fp_diagnostics_reference_group_mode || "").trim() || null,
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
      execution_scope_train_run_status: mlTrainRunScopeStatus,
      execution_scope_train_run_id: String(mlTrainRunScopeSummary.train_run_id || "").trim() || null,
      execution_scope_train_run_model_artifact_id: String(mlTrainRunScopeSummary.model_artifact_id || "").trim() || null,
      execution_scope_train_run_model_kind: String(mlTrainRunScopeSummary.model_kind || "").trim() || null,
      execution_scope_train_run_quality_gate_status: String(mlTrainRunScopeSummary.quality_gate_status || "").trim() || null,
      execution_scope_train_run_quality_gate_ready: mlTrainRunScopeSummary.quality_gate_ready === true,
      execution_scope_train_run_top_policy_blocked_test_source: String(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source || "").trim() || null,
      execution_scope_train_run_top_policy_blocked_test_source_train_n: toNum(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source_train_n),
      execution_scope_train_run_top_policy_blocked_test_source_test_n: toNum(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source_test_n),
      execution_scope_train_run_top_policy_blocked_test_source_test_share: toNum(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source_test_share),
      execution_model_dataset_version_id: String(
        executionModelSummary.version_id
        || (executionModelDataset && executionModelDataset.execution_dataset_version && executionModelDataset.execution_dataset_version.version_id)
        || ""
      ).trim() || null,
      execution_model_dataset_rows_n: toNum(executionModelSummary.rows_n),
      execution_model_dataset_entry_rows_n: toNum(executionModelSummary.entry_rows_n),
      execution_model_dataset_exit_rows_n: toNum(executionModelSummary.exit_rows_n),
      execution_model_dataset_filled_n: toNum(executionModelSummary.filled_n),
      execution_model_dataset_rejected_n: toNum(executionModelSummary.rejected_n),
      execution_model_dataset_partial_n: toNum(executionModelSummary.partial_n),
      execution_model_dataset_latency_p95_ms: toNum(executionModelSummary.created_to_fill_p95_ms),
      execution_model_dataset_measured_latency_p95_ms: toNum(executionModelSummary.created_to_fill_measured_p95_ms),
      execution_model_dataset_signal_to_intent_p95_ms: toNum(executionModelSummary.signal_to_intent_p95_ms),
      execution_model_dataset_signal_to_fill_p95_ms: toNum(executionModelSummary.signal_to_fill_p95_ms),
      execution_model_dataset_webhook_to_intent_p95_ms: toNum(executionModelSummary.webhook_to_intent_p95_ms),
      execution_model_dataset_webhook_to_outcome_p95_ms: toNum(executionModelSummary.webhook_to_outcome_p95_ms),
      execution_model_dataset_slippage_p95_bps: toNum(executionModelSummary.slippage_p95_bps),
      execution_model_dataset_top_webhook_to_intent_latency_group: topWebhookToIntentLatencyGroup ? String(topWebhookToIntentLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_webhook_to_intent_latency_market: topWebhookToIntentLatencyGroup ? String(topWebhookToIntentLatencyGroup.market || "").trim() || null : null,
      execution_model_dataset_top_webhook_to_intent_latency_source: topWebhookToIntentLatencyGroup ? String(topWebhookToIntentLatencyGroup.source || "").trim() || null : null,
      execution_model_dataset_top_webhook_to_intent_latency_p95_ms: toNum(topWebhookToIntentLatencyGroup && topWebhookToIntentLatencyGroup.webhook_to_intent_p95_ms),
      execution_model_dataset_top_webhook_delay_reason: topWebhookDelayReason ? String(topWebhookDelayReason.key || "").trim() || null : null,
      execution_model_dataset_top_webhook_delay_reason_rows_n: toNum(topWebhookDelayReason && topWebhookDelayReason.rows_n),
      execution_model_dataset_top_webhook_delay_cause: topWebhookDelayCause ? String(topWebhookDelayCause.key || "").trim() || null : null,
      execution_model_dataset_top_webhook_delay_cause_rows_n: toNum(topWebhookDelayCause && topWebhookDelayCause.rows_n),
      execution_model_dataset_top_operational_webhook_delay_cause: topOperationalWebhookDelayCause ? String(topOperationalWebhookDelayCause.key || "").trim() || null : null,
      execution_model_dataset_top_operational_webhook_delay_cause_rows_n: toNum(topOperationalWebhookDelayCause && topOperationalWebhookDelayCause.rows_n),
      execution_model_dataset_top_operational_immediate_intent_delay_group: topOperationalImmediateIntentDelayGroup ? String(topOperationalImmediateIntentDelayGroup.key || "").trim() || null : null,
      execution_model_dataset_top_operational_immediate_intent_delay_p95_ms: toNum(topOperationalImmediateIntentDelayGroup && topOperationalImmediateIntentDelayGroup.webhook_to_intent_p95_ms),
      execution_model_dataset_top_signal_to_intent_latency_group: topSignalToIntentLatencyGroup ? String(topSignalToIntentLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_operational_signal_to_intent_latency_group: topOperationalSignalToIntentLatencyGroup ? String(topOperationalSignalToIntentLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_operational_signal_to_intent_latency_market: topOperationalSignalToIntentLatencyGroup ? String(topOperationalSignalToIntentLatencyGroup.market || "").trim() || null : null,
      execution_model_dataset_top_operational_signal_to_intent_latency_source: topOperationalSignalToIntentLatencyGroup ? String(topOperationalSignalToIntentLatencyGroup.source || "").trim() || null : null,
      execution_model_dataset_top_operational_signal_to_intent_latency_p95_ms: toNum(topOperationalSignalToIntentLatencyGroup && topOperationalSignalToIntentLatencyGroup.signal_to_intent_p95_ms),
      execution_model_dataset_top_signal_to_intent_latency_market: topSignalToIntentLatencyGroup ? String(topSignalToIntentLatencyGroup.market || "").trim() || null : null,
      execution_model_dataset_top_signal_to_intent_latency_source: topSignalToIntentLatencyGroup ? String(topSignalToIntentLatencyGroup.source || "").trim() || null : null,
      execution_model_dataset_top_signal_to_intent_latency_p95_ms: toNum(topSignalToIntentLatencyGroup && topSignalToIntentLatencyGroup.signal_to_intent_p95_ms),
      execution_model_dataset_top_entry_latency_group: topEntryLatencyGroup ? String(topEntryLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_entry_latency_market: topEntryLatencyGroup ? String(topEntryLatencyGroup.market || "").trim() || null : null,
      execution_model_dataset_top_entry_latency_source: topEntryLatencyGroup ? String(topEntryLatencyGroup.primary_fill_source || topEntryLatencyGroup.source || "").trim() || null : null,
      execution_model_dataset_top_entry_latency_p95_ms: toNum(topEntryLatencyGroup && topEntryLatencyGroup.created_to_fill_p95_ms),
      execution_model_dataset_top_fallback_latency_group: topFallbackEntryLatencyGroup ? String(topFallbackEntryLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_fallback_latency_market: topFallbackEntryLatencyGroup ? String(topFallbackEntryLatencyGroup.market || "").trim() || null : null,
      execution_model_dataset_top_fallback_latency_source: topFallbackEntryLatencyGroup ? String(topFallbackEntryLatencyGroup.primary_fill_source || topFallbackEntryLatencyGroup.source || "").trim() || null : null,
      execution_model_dataset_top_fallback_latency_p95_ms: toNum(topFallbackEntryLatencyGroup && topFallbackEntryLatencyGroup.created_to_fill_p95_ms),
      execution_model_dataset_top_fill_source: topFillSourceBucket ? String(topFillSourceBucket.key || "").trim() || null : null,
      execution_model_dataset_top_fill_source_rows_n: toNum(topFillSourceBucket && topFillSourceBucket.rows_n),
      execution_model_dataset_top_fill_source_slippage_zero_rate: toNum(topFillSourceBucket && topFillSourceBucket.slippage_zero_rate),
      execution_model_dataset_top_fill_source_slippage_measured_rate: toNum(topFillSourceBucket && topFillSourceBucket.slippage_measured_rate),
      execution_model_dataset_top_no_fill_reason: topNoFillReason ? String(topNoFillReason.key || "").trim() || null : null,
      execution_model_dataset_top_no_fill_reason_rows_n: toNum(topNoFillReason && topNoFillReason.rows_n),
      execution_model_dataset_top_no_fill_reason_family: topNoFillReasonFamily ? String(topNoFillReasonFamily.key || "").trim() || null : null,
      execution_model_dataset_top_no_fill_reason_family_rows_n: toNum(topNoFillReasonFamily && topNoFillReasonFamily.rows_n),
      execution_model_dataset_top_no_fill_subtype: topNoFillSubtype ? String(topNoFillSubtype.key || "").trim() || null : null,
      execution_model_dataset_top_no_fill_subtype_rows_n: toNum(topNoFillSubtype && topNoFillSubtype.rows_n),
    },
    summary: {
      goal_state: objectiveMet ? "OBJECTIVE_ON_TRACK" : "OBJECTIVE_RECOVERY_REQUIRED",
      authority_state: runtimeAuthorityState,
      runtime_authority_state: runtimeAuthorityState,
      change_authority_state: changeAuthorityState,
      change_authority_pending: authorityPending,
      phase_d_status: phaseDReady ? "READY" : (String(serverPrimarySummary.acceptance_reason || "PENDING").trim().toUpperCase() || "PENDING"),
      ops_status: opsHealthy ? "PASS" : "WARN",
      degraded_authority_enabled: authorityPolicy.degraded_timeout_policy.enabled === true,
      degraded_authority_min_timeout_streak: authorityPolicy.degraded_timeout_policy.min_timeout_streak,
      server_signal_authority_status: toUpper(serverSignalAuthoritySummary.drift_status) || "PARITY_UNKNOWN",
      server_signal_quality_status: toUpper(serverSignalQualitySummary.quality_status) || "N_A",
      server_signal_runtime_status: toUpper(serverSignalRuntimeSummary.runtime_status) || "N_A",
      server_signal_transition_status: serverSignalTransition.status,
      server_signal_transition_progress_pct: serverSignalTransition.progress_pct,
      market_regime_board_status: toUpper(marketRegimeBoardSummary.status) || "N_A",
      market_regime_rescue_n: toNum(marketRegimeBoardSummary.rescue_market_n) || 0,
      market_regime_keep_drop_n: toNum(marketRegimeBoardSummary.keep_drop_market_n) || 0,
      market_regime_top_rescue_market: String(marketRegimeBoardSummary.top_rescue_market || "").trim() || null,
      market_regime_top_keep_drop_market: String(marketRegimeBoardSummary.top_keep_drop_market || "").trim() || null,
      execution_microstructure_status: executionMicrostructureStatus,
      portfolio_cluster_risk_status: portfolioClusterRiskStatus,
      model_readiness_status: modelReadinessStatus,
      model_readiness_mfe_mae_labeled_n: toNum(modelReadinessSummary.mfe_mae_labeled_n),
      model_readiness_mfe_mae_label_rate: toNum(modelReadinessSummary.mfe_mae_label_rate),
      model_readiness_tp1_time_labeled_n: toNum(modelReadinessSummary.tp1_time_labeled_n),
      model_readiness_tp1_time_label_rate: toNum(modelReadinessSummary.tp1_time_label_rate),
      model_readiness_tp0_time_labeled_n: toNum(modelReadinessSummary.tp0_time_labeled_n),
      model_readiness_tp0_time_label_rate: toNum(modelReadinessSummary.tp0_time_label_rate),
      model_readiness_tp0_to_tp1_converted_n: toNum(modelReadinessSummary.tp0_to_tp1_converted_n),
      model_readiness_pre_tp1_time_stop_n: toNum(modelReadinessSummary.pre_tp1_time_stop_n),
      model_readiness_dataset_version_id: String(modelReadinessSummary.dataset_version_id || "").trim() || null,
      feature_store_status: featureStoreStatus,
      feature_store_version_id: String(
        featureStoreSummary.version_id
        || (featureStore && featureStore.feature_store_version && featureStore.feature_store_version.version_id)
        || ""
      ).trim() || null,
      ml_experiment_registry_status: mlExperimentRegistryStatus,
      ml_experiment_registry_experiment_id: String(mlExperimentRegistrySummary.experiment_id || "").trim() || null,
      ml_experiment_registry_execution_dataset_version_id: String(mlExperimentRegistrySummary.execution_dataset_version_id || "").trim() || null,
      ml_train_run_status: mlTrainRunStatus,
      ml_train_run_id: String(mlTrainRunSummary.train_run_id || "").trim() || null,
      ml_train_run_model_artifact_id: String(mlTrainRunSummary.model_artifact_id || "").trim() || null,
      ml_train_run_model_kind: String(mlTrainRunSummary.model_kind || "").trim() || null,
      ml_train_run_quality_gate_status: String(mlTrainRunSummary.quality_gate_status || "").trim() || null,
      ml_train_run_quality_gate_ready: mlTrainRunSummary.quality_gate_ready === true,
      execution_scope_train_run_status: mlTrainRunScopeStatus,
      execution_scope_train_run_id: String(mlTrainRunScopeSummary.train_run_id || "").trim() || null,
      execution_scope_train_run_model_artifact_id: String(mlTrainRunScopeSummary.model_artifact_id || "").trim() || null,
      execution_scope_train_run_model_kind: String(mlTrainRunScopeSummary.model_kind || "").trim() || null,
      execution_scope_train_run_quality_gate_status: String(mlTrainRunScopeSummary.quality_gate_status || "").trim() || null,
      execution_scope_train_run_quality_gate_ready: mlTrainRunScopeSummary.quality_gate_ready === true,
      execution_scope_train_run_top_policy_blocked_test_source: String(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source || "").trim() || null,
      execution_scope_train_run_top_policy_blocked_test_source_train_n: toNum(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source_train_n),
      execution_scope_train_run_top_policy_blocked_test_source_test_n: toNum(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source_test_n),
      execution_scope_train_run_top_policy_blocked_test_source_test_share: toNum(mlTrainRunScopeSummary.split_diagnostics && mlTrainRunScopeSummary.split_diagnostics.top_policy_blocked_test_source_test_share),
      ml_model_contract_status: mlModelContractStatus,
      ml_model_contract_deployment_stage: String(mlModelContractSummary.deployment_stage || "").trim() || null,
      ml_model_contract_canary_gate_status: String(mlModelContractSummary.canary_gate_status || "").trim() || null,
      ml_model_contract_promotion_status: String(mlModelContractSummary.promotion_status || "").trim() || null,
      ml_model_contract_model_artifact_id: String(mlModelContractSummary.model_artifact_id || "").trim() || null,
      execution_stage_latency_status: executionStageLatencyStatus,
      execution_stage_latency_top_signal_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_signal_to_intent_groups)?.key || "").trim() || null,
      execution_stage_latency_top_operational_signal_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_operational_signal_to_intent_groups)?.key || "").trim() || null,
      execution_stage_latency_top_webhook_saved_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_webhook_saved_to_intent_groups)?.key || "").trim() || null,
      execution_stage_latency_top_operational_webhook_saved_to_intent_group: String(firstArrayRow(executionStageLatencySummary.top_operational_webhook_saved_to_intent_groups)?.key || "").trim() || null,
      execution_bottleneck_delta_status: executionBottleneckDeltaStatus,
      execution_bottleneck_delta_comparable: executionBottleneckDeltaComparable,
      execution_bottleneck_delta_interpretation: executionBottleneckDeltaInterpretation,
      execution_bottleneck_delta_top_operational_webhook_delay_cause: executionBottleneckDeltaComparable ? (String(executionBottleneckDeltaSummary.current_top_operational_webhook_delay_cause || "").trim() || null) : null,
      execution_bottleneck_delta_top_operational_signal_to_intent_group: executionBottleneckDeltaComparable ? (String(executionBottleneckDeltaSummary.current_top_operational_signal_to_intent_group || "").trim() || null) : null,
      execution_model_dataset_status: executionModelStatus,
      execution_fill_inference_status: executionFillInferenceStatus,
      execution_fill_inference_model_artifact_id: String(executionFillInferenceSummary.model_artifact_id || "").trim() || null,
      execution_fill_inference_mismatch_rate: toNum(executionFillInferenceSummary.mismatch_rate),
      execution_fill_inference_filled_avg_pred_fill_prob: toNum(firstArrayRow((executionFillInferenceSummary.by_scope || []).filter((row) => String(row.key || "").trim().toUpperCase() === "FILLED"))?.avg_pred_fill_prob),
      execution_fill_inference_policy_blocked_avg_pred_fill_prob: toNum(firstArrayRow((executionFillInferenceSummary.by_scope || []).filter((row) => String(row.key || "").trim().toUpperCase() === "POLICY_BLOCKED"))?.avg_pred_fill_prob),
      execution_scope_inference_status: executionScopeInferenceStatus,
      execution_scope_inference_model_artifact_id: String(executionScopeInferenceSummary.model_artifact_id || "").trim() || null,
      execution_scope_inference_mismatch_rate: toNum(executionScopeInferenceSummary.mismatch_rate),
      execution_scope_inference_top_false_positive_group: String(firstArrayRow(executionScopeInferenceSummary.top_false_positive_groups)?.key || "").trim() || null,
      execution_scope_fp_diagnostics_status: String(executionQualitySummary.execution_scope_fp_diagnostics_status || "").trim() || null,
      execution_scope_fp_diagnostics_top_shared_feature: String(executionQualitySummary.execution_scope_fp_diagnostics_top_shared_feature || "").trim() || null,
      execution_scope_fp_diagnostics_top_context_profile: String(executionQualitySummary.execution_scope_fp_diagnostics_top_context_profile || "").trim() || null,
      execution_scope_fp_diagnostics_reference_rows_n: toNum(executionQualitySummary.execution_scope_fp_diagnostics_reference_rows_n),
      execution_scope_fp_diagnostics_reference_group_mode: String(executionQualitySummary.execution_scope_fp_diagnostics_reference_group_mode || "").trim() || null,
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
      execution_model_dataset_version_id: String(
        executionModelSummary.version_id
        || (executionModelDataset && executionModelDataset.execution_dataset_version && executionModelDataset.execution_dataset_version.version_id)
        || ""
      ).trim() || null,
      execution_model_dataset_top_webhook_to_intent_latency_group: topWebhookToIntentLatencyGroup ? String(topWebhookToIntentLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_webhook_delay_reason: topWebhookDelayReason ? String(topWebhookDelayReason.key || "").trim() || null : null,
      execution_model_dataset_top_webhook_delay_cause: topWebhookDelayCause ? String(topWebhookDelayCause.key || "").trim() || null : null,
      execution_model_dataset_top_operational_webhook_delay_cause: topOperationalWebhookDelayCause ? String(topOperationalWebhookDelayCause.key || "").trim() || null : null,
      execution_model_dataset_top_operational_immediate_intent_delay_group: topOperationalImmediateIntentDelayGroup ? String(topOperationalImmediateIntentDelayGroup.key || "").trim() || null : null,
      execution_model_dataset_top_signal_to_intent_latency_group: topSignalToIntentLatencyGroup ? String(topSignalToIntentLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_operational_signal_to_intent_latency_group: topOperationalSignalToIntentLatencyGroup ? String(topOperationalSignalToIntentLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_entry_latency_group: topEntryLatencyGroup ? String(topEntryLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_fallback_latency_group: topFallbackEntryLatencyGroup ? String(topFallbackEntryLatencyGroup.key || "").trim() || null : null,
      execution_model_dataset_top_fill_source: topFillSourceBucket ? String(topFillSourceBucket.key || "").trim() || null : null,
      execution_model_dataset_top_no_fill_reason: topNoFillReason ? String(topNoFillReason.key || "").trim() || null : null,
      execution_model_dataset_top_no_fill_reason_family: topNoFillReasonFamily ? String(topNoFillReasonFamily.key || "").trim() || null : null,
      execution_model_dataset_top_no_fill_subtype: topNoFillSubtype ? String(topNoFillSubtype.key || "").trim() || null : null,
      execution_quality_status: executionQualityStatus,
      lineage_status: lineageVerdict,
      account_integrity_status: overallIntegrity.ok === true ? "PASS" : (overallIntegrity.issue_count != null ? "WARN" : "N_A"),
    },
    server_signal_transition: serverSignalTransition,
  };
}

module.exports = {
  unwrapRawReport,
  deriveOpenClawAutonomyContract,
};
