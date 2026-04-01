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
  const pineIngressShadowOnly = true;
  const executionShadowPolicy = "EXCLUDE_FROM_EXECUTION_DEFAULT";

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
      scheduler_enabled: schedulerEnabled,
      scheduler_interval_sec: schedulerIntervalSec,
      watchdog_verdict: watchdogVerdict,
      canonical_engine_source_mode: sourceMode,
      canonical_engine_shadow_enabled: shadowEnabled,
      exec_tf: execTf,
      tf_allowlist: tfAllowlist,
      market_count: markets.length,
      markets_preview: markets.slice(0, 8),
      execution_shadow_policy: executionShadowPolicy,
      pine_ingress_shadow_only: pineIngressShadowOnly,
    },
    summary: {
      runtime_status: schedulerEnabled && execTf === "15m" && markets.length > 0 ? "READY" : "HOLD",
      canonical_engine_source_mode: sourceMode,
      exec_tf: execTf,
      market_count: markets.length,
      scheduler_status: schedulerEnabled ? "ENABLED" : "DISABLED",
      watchdog_verdict: watchdogVerdict,
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
