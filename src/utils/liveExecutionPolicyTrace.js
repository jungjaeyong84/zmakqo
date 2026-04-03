"use strict";

const TRACE_KEYS = Object.freeze([
  "_live_exec_policy_stage",
  "_live_exec_policy_reason",
  "_live_exec_policy_market",
  "_live_exec_policy_action",
  "_live_exec_policy_allocation_score",
  "_live_exec_policy_quarantine_reason",
  "_live_exec_policy_quality_latency_ms",
  "_live_exec_policy_quality_partial_pct",
  "_live_exec_policy_quality_slippage_bps",
  "_live_exec_policy_quality_global_status",
  "_live_exec_policy_quality_global_latency_p95_ms",
  "_live_exec_policy_quality_global_partial_pct",
  "_live_exec_policy_quality_global_slippage_p95_bps",
  "_live_exec_policy_lineage_slo_enabled",
  "_live_exec_policy_lineage_slo_fail_closed",
  "_live_exec_policy_drift_remediation_enabled",
  "_live_exec_policy_other_server_policy_watch_only_block_enabled",
  "_live_exec_policy_other_server_policy_watch_only_block",
  "_live_exec_policy_other_server_policy_watch_only_market",
  "_live_exec_policy_other_server_policy_watch_only_reasons",
  "_live_exec_policy_plan_enabled",
  "_live_exec_policy_plan_apply",
  "_live_exec_policy_plan_status",
  "_live_exec_policy_plan_mode",
  "_live_exec_policy_plan_global_scale",
  "_live_exec_policy_plan_market_scale",
  "_live_exec_policy_learning_epoch_active",
  "_live_exec_policy_learning_epoch_exception_release_enabled",
  "_live_exec_policy_learning_epoch_exception_release_active",
  "_live_exec_policy_objective_scale",
  "_live_exec_policy_objective_verdict",
  "_live_exec_policy_objective_score",
  "_live_exec_policy_objective_constrained",
  "_live_exec_policy_scale_applied",
  "_live_exec_policy_scale",
  "_live_exec_policy_qty_before",
  "_live_exec_policy_qty_after",
]);

function extractLiveExecutionPolicyTrace(features = null) {
  if (!features || typeof features !== "object") return {};
  const out = {};
  for (const key of TRACE_KEYS) {
    if (features[key] !== undefined) out[key] = features[key];
  }
  return out;
}

function toLiveExecutionPolicyTopLevel(trace = null) {
  const src = trace && typeof trace === "object" ? trace : {};
  return {
    live_exec_policy_stage: src._live_exec_policy_stage ?? null,
    live_exec_policy_reason: src._live_exec_policy_reason ?? null,
    live_exec_policy_market: src._live_exec_policy_market ?? null,
    live_exec_policy_action: src._live_exec_policy_action ?? null,
    live_exec_policy_allocation_score: src._live_exec_policy_allocation_score ?? null,
    live_exec_policy_quarantine_reason: src._live_exec_policy_quarantine_reason ?? null,
    live_exec_policy_plan_status: src._live_exec_policy_plan_status ?? null,
    live_exec_policy_plan_mode: src._live_exec_policy_plan_mode ?? null,
    live_exec_policy_plan_global_scale: src._live_exec_policy_plan_global_scale ?? null,
    live_exec_policy_plan_market_scale: src._live_exec_policy_plan_market_scale ?? null,
    live_exec_policy_quality_latency_ms: src._live_exec_policy_quality_latency_ms ?? null,
    live_exec_policy_quality_partial_pct: src._live_exec_policy_quality_partial_pct ?? null,
    live_exec_policy_quality_slippage_bps: src._live_exec_policy_quality_slippage_bps ?? null,
    live_exec_policy_quality_global_status: src._live_exec_policy_quality_global_status ?? null,
    live_exec_policy_quality_global_latency_p95_ms: src._live_exec_policy_quality_global_latency_p95_ms ?? null,
    live_exec_policy_quality_global_partial_pct: src._live_exec_policy_quality_global_partial_pct ?? null,
    live_exec_policy_quality_global_slippage_p95_bps: src._live_exec_policy_quality_global_slippage_p95_bps ?? null,
    live_exec_policy_learning_epoch_exception_release_active: src._live_exec_policy_learning_epoch_exception_release_active ?? null,
    live_exec_policy_other_server_policy_watch_only_reasons: Array.isArray(src._live_exec_policy_other_server_policy_watch_only_reasons)
      ? src._live_exec_policy_other_server_policy_watch_only_reasons
      : null,
    live_exec_policy_blocked: typeof src._live_exec_policy_reason === "string"
      ? src._live_exec_policy_reason !== "LIVE_POLICY_OK"
      : null,
  };
}

module.exports = {
  TRACE_KEYS,
  extractLiveExecutionPolicyTrace,
  toLiveExecutionPolicyTopLevel,
};
