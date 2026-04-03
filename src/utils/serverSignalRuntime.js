"use strict";

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function list(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function phaseStatus(done, active) {
  if (done) return "DONE";
  if (active) return "IN_PROGRESS";
  return "PENDING";
}

function deriveServerSignalRuntime({
  provider = "BINANCEFUT",
  systemSettings = {},
  exchangeSettings = {},
  watchdog = null,
  livePolicyConfig = null,
  cycleId = null,
} = {}) {
  const schedulerEnabled = toBool(systemSettings.scheduler_enabled, true);
  const schedulerIntervalSec = Math.max(10, toNum(systemSettings.scheduler_interval_sec) || 900);
  const sourceMode = toUpper(systemSettings.canonical_engine_source_mode || "PINE_PRIMARY") || "PINE_PRIMARY";
  const shadowEnabled = toBool(systemSettings.canonical_engine_shadow_enabled, true);
  const execTf = String(exchangeSettings.exec_tf || "15m").trim() || "15m";
  const tfAllowlist = list(exchangeSettings.tf_allowlist).length ? list(exchangeSettings.tf_allowlist) : [execTf];
  const markets = list(exchangeSettings.markets);
  const watchdogSummary = watchdog && typeof watchdog === "object"
    ? ((watchdog.summary && typeof watchdog.summary === "object") ? watchdog.summary : watchdog)
    : {};
  const watchdogVerdict = toUpper(watchdogSummary.verdict || watchdogSummary.status || watchdogSummary.summary_verdict || "N/A") || "N/A";
  const watchdogGeneratedAtKst = String(
    watchdogSummary.generated_at_kst
    || (watchdog && watchdog.generated_at_kst)
    || ""
  ).trim() || null;
  const pineIngressShadowOnly = true;
  const executionShadowPolicy = "EXCLUDE_FROM_EXECUTION_DEFAULT";
  const livePolicy = livePolicyConfig && typeof livePolicyConfig === "object"
    ? livePolicyConfig
    : {};
  const runtimeCycleId = String(cycleId || "").trim() || null;
  const livePolicyMode = livePolicy.enabled === true
    ? ((livePolicy.quarantine_hard_block !== false || livePolicy.quality_hard_block !== false || livePolicy.policy_plan_apply === true)
      ? "ENFORCING"
      : "ADVISORY")
    : "DISABLED";

  const transition = {
    server_15m_runtime: phaseStatus(schedulerEnabled && execTf === "15m" && markets.length > 0, schedulerEnabled || markets.length > 0),
    server_source_authority: phaseStatus(sourceMode === "SERVER_PRIMARY", sourceMode === "SERVER_PRIMARY" || sourceMode === "PINE_PRIMARY"),
    pine_shadow_only: phaseStatus(pineIngressShadowOnly && executionShadowPolicy === "EXCLUDE_FROM_EXECUTION_DEFAULT", pineIngressShadowOnly),
  };
  const completedN = Object.values(transition).filter((x) => x === "DONE").length;
  const progressPct = Math.round((completedN / Object.keys(transition).length) * 100);

  return {
    contract_version: "SERVER_SIGNAL_RUNTIME_V1",
    provider: toUpper(provider) || "BINANCEFUT",
    current_status: {
      cycle_id: runtimeCycleId,
      scheduler_enabled: schedulerEnabled,
      scheduler_interval_sec: schedulerIntervalSec,
      watchdog_verdict: watchdogVerdict,
      watchdog_generated_at_kst: watchdogGeneratedAtKst,
      canonical_engine_source_mode: sourceMode,
      canonical_engine_shadow_enabled: shadowEnabled,
      exec_tf: execTf,
      tf_allowlist: tfAllowlist,
      market_count: markets.length,
      markets_preview: markets.slice(0, 8),
      execution_shadow_policy: executionShadowPolicy,
      pine_ingress_shadow_only: pineIngressShadowOnly,
      live_execution_policy: {
        enabled: livePolicy.enabled === true,
        binance_only: livePolicy.binance_only !== false,
        quarantine_hard_block: livePolicy.quarantine_hard_block !== false,
        quality_hard_block: livePolicy.quality_hard_block !== false,
        execution_quality_global_guard_enabled: livePolicy.execution_quality_global_guard_enabled !== false,
        objective_scale_enabled: livePolicy.objective_scale_enabled !== false,
        lineage_slo_enabled: livePolicy.lineage_slo_enabled !== false,
        lineage_slo_fail_closed: livePolicy.lineage_slo_fail_closed !== false,
        lineage_slo_require_fresh: livePolicy.lineage_slo_require_fresh !== false,
        drift_remediation_enabled: livePolicy.drift_remediation_enabled !== false,
        drift_remediation_watch_only_block: livePolicy.drift_remediation_watch_only_block !== false,
        policy_plan_enabled: livePolicy.policy_plan_enabled !== false,
        policy_plan_apply: livePolicy.policy_plan_apply === true,
        policy_plan_watch_only_block: livePolicy.policy_plan_watch_only_block !== false,
        policy_plan_hold_block: livePolicy.policy_plan_hold_block !== false,
        effective_mode: livePolicyMode,
        policy_profile: toUpper(livePolicy.policy_profile || "RISK_GUARD_V2") || "RISK_GUARD_V2",
      },
    },
    summary: {
      cycle_id: runtimeCycleId,
      runtime_status: schedulerEnabled && execTf === "15m" && markets.length > 0 ? "READY" : "HOLD",
      canonical_engine_source_mode: sourceMode,
      exec_tf: execTf,
      market_count: markets.length,
      scheduler_status: schedulerEnabled ? "ENABLED" : "DISABLED",
      watchdog_verdict: watchdogVerdict,
      watchdog_generated_at_kst: watchdogGeneratedAtKst,
      live_execution_policy_enabled: livePolicy.enabled === true,
      live_execution_policy_mode: livePolicyMode,
      live_execution_policy_policy_plan_apply: livePolicy.policy_plan_apply === true,
      live_execution_policy_quarantine_hard_block: livePolicy.quarantine_hard_block !== false,
      live_execution_policy_quality_hard_block: livePolicy.quality_hard_block !== false,
      live_execution_policy_exec_quality_global_guard_enabled: livePolicy.execution_quality_global_guard_enabled !== false,
      live_execution_policy_objective_scale_enabled: livePolicy.objective_scale_enabled !== false,
      live_execution_policy_lineage_slo_enabled: livePolicy.lineage_slo_enabled !== false,
      live_execution_policy_lineage_slo_fail_closed: livePolicy.lineage_slo_fail_closed !== false,
      live_execution_policy_drift_remediation_enabled: livePolicy.drift_remediation_enabled !== false,
      live_execution_policy_drift_remediation_watch_only_block: livePolicy.drift_remediation_watch_only_block !== false,
      pine_shadow_transition_status: completedN === Object.keys(transition).length ? "COMPLETE" : "IN_PROGRESS",
      pine_shadow_transition_progress_pct: progressPct,
    },
    rows: {
      markets,
      transition: Object.entries(transition).map(([key, status]) => ({ key, status })),
    },
  };
}

module.exports = {
  deriveServerSignalRuntime,
};
