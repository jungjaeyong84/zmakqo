"use strict";
const { unwrapRawReport, toNum, extractObjectiveScore, deriveObjectiveScoreSnapshot } = require("./objectiveScoreSnapshot");

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function readDisplay(value) {
  return value && value.display && typeof value.display === "object" ? value.display : null;
}

function readRaw(value) {
  return value && value.raw && typeof value.raw === "object" ? value.raw : null;
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

function rate(part, whole) {
  const a = Number(part);
  const b = Number(whole);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return a / b;
}

function cappedRate(part, whole) {
  const a = Number(part);
  const b = Number(whole);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return Math.min(a, b) / b;
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

function readNestedObject(value) {
  return value && typeof value === "object" ? value : {};
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
  exitTrailingContract = null,
  executionStructureUpgradeContract = null,
  costControlEngineContract = null,
  cohortRegimeParameterSplitContract = null,
  overallAccountReport = null,
  signalLineageHealth = null,
  modelReadiness = null,
  truthPreservationAudit = null,
  featureStore = null,
  executionModelDataset = null,
  executionFillInference = null,
  executionScopeInference = null,
  executionStageLatency = null,
  mlExperimentRegistry = null,
  executionBottleneckDelta = null,
  mlTrainRun = null,
  mlTrainRunScope = null,
  executionServingContract = null,
  mlGlobalCanaryEvidence = null,
  mlEvReplaySampleGap = null,
  mlReplayUnblockProjection = null,
  mlEvReplayDeltaDiagnostics = null,
  mlEvReplayMarketContribution = null,
  mlEvReplayProfileContribution = null,
  mlEvReplayStalePosDiagnostics = null,
  mlEvProfileReviewTracking = null,
  mlModelSpecificCanary = null,
  mlRollbackArm = null,
  validationDeploymentPipelineContract = null,
  performanceKpiUpgradeContract = null,
  mlModelContract = null,
  mlPromotionGate = null,
  evGateCompositePolicy = null,
  candidates = null,
  lineageSloDropMonitor = null,
} = {}) {
  const objectiveSummary = readSummary(objective);
  const objectiveSupervisorRaw = unwrapRawReport(objectiveSupervisor) || {};
  const objectiveSupervisorEnvelope = readRaw(objectiveSupervisor) || objectiveSupervisorRaw;
  const objectiveSupervisorFilterLayers = objectiveSupervisorEnvelope.filter_layers && typeof objectiveSupervisorEnvelope.filter_layers === "object"
    ? objectiveSupervisorEnvelope.filter_layers
    : {};
  const filterLayerIntegrity = objectiveSupervisorFilterLayers.integrity && typeof objectiveSupervisorFilterLayers.integrity === "object"
    ? objectiveSupervisorFilterLayers.integrity
    : {};
  const filterLayerEntryQuality = objectiveSupervisorFilterLayers.entry_quality && typeof objectiveSupervisorFilterLayers.entry_quality === "object"
    ? objectiveSupervisorFilterLayers.entry_quality
    : {};
  const filterLayerStateSoftSizing = objectiveSupervisorFilterLayers.state_soft_sizing && typeof objectiveSupervisorFilterLayers.state_soft_sizing === "object"
    ? objectiveSupervisorFilterLayers.state_soft_sizing
    : {};
  const filterLayerEvTimeValue = objectiveSupervisorFilterLayers.ev_time_value && typeof objectiveSupervisorFilterLayers.ev_time_value === "object"
    ? objectiveSupervisorFilterLayers.ev_time_value
    : {};
  const filterLayerWaitTiming = objectiveSupervisorFilterLayers.wait_timing && typeof objectiveSupervisorFilterLayers.wait_timing === "object"
    ? objectiveSupervisorFilterLayers.wait_timing
    : {};
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
  const exitTrailingContractSummary = readSummary(exitTrailingContract);
  const activeBinanceEntryExitContract = readNestedObject(exitTrailingContractSummary.active_binance_entry_exit_contract);
  const executionStructureUpgradeContractSummary = readSummary(executionStructureUpgradeContract);
  const costControlEngineContractSummary = readSummary(costControlEngineContract);
  const cohortRegimeParameterSplitContractSummary = readSummary(cohortRegimeParameterSplitContract);
  const overallAccount = overallAccountReport && typeof overallAccountReport === "object" ? overallAccountReport : {};
  const overallIntegrity = overallAccount.integrity && typeof overallAccount.integrity === "object" ? overallAccount.integrity : {};
  const overallOperations = overallAccount.operations && typeof overallAccount.operations === "object" ? overallAccount.operations : {};
  const signalLineageSummary = readSummary(signalLineageHealth);
  const modelReadinessSummary = readSummary(modelReadiness);
  const truthPreservationSummary = readSummary(truthPreservationAudit);
  const featureStoreSummary = readSummary(featureStore);
  const executionModelSummary = readSummary(executionModelDataset);
  const executionFillInferenceSummary = readSummary(executionFillInference);
  const executionScopeInferenceSummary = readSummary(executionScopeInference);
  const executionStageLatencySummary = readSummary(executionStageLatency);
  const mlExperimentRegistrySummary = readSummary(mlExperimentRegistry);
  const executionBottleneckDeltaSummary = readSummary(executionBottleneckDelta);
  const mlTrainRunSummary = readSummary(mlTrainRun);
  const mlTrainRunScopeSummary = readSummary(mlTrainRunScope);
  const executionServingContractSummary = readSummary(executionServingContract);
  const mlGlobalCanaryEvidenceSummary = readSummary(mlGlobalCanaryEvidence);
  const mlEvReplaySampleGapSummary = readSummary(mlEvReplaySampleGap);
  const mlReplayUnblockProjectionSummary = readSummary(mlReplayUnblockProjection);
  const mlEvReplayDeltaDiagnosticsSummary = readSummary(mlEvReplayDeltaDiagnostics);
  const mlEvReplayMarketContributionSummary = readSummary(mlEvReplayMarketContribution);
  const mlEvReplayProfileContributionSummary = readSummary(mlEvReplayProfileContribution);
  const mlEvReplayStalePosDiagnosticsSummary = readSummary(mlEvReplayStalePosDiagnostics);
  const mlEvProfileReviewTrackingSummary = readSummary(mlEvProfileReviewTracking);
  const mlModelSpecificCanarySummary = readSummary(mlModelSpecificCanary);
  const mlRollbackArmSummary = readSummary(mlRollbackArm);
  const validationDeploymentPipelineContractSummary = readSummary(validationDeploymentPipelineContract);
  const performanceKpiUpgradeContractSummary = readSummary(performanceKpiUpgradeContract);
  const mlModelContractSummary = readSummary(mlModelContract);
  const mlPromotionGateSummary = readSummary(mlPromotionGate);
  const evGateCompositePolicySummary = readSummary(evGateCompositePolicy);
  const lineageSloDropMonitorSummary = readSummary(lineageSloDropMonitor);
  const exitTrailingContractActiveBinanceProfileMode = String(exitTrailingContractSummary.active_binance_profile_mode || "").trim() || null;
  const exitTrailingContractCanonicalMode = String(exitTrailingContractSummary.canonical_mode || "").trim() || null;
  const exitTrailingContractActiveBinanceTp1Pct = toNum(activeBinanceEntryExitContract.tp1_pct);
  const exitTrailingContractActiveBinanceBePct = toNum(activeBinanceEntryExitContract.be_pct);
  const exitTrailingContractActiveBinanceTrailRMultiple = toNum(activeBinanceEntryExitContract.trail_r_multiple);
  const runtimeTp1LadderDefaultProfile = String(serverSignalRuntimeSummary.tp1_ladder_default_profile || "").trim() || null;
  const runtimeOppositeCooldownDefaultProfile = String(serverSignalRuntimeSummary.opposite_cooldown_default_profile || "").trim() || null;
  const runtimeVsCanonicalExitContractDiverged = Boolean(
    (toUpper(runtimeTp1LadderDefaultProfile) && toUpper(exitTrailingContractActiveBinanceProfileMode)
      && toUpper(runtimeTp1LadderDefaultProfile) !== toUpper(exitTrailingContractActiveBinanceProfileMode))
    || (toUpper(runtimeOppositeCooldownDefaultProfile) && toUpper(exitTrailingContractActiveBinanceProfileMode)
      && toUpper(runtimeOppositeCooldownDefaultProfile) !== toUpper(exitTrailingContractActiveBinanceProfileMode))
  );
  const candidatesRaw = unwrapRawReport(candidates) || {};
  const candidatesSummary = readSummary(candidates);
  const candidateRows = Array.isArray(candidatesRaw.rows) ? candidatesRaw.rows : [];
  const topCandidateId = String(candidatesSummary.top_candidate_id || "").trim() || null;
  const topCandidateRow = candidateRows.find((row) => String(row && row.candidate_id || "").trim() === topCandidateId) || null;
  const evCandidateRow = candidateRows.find((row) => String(row && row.scope || "").trim().toUpperCase() === "EV") || null;
  const executionModelStatus = toUpper(executionModelSummary.status) || "N_A";
  const executionFillInferenceStatus = toUpper(executionFillInferenceSummary.status) || "N_A";
  const executionScopeInferenceStatus = toUpper(executionScopeInferenceSummary.status) || "N_A";
  const executionStageLatencyStatus = toUpper(executionStageLatencySummary.status) || "N_A";
  const mlExperimentRegistryStatus = toUpper(mlExperimentRegistrySummary.status) || "N_A";
  const executionBottleneckDeltaStatus = toUpper(executionBottleneckDeltaSummary.status) || "N_A";
  const mlTrainRunStatus = toUpper(mlTrainRunSummary.status) || "N_A";
  const mlTrainRunScopeStatus = toUpper(mlTrainRunScopeSummary.status) || "N_A";
  const executionServingContractStatus = toUpper(executionServingContractSummary.status) || "N_A";
  const mlModelContractStatus = toUpper(mlModelContractSummary.status) || "N_A";
  const mlPromotionGateStatus = toUpper(mlPromotionGateSummary.status) || "N_A";
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
    min_monthly_run_rate_krw: envNum("OPENCLAW_AUTONOMY_MIN_MONTHLY_RUN_RATE_KRW", 150000),
    primary_performance_metrics: [
      "TP0_HIT_RATE",
      "TP1_HIT_RATE",
      "FEE_ADJUSTED_EXPECTANCY",
      "SIGNAL_TO_FILL_CONVERSION",
    ],
    legacy_win_rate_reference_only: true,
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
  const signalEntry24h = toNum(serverSignalQualitySummary.authoritative_entry_signal_24h_n) || 0;
  const signalIntent24h = toNum(serverSignalQualitySummary.order_intent_24h_n) || 0;
  const signalFill24h = toNum(serverSignalQualitySummary.fill_24h_n) || 0;
  const serverSignalEntryToIntentConversion24h = cappedRate(signalIntent24h, signalEntry24h);
  const serverSignalEntryToFillConversion24h = cappedRate(signalFill24h, signalEntry24h);
  const serverSignalIntentToFillConversion24h = cappedRate(signalFill24h, signalIntent24h);
  const objectiveMet = Boolean(
    currentObjectiveScore != null && currentObjectiveScore >= objectivePolicy.min_objective_score
    && currentMonthlyRunRate != null && currentMonthlyRunRate >= objectivePolicy.min_monthly_run_rate_krw
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
  const truthPreservationAuditStatus = toUpper(truthPreservationSummary.status) || "N_A";
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
      performance_primary_metrics: objectivePolicy.primary_performance_metrics.slice(),
      legacy_win_rate_reference_only: objectivePolicy.legacy_win_rate_reference_only === true,
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
      server_signal_runtime_ev_gate_unknown_gen_relax_enabled: serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_enabled === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_mode: String(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_mode || "").trim() || null,
      server_signal_runtime_ev_gate_unknown_gen_relax_started_at: String(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_started_at || "").trim() || null,
      server_signal_runtime_ev_gate_unknown_gen_relax_window_hours: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_window_hours),
      server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_review_after_hours),
      server_signal_runtime_ev_gate_unknown_gen_relax_active_window: serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_active_window === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled: serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_auto_rollback_enabled === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_tp1_prob_min_delta),
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_tp1_prob_full_delta),
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_tp1_prob_kill_delta),
      server_signal_runtime_tp1_ladder_enabled: serverSignalRuntimeSummary.tp1_ladder_enabled === true,
      server_signal_runtime_tp1_ladder_stage1_realized_n_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_realized_n_min),
      server_signal_runtime_tp1_ladder_stage1_tp0_hit_rate_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_tp0_hit_rate_min),
      server_signal_runtime_tp1_ladder_stage1_tp0_to_tp1_conversion_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_tp0_to_tp1_conversion_min),
      server_signal_runtime_tp1_ladder_stage1_fee_adjusted_expectancy_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_fee_adjusted_expectancy_min),
      server_signal_runtime_tp1_ladder_stage2_realized_n_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_realized_n_min),
      server_signal_runtime_tp1_ladder_stage2_tp0_hit_rate_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_tp0_hit_rate_min),
      server_signal_runtime_tp1_ladder_stage2_tp1_hit_rate_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_tp1_hit_rate_min),
      server_signal_runtime_tp1_ladder_stage2_tp0_to_tp1_conversion_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_tp0_to_tp1_conversion_min),
      server_signal_runtime_tp1_ladder_stage2_fee_adjusted_expectancy_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_fee_adjusted_expectancy_min),
      server_signal_runtime_tp1_ladder_freeze: serverSignalRuntimeSummary.tp1_ladder_freeze === true,
      server_signal_runtime_tp1_ladder_default_profile: String(serverSignalRuntimeSummary.tp1_ladder_default_profile || "").trim() || null,
      server_signal_runtime_tp1_ladder_promotion_mode: String(serverSignalRuntimeSummary.tp1_ladder_promotion_mode || "").trim() || null,
      exit_trailing_contract_canonical_mode: exitTrailingContractCanonicalMode,
      exit_trailing_contract_active_binance_profile_mode: exitTrailingContractActiveBinanceProfileMode,
      exit_trailing_contract_active_binance_tp1_pct: exitTrailingContractActiveBinanceTp1Pct,
      exit_trailing_contract_active_binance_be_pct: exitTrailingContractActiveBinanceBePct,
      exit_trailing_contract_active_binance_trail_r_multiple: exitTrailingContractActiveBinanceTrailRMultiple,
      runtime_vs_canonical_exit_contract_diverged: runtimeVsCanonicalExitContractDiverged,
      server_signal_runtime_opposite_cooldown_bars_base: toNum(serverSignalRuntimeSummary.opposite_cooldown_bars_base),
      server_signal_runtime_opposite_cooldown_bars_mixed: toNum(serverSignalRuntimeSummary.opposite_cooldown_bars_mixed),
      server_signal_runtime_opposite_cooldown_bars_rescue: toNum(serverSignalRuntimeSummary.opposite_cooldown_bars_rescue),
      server_signal_runtime_opposite_cooldown_ms_base: toNum(serverSignalRuntimeSummary.opposite_cooldown_ms_base),
      server_signal_runtime_opposite_cooldown_ms_mixed: toNum(serverSignalRuntimeSummary.opposite_cooldown_ms_mixed),
      server_signal_runtime_opposite_cooldown_ms_rescue: toNum(serverSignalRuntimeSummary.opposite_cooldown_ms_rescue),
      server_signal_runtime_opposite_cooldown_default_profile: String(serverSignalRuntimeSummary.opposite_cooldown_default_profile || "").trim() || null,
      server_signal_runtime_opposite_cooldown_promotion_mode: String(serverSignalRuntimeSummary.opposite_cooldown_promotion_mode || "").trim() || null,
      server_signal_runtime_reverse_exception_mixed_bypass_tier_block: serverSignalRuntimeSummary.reverse_exception_mixed_bypass_tier_block === true,
      server_signal_runtime_reverse_exception_rescue_bypass_tier_block: serverSignalRuntimeSummary.reverse_exception_rescue_bypass_tier_block === true,
      server_signal_runtime_auto_score_freeze: serverSignalRuntimeSummary.auto_score_freeze === true,
      server_signal_authoritative_24h_n: toNum(serverSignalAuthoritySummary.authoritative_server_24h_n) || 0,
      server_signal_shadow_24h_n: toNum(serverSignalAuthoritySummary.pine_shadow_24h_n) || 0,
      server_signal_entry_24h_n: toNum(serverSignalQualitySummary.authoritative_entry_signal_24h_n) || 0,
      server_signal_intent_24h_n: toNum(serverSignalQualitySummary.order_intent_24h_n) || 0,
      server_signal_fill_24h_n: toNum(serverSignalQualitySummary.fill_24h_n) || 0,
      server_signal_entry_to_intent_conversion_24h: serverSignalEntryToIntentConversion24h,
      server_signal_entry_to_fill_conversion_24h: serverSignalEntryToFillConversion24h,
      server_signal_intent_to_fill_conversion_24h: serverSignalIntentToFillConversion24h,
      server_signal_runtime_signal_overlap_enabled: serverSignalRuntimeSummary.signal_overlap_enabled === true,
      server_signal_runtime_signal_overlap_bars: toNum(serverSignalRuntimeSummary.signal_overlap_bars),
      server_signal_runtime_same_direction_trail_profit_cooldown_enabled: serverSignalRuntimeSummary.same_direction_trail_profit_cooldown_enabled === true,
      server_signal_runtime_same_direction_trail_profit_cooldown_ms: toNum(serverSignalRuntimeSummary.same_direction_trail_profit_cooldown_ms),
      server_signal_runtime_opposite_transition_enabled: serverSignalRuntimeSummary.opposite_transition_enabled === true,
      server_signal_runtime_opposite_transition_reduce_fraction: toNum(serverSignalRuntimeSummary.opposite_transition_reduce_fraction),
      server_signal_runtime_opposite_transition_confirm_bars: toNum(serverSignalRuntimeSummary.opposite_transition_confirm_bars),
      server_signal_runtime_operational_drop_watch_reasons: Array.isArray(serverSignalRuntimeSummary.operational_drop_watch_reasons)
        ? serverSignalRuntimeSummary.operational_drop_watch_reasons.map((row) => String(row || "").trim()).filter(Boolean)
        : [],
      server_signal_runtime_binance_live_state_self_heal_enabled: serverSignalRuntimeSummary.binance_live_state_self_heal_enabled === true,
      server_signal_runtime_binance_live_state_self_heal_max_positions: toNum(serverSignalRuntimeSummary.binance_live_state_self_heal_max_positions),
      server_signal_runtime_binance_live_state_projection_ssot: String(serverSignalRuntimeSummary.binance_live_state_projection_ssot || "").trim() || null,
      server_signal_runtime_binance_live_state_projection_writer_mode: String(serverSignalRuntimeSummary.binance_live_state_projection_writer_mode || "").trim() || null,
      server_signal_runtime_binance_live_state_active_position_n: toNum(serverSignalRuntimeSummary.binance_live_state_active_position_n),
      server_signal_runtime_binance_live_state_projection_out_of_sync_n: toNum(serverSignalRuntimeSummary.binance_live_state_projection_out_of_sync_n),
      server_signal_runtime_binance_live_state_self_heal_required_n: toNum(serverSignalRuntimeSummary.binance_live_state_self_heal_required_n),
      server_signal_runtime_binance_live_state_native_stop_missing_n: toNum(serverSignalRuntimeSummary.binance_live_state_native_stop_missing_n),
      server_signal_runtime_binance_live_state_trail_without_tp1_n: toNum(serverSignalRuntimeSummary.binance_live_state_trail_without_tp1_n),
      server_signal_runtime_binance_live_state_tp1_done_with_tp_order_n: toNum(serverSignalRuntimeSummary.binance_live_state_tp1_done_with_tp_order_n),
      server_signal_runtime_binance_live_state_invariant_counts: serverSignalRuntimeSummary.binance_live_state_invariant_counts && typeof serverSignalRuntimeSummary.binance_live_state_invariant_counts === "object"
        ? serverSignalRuntimeSummary.binance_live_state_invariant_counts
        : {},
      filter_layer_1_integrity_mode: String(filterLayerIntegrity.server_mode || "").trim() || null,
      filter_layer_1_integrity_expectation: String(filterLayerIntegrity.expectation || "").trim() || null,
      filter_layer_1_integrity_coverage_pass: filterLayerIntegrity.coverage_pass === true,
      filter_layer_2_entry_quality_candidate_verdict: String(filterLayerEntryQuality.pine_candidate_verdict || "").trim() || null,
      filter_layer_2_entry_quality_actions: toNum(filterLayerEntryQuality.quality_actions),
      filter_layer_3_state_soft_sizing_ml_action: String(filterLayerStateSoftSizing.ml_action || "").trim() || null,
      filter_layer_3_state_soft_sizing_physics_action: String(filterLayerStateSoftSizing.physics_action || "").trim() || null,
      filter_layer_3_state_soft_sizing_qty_scale: toNum(filterLayerStateSoftSizing.qty_scale),
      filter_layer_3_state_soft_sizing_dominant_state: String(filterLayerStateSoftSizing.dominant_state || "").trim() || null,
      filter_layer_3_state_soft_sizing_dominant_action: String(filterLayerStateSoftSizing.dominant_action || "").trim() || null,
      filter_layer_4_ev_time_value_tuner_reason: String(filterLayerEvTimeValue.tuner_reason || "").trim() || null,
      filter_layer_4_ev_time_value_observed_tuner_reason: String(filterLayerEvTimeValue.observed_tuner_reason || "").trim() || null,
      filter_layer_4_ev_time_value_fresh: filterLayerEvTimeValue.fresh === true,
      filter_layer_4_ev_time_value_age_hours: toNum(filterLayerEvTimeValue.age_hours),
      filter_layer_4_ev_time_value_policy_version: String(filterLayerEvTimeValue.policy_version || "").trim() || null,
      filter_layer_4_ev_time_value_policy_source: String(filterLayerEvTimeValue.policy_source || "").trim() || null,
      filter_layer_5_wait_timing_tuner_reason: String(filterLayerWaitTiming.tuner_reason || "").trim() || null,
      filter_layer_5_wait_timing_wait_action: String(filterLayerWaitTiming.wait_action || "").trim() || null,
      filter_layer_5_wait_timing_febt_calc_ok_rate: toNum(filterLayerWaitTiming.febt_calc_ok_rate),
      filter_layer_5_wait_timing_febt_phase_known: toNum(filterLayerWaitTiming.febt_phase_known),
      filter_layer_5_wait_timing_febt_fire_n: toNum(filterLayerWaitTiming.febt_fire_n),
      filter_layer_5_wait_timing_febt_late_n: toNum(filterLayerWaitTiming.febt_late_n),
      filter_layer_5_wait_timing_febt_void_n: toNum(filterLayerWaitTiming.febt_void_n),
      filter_layer_5_wait_timing_febt_disagreement_n: toNum(filterLayerWaitTiming.febt_disagreement_n),
      filter_layer_5_wait_timing_febt_fallback_legacy_n: toNum(filterLayerWaitTiming.febt_fallback_legacy_n),
      filter_layer_5_wait_timing_febt_missing_rate: toNum(filterLayerWaitTiming.febt_missing_rate),
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
      lineage_entry_fills_intent_null_rate: toNum(signalLineageSummary.entry_fills_intent_id_null_rate),
      lineage_external_reconciled_fill_intent_null_n: toNum(signalLineageSummary.external_reconciled_fills_intent_id_null_n),
      lineage_warning_reason_n: Array.isArray(signalLineageSummary.warning_reasons) ? signalLineageSummary.warning_reasons.length : 0,
      lineage_external_reconciled_fill_intent_null_present: Array.isArray(signalLineageSummary.warning_reasons)
        && signalLineageSummary.warning_reasons.includes("EXTERNAL_RECONCILED_FILL_INTENT_NULL_PRESENT"),
      lineage_fills_signal_null_rate: toNum(signalLineageSummary.fills_signal_doc_id_null_rate),
      lineage_intents_signal_null_rate: toNum(signalLineageSummary.intents_signal_doc_id_null_rate),
      lineage_slo_drop_monitor_status: String(lineageSloDropMonitorSummary.status || "").trim() || null,
      lineage_slo_drop_monitor_evidence_status: String(lineageSloDropMonitorSummary.evidence_status || "").trim() || null,
      lineage_slo_drop_monitor_post_fix_lineage_slo_drop_n: toNum(lineageSloDropMonitorSummary.post_fix_lineage_slo_drop_n),
      lineage_slo_drop_monitor_pre_fix_lineage_slo_drop_n: toNum(lineageSloDropMonitorSummary.pre_fix_lineage_slo_drop_n),
      lineage_slo_drop_monitor_latest_drop_created_at: String(lineageSloDropMonitorSummary.latest_lineage_slo_drop_created_at || "").trim() || null,
      lineage_slo_drop_monitor_post_fix_clear: lineageSloDropMonitorSummary.post_fix_clear === true,
      account_integrity_ok: overallIntegrity.ok === true,
      account_integrity_issue_n: accountIntegrityIssueN,
      account_active_market_count: toNum(overallIntegrity.active_market_count) || 0,
      account_position_doc_count: toNum(overallIntegrity.position_doc_count) || 0,
      account_ops_status: String(overallOperations.status || "").trim() || null,
      account_ops_mode: String(overallOperations.mode || "").trim() || null,
      execution_microstructure_status: executionMicrostructureStatus,
      execution_structure_upgrade_contract_status: String(executionStructureUpgradeContractSummary.status || "").trim() || null,
      execution_structure_upgrade_mode: String(executionStructureUpgradeContractSummary.structure_mode || "").trim() || null,
      execution_structure_upgrade_survivability_priority: String(executionStructureUpgradeContractSummary.survivability_priority || "").trim() || null,
      execution_structure_upgrade_stage_sequence_ready: executionStructureUpgradeContractSummary.stage_sequence_ready === true,
      execution_structure_upgrade_survivability_ready: executionStructureUpgradeContractSummary.survivability_ready === true,
      execution_structure_upgrade_label_support_ready: executionStructureUpgradeContractSummary.label_support_ready === true,
      execution_structure_upgrade_tp0_stage_active: executionStructureUpgradeContractSummary.tp0_stage_active === true,
      execution_structure_upgrade_tp1_stage_active: executionStructureUpgradeContractSummary.tp1_stage_active === true,
      execution_structure_upgrade_trail_stage_active: executionStructureUpgradeContractSummary.trail_stage_active === true,
      execution_structure_upgrade_conversion_observable: executionStructureUpgradeContractSummary.conversion_observable === true,
      execution_structure_upgrade_pre_tp1_survivability_observable: executionStructureUpgradeContractSummary.pre_tp1_survivability_observable === true,
      execution_structure_upgrade_tp0_pct: toNum(executionStructureUpgradeContractSummary.tp0_pct),
      execution_structure_upgrade_tp0_qty_ratio: toNum(executionStructureUpgradeContractSummary.tp0_qty_ratio),
      execution_structure_upgrade_tp1_pct: toNum(executionStructureUpgradeContractSummary.tp1_pct),
      execution_structure_upgrade_trail_r_multiple: toNum(executionStructureUpgradeContractSummary.trail_r_multiple),
      execution_structure_upgrade_tp0_to_tp1_conversion_rate: toNum(executionStructureUpgradeContractSummary.tp0_to_tp1_conversion_rate),
      execution_structure_upgrade_pre_tp1_time_stop_rate: toNum(executionStructureUpgradeContractSummary.pre_tp1_time_stop_rate),
      execution_structure_upgrade_blocking_reason_n: toNum(executionStructureUpgradeContractSummary.blocking_reason_n),
      cost_control_engine_contract_status: String(costControlEngineContractSummary.status || "").trim() || null,
      cost_control_engine_contract_mode: String(costControlEngineContractSummary.contract_mode || "").trim() || null,
      cost_control_engine_automatic_entry_suppression_ready: costControlEngineContractSummary.automatic_entry_suppression_ready === true,
      cost_control_engine_system_reentry_control_ready: costControlEngineContractSummary.system_reentry_control_ready === true,
      cost_control_engine_expectancy_gate_active: costControlEngineContractSummary.expectancy_gate_active === true,
      cost_control_engine_cost_block_mode_active: costControlEngineContractSummary.cost_block_mode_active === true,
      cost_control_engine_cooldown_reentry_control_active: costControlEngineContractSummary.cooldown_reentry_control_active === true,
      cost_control_engine_reverse_reentry_control_active: costControlEngineContractSummary.reverse_reentry_control_active === true,
      cost_control_engine_fill_cost_pressure_active: costControlEngineContractSummary.fill_cost_pressure_active === true,
      cost_control_engine_expectancy_metric: String(costControlEngineContractSummary.expectancy_metric || "").trim() || null,
      cost_control_engine_expectancy_metric_family: String(costControlEngineContractSummary.expectancy_metric_family || "").trim() || null,
      cost_control_engine_operations_mode: String(costControlEngineContractSummary.operations_mode || "").trim() || null,
      cost_control_engine_cooldown_policy_status: String(costControlEngineContractSummary.cooldown_policy_status || "").trim() || null,
      cost_control_engine_cooldown_policy_mismatch_n: toNum(costControlEngineContractSummary.cooldown_policy_mismatch_n),
      cost_control_engine_reverse_policy_status: String(costControlEngineContractSummary.reverse_policy_status || "").trim() || null,
      cost_control_engine_reverse_blocked_n: toNum(costControlEngineContractSummary.reverse_blocked_n),
      cost_control_engine_reverse_cooldown_n: toNum(costControlEngineContractSummary.reverse_cooldown_n),
      cost_control_engine_blocking_reason_n: toNum(costControlEngineContractSummary.blocking_reason_n),
      cohort_regime_parameter_split_contract_status: String(cohortRegimeParameterSplitContractSummary.status || "").trim() || null,
      cohort_regime_parameter_split_contract_mode: String(cohortRegimeParameterSplitContractSummary.contract_mode || "").trim() || null,
      cohort_regime_parameter_split_cohort_scope: String(cohortRegimeParameterSplitContractSummary.cohort_scope || "").trim() || null,
      cohort_regime_parameter_split_active_market_n: toNum(cohortRegimeParameterSplitContractSummary.active_market_n),
      cohort_regime_parameter_split_active_cohort_n: toNum(cohortRegimeParameterSplitContractSummary.active_cohort_n),
      cohort_regime_parameter_split_rescue_market_n: toNum(cohortRegimeParameterSplitContractSummary.rescue_market_n),
      cohort_regime_parameter_split_mixed_market_n: toNum(cohortRegimeParameterSplitContractSummary.mixed_market_n),
      cohort_regime_parameter_split_keep_drop_market_n: toNum(cohortRegimeParameterSplitContractSummary.keep_drop_market_n),
      cohort_regime_parameter_split_has_market_split: cohortRegimeParameterSplitContractSummary.has_market_split === true,
      cohort_regime_parameter_split_cohort_parameterization_ready: cohortRegimeParameterSplitContractSummary.cohort_parameterization_ready === true,
      cohort_regime_parameter_split_regime_switch_ready: cohortRegimeParameterSplitContractSummary.regime_switch_ready === true,
      cohort_regime_parameter_split_policy_scoped_ready: cohortRegimeParameterSplitContractSummary.policy_scoped_ready === true,
      cohort_regime_parameter_split_auto_switch_observability_ready: cohortRegimeParameterSplitContractSummary.auto_switch_observability_ready === true,
      cohort_regime_parameter_split_automatic_transition_ready: cohortRegimeParameterSplitContractSummary.automatic_transition_ready === true,
      cohort_regime_parameter_split_policy_plan_status: String(cohortRegimeParameterSplitContractSummary.policy_plan_status || "").trim() || null,
      cohort_regime_parameter_split_policy_plan_mode: String(cohortRegimeParameterSplitContractSummary.policy_plan_mode || "").trim() || null,
      cohort_regime_parameter_split_policy_global_qty_scale: toNum(cohortRegimeParameterSplitContractSummary.policy_global_qty_scale),
      cohort_regime_parameter_split_cohort_action_profile_n: toNum(cohortRegimeParameterSplitContractSummary.cohort_action_profile_n),
      cohort_regime_parameter_split_blocking_reason_n: toNum(cohortRegimeParameterSplitContractSummary.blocking_reason_n),
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
      truth_preservation_audit_status: truthPreservationAuditStatus,
      truth_preservation_ready: truthPreservationSummary.truth_preservation_ready === true,
      truth_preservation_dataset_version_id: String(truthPreservationSummary.dataset_version_id || "").trim() || null,
      truth_preservation_feature_store_version_id: String(truthPreservationSummary.feature_store_version_id || "").trim() || null,
      truth_preservation_execution_dataset_version_id: String(truthPreservationSummary.execution_dataset_version_id || "").trim() || null,
      truth_preservation_lineage_status: String(truthPreservationSummary.lineage_status || "").trim() || null,
      truth_preservation_stale_comparison_active: truthPreservationSummary.stale_comparison_active === true,
      truth_preservation_legacy_webhook_outcome_only_rows_n: toNum(truthPreservationSummary.legacy_webhook_outcome_only_rows_n),
      truth_preservation_blocking_reason_n: toNum(truthPreservationSummary.blocking_reason_n),
      truth_preservation_warning_reason_n: toNum(truthPreservationSummary.warning_reason_n),
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
      execution_serving_contract_status: executionServingContractStatus,
      execution_serving_stage: String(executionServingContractSummary.serving_stage || "").trim() || null,
      execution_serving_decision: String(executionServingContractSummary.serving_decision || "").trim() || null,
      execution_serving_shadow_ready: executionServingContractSummary.shadow_ready === true,
      execution_serving_scope_train_run_aligned: executionServingContractSummary.scope_train_run_aligned === true,
      execution_serving_scope_registry_aligned: executionServingContractSummary.scope_registry_aligned === true,
      execution_serving_preferred_model_family: String(executionServingContractSummary.preferred_model_family || "").trim() || null,
      execution_serving_preferred_model_kind: String(executionServingContractSummary.preferred_model_kind || "").trim() || null,
      execution_serving_preferred_model_artifact_id: String(executionServingContractSummary.preferred_model_artifact_id || "").trim() || null,
      ml_global_canary_status: String(mlGlobalCanaryEvidenceSummary.status || "").trim() || null,
      ml_global_canary_ready: mlGlobalCanaryEvidenceSummary.global_canary_ready === true,
      ml_global_canary_evidence_status: String(mlGlobalCanaryEvidenceSummary.evidence_status || "").trim() || null,
      ml_global_canary_dominant_blocker: String(mlGlobalCanaryEvidenceSummary.dominant_blocker || "").trim() || null,
      ml_global_canary_replay_evidence_status: String(mlGlobalCanaryEvidenceSummary.replay_evidence_status || "").trim() || null,
      ml_global_canary_replay_dominant_issue: String(mlGlobalCanaryEvidenceSummary.replay_dominant_issue || "").trim() || null,
      ml_global_canary_replay_best_candidate_id: String(mlGlobalCanaryEvidenceSummary.replay_best_candidate_id || "").trim() || null,
      ml_global_canary_replay_best_display_candidate_id: String(mlGlobalCanaryEvidenceSummary.replay_best_display_candidate_id || "").trim() || null,
      ml_global_canary_replay_best_candidate_review_mode: String(mlGlobalCanaryEvidenceSummary.replay_best_candidate_review_mode || "").trim() || null,
      ml_global_canary_replay_best_candidate_profile_target_n: toNum(mlGlobalCanaryEvidenceSummary.replay_best_candidate_profile_target_n),
      ml_global_canary_replay_best_candidate_top_return_drag_profile: String(mlGlobalCanaryEvidenceSummary.replay_best_candidate_top_return_drag_profile || "").trim() || null,
      ml_global_canary_replay_best_candidate_top_return_drag_driver: String(mlGlobalCanaryEvidenceSummary.replay_best_candidate_top_return_drag_driver || "").trim() || null,
      ml_global_canary_replay_best_candidate_top_mixed_profile: String(mlGlobalCanaryEvidenceSummary.replay_best_candidate_top_mixed_profile || "").trim() || null,
      ml_global_canary_replay_best_candidate_top_mixed_driver: String(mlGlobalCanaryEvidenceSummary.replay_best_candidate_top_mixed_driver || "").trim() || null,
      ml_global_canary_replay_sample_gap_status: String(mlGlobalCanaryEvidenceSummary.replay_sample_gap_status || mlEvReplaySampleGapSummary.evidence_status || "").trim() || null,
      ml_global_canary_replay_sample_required_realized_n: toNum(mlGlobalCanaryEvidenceSummary.replay_sample_required_realized_n ?? mlEvReplaySampleGapSummary.required_realized_n),
      ml_global_canary_replay_sample_current_effective_realized_n: toNum(mlGlobalCanaryEvidenceSummary.replay_sample_current_effective_realized_n ?? mlEvReplaySampleGapSummary.governance_effective_realized_n),
      ml_global_canary_replay_sample_gap_n: toNum(mlGlobalCanaryEvidenceSummary.replay_sample_gap_n ?? mlEvReplaySampleGapSummary.governance_effective_gap_n),
      ml_global_canary_replay_sample_dominant_dimension: String(mlGlobalCanaryEvidenceSummary.replay_sample_dominant_dimension || mlEvReplaySampleGapSummary.dominant_sample_dimension || "").trim() || null,
      ml_global_canary_replay_projected_ready_if_sample_gap_closed: mlGlobalCanaryEvidenceSummary.replay_projected_ready_if_sample_gap_closed === true || mlReplayUnblockProjectionSummary.projected_replay_ready_if_sample_gap_closed === true,
      ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed: String(mlGlobalCanaryEvidenceSummary.replay_projected_residual_issue_after_sample_gap_closed || mlReplayUnblockProjectionSummary.projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      ml_ev_replay_delta_diagnostics_status: String(mlEvReplayDeltaDiagnosticsSummary.status || "").trim() || null,
      ml_ev_replay_delta_driver_class: String(mlEvReplayDeltaDiagnosticsSummary.driver_class || "").trim() || null,
      ml_ev_replay_delta_historical_applied_gap_role: String(mlEvReplayDeltaDiagnosticsSummary.historical_applied_gap_role || "").trim() || null,
      ml_ev_replay_delta_top_positive_market: String(mlEvReplayDeltaDiagnosticsSummary.top_positive_market || "").trim() || null,
      ml_ev_replay_delta_top_negative_market: String(mlEvReplayDeltaDiagnosticsSummary.top_negative_market || "").trim() || null,
      ml_ev_replay_market_contribution_status: String(mlEvReplayMarketContributionSummary.status || "").trim() || null,
      ml_ev_replay_market_dominant_drag_pattern: String(mlEvReplayMarketContributionSummary.dominant_drag_pattern || "").trim() || null,
      ml_ev_replay_market_positive_objective_market_n: toNum(mlEvReplayMarketContributionSummary.positive_objective_market_n),
      ml_ev_replay_market_return_drag_market_n: toNum(mlEvReplayMarketContributionSummary.return_drag_market_n),
      ml_ev_replay_market_positive_with_return_drag_market_n: toNum(mlEvReplayMarketContributionSummary.positive_objective_with_return_drag_market_n),
      ml_ev_replay_market_top_positive_market: String(mlEvReplayMarketContributionSummary.top_positive_market || "").trim() || null,
      ml_ev_replay_market_top_return_drag_market: String(mlEvReplayMarketContributionSummary.top_return_drag_market || "").trim() || null,
      ml_ev_replay_market_top_mixed_market: String(mlEvReplayMarketContributionSummary.top_mixed_market || "").trim() || null,
      ml_ev_replay_profile_contribution_status: String(mlEvReplayProfileContributionSummary.status || "").trim() || null,
      ml_ev_replay_profile_evidence_status: String(mlEvReplayProfileContributionSummary.evidence_status || "").trim() || null,
      ml_ev_replay_profile_top_return_drag_market: String(mlEvReplayProfileContributionSummary.top_return_drag_market || "").trim() || null,
      ml_ev_replay_profile_top_return_drag_profile: String(mlEvReplayProfileContributionSummary.top_return_drag_profile || "").trim() || null,
      ml_ev_replay_profile_top_return_drag_profile_rows_delta: toNum(mlEvReplayProfileContributionSummary.top_return_drag_profile_rows_delta),
      ml_ev_replay_profile_top_return_drag_profile_avg_ret_net_delta: toNum(mlEvReplayProfileContributionSummary.top_return_drag_profile_avg_ret_net_delta),
      ml_ev_replay_profile_top_mixed_market: String(mlEvReplayProfileContributionSummary.top_mixed_market || "").trim() || null,
      ml_ev_replay_profile_top_mixed_profile: String(mlEvReplayProfileContributionSummary.top_mixed_profile || "").trim() || null,
      ml_ev_replay_profile_top_mixed_profile_rows_delta: toNum(mlEvReplayProfileContributionSummary.top_mixed_profile_rows_delta),
      ml_ev_replay_profile_top_mixed_profile_avg_ret_net_delta: toNum(mlEvReplayProfileContributionSummary.top_mixed_profile_avg_ret_net_delta),
      ml_ev_replay_stale_pos_diagnostics_status: String(mlEvReplayStalePosDiagnosticsSummary.status || "").trim() || null,
      ml_ev_replay_stale_pos_evidence_status: String(mlEvReplayStalePosDiagnosticsSummary.evidence_status || "").trim() || null,
      ml_ev_replay_stale_pos_top_return_drag_profile: String(mlEvReplayStalePosDiagnosticsSummary.top_return_drag_profile || "").trim() || null,
      ml_ev_replay_stale_pos_top_return_drag_avg_ev_lb: toNum(mlEvReplayStalePosDiagnosticsSummary.top_return_drag_avg_ev_lb),
      ml_ev_replay_stale_pos_top_return_drag_avg_delay_cost: toNum(mlEvReplayStalePosDiagnosticsSummary.top_return_drag_avg_delay_cost),
      ml_ev_replay_stale_pos_top_return_drag_avg_late_risk: toNum(mlEvReplayStalePosDiagnosticsSummary.top_return_drag_avg_late_risk),
      ml_ev_replay_stale_pos_top_mixed_profile: String(mlEvReplayStalePosDiagnosticsSummary.top_mixed_profile || "").trim() || null,
      ml_ev_replay_stale_pos_top_mixed_avg_ev_lb: toNum(mlEvReplayStalePosDiagnosticsSummary.top_mixed_avg_ev_lb),
      ml_ev_replay_stale_pos_top_mixed_avg_delay_cost: toNum(mlEvReplayStalePosDiagnosticsSummary.top_mixed_avg_delay_cost),
      ml_ev_replay_stale_pos_top_mixed_avg_late_risk: toNum(mlEvReplayStalePosDiagnosticsSummary.top_mixed_avg_late_risk),
      ml_ev_profile_review_tracking_status: String(mlEvProfileReviewTrackingSummary.status || "").trim() || null,
      ml_ev_profile_review_tracking_evidence_status: String(mlEvProfileReviewTrackingSummary.evidence_status || "").trim() || null,
      ml_ev_profile_review_mode: String(mlEvProfileReviewTrackingSummary.review_mode || "").trim() || null,
      ml_ev_profile_review_target_n: toNum(mlEvProfileReviewTrackingSummary.target_n),
      ml_ev_profile_review_split_ready: mlEvProfileReviewTrackingSummary.split_ready === true,
      ml_ev_profile_review_split_blocker: String(mlEvProfileReviewTrackingSummary.split_blocker || "").trim() || null,
      ml_ev_profile_review_top_return_drag_profile: String(mlEvProfileReviewTrackingSummary.top_return_drag_profile || "").trim() || null,
      ml_ev_profile_review_top_return_drag_driver: String(mlEvProfileReviewTrackingSummary.top_return_drag_driver || "").trim() || null,
      ml_ev_profile_review_top_mixed_profile: String(mlEvProfileReviewTrackingSummary.top_mixed_profile || "").trim() || null,
      ml_ev_profile_review_top_mixed_driver: String(mlEvProfileReviewTrackingSummary.top_mixed_driver || "").trim() || null,
      ml_model_specific_canary_status: String(mlModelSpecificCanarySummary.status || "").trim() || null,
      ml_model_specific_canary_binding_mode: String(mlModelSpecificCanarySummary.binding_mode || "").trim() || null,
      ml_model_specific_canary_evidence_status: String(mlModelSpecificCanarySummary.evidence_status || "").trim() || null,
      ml_model_specific_canary_ready: mlModelSpecificCanarySummary.model_specific_canary_ready === true,
      ml_model_specific_canary_preferred_model_artifact_id: String(mlModelSpecificCanarySummary.preferred_model_artifact_id || "").trim() || null,
      ml_model_specific_canary_preferred_train_run_id: String(mlModelSpecificCanarySummary.preferred_train_run_id || "").trim() || null,
      ml_model_specific_canary_bound_model_artifact_id: String(mlModelSpecificCanarySummary.bound_model_artifact_id || "").trim() || null,
      ml_model_specific_canary_bound_train_run_id: String(mlModelSpecificCanarySummary.bound_train_run_id || "").trim() || null,
      ml_rollback_arm_status: String(mlRollbackArmSummary.status || "").trim() || null,
      ml_rollback_arm_binding_source: String(mlRollbackArmSummary.rollback_binding_source || "").trim() || null,
      ml_rollback_arm_evidence_status: String(mlRollbackArmSummary.evidence_status || "").trim() || null,
      ml_rollback_arm_ready: mlRollbackArmSummary.rollback_arm_ready === true,
      ml_rollback_arm_target_path: String(mlRollbackArmSummary.rollback_target_path || "").trim() || null,
      ml_rollback_arm_engine_bundle_id: String(mlRollbackArmSummary.rollback_engine_bundle_id || "").trim() || null,
      ml_rollback_arm_trigger_status: String(mlRollbackArmSummary.rollback_trigger_status || "").trim() || null,
      ml_rollback_arm_server_primary_trigger_n: toNum(mlRollbackArmSummary.server_primary_rollback_trigger_n),
      validation_deployment_pipeline_contract_status: String(validationDeploymentPipelineContractSummary.status || "").trim() || null,
      validation_deployment_pipeline_contract_mode: String(validationDeploymentPipelineContractSummary.contract_mode || "").trim() || null,
      validation_deployment_pipeline_current_deployment_stage: String(validationDeploymentPipelineContractSummary.current_deployment_stage || "").trim() || null,
      validation_deployment_pipeline_shadow_numeric_gate_ready: validationDeploymentPipelineContractSummary.shadow_numeric_gate_ready === true,
      validation_deployment_pipeline_canary_numeric_gate_ready: validationDeploymentPipelineContractSummary.canary_numeric_gate_ready === true,
      validation_deployment_pipeline_live_numeric_gate_ready: validationDeploymentPipelineContractSummary.live_numeric_gate_ready === true,
      validation_deployment_pipeline_numeric_judgement_ready: validationDeploymentPipelineContractSummary.numeric_judgement_ready === true,
      validation_deployment_pipeline_automatic_rollback_ready: validationDeploymentPipelineContractSummary.automatic_rollback_ready === true,
      validation_deployment_pipeline_global_canary_evidence_status: String(validationDeploymentPipelineContractSummary.global_canary_evidence_status || "").trim() || null,
      validation_deployment_pipeline_global_canary_dominant_blocker: String(validationDeploymentPipelineContractSummary.global_canary_dominant_blocker || "").trim() || null,
      validation_deployment_pipeline_replay_sample_gap_n: toNum(validationDeploymentPipelineContractSummary.replay_sample_gap_n),
      validation_deployment_pipeline_replay_projected_ready_if_gap_closed: validationDeploymentPipelineContractSummary.replay_projected_ready_if_gap_closed === true,
      validation_deployment_pipeline_replay_projected_residual_issue_after_sample_gap_closed: String(validationDeploymentPipelineContractSummary.replay_projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      validation_deployment_pipeline_blocking_reason_n: toNum(validationDeploymentPipelineContractSummary.blocking_reason_n),
      performance_kpi_upgrade_contract_status: String(performanceKpiUpgradeContractSummary.status || "").trim() || null,
      performance_kpi_upgrade_contract_mode: String(performanceKpiUpgradeContractSummary.contract_mode || "").trim() || null,
      performance_kpi_upgrade_microstructure_kpi_ready: performanceKpiUpgradeContractSummary.microstructure_kpi_ready === true,
      performance_kpi_upgrade_survivability_kpi_ready: performanceKpiUpgradeContractSummary.survivability_kpi_ready === true,
      performance_kpi_upgrade_expectancy_kpi_ready: performanceKpiUpgradeContractSummary.expectancy_kpi_ready === true,
      performance_kpi_upgrade_structure_alignment_ready: performanceKpiUpgradeContractSummary.structure_alignment_ready === true,
      performance_kpi_upgrade_cost_alignment_ready: performanceKpiUpgradeContractSummary.cost_alignment_ready === true,
      performance_kpi_upgrade_tp0_hit_rate: toNum(performanceKpiUpgradeContractSummary.tp0_hit_rate),
      performance_kpi_upgrade_tp1_hit_rate: toNum(performanceKpiUpgradeContractSummary.tp1_hit_rate),
      performance_kpi_upgrade_tp0_to_tp1_conversion_rate: toNum(performanceKpiUpgradeContractSummary.tp0_to_tp1_conversion_rate),
      performance_kpi_upgrade_pre_tp1_time_stop_rate: toNum(performanceKpiUpgradeContractSummary.pre_tp1_time_stop_rate),
      performance_kpi_upgrade_fee_adjusted_expectancy: toNum(performanceKpiUpgradeContractSummary.fee_adjusted_expectancy),
      performance_kpi_upgrade_realized_trade_n: toNum(performanceKpiUpgradeContractSummary.realized_trade_n),
      performance_kpi_upgrade_legacy_win_rate_reference: toNum(performanceKpiUpgradeContractSummary.legacy_win_rate_reference),
      performance_kpi_upgrade_objective_verdict: String(performanceKpiUpgradeContractSummary.objective_verdict || "").trim() || null,
      performance_kpi_upgrade_blocking_reason_n: toNum(performanceKpiUpgradeContractSummary.blocking_reason_n),
      ev_gate_policy_status: String(evGateCompositePolicySummary.status || "").trim() || null,
      ev_gate_policy_basis: String(evGateCompositePolicySummary.policy_basis || "").trim() || null,
      ev_gate_canonical_policy_version: String(evGateCompositePolicySummary.canonical_policy_version || "").trim() || null,
      ev_gate_compatibility_policy_version: String(evGateCompositePolicySummary.compatibility_policy_version || "").trim() || null,
      ev_gate_threshold_metric: String(evGateCompositePolicySummary.threshold_metric || "").trim() || null,
      ev_gate_threshold_metric_family: String(evGateCompositePolicySummary.threshold_metric_family || "").trim() || null,
      ev_gate_compatibility_drop_reason: String(evGateCompositePolicySummary.compatibility_drop_reason || "").trim() || null,
      ev_gate_default_tp0_pct: toNum(evGateCompositePolicySummary.default_tp0_pct),
      ev_gate_default_tp0_qty_ratio: toNum(evGateCompositePolicySummary.default_tp0_qty_ratio),
      ev_gate_default_tp1_pct: toNum(evGateCompositePolicySummary.default_tp1_pct),
      ev_gate_default_sl_pct: toNum(evGateCompositePolicySummary.default_sl_pct),
      ev_gate_legacy_threshold_setting_keys: Array.isArray(evGateCompositePolicySummary.legacy_threshold_setting_keys)
        ? evGateCompositePolicySummary.legacy_threshold_setting_keys.map((row) => String(row || "").trim()).filter(Boolean)
        : [],
      ev_gate_tp1_prob_min_global: toNum(evGateCompositePolicySummary.tp1_prob_min_global),
      ev_gate_tp1_prob_min_early: toNum(evGateCompositePolicySummary.tp1_prob_min_early),
      ev_gate_tp1_prob_min_core: toNum(evGateCompositePolicySummary.tp1_prob_min_core),
      self_evolution_top_candidate_id: topCandidateId,
      self_evolution_top_candidate_canonical_id: String(topCandidateRow && topCandidateRow.canonical_candidate_id || "").trim() || null,
      self_evolution_top_candidate_scope: String(topCandidateRow && topCandidateRow.scope || "").trim() || null,
      ev_candidate_id: String(evCandidateRow && evCandidateRow.candidate_id || "").trim() || null,
      ev_candidate_canonical_id: String(evCandidateRow && evCandidateRow.canonical_candidate_id || "").trim() || null,
      ml_model_contract_status: mlModelContractStatus,
      ml_model_contract_deployment_stage: String(mlModelContractSummary.deployment_stage || "").trim() || null,
      ml_model_contract_canary_gate_status: String(mlModelContractSummary.canary_gate_status || "").trim() || null,
      ml_model_contract_promotion_status: String(mlModelContractSummary.promotion_status || "").trim() || null,
      ml_model_contract_model_artifact_id: String(mlModelContractSummary.model_artifact_id || "").trim() || null,
      ml_promotion_gate_status: mlPromotionGateStatus,
      ml_promotion_stage: String(mlPromotionGateSummary.promotion_stage || "").trim() || null,
      ml_promotion_decision: String(mlPromotionGateSummary.promotion_decision || "").trim() || null,
      ml_promotion_global_canary_gate_status: String(mlPromotionGateSummary.global_canary_gate_status || "").trim() || null,
      ml_promotion_global_canary_evidence_status: String(mlPromotionGateSummary.global_canary_evidence_status || "").trim() || null,
      ml_promotion_global_canary_dominant_blocker: String(mlPromotionGateSummary.global_canary_dominant_blocker || "").trim() || null,
      ml_promotion_global_canary_replay_evidence_status: String(mlPromotionGateSummary.global_canary_replay_evidence_status || "").trim() || null,
      ml_promotion_global_canary_replay_dominant_issue: String(mlPromotionGateSummary.global_canary_replay_dominant_issue || "").trim() || null,
      ml_promotion_global_canary_replay_best_candidate_id: String(mlPromotionGateSummary.global_canary_replay_best_candidate_id || "").trim() || null,
      ml_promotion_global_canary_replay_best_display_candidate_id: String(mlPromotionGateSummary.global_canary_replay_best_display_candidate_id || "").trim() || null,
      ml_promotion_global_canary_replay_best_candidate_review_mode: String(mlPromotionGateSummary.global_canary_replay_best_candidate_review_mode || "").trim() || null,
      ml_promotion_global_canary_replay_best_candidate_profile_target_n: toNum(mlPromotionGateSummary.global_canary_replay_best_candidate_profile_target_n),
      ml_promotion_global_canary_replay_best_candidate_top_return_drag_profile: String(mlPromotionGateSummary.global_canary_replay_best_candidate_top_return_drag_profile || "").trim() || null,
      ml_promotion_global_canary_replay_best_candidate_top_return_drag_driver: String(mlPromotionGateSummary.global_canary_replay_best_candidate_top_return_drag_driver || "").trim() || null,
      ml_promotion_global_canary_replay_best_candidate_top_mixed_profile: String(mlPromotionGateSummary.global_canary_replay_best_candidate_top_mixed_profile || "").trim() || null,
      ml_promotion_global_canary_replay_best_candidate_top_mixed_driver: String(mlPromotionGateSummary.global_canary_replay_best_candidate_top_mixed_driver || "").trim() || null,
      ml_promotion_global_canary_replay_sample_gap_status: String(mlPromotionGateSummary.global_canary_replay_sample_gap_status || "").trim() || null,
      ml_promotion_global_canary_replay_sample_required_realized_n: toNum(mlPromotionGateSummary.global_canary_replay_sample_required_realized_n),
      ml_promotion_global_canary_replay_sample_current_effective_realized_n: toNum(mlPromotionGateSummary.global_canary_replay_sample_current_effective_realized_n),
      ml_promotion_global_canary_replay_sample_gap_n: toNum(mlPromotionGateSummary.global_canary_replay_sample_gap_n),
      ml_promotion_global_canary_replay_sample_dominant_dimension: String(mlPromotionGateSummary.global_canary_replay_sample_dominant_dimension || "").trim() || null,
      ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed: mlPromotionGateSummary.global_canary_replay_projected_ready_if_sample_gap_closed === true,
      ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed: String(mlPromotionGateSummary.global_canary_replay_projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      ml_promotion_model_specific_canary_gate_status: String(mlPromotionGateSummary.model_specific_canary_gate_status || "").trim() || null,
      ml_promotion_model_specific_canary_ready: mlPromotionGateSummary.model_specific_canary_ready === true,
      ml_promotion_model_specific_canary_binding_mode: String(mlPromotionGateSummary.model_specific_canary_binding_mode || "").trim() || null,
      ml_promotion_model_specific_canary_evidence_status: String(mlPromotionGateSummary.model_specific_canary_evidence_status || "").trim() || null,
      ml_promotion_rollback_gate_status: String(mlPromotionGateSummary.rollback_gate_status || "").trim() || null,
      ml_promotion_rollback_binding_source: String(mlPromotionGateSummary.rollback_binding_source || "").trim() || null,
      ml_promotion_rollback_evidence_status: String(mlPromotionGateSummary.rollback_evidence_status || "").trim() || null,
      ml_promotion_rollback_arm_ready: mlPromotionGateSummary.rollback_arm_ready === true,
      ml_promotion_preferred_model_family: String(mlPromotionGateSummary.preferred_model_family || "").trim() || null,
      ml_promotion_preferred_model_artifact_id: String(mlPromotionGateSummary.preferred_model_artifact_id || "").trim() || null,
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
      performance_primary_metrics: objectivePolicy.primary_performance_metrics.slice(),
      legacy_win_rate_reference_only: objectivePolicy.legacy_win_rate_reference_only === true,
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
      server_signal_runtime_ev_gate_unknown_gen_relax_enabled: serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_enabled === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_mode: String(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_mode || "").trim() || null,
      server_signal_runtime_ev_gate_unknown_gen_relax_started_at: String(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_started_at || "").trim() || null,
      server_signal_runtime_ev_gate_unknown_gen_relax_window_hours: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_window_hours),
      server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_review_after_hours),
      server_signal_runtime_ev_gate_unknown_gen_relax_active_window: serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_active_window === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled: serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_auto_rollback_enabled === true,
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_tp1_prob_min_delta),
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_tp1_prob_full_delta),
      server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta: toNum(serverSignalRuntimeSummary.ev_gate_unknown_gen_relax_tp1_prob_kill_delta),
      server_signal_runtime_tp1_ladder_enabled: serverSignalRuntimeSummary.tp1_ladder_enabled === true,
      server_signal_runtime_tp1_ladder_stage1_realized_n_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_realized_n_min),
      server_signal_runtime_tp1_ladder_stage1_tp0_hit_rate_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_tp0_hit_rate_min),
      server_signal_runtime_tp1_ladder_stage1_tp0_to_tp1_conversion_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_tp0_to_tp1_conversion_min),
      server_signal_runtime_tp1_ladder_stage1_fee_adjusted_expectancy_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage1_fee_adjusted_expectancy_min),
      server_signal_runtime_tp1_ladder_stage2_realized_n_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_realized_n_min),
      server_signal_runtime_tp1_ladder_stage2_tp0_hit_rate_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_tp0_hit_rate_min),
      server_signal_runtime_tp1_ladder_stage2_tp1_hit_rate_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_tp1_hit_rate_min),
      server_signal_runtime_tp1_ladder_stage2_tp0_to_tp1_conversion_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_tp0_to_tp1_conversion_min),
      server_signal_runtime_tp1_ladder_stage2_fee_adjusted_expectancy_min: toNum(serverSignalRuntimeSummary.tp1_ladder_stage2_fee_adjusted_expectancy_min),
      server_signal_runtime_tp1_ladder_freeze: serverSignalRuntimeSummary.tp1_ladder_freeze === true,
      server_signal_runtime_tp1_ladder_default_profile: String(serverSignalRuntimeSummary.tp1_ladder_default_profile || "").trim() || null,
      server_signal_runtime_tp1_ladder_promotion_mode: String(serverSignalRuntimeSummary.tp1_ladder_promotion_mode || "").trim() || null,
      server_signal_runtime_signal_overlap_enabled: serverSignalRuntimeSummary.signal_overlap_enabled === true,
      server_signal_runtime_signal_overlap_bars: toNum(serverSignalRuntimeSummary.signal_overlap_bars),
      server_signal_runtime_same_direction_trail_profit_cooldown_enabled: serverSignalRuntimeSummary.same_direction_trail_profit_cooldown_enabled === true,
      server_signal_runtime_same_direction_trail_profit_cooldown_ms: toNum(serverSignalRuntimeSummary.same_direction_trail_profit_cooldown_ms),
      exit_trailing_contract_canonical_mode: exitTrailingContractCanonicalMode,
      exit_trailing_contract_active_binance_profile_mode: exitTrailingContractActiveBinanceProfileMode,
      exit_trailing_contract_active_binance_tp1_pct: exitTrailingContractActiveBinanceTp1Pct,
      exit_trailing_contract_active_binance_be_pct: exitTrailingContractActiveBinanceBePct,
      exit_trailing_contract_active_binance_trail_r_multiple: exitTrailingContractActiveBinanceTrailRMultiple,
      runtime_vs_canonical_exit_contract_diverged: runtimeVsCanonicalExitContractDiverged,
      server_signal_runtime_opposite_cooldown_bars_base: toNum(serverSignalRuntimeSummary.opposite_cooldown_bars_base),
      server_signal_runtime_opposite_cooldown_bars_mixed: toNum(serverSignalRuntimeSummary.opposite_cooldown_bars_mixed),
      server_signal_runtime_opposite_cooldown_bars_rescue: toNum(serverSignalRuntimeSummary.opposite_cooldown_bars_rescue),
      server_signal_runtime_opposite_cooldown_ms_base: toNum(serverSignalRuntimeSummary.opposite_cooldown_ms_base),
      server_signal_runtime_opposite_cooldown_ms_mixed: toNum(serverSignalRuntimeSummary.opposite_cooldown_ms_mixed),
      server_signal_runtime_opposite_cooldown_ms_rescue: toNum(serverSignalRuntimeSummary.opposite_cooldown_ms_rescue),
      server_signal_runtime_opposite_cooldown_default_profile: String(serverSignalRuntimeSummary.opposite_cooldown_default_profile || "").trim() || null,
      server_signal_runtime_opposite_cooldown_promotion_mode: String(serverSignalRuntimeSummary.opposite_cooldown_promotion_mode || "").trim() || null,
      server_signal_runtime_opposite_transition_enabled: serverSignalRuntimeSummary.opposite_transition_enabled === true,
      server_signal_runtime_opposite_transition_reduce_fraction: toNum(serverSignalRuntimeSummary.opposite_transition_reduce_fraction),
      server_signal_runtime_opposite_transition_confirm_bars: toNum(serverSignalRuntimeSummary.opposite_transition_confirm_bars),
      server_signal_runtime_reverse_exception_mixed_bypass_tier_block: serverSignalRuntimeSummary.reverse_exception_mixed_bypass_tier_block === true,
      server_signal_runtime_reverse_exception_rescue_bypass_tier_block: serverSignalRuntimeSummary.reverse_exception_rescue_bypass_tier_block === true,
      server_signal_runtime_auto_score_freeze: serverSignalRuntimeSummary.auto_score_freeze === true,
      server_signal_runtime_operational_drop_watch_reasons: Array.isArray(serverSignalRuntimeSummary.operational_drop_watch_reasons)
        ? serverSignalRuntimeSummary.operational_drop_watch_reasons.map((row) => String(row || "").trim()).filter(Boolean)
        : [],
      server_signal_runtime_binance_live_state_self_heal_enabled: serverSignalRuntimeSummary.binance_live_state_self_heal_enabled === true,
      server_signal_runtime_binance_live_state_self_heal_max_positions: toNum(serverSignalRuntimeSummary.binance_live_state_self_heal_max_positions),
      server_signal_runtime_binance_live_state_projection_ssot: String(serverSignalRuntimeSummary.binance_live_state_projection_ssot || "").trim() || null,
      server_signal_runtime_binance_live_state_projection_writer_mode: String(serverSignalRuntimeSummary.binance_live_state_projection_writer_mode || "").trim() || null,
      server_signal_runtime_binance_live_state_active_position_n: toNum(serverSignalRuntimeSummary.binance_live_state_active_position_n),
      server_signal_runtime_binance_live_state_projection_out_of_sync_n: toNum(serverSignalRuntimeSummary.binance_live_state_projection_out_of_sync_n),
      server_signal_runtime_binance_live_state_self_heal_required_n: toNum(serverSignalRuntimeSummary.binance_live_state_self_heal_required_n),
      server_signal_runtime_binance_live_state_native_stop_missing_n: toNum(serverSignalRuntimeSummary.binance_live_state_native_stop_missing_n),
      server_signal_runtime_binance_live_state_trail_without_tp1_n: toNum(serverSignalRuntimeSummary.binance_live_state_trail_without_tp1_n),
      server_signal_runtime_binance_live_state_tp1_done_with_tp_order_n: toNum(serverSignalRuntimeSummary.binance_live_state_tp1_done_with_tp_order_n),
      server_signal_runtime_binance_live_state_invariant_counts: serverSignalRuntimeSummary.binance_live_state_invariant_counts && typeof serverSignalRuntimeSummary.binance_live_state_invariant_counts === "object"
        ? serverSignalRuntimeSummary.binance_live_state_invariant_counts
        : {},
      server_signal_entry_to_intent_conversion_24h: serverSignalEntryToIntentConversion24h,
      server_signal_entry_to_fill_conversion_24h: serverSignalEntryToFillConversion24h,
      server_signal_intent_to_fill_conversion_24h: serverSignalIntentToFillConversion24h,
      filter_layer_1_integrity_mode: String(filterLayerIntegrity.server_mode || "").trim() || null,
      filter_layer_1_integrity_expectation: String(filterLayerIntegrity.expectation || "").trim() || null,
      filter_layer_1_integrity_coverage_pass: filterLayerIntegrity.coverage_pass === true,
      filter_layer_2_entry_quality_candidate_verdict: String(filterLayerEntryQuality.pine_candidate_verdict || "").trim() || null,
      filter_layer_2_entry_quality_actions: toNum(filterLayerEntryQuality.quality_actions),
      filter_layer_3_state_soft_sizing_ml_action: String(filterLayerStateSoftSizing.ml_action || "").trim() || null,
      filter_layer_3_state_soft_sizing_physics_action: String(filterLayerStateSoftSizing.physics_action || "").trim() || null,
      filter_layer_3_state_soft_sizing_qty_scale: toNum(filterLayerStateSoftSizing.qty_scale),
      filter_layer_3_state_soft_sizing_dominant_state: String(filterLayerStateSoftSizing.dominant_state || "").trim() || null,
      filter_layer_3_state_soft_sizing_dominant_action: String(filterLayerStateSoftSizing.dominant_action || "").trim() || null,
      filter_layer_4_ev_time_value_tuner_reason: String(filterLayerEvTimeValue.tuner_reason || "").trim() || null,
      filter_layer_4_ev_time_value_observed_tuner_reason: String(filterLayerEvTimeValue.observed_tuner_reason || "").trim() || null,
      filter_layer_4_ev_time_value_fresh: filterLayerEvTimeValue.fresh === true,
      filter_layer_4_ev_time_value_age_hours: toNum(filterLayerEvTimeValue.age_hours),
      filter_layer_4_ev_time_value_policy_version: String(filterLayerEvTimeValue.policy_version || "").trim() || null,
      filter_layer_4_ev_time_value_policy_source: String(filterLayerEvTimeValue.policy_source || "").trim() || null,
      filter_layer_5_wait_timing_tuner_reason: String(filterLayerWaitTiming.tuner_reason || "").trim() || null,
      filter_layer_5_wait_timing_wait_action: String(filterLayerWaitTiming.wait_action || "").trim() || null,
      filter_layer_5_wait_timing_febt_calc_ok_rate: toNum(filterLayerWaitTiming.febt_calc_ok_rate),
      filter_layer_5_wait_timing_febt_phase_known: toNum(filterLayerWaitTiming.febt_phase_known),
      filter_layer_5_wait_timing_febt_fire_n: toNum(filterLayerWaitTiming.febt_fire_n),
      filter_layer_5_wait_timing_febt_late_n: toNum(filterLayerWaitTiming.febt_late_n),
      filter_layer_5_wait_timing_febt_void_n: toNum(filterLayerWaitTiming.febt_void_n),
      filter_layer_5_wait_timing_febt_disagreement_n: toNum(filterLayerWaitTiming.febt_disagreement_n),
      filter_layer_5_wait_timing_febt_fallback_legacy_n: toNum(filterLayerWaitTiming.febt_fallback_legacy_n),
      filter_layer_5_wait_timing_febt_missing_rate: toNum(filterLayerWaitTiming.febt_missing_rate),
      server_signal_transition_status: serverSignalTransition.status,
      server_signal_transition_progress_pct: serverSignalTransition.progress_pct,
      market_regime_board_status: toUpper(marketRegimeBoardSummary.status) || "N_A",
      market_regime_rescue_n: toNum(marketRegimeBoardSummary.rescue_market_n) || 0,
      market_regime_keep_drop_n: toNum(marketRegimeBoardSummary.keep_drop_market_n) || 0,
      market_regime_top_rescue_market: String(marketRegimeBoardSummary.top_rescue_market || "").trim() || null,
      market_regime_top_keep_drop_market: String(marketRegimeBoardSummary.top_keep_drop_market || "").trim() || null,
      execution_microstructure_status: executionMicrostructureStatus,
      execution_structure_upgrade_contract_status: String(executionStructureUpgradeContractSummary.status || "").trim() || null,
      execution_structure_upgrade_mode: String(executionStructureUpgradeContractSummary.structure_mode || "").trim() || null,
      execution_structure_upgrade_survivability_priority: String(executionStructureUpgradeContractSummary.survivability_priority || "").trim() || null,
      execution_structure_upgrade_stage_sequence_ready: executionStructureUpgradeContractSummary.stage_sequence_ready === true,
      execution_structure_upgrade_survivability_ready: executionStructureUpgradeContractSummary.survivability_ready === true,
      execution_structure_upgrade_label_support_ready: executionStructureUpgradeContractSummary.label_support_ready === true,
      execution_structure_upgrade_tp0_stage_active: executionStructureUpgradeContractSummary.tp0_stage_active === true,
      execution_structure_upgrade_tp1_stage_active: executionStructureUpgradeContractSummary.tp1_stage_active === true,
      execution_structure_upgrade_trail_stage_active: executionStructureUpgradeContractSummary.trail_stage_active === true,
      execution_structure_upgrade_conversion_observable: executionStructureUpgradeContractSummary.conversion_observable === true,
      execution_structure_upgrade_pre_tp1_survivability_observable: executionStructureUpgradeContractSummary.pre_tp1_survivability_observable === true,
      execution_structure_upgrade_tp0_pct: toNum(executionStructureUpgradeContractSummary.tp0_pct),
      execution_structure_upgrade_tp0_qty_ratio: toNum(executionStructureUpgradeContractSummary.tp0_qty_ratio),
      execution_structure_upgrade_tp1_pct: toNum(executionStructureUpgradeContractSummary.tp1_pct),
      execution_structure_upgrade_trail_r_multiple: toNum(executionStructureUpgradeContractSummary.trail_r_multiple),
      execution_structure_upgrade_tp0_to_tp1_conversion_rate: toNum(executionStructureUpgradeContractSummary.tp0_to_tp1_conversion_rate),
      execution_structure_upgrade_pre_tp1_time_stop_rate: toNum(executionStructureUpgradeContractSummary.pre_tp1_time_stop_rate),
      execution_structure_upgrade_blocking_reason_n: toNum(executionStructureUpgradeContractSummary.blocking_reason_n),
      cost_control_engine_contract_status: String(costControlEngineContractSummary.status || "").trim() || null,
      cost_control_engine_contract_mode: String(costControlEngineContractSummary.contract_mode || "").trim() || null,
      cost_control_engine_automatic_entry_suppression_ready: costControlEngineContractSummary.automatic_entry_suppression_ready === true,
      cost_control_engine_system_reentry_control_ready: costControlEngineContractSummary.system_reentry_control_ready === true,
      cost_control_engine_expectancy_gate_active: costControlEngineContractSummary.expectancy_gate_active === true,
      cost_control_engine_cost_block_mode_active: costControlEngineContractSummary.cost_block_mode_active === true,
      cost_control_engine_cooldown_reentry_control_active: costControlEngineContractSummary.cooldown_reentry_control_active === true,
      cost_control_engine_reverse_reentry_control_active: costControlEngineContractSummary.reverse_reentry_control_active === true,
      cost_control_engine_fill_cost_pressure_active: costControlEngineContractSummary.fill_cost_pressure_active === true,
      cost_control_engine_expectancy_metric: String(costControlEngineContractSummary.expectancy_metric || "").trim() || null,
      cost_control_engine_expectancy_metric_family: String(costControlEngineContractSummary.expectancy_metric_family || "").trim() || null,
      cost_control_engine_operations_mode: String(costControlEngineContractSummary.operations_mode || "").trim() || null,
      cost_control_engine_cooldown_policy_status: String(costControlEngineContractSummary.cooldown_policy_status || "").trim() || null,
      cost_control_engine_cooldown_policy_mismatch_n: toNum(costControlEngineContractSummary.cooldown_policy_mismatch_n),
      cost_control_engine_reverse_policy_status: String(costControlEngineContractSummary.reverse_policy_status || "").trim() || null,
      cost_control_engine_reverse_blocked_n: toNum(costControlEngineContractSummary.reverse_blocked_n),
      cost_control_engine_reverse_cooldown_n: toNum(costControlEngineContractSummary.reverse_cooldown_n),
      cost_control_engine_blocking_reason_n: toNum(costControlEngineContractSummary.blocking_reason_n),
      cohort_regime_parameter_split_contract_status: String(cohortRegimeParameterSplitContractSummary.status || "").trim() || null,
      cohort_regime_parameter_split_contract_mode: String(cohortRegimeParameterSplitContractSummary.contract_mode || "").trim() || null,
      cohort_regime_parameter_split_cohort_scope: String(cohortRegimeParameterSplitContractSummary.cohort_scope || "").trim() || null,
      cohort_regime_parameter_split_active_market_n: toNum(cohortRegimeParameterSplitContractSummary.active_market_n),
      cohort_regime_parameter_split_active_cohort_n: toNum(cohortRegimeParameterSplitContractSummary.active_cohort_n),
      cohort_regime_parameter_split_rescue_market_n: toNum(cohortRegimeParameterSplitContractSummary.rescue_market_n),
      cohort_regime_parameter_split_mixed_market_n: toNum(cohortRegimeParameterSplitContractSummary.mixed_market_n),
      cohort_regime_parameter_split_keep_drop_market_n: toNum(cohortRegimeParameterSplitContractSummary.keep_drop_market_n),
      cohort_regime_parameter_split_has_market_split: cohortRegimeParameterSplitContractSummary.has_market_split === true,
      cohort_regime_parameter_split_cohort_parameterization_ready: cohortRegimeParameterSplitContractSummary.cohort_parameterization_ready === true,
      cohort_regime_parameter_split_regime_switch_ready: cohortRegimeParameterSplitContractSummary.regime_switch_ready === true,
      cohort_regime_parameter_split_policy_scoped_ready: cohortRegimeParameterSplitContractSummary.policy_scoped_ready === true,
      cohort_regime_parameter_split_auto_switch_observability_ready: cohortRegimeParameterSplitContractSummary.auto_switch_observability_ready === true,
      cohort_regime_parameter_split_automatic_transition_ready: cohortRegimeParameterSplitContractSummary.automatic_transition_ready === true,
      cohort_regime_parameter_split_policy_plan_status: String(cohortRegimeParameterSplitContractSummary.policy_plan_status || "").trim() || null,
      cohort_regime_parameter_split_policy_plan_mode: String(cohortRegimeParameterSplitContractSummary.policy_plan_mode || "").trim() || null,
      cohort_regime_parameter_split_policy_global_qty_scale: toNum(cohortRegimeParameterSplitContractSummary.policy_global_qty_scale),
      cohort_regime_parameter_split_cohort_action_profile_n: toNum(cohortRegimeParameterSplitContractSummary.cohort_action_profile_n),
      cohort_regime_parameter_split_blocking_reason_n: toNum(cohortRegimeParameterSplitContractSummary.blocking_reason_n),
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
      truth_preservation_audit_status: truthPreservationAuditStatus,
      truth_preservation_ready: truthPreservationSummary.truth_preservation_ready === true,
      truth_preservation_lineage_status: String(truthPreservationSummary.lineage_status || "").trim() || null,
      truth_preservation_stale_comparison_active: truthPreservationSummary.stale_comparison_active === true,
      truth_preservation_legacy_webhook_outcome_only_rows_n: toNum(truthPreservationSummary.legacy_webhook_outcome_only_rows_n),
      truth_preservation_blocking_reason_n: toNum(truthPreservationSummary.blocking_reason_n),
      truth_preservation_warning_reason_n: toNum(truthPreservationSummary.warning_reason_n),
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
      execution_serving_contract_status: executionServingContractStatus,
      execution_serving_stage: String(executionServingContractSummary.serving_stage || "").trim() || null,
      execution_serving_decision: String(executionServingContractSummary.serving_decision || "").trim() || null,
      execution_serving_shadow_ready: executionServingContractSummary.shadow_ready === true,
      execution_serving_scope_train_run_aligned: executionServingContractSummary.scope_train_run_aligned === true,
      execution_serving_scope_registry_aligned: executionServingContractSummary.scope_registry_aligned === true,
      execution_serving_preferred_model_family: String(executionServingContractSummary.preferred_model_family || "").trim() || null,
      execution_serving_preferred_model_kind: String(executionServingContractSummary.preferred_model_kind || "").trim() || null,
      execution_serving_preferred_model_artifact_id: String(executionServingContractSummary.preferred_model_artifact_id || "").trim() || null,
      ml_global_canary_status: String(mlGlobalCanaryEvidenceSummary.status || "").trim() || null,
      ml_global_canary_ready: mlGlobalCanaryEvidenceSummary.global_canary_ready === true,
      ml_global_canary_evidence_status: String(mlGlobalCanaryEvidenceSummary.evidence_status || "").trim() || null,
      ml_global_canary_dominant_blocker: String(mlGlobalCanaryEvidenceSummary.dominant_blocker || "").trim() || null,
      ml_global_canary_replay_evidence_status: String(mlGlobalCanaryEvidenceSummary.replay_evidence_status || "").trim() || null,
      ml_global_canary_replay_dominant_issue: String(mlGlobalCanaryEvidenceSummary.replay_dominant_issue || "").trim() || null,
      ml_global_canary_replay_sample_gap_status: String(mlGlobalCanaryEvidenceSummary.replay_sample_gap_status || mlEvReplaySampleGapSummary.evidence_status || "").trim() || null,
      ml_global_canary_replay_sample_required_realized_n: toNum(mlGlobalCanaryEvidenceSummary.replay_sample_required_realized_n ?? mlEvReplaySampleGapSummary.required_realized_n),
      ml_global_canary_replay_sample_current_effective_realized_n: toNum(mlGlobalCanaryEvidenceSummary.replay_sample_current_effective_realized_n ?? mlEvReplaySampleGapSummary.governance_effective_realized_n),
      ml_global_canary_replay_sample_gap_n: toNum(mlGlobalCanaryEvidenceSummary.replay_sample_gap_n ?? mlEvReplaySampleGapSummary.governance_effective_gap_n),
      ml_global_canary_replay_sample_dominant_dimension: String(mlGlobalCanaryEvidenceSummary.replay_sample_dominant_dimension || mlEvReplaySampleGapSummary.dominant_sample_dimension || "").trim() || null,
      ml_global_canary_replay_projected_ready_if_sample_gap_closed: mlGlobalCanaryEvidenceSummary.replay_projected_ready_if_sample_gap_closed === true || mlReplayUnblockProjectionSummary.projected_replay_ready_if_sample_gap_closed === true,
      ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed: String(mlGlobalCanaryEvidenceSummary.replay_projected_residual_issue_after_sample_gap_closed || mlReplayUnblockProjectionSummary.projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      ml_ev_profile_review_tracking_status: String(mlEvProfileReviewTrackingSummary.status || "").trim() || null,
      ml_ev_profile_review_tracking_evidence_status: String(mlEvProfileReviewTrackingSummary.evidence_status || "").trim() || null,
      ml_ev_profile_review_mode: String(mlEvProfileReviewTrackingSummary.review_mode || "").trim() || null,
      ml_ev_profile_review_target_n: toNum(mlEvProfileReviewTrackingSummary.target_n),
      ml_ev_profile_review_split_ready: mlEvProfileReviewTrackingSummary.split_ready === true,
      ml_ev_profile_review_split_blocker: String(mlEvProfileReviewTrackingSummary.split_blocker || "").trim() || null,
      ml_ev_profile_review_top_return_drag_profile: String(mlEvProfileReviewTrackingSummary.top_return_drag_profile || "").trim() || null,
      ml_ev_profile_review_top_return_drag_driver: String(mlEvProfileReviewTrackingSummary.top_return_drag_driver || "").trim() || null,
      ml_ev_profile_review_top_mixed_profile: String(mlEvProfileReviewTrackingSummary.top_mixed_profile || "").trim() || null,
      ml_ev_profile_review_top_mixed_driver: String(mlEvProfileReviewTrackingSummary.top_mixed_driver || "").trim() || null,
      ml_model_specific_canary_status: String(mlModelSpecificCanarySummary.status || "").trim() || null,
      ml_model_specific_canary_binding_mode: String(mlModelSpecificCanarySummary.binding_mode || "").trim() || null,
      ml_model_specific_canary_evidence_status: String(mlModelSpecificCanarySummary.evidence_status || "").trim() || null,
      ml_model_specific_canary_ready: mlModelSpecificCanarySummary.model_specific_canary_ready === true,
      ml_model_specific_canary_preferred_model_artifact_id: String(mlModelSpecificCanarySummary.preferred_model_artifact_id || "").trim() || null,
      ml_model_specific_canary_preferred_train_run_id: String(mlModelSpecificCanarySummary.preferred_train_run_id || "").trim() || null,
      ml_model_specific_canary_bound_model_artifact_id: String(mlModelSpecificCanarySummary.bound_model_artifact_id || "").trim() || null,
      ml_model_specific_canary_bound_train_run_id: String(mlModelSpecificCanarySummary.bound_train_run_id || "").trim() || null,
      ml_rollback_arm_status: String(mlRollbackArmSummary.status || "").trim() || null,
      ml_rollback_arm_binding_source: String(mlRollbackArmSummary.rollback_binding_source || "").trim() || null,
      ml_rollback_arm_evidence_status: String(mlRollbackArmSummary.evidence_status || "").trim() || null,
      ml_rollback_arm_ready: mlRollbackArmSummary.rollback_arm_ready === true,
      ml_rollback_arm_target_path: String(mlRollbackArmSummary.rollback_target_path || "").trim() || null,
      ml_rollback_arm_engine_bundle_id: String(mlRollbackArmSummary.rollback_engine_bundle_id || "").trim() || null,
      ml_rollback_arm_trigger_status: String(mlRollbackArmSummary.rollback_trigger_status || "").trim() || null,
      ml_rollback_arm_server_primary_trigger_n: toNum(mlRollbackArmSummary.server_primary_rollback_trigger_n),
      validation_deployment_pipeline_contract_status: String(validationDeploymentPipelineContractSummary.status || "").trim() || null,
      validation_deployment_pipeline_contract_mode: String(validationDeploymentPipelineContractSummary.contract_mode || "").trim() || null,
      validation_deployment_pipeline_current_deployment_stage: String(validationDeploymentPipelineContractSummary.current_deployment_stage || "").trim() || null,
      validation_deployment_pipeline_shadow_numeric_gate_ready: validationDeploymentPipelineContractSummary.shadow_numeric_gate_ready === true,
      validation_deployment_pipeline_canary_numeric_gate_ready: validationDeploymentPipelineContractSummary.canary_numeric_gate_ready === true,
      validation_deployment_pipeline_live_numeric_gate_ready: validationDeploymentPipelineContractSummary.live_numeric_gate_ready === true,
      validation_deployment_pipeline_numeric_judgement_ready: validationDeploymentPipelineContractSummary.numeric_judgement_ready === true,
      validation_deployment_pipeline_automatic_rollback_ready: validationDeploymentPipelineContractSummary.automatic_rollback_ready === true,
      validation_deployment_pipeline_global_canary_evidence_status: String(validationDeploymentPipelineContractSummary.global_canary_evidence_status || "").trim() || null,
      validation_deployment_pipeline_global_canary_dominant_blocker: String(validationDeploymentPipelineContractSummary.global_canary_dominant_blocker || "").trim() || null,
      validation_deployment_pipeline_replay_sample_gap_n: toNum(validationDeploymentPipelineContractSummary.replay_sample_gap_n),
      validation_deployment_pipeline_replay_projected_ready_if_gap_closed: validationDeploymentPipelineContractSummary.replay_projected_ready_if_gap_closed === true,
      validation_deployment_pipeline_replay_projected_residual_issue_after_sample_gap_closed: String(validationDeploymentPipelineContractSummary.replay_projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      validation_deployment_pipeline_blocking_reason_n: toNum(validationDeploymentPipelineContractSummary.blocking_reason_n),
      performance_kpi_upgrade_contract_status: String(performanceKpiUpgradeContractSummary.status || "").trim() || null,
      performance_kpi_upgrade_contract_mode: String(performanceKpiUpgradeContractSummary.contract_mode || "").trim() || null,
      performance_kpi_upgrade_microstructure_kpi_ready: performanceKpiUpgradeContractSummary.microstructure_kpi_ready === true,
      performance_kpi_upgrade_survivability_kpi_ready: performanceKpiUpgradeContractSummary.survivability_kpi_ready === true,
      performance_kpi_upgrade_expectancy_kpi_ready: performanceKpiUpgradeContractSummary.expectancy_kpi_ready === true,
      performance_kpi_upgrade_structure_alignment_ready: performanceKpiUpgradeContractSummary.structure_alignment_ready === true,
      performance_kpi_upgrade_cost_alignment_ready: performanceKpiUpgradeContractSummary.cost_alignment_ready === true,
      performance_kpi_upgrade_tp0_hit_rate: toNum(performanceKpiUpgradeContractSummary.tp0_hit_rate),
      performance_kpi_upgrade_tp1_hit_rate: toNum(performanceKpiUpgradeContractSummary.tp1_hit_rate),
      performance_kpi_upgrade_tp0_to_tp1_conversion_rate: toNum(performanceKpiUpgradeContractSummary.tp0_to_tp1_conversion_rate),
      performance_kpi_upgrade_pre_tp1_time_stop_rate: toNum(performanceKpiUpgradeContractSummary.pre_tp1_time_stop_rate),
      performance_kpi_upgrade_fee_adjusted_expectancy: toNum(performanceKpiUpgradeContractSummary.fee_adjusted_expectancy),
      performance_kpi_upgrade_realized_trade_n: toNum(performanceKpiUpgradeContractSummary.realized_trade_n),
      performance_kpi_upgrade_legacy_win_rate_reference: toNum(performanceKpiUpgradeContractSummary.legacy_win_rate_reference),
      performance_kpi_upgrade_objective_verdict: String(performanceKpiUpgradeContractSummary.objective_verdict || "").trim() || null,
      performance_kpi_upgrade_blocking_reason_n: toNum(performanceKpiUpgradeContractSummary.blocking_reason_n),
      ev_gate_policy_status: String(evGateCompositePolicySummary.status || "").trim() || null,
      ev_gate_policy_basis: String(evGateCompositePolicySummary.policy_basis || "").trim() || null,
      ev_gate_canonical_policy_version: String(evGateCompositePolicySummary.canonical_policy_version || "").trim() || null,
      ev_gate_compatibility_policy_version: String(evGateCompositePolicySummary.compatibility_policy_version || "").trim() || null,
      ev_gate_threshold_metric: String(evGateCompositePolicySummary.threshold_metric || "").trim() || null,
      ev_gate_threshold_metric_family: String(evGateCompositePolicySummary.threshold_metric_family || "").trim() || null,
      ev_gate_compatibility_drop_reason: String(evGateCompositePolicySummary.compatibility_drop_reason || "").trim() || null,
      ev_gate_default_tp0_pct: toNum(evGateCompositePolicySummary.default_tp0_pct),
      ev_gate_default_tp0_qty_ratio: toNum(evGateCompositePolicySummary.default_tp0_qty_ratio),
      ev_gate_default_tp1_pct: toNum(evGateCompositePolicySummary.default_tp1_pct),
      ev_gate_default_sl_pct: toNum(evGateCompositePolicySummary.default_sl_pct),
      ev_gate_legacy_threshold_setting_keys: Array.isArray(evGateCompositePolicySummary.legacy_threshold_setting_keys)
        ? evGateCompositePolicySummary.legacy_threshold_setting_keys.map((row) => String(row || "").trim()).filter(Boolean)
        : [],
      ev_gate_tp1_prob_min_global: toNum(evGateCompositePolicySummary.tp1_prob_min_global),
      ev_gate_tp1_prob_min_early: toNum(evGateCompositePolicySummary.tp1_prob_min_early),
      ev_gate_tp1_prob_min_core: toNum(evGateCompositePolicySummary.tp1_prob_min_core),
      self_evolution_top_candidate_id: topCandidateId,
      self_evolution_top_candidate_canonical_id: String(topCandidateRow && topCandidateRow.canonical_candidate_id || "").trim() || null,
      self_evolution_top_candidate_scope: String(topCandidateRow && topCandidateRow.scope || "").trim() || null,
      ev_candidate_id: String(evCandidateRow && evCandidateRow.candidate_id || "").trim() || null,
      ev_candidate_canonical_id: String(evCandidateRow && evCandidateRow.canonical_candidate_id || "").trim() || null,
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
      ml_promotion_gate_status: mlPromotionGateStatus,
      ml_promotion_stage: String(mlPromotionGateSummary.promotion_stage || "").trim() || null,
      ml_promotion_decision: String(mlPromotionGateSummary.promotion_decision || "").trim() || null,
      ml_promotion_global_canary_gate_status: String(mlPromotionGateSummary.global_canary_gate_status || "").trim() || null,
      ml_promotion_global_canary_evidence_status: String(mlPromotionGateSummary.global_canary_evidence_status || "").trim() || null,
      ml_promotion_global_canary_dominant_blocker: String(mlPromotionGateSummary.global_canary_dominant_blocker || "").trim() || null,
      ml_promotion_global_canary_replay_evidence_status: String(mlPromotionGateSummary.global_canary_replay_evidence_status || "").trim() || null,
      ml_promotion_global_canary_replay_dominant_issue: String(mlPromotionGateSummary.global_canary_replay_dominant_issue || "").trim() || null,
      ml_promotion_global_canary_replay_sample_gap_status: String(mlPromotionGateSummary.global_canary_replay_sample_gap_status || "").trim() || null,
      ml_promotion_global_canary_replay_sample_required_realized_n: toNum(mlPromotionGateSummary.global_canary_replay_sample_required_realized_n),
      ml_promotion_global_canary_replay_sample_current_effective_realized_n: toNum(mlPromotionGateSummary.global_canary_replay_sample_current_effective_realized_n),
      ml_promotion_global_canary_replay_sample_gap_n: toNum(mlPromotionGateSummary.global_canary_replay_sample_gap_n),
      ml_promotion_global_canary_replay_sample_dominant_dimension: String(mlPromotionGateSummary.global_canary_replay_sample_dominant_dimension || "").trim() || null,
      ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed: mlPromotionGateSummary.global_canary_replay_projected_ready_if_sample_gap_closed === true,
      ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed: String(mlPromotionGateSummary.global_canary_replay_projected_residual_issue_after_sample_gap_closed || "").trim() || null,
      ml_promotion_model_specific_canary_gate_status: String(mlPromotionGateSummary.model_specific_canary_gate_status || "").trim() || null,
      ml_promotion_model_specific_canary_ready: mlPromotionGateSummary.model_specific_canary_ready === true,
      ml_promotion_model_specific_canary_binding_mode: String(mlPromotionGateSummary.model_specific_canary_binding_mode || "").trim() || null,
      ml_promotion_model_specific_canary_evidence_status: String(mlPromotionGateSummary.model_specific_canary_evidence_status || "").trim() || null,
      ml_promotion_rollback_gate_status: String(mlPromotionGateSummary.rollback_gate_status || "").trim() || null,
      ml_promotion_rollback_binding_source: String(mlPromotionGateSummary.rollback_binding_source || "").trim() || null,
      ml_promotion_rollback_evidence_status: String(mlPromotionGateSummary.rollback_evidence_status || "").trim() || null,
      ml_promotion_rollback_arm_ready: mlPromotionGateSummary.rollback_arm_ready === true,
      ml_promotion_preferred_model_family: String(mlPromotionGateSummary.preferred_model_family || "").trim() || null,
      ml_promotion_preferred_model_artifact_id: String(mlPromotionGateSummary.preferred_model_artifact_id || "").trim() || null,
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
