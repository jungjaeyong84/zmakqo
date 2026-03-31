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

function deriveOpenClawAutonomyContract({
  objective = null,
  objectiveSupervisor = null,
  deploymentPlan = null,
  serverPrimaryCanary = null,
  watchdog = null,
} = {}) {
  const objectiveSummary = readSummary(objective);
  const objectiveSupervisorRaw = unwrapRawReport(objectiveSupervisor) || {};
  const deploymentPlanSummary = readSummary(deploymentPlan);
  const serverPrimarySummary = readSummary(serverPrimaryCanary);
  const watchdogSummary = readSummary(watchdog);

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

  const authorityPending = Boolean(
    deploymentPlanSummary.external_authority_pending === true
    || toUpper(deploymentPlanSummary.authority_state) === "PENDING"
  );

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
    },
    summary: {
      goal_state: objectiveMet ? "OBJECTIVE_ON_TRACK" : "OBJECTIVE_RECOVERY_REQUIRED",
      authority_state: authorityPending ? "PENDING" : "CLEAR",
      phase_d_status: phaseDReady ? "READY" : (String(serverPrimarySummary.acceptance_reason || "PENDING").trim().toUpperCase() || "PENDING"),
      ops_status: opsHealthy ? "PASS" : "WARN",
      degraded_authority_enabled: authorityPolicy.degraded_timeout_policy.enabled === true,
      degraded_authority_min_timeout_streak: authorityPolicy.degraded_timeout_policy.min_timeout_streak,
    },
  };
}

module.exports = {
  unwrapRawReport,
  deriveOpenClawAutonomyContract,
};
