#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveLoopMonitor } = require("../src/utils/bestSelfEvolutionLoopMonitor");

loadLocalEnv();

const MAX_AGE_HOURS = Object.freeze({
  objectiveSupervisor: 12,
  candidates: 24,
  replay: 24,
  canary: 12,
  canonicalParity: 24,
  serverSignalAuthority: 24,
  serverSignalQuality: 24,
  serverSignalRuntime: 24,
  serverSignalCutoverReadiness: 24,
  dropValidation: 24,
  provisionalRealizedOutcome: 24,
  overrideAuthority: 24,
  executionQuality: 24,
  reversePolicy: 24,
  marketObjectiveScore: 24,
  serverVsPinePerformanceDelta: 24,
  canonicalProvenance: 24,
  serverPrimaryCanary: 24,
  serverPrimaryAcceptanceWatch: 24,
  pineShadowDrift: 24,
  deploymentProbe: 12,
  bundleActivation: 12,
  openclawAutonomyContract: 24,
  objectiveRecoveryGovernor: 24,
  objectiveRecoveryEffect: 24,
  deployment: 12,
  deploymentPlan: 12,
  stageAutopilot: 12,
  weightTuning: 24,
  memory: 24,
  codexPatch: 48,
});

const INPUTS = Object.freeze({
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  canonicalParity: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json"),
  serverSignalAuthority: path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json"),
  serverSignalQuality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  serverSignalRuntime: path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json"),
  serverSignalCutoverReadiness: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  dropValidation: path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json"),
  provisionalRealizedOutcome: path.join(OPS_DAILY_DIR, "best_self_evolution_provisional_realized_outcome_latest.json"),
  overrideAuthority: path.join(OPS_DAILY_DIR, "best_self_evolution_override_authority_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
  reversePolicy: path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json"),
  marketObjectiveScore: path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json"),
  serverVsPinePerformanceDelta: path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.json"),
  canonicalProvenance: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_provenance_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
  serverPrimaryAcceptanceWatch: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_acceptance_watch_latest.json"),
  pineShadowDrift: path.join(OPS_DAILY_DIR, "best_self_evolution_pine_shadow_drift_latest.json"),
  deploymentProbe: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_probe_latest.json"),
  bundleActivation: path.join(OPS_DAILY_DIR, "best_self_evolution_bundle_activation_latest.json"),
  openclawAutonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  objectiveRecoveryGovernor: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json"),
  objectiveRecoveryEffect: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_effect_latest.json"),
  deployment: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json"),
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  weightTuning: path.join(OPS_DAILY_DIR, "best_self_evolution_weight_tuning_latest.json"),
  memory: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
  codexPatch: selfEvolutionSnapshotLatestPath("self_evolution_authority_latest.json"),
});

function readFresh(filePath, maxAgeHours) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) return { filePath, data: null, fresh: false, exists: false, age_hours: null };
  try {
    const st = fs.statSync(filePath);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    return {
      filePath,
      data,
      fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours,
      exists: true,
      age_hours: ageHours,
    };
  } catch (_err) {
    return { filePath, data, fresh: false, exists: true, age_hours: null };
  }
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Loop Monitor",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- cycle_consistent: ${summary.cycle_consistent ? "YES" : "NO"} / cycle_mismatch_n: ${summary.cycle_mismatch_n ?? 0}`,
    `- overall_status: ${summary.overall_status || "N/A"}`,
    `- fresh loops: ${summary.fresh_loop_n ?? 0} / ${summary.loop_n ?? 0}`,
    `- stale artifacts: ${Array.isArray(summary.stale_artifacts) && summary.stale_artifacts.length ? summary.stale_artifacts.join(", ") : "none"}`,
    `- critical blockers: ${Array.isArray(summary.critical_blockers) && summary.critical_blockers.length ? summary.critical_blockers.join("|") : "none"}`,
    `- server_signal_authority: ${summary.server_signal_drift_status || "N/A"} / mismatch_rate: ${summary.server_signal_parity_mismatch_rate != null ? summary.server_signal_parity_mismatch_rate : "N/A"}`,
    `- server_signal_quality: ${summary.server_signal_quality_status || "N/A"} / entry_24h: ${summary.server_signal_entry_24h_n ?? "N/A"} / intent_24h: ${summary.server_signal_intent_24h_n ?? "N/A"} / fill_24h: ${summary.server_signal_fill_24h_n ?? "N/A"}`,
    `- server_signal_runtime: ${summary.server_signal_runtime_status || "N/A"} / tf: ${summary.server_signal_runtime_exec_tf || "N/A"} / markets: ${summary.server_signal_runtime_market_count ?? "N/A"}`,
    `- server_signal_cutover: ${summary.server_signal_cutover_status || "N/A"} / ready: ${summary.server_signal_cutover_ready ? "YES" : "NO"} / blockers: ${Array.isArray(summary.server_signal_cutover_blockers) && summary.server_signal_cutover_blockers.length ? summary.server_signal_cutover_blockers.join("|") : "none"}`,
    `- drop_validation: ${summary.drop_validation_status || "N/A"} / top_rescue: ${summary.drop_validation_top_rescue_family || "N/A"} / reason: ${summary.drop_validation_top_rescue_reason || "N/A"} / market: ${summary.drop_validation_top_rescue_market || "N/A"}`,
    `- provisional_realized: ${summary.provisional_realized_outcome_status || "N/A"} / final: ${summary.provisional_realized_final_n ?? 0} / provisional: ${summary.provisional_realized_provisional_n ?? 0} / effective: ${summary.provisional_realized_effective_n ?? 0} / top: ${summary.provisional_realized_top_market || "N/A"}`,
    `- override_authority: ${summary.override_authority_status || "N/A"} / max_markets: ${summary.override_authority_max_market_overrides_per_cycle ?? "N/A"} / risk: ${summary.override_authority_risk_override_enabled ? "ALLOW" : "BLOCK"} / top: ${Array.isArray(summary.override_authority_top_markets) && summary.override_authority_top_markets.length ? summary.override_authority_top_markets.join("|") : "N/A"}`,
    `- execution_quality: ${summary.execution_quality_status || "N/A"} / latency_p95: ${summary.execution_quality_created_to_fill_p95_ms ?? "N/A"} / slippage_p95: ${summary.execution_quality_adverse_slippage_p95_bps ?? "N/A"} / partial: ${summary.execution_quality_partial_fill_rate_pct ?? "N/A"} / top: ${summary.execution_quality_top_latency_market || summary.execution_quality_top_slippage_market || summary.execution_quality_top_partial_market || "N/A"}`,
    `- reverse_policy: ${summary.reverse_policy_status || "N/A"} / drops: ${summary.reverse_policy_drop_n ?? "N/A"} / revive: ${summary.reverse_policy_revive_n ?? "N/A"} / rate: ${summary.reverse_policy_revive_rate ?? "N/A"} / top: ${summary.reverse_policy_top_watch_market || "N/A"}`,
    `- market_objective: ${summary.market_objective_status || "N/A"} / recovery: ${summary.market_objective_top_recovery_market || "N/A"} / drag: ${summary.market_objective_top_drag_market || "N/A"}`,
    `- server_vs_pine_delta: ${summary.server_vs_pine_delta_status || "N/A"} / shadow_gap: ${summary.server_vs_pine_delta_top_shadow_gap_market || "N/A"} / edge: ${summary.server_vs_pine_delta_top_server_edge_market || "N/A"} / avg_delta: ${summary.server_vs_pine_delta_avg_active_delta_score != null ? summary.server_vs_pine_delta_avg_active_delta_score : "N/A"}`,
    `- promotion_path_ready: ${summary.promotion_path_ready ? "YES" : "NO"} / manual_paste_ready: ${summary.manual_paste_ready ? "YES" : "NO"}`,
    `- ready_candidate: ${summary.ready_candidate_id || "N/A"} / canary_open_wave: ${summary.canary_open_wave ?? "N/A"}`,
    "",
    "## Loops",
  ];
  for (const row of rows) {
    lines.push(`- ${row.loop}: ${row.status} / fresh=${row.fresh ? "YES" : "NO"} / ${row.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function resolveReportCycleId({ preferredCycleId = null, objectiveSupervisor = null, deploymentPlan = null, fallbackCycleId = null } = {}) {
  const objective = objectiveSupervisor && typeof objectiveSupervisor === "object" ? objectiveSupervisor : {};
  const plan = deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {};
  return String(
    preferredCycleId
    || objective.source_cycle_id
    || objective.cycle_id
    || plan.source_cycle_id
    || plan.cycle_id
    || fallbackCycleId
    || ""
  ).trim() || null;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const artifacts = Object.fromEntries(
    Object.entries(INPUTS).map(([key, filePath]) => [key, readFresh(filePath, MAX_AGE_HOURS[key] || 24)])
  );
  const objectiveSupervisor = artifacts.objectiveSupervisor && artifacts.objectiveSupervisor.data;
  const deploymentPlan = artifacts.deploymentPlan && artifacts.deploymentPlan.data;
  const reportCycleId = resolveReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    objectiveSupervisor,
    deploymentPlan,
    fallbackCycleId: cycleMeta.cycle_id,
  });
  const derived = deriveLoopMonitor({
    artifacts,
    reports: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.data])),
  });
  const dropValidationRaw = artifacts.dropValidation && artifacts.dropValidation.data
    ? ((artifacts.dropValidation.data.raw && typeof artifacts.dropValidation.data.raw === "object")
      ? artifacts.dropValidation.data.raw
      : artifacts.dropValidation.data)
    : {};
  const provisionalRealizedRaw = artifacts.provisionalRealizedOutcome && artifacts.provisionalRealizedOutcome.data
    ? ((artifacts.provisionalRealizedOutcome.data.raw && typeof artifacts.provisionalRealizedOutcome.data.raw === "object")
      ? artifacts.provisionalRealizedOutcome.data.raw
      : artifacts.provisionalRealizedOutcome.data)
    : {};
  const provisionalRealizedSummary = provisionalRealizedRaw.summary && typeof provisionalRealizedRaw.summary === "object"
    ? provisionalRealizedRaw.summary
    : {};
  const overrideAuthorityRaw = artifacts.overrideAuthority && artifacts.overrideAuthority.data
    ? ((artifacts.overrideAuthority.data.raw && typeof artifacts.overrideAuthority.data.raw === "object")
      ? artifacts.overrideAuthority.data.raw
      : artifacts.overrideAuthority.data)
    : {};
  const executionQualityRaw = artifacts.executionQuality && artifacts.executionQuality.data
    ? ((artifacts.executionQuality.data.raw && typeof artifacts.executionQuality.data.raw === "object")
      ? artifacts.executionQuality.data.raw
      : artifacts.executionQuality.data)
    : {};
  const reversePolicyRaw = artifacts.reversePolicy && artifacts.reversePolicy.data
    ? ((artifacts.reversePolicy.data.raw && typeof artifacts.reversePolicy.data.raw === "object")
      ? artifacts.reversePolicy.data.raw
      : artifacts.reversePolicy.data)
    : {};
  const overrideAuthoritySummary = overrideAuthorityRaw.summary && typeof overrideAuthorityRaw.summary === "object"
    ? overrideAuthorityRaw.summary
    : {};
  const executionQualitySummary = executionQualityRaw.summary && typeof executionQualityRaw.summary === "object"
    ? executionQualityRaw.summary
    : {};
  const reversePolicySummary = reversePolicyRaw.summary && typeof reversePolicyRaw.summary === "object"
    ? reversePolicyRaw.summary
    : {};
  const dropValidationSummary = dropValidationRaw.summary && typeof dropValidationRaw.summary === "object"
    ? dropValidationRaw.summary
    : {};
  const marketObjectiveRaw = artifacts.marketObjectiveScore && artifacts.marketObjectiveScore.data
    ? ((artifacts.marketObjectiveScore.data.raw && typeof artifacts.marketObjectiveScore.data.raw === "object")
      ? artifacts.marketObjectiveScore.data.raw
      : artifacts.marketObjectiveScore.data)
    : {};
  const marketObjectiveSummary = marketObjectiveRaw.summary && typeof marketObjectiveRaw.summary === "object"
    ? marketObjectiveRaw.summary
    : {};
  const serverVsPineDeltaRaw = artifacts.serverVsPinePerformanceDelta && artifacts.serverVsPinePerformanceDelta.data
    ? ((artifacts.serverVsPinePerformanceDelta.data.raw && typeof artifacts.serverVsPinePerformanceDelta.data.raw === "object")
      ? artifacts.serverVsPinePerformanceDelta.data.raw
      : artifacts.serverVsPinePerformanceDelta.data)
    : {};
  const serverVsPineDeltaSummary = serverVsPineDeltaRaw.summary && typeof serverVsPineDeltaRaw.summary === "object"
    ? serverVsPineDeltaRaw.summary
    : {};
  const dropValidationRow = {
    loop: "DROP_VALIDATION",
    fresh: artifacts.dropValidation && artifacts.dropValidation.fresh === true,
    cycle_id: String(dropValidationRaw.cycle_id || dropValidationRaw.generation_id || "").trim() || null,
    status: String(dropValidationSummary.status || "N/A").trim().toUpperCase() === "ACTIONABLE_RESCUE_REVIEW"
      ? "WARN"
      : (String(dropValidationSummary.status || "N/A").trim().toUpperCase() === "KEEP_DROP_CONFIRMED"
      ? "PASS"
      : (String(dropValidationSummary.status || "N/A").trim() ? "HOLD" : "N/A")),
    reason: `recent=${dropValidationSummary.recent_drop_n ?? 0} / matured=${dropValidationSummary.matured_reason_n ?? 0} / dominant=${dropValidationSummary.dominant_family || "N/A"}:${dropValidationSummary.dominant_verdict || "N/A"} / rescue=${dropValidationSummary.top_rescue_family || "N/A"}:${dropValidationSummary.top_rescue_reason || "N/A"}:${dropValidationSummary.top_rescue_market || "N/A"}`,
  };
  const rows = Array.isArray(derived.rows) ? derived.rows.slice() : [];
  if (!rows.find((row) => row.loop === "DROP_VALIDATION")) {
    rows.splice(9, 0, dropValidationRow);
  }
  const provisionalRealizedRow = {
    loop: "PROVISIONAL_REALIZED_OUTCOME",
    fresh: artifacts.provisionalRealizedOutcome && artifacts.provisionalRealizedOutcome.fresh === true,
    cycle_id: String(provisionalRealizedRaw.cycle_id || provisionalRealizedRaw.generation_id || "").trim() || null,
    status: String(provisionalRealizedSummary.status || "").trim().toUpperCase() === "PROVISIONAL_ACTIVE"
      ? "WARN"
      : (Number(provisionalRealizedSummary.final_realized_n || 0) > 0 ? "PASS" : "HOLD"),
    reason: `final=${provisionalRealizedSummary.final_realized_n ?? 0} / provisional=${provisionalRealizedSummary.provisional_realized_n ?? 0} / effective=${provisionalRealizedSummary.effective_realized_n ?? 0} / top=${provisionalRealizedSummary.top_provisional_market || "N/A"}`,
  };
  if (!rows.find((row) => row.loop === "PROVISIONAL_REALIZED_OUTCOME")) {
    rows.splice(10, 0, provisionalRealizedRow);
  }
  const overrideAuthorityRow = {
    loop: "OVERRIDE_AUTHORITY",
    fresh: artifacts.overrideAuthority && artifacts.overrideAuthority.fresh === true,
    cycle_id: String(overrideAuthorityRaw.cycle_id || overrideAuthorityRaw.generation_id || "").trim() || null,
    status: String(overrideAuthoritySummary.status || "").trim().toUpperCase() === "BOUNDED_AUTHORITY_ACTIVE" ? "PASS" : "HOLD",
    reason: `max_markets=${overrideAuthoritySummary.max_market_overrides_per_cycle ?? "N/A"} / risk=${overrideAuthoritySummary.risk_override_enabled === true ? "ALLOW" : "BLOCK"} / top=${Array.isArray(overrideAuthoritySummary.top_priority_markets) && overrideAuthoritySummary.top_priority_markets.length ? overrideAuthoritySummary.top_priority_markets.map((row) => row.market).join("|") : "N/A"}`,
  };
  if (!rows.find((row) => row.loop === "OVERRIDE_AUTHORITY")) {
    rows.splice(11, 0, overrideAuthorityRow);
  }
  const executionQualityRow = {
    loop: "EXECUTION_QUALITY",
    fresh: artifacts.executionQuality && artifacts.executionQuality.fresh === true,
    cycle_id: String(executionQualityRaw.cycle_id || executionQualityRaw.generation_id || "").trim() || null,
    status: String(executionQualitySummary.status || "").trim().toUpperCase() === "EXECUTION_QUALITY_STABLE"
      ? "PASS"
      : (String(executionQualitySummary.status || "").trim().toUpperCase() ? "WARN" : "N/A"),
    reason: `latency_p95=${executionQualitySummary.created_to_fill_p95_ms ?? "N/A"} / slippage_p95=${executionQualitySummary.adverse_slippage_p95_bps ?? "N/A"} / partial=${executionQualitySummary.partial_fill_rate_pct ?? "N/A"} / top=${executionQualitySummary.top_latency_market || executionQualitySummary.top_slippage_market || executionQualitySummary.top_partial_market || "N/A"}`,
  };
  if (!rows.find((row) => row.loop === "EXECUTION_QUALITY")) {
    rows.splice(12, 0, executionQualityRow);
  }
  const reversePolicyRow = {
    loop: "REVERSE_POLICY",
    fresh: artifacts.reversePolicy && artifacts.reversePolicy.fresh === true,
    cycle_id: String(reversePolicyRaw.cycle_id || reversePolicyRaw.generation_id || "").trim() || null,
    status: String(reversePolicySummary.status || "").trim().toUpperCase() === "REVERSE_POLICY_STABLE"
      ? "PASS"
      : (String(reversePolicySummary.status || "").trim().toUpperCase() ? "WARN" : "N/A"),
    reason: `drops=${reversePolicySummary.reverse_drop_n ?? 0} / revive=${reversePolicySummary.reverse_revive_n ?? 0} / rate=${reversePolicySummary.reverse_revive_rate != null ? reversePolicySummary.reverse_revive_rate : "N/A"} / top=${reversePolicySummary.top_watch_market || "N/A"}:${reversePolicySummary.top_watch_reason || "N/A"}:${reversePolicySummary.top_watch_action || "N/A"}`,
  };
  if (!rows.find((row) => row.loop === "REVERSE_POLICY")) {
    rows.splice(13, 0, reversePolicyRow);
  }
  const marketObjectiveRow = {
    loop: "MARKET_OBJECTIVE_SCORE",
    fresh: artifacts.marketObjectiveScore && artifacts.marketObjectiveScore.fresh === true,
    cycle_id: String(marketObjectiveRaw.cycle_id || marketObjectiveRaw.generation_id || "").trim() || null,
    status: String(marketObjectiveSummary.status || "").trim().toUpperCase() === "RECOVERY_PRIORITY_ACTIVE"
      ? "WARN"
      : (String(marketObjectiveSummary.status || "").trim().toUpperCase() ? "PASS" : "N/A"),
    reason: `recovery=${marketObjectiveSummary.top_recovery_market || "N/A"} / drag=${marketObjectiveSummary.top_drag_market || "N/A"} / active=${marketObjectiveSummary.active_market_n ?? 0} / global=${marketObjectiveSummary.global_objective_score != null ? marketObjectiveSummary.global_objective_score : "N/A"}`,
  };
  if (!rows.find((row) => row.loop === "MARKET_OBJECTIVE_SCORE")) {
    rows.splice(14, 0, marketObjectiveRow);
  }
  const serverVsPineDeltaRow = {
    loop: "SERVER_VS_PINE_DELTA",
    fresh: artifacts.serverVsPinePerformanceDelta && artifacts.serverVsPinePerformanceDelta.fresh === true,
    cycle_id: String(serverVsPineDeltaRaw.cycle_id || serverVsPineDeltaRaw.generation_id || "").trim() || null,
    status: String(serverVsPineDeltaSummary.status || "").trim().toUpperCase() === "SERVER_EDGE_STABLE"
      ? "PASS"
      : (String(serverVsPineDeltaSummary.status || "").trim().toUpperCase() === "SHADOW_GAP_REVIEW" ? "WARN" : "HOLD"),
    reason: `shadow_gap=${serverVsPineDeltaSummary.top_shadow_gap_market || "N/A"} / edge=${serverVsPineDeltaSummary.top_server_edge_market || "N/A"} / delta=${serverVsPineDeltaSummary.avg_active_delta_score != null ? serverVsPineDeltaSummary.avg_active_delta_score : "N/A"}`,
  };
  if (!rows.find((row) => row.loop === "SERVER_VS_PINE_DELTA")) {
    rows.splice(15, 0, serverVsPineDeltaRow);
  }
  const summary = {
    ...(derived.summary || {}),
    drop_validation_status: dropValidationSummary.status || derived.summary && derived.summary.drop_validation_status || null,
    drop_validation_top_rescue_family: dropValidationSummary.top_rescue_family || derived.summary && derived.summary.drop_validation_top_rescue_family || null,
    drop_validation_top_rescue_reason: dropValidationSummary.top_rescue_reason || derived.summary && derived.summary.drop_validation_top_rescue_reason || null,
    drop_validation_top_rescue_market: dropValidationSummary.top_rescue_market || derived.summary && derived.summary.drop_validation_top_rescue_market || null,
    provisional_realized_outcome_status: provisionalRealizedSummary.status || derived.summary && derived.summary.provisional_realized_outcome_status || null,
    provisional_realized_final_n: provisionalRealizedSummary.final_realized_n != null ? provisionalRealizedSummary.final_realized_n : derived.summary && derived.summary.provisional_realized_final_n || 0,
    provisional_realized_provisional_n: provisionalRealizedSummary.provisional_realized_n != null ? provisionalRealizedSummary.provisional_realized_n : derived.summary && derived.summary.provisional_realized_provisional_n || 0,
    provisional_realized_effective_n: provisionalRealizedSummary.effective_realized_n != null ? provisionalRealizedSummary.effective_realized_n : derived.summary && derived.summary.provisional_realized_effective_n || 0,
    provisional_realized_top_market: provisionalRealizedSummary.top_provisional_market || derived.summary && derived.summary.provisional_realized_top_market || null,
    override_authority_status: overrideAuthoritySummary.status || derived.summary && derived.summary.override_authority_status || null,
    override_authority_max_market_overrides_per_cycle: overrideAuthoritySummary.max_market_overrides_per_cycle != null ? overrideAuthoritySummary.max_market_overrides_per_cycle : derived.summary && derived.summary.override_authority_max_market_overrides_per_cycle || 0,
    override_authority_risk_override_enabled: overrideAuthoritySummary.risk_override_enabled === true || (derived.summary && derived.summary.override_authority_risk_override_enabled === true),
    override_authority_top_markets: Array.isArray(overrideAuthoritySummary.top_priority_markets)
      ? overrideAuthoritySummary.top_priority_markets.map((row) => String(row && row.market || "").trim().toUpperCase()).filter(Boolean)
      : (derived.summary && Array.isArray(derived.summary.override_authority_top_markets) ? derived.summary.override_authority_top_markets : []),
    execution_quality_status: executionQualitySummary.status || derived.summary && derived.summary.execution_quality_status || null,
    execution_quality_created_to_fill_p95_ms: executionQualitySummary.created_to_fill_p95_ms != null ? executionQualitySummary.created_to_fill_p95_ms : derived.summary && derived.summary.execution_quality_created_to_fill_p95_ms || null,
    execution_quality_adverse_slippage_p95_bps: executionQualitySummary.adverse_slippage_p95_bps != null ? executionQualitySummary.adverse_slippage_p95_bps : derived.summary && derived.summary.execution_quality_adverse_slippage_p95_bps || null,
    execution_quality_partial_fill_rate_pct: executionQualitySummary.partial_fill_rate_pct != null ? executionQualitySummary.partial_fill_rate_pct : derived.summary && derived.summary.execution_quality_partial_fill_rate_pct || null,
    execution_quality_top_latency_market: executionQualitySummary.top_latency_market || derived.summary && derived.summary.execution_quality_top_latency_market || null,
    execution_quality_top_slippage_market: executionQualitySummary.top_slippage_market || derived.summary && derived.summary.execution_quality_top_slippage_market || null,
    execution_quality_top_partial_market: executionQualitySummary.top_partial_market || derived.summary && derived.summary.execution_quality_top_partial_market || null,
    execution_quality_review_reasons: Array.isArray(executionQualitySummary.review_reasons)
      ? executionQualitySummary.review_reasons.slice(0, 6)
      : ((derived.summary && Array.isArray(derived.summary.execution_quality_review_reasons)) ? derived.summary.execution_quality_review_reasons : []),
    reverse_policy_status: reversePolicySummary.status || derived.summary && derived.summary.reverse_policy_status || null,
    reverse_policy_drop_n: reversePolicySummary.reverse_drop_n != null ? reversePolicySummary.reverse_drop_n : derived.summary && derived.summary.reverse_policy_drop_n || 0,
    reverse_policy_revive_n: reversePolicySummary.reverse_revive_n != null ? reversePolicySummary.reverse_revive_n : derived.summary && derived.summary.reverse_policy_revive_n || 0,
    reverse_policy_revive_rate: reversePolicySummary.reverse_revive_rate != null ? reversePolicySummary.reverse_revive_rate : derived.summary && derived.summary.reverse_policy_revive_rate || null,
    reverse_policy_top_watch_market: reversePolicySummary.top_watch_market || derived.summary && derived.summary.reverse_policy_top_watch_market || null,
    reverse_policy_top_watch_reason: reversePolicySummary.top_watch_reason || derived.summary && derived.summary.reverse_policy_top_watch_reason || null,
    reverse_policy_top_watch_action: reversePolicySummary.top_watch_action || derived.summary && derived.summary.reverse_policy_top_watch_action || null,
    market_objective_status: marketObjectiveSummary.status || derived.summary && derived.summary.market_objective_status || null,
    market_objective_top_recovery_market: marketObjectiveSummary.top_recovery_market || derived.summary && derived.summary.market_objective_top_recovery_market || null,
    market_objective_top_drag_market: marketObjectiveSummary.top_drag_market || derived.summary && derived.summary.market_objective_top_drag_market || null,
    server_vs_pine_delta_status: serverVsPineDeltaSummary.status || derived.summary && derived.summary.server_vs_pine_delta_status || null,
    server_vs_pine_delta_top_shadow_gap_market: serverVsPineDeltaSummary.top_shadow_gap_market || derived.summary && derived.summary.server_vs_pine_delta_top_shadow_gap_market || null,
    server_vs_pine_delta_top_server_edge_market: serverVsPineDeltaSummary.top_server_edge_market || derived.summary && derived.summary.server_vs_pine_delta_top_server_edge_market || null,
    server_vs_pine_delta_avg_active_delta_score: serverVsPineDeltaSummary.avg_active_delta_score != null ? serverVsPineDeltaSummary.avg_active_delta_score : derived.summary && derived.summary.server_vs_pine_delta_avg_active_delta_score || null,
    loop_n: rows.length,
    fresh_loop_n: rows.filter((row) => row.fresh === true).length,
  };
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    source_cycle_id: String(
      (objectiveSupervisor && (objectiveSupervisor.source_cycle_id || objectiveSupervisor.cycle_id))
      || (deploymentPlan && (deploymentPlan.source_cycle_id || deploymentPlan.cycle_id))
      || reportCycleId
      || ""
    ).trim() || null,
    evaluation_cycle_id: cycleMeta.cycle_id,
    inputs: { ...INPUTS },
    summary,
    rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_monitor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_monitor.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_LOOP_MONITOR_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    readFresh,
    resolveReportCycleId,
    renderMarkdown,
  },
};
