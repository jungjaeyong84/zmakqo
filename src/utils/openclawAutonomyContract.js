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
  deploymentPlan = null,
  serverPrimaryCanary = null,
  watchdog = null,
  serverSignalAuthority = null,
  serverSignalQuality = null,
} = {}) {
  const objectiveSummary = readSummary(objective);
  const objectiveSupervisorRaw = unwrapRawReport(objectiveSupervisor) || {};
  const deploymentPlanSummary = readSummary(deploymentPlan);
  const serverPrimarySummary = readSummary(serverPrimaryCanary);
  const watchdogSummary = readSummary(watchdog);
  const serverSignalAuthoritySummary = readSummary(serverSignalAuthority);
  const serverSignalQualitySummary = readSummary(serverSignalQuality);

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
  const currentObjectiveScore = extractObjectiveScore(objectiveSummary)
    ?? extractObjectiveScore(objectiveSupervisorSummary)
    ?? extractObjectiveScore(governanceObjectiveSummary);
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
  const authorityState = deploymentAuthorityState
    || (deploymentPlanSummary.authority_approved === true ? "APPROVED" : null)
    || (authorityPending ? "PENDING" : "CLEAR");

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
      monthly_run_rate_krw: currentMonthlyRunRate,
      win_rate: currentWinRate,
      objective_met: objectiveMet,
      recovery_required: recoveryRequired,
      authority_pending: authorityPending,
      authority_state: authorityState,
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
      server_signal_authoritative_24h_n: toNum(serverSignalAuthoritySummary.authoritative_server_24h_n) || 0,
      server_signal_shadow_24h_n: toNum(serverSignalAuthoritySummary.pine_shadow_24h_n) || 0,
      server_signal_entry_24h_n: toNum(serverSignalQualitySummary.authoritative_entry_signal_24h_n) || 0,
      server_signal_intent_24h_n: toNum(serverSignalQualitySummary.order_intent_24h_n) || 0,
      server_signal_fill_24h_n: toNum(serverSignalQualitySummary.fill_24h_n) || 0,
    },
    summary: {
      goal_state: objectiveMet ? "OBJECTIVE_ON_TRACK" : "OBJECTIVE_RECOVERY_REQUIRED",
      authority_state: authorityState,
      phase_d_status: phaseDReady ? "READY" : (String(serverPrimarySummary.acceptance_reason || "PENDING").trim().toUpperCase() || "PENDING"),
      ops_status: opsHealthy ? "PASS" : "WARN",
      degraded_authority_enabled: authorityPolicy.degraded_timeout_policy.enabled === true,
      degraded_authority_min_timeout_streak: authorityPolicy.degraded_timeout_policy.min_timeout_streak,
      server_signal_authority_status: toUpper(serverSignalAuthoritySummary.drift_status) || "PARITY_UNKNOWN",
      server_signal_quality_status: toUpper(serverSignalQualitySummary.quality_status) || "N_A",
      server_signal_transition_status: serverSignalTransition.status,
      server_signal_transition_progress_pct: serverSignalTransition.progress_pct,
    },
    server_signal_transition: serverSignalTransition,
  };
}

module.exports = {
  unwrapRawReport,
  deriveOpenClawAutonomyContract,
};
