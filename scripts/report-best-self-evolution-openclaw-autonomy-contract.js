#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  readJsonSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveOpenClawAutonomyContract } = require("../src/utils/openclawAutonomyContract");

loadLocalEnv();

const INPUTS = Object.freeze({
  objective: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json"),
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  objectiveRecoveryGovernor: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json"),
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
  watchdog: path.join(OPS_DAILY_DIR, "automation_watchdog_latest.json"),
  serverSignalAuthority: path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json"),
  serverSignalQuality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  serverSignalRuntime: path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json"),
  marketRegimeBoard: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_market_regime_board_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
  objectiveRetrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
  overallAccountReport: path.join(OPS_DAILY_DIR, "overall_account_report_latest.json"),
  signalLineageHealth: path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json"),
  modelReadiness: path.join(OPS_DAILY_DIR, "best_self_evolution_model_readiness_latest.json"),
  featureStore: path.join(OPS_DAILY_DIR, "ml_feature_store_latest.json"),
  executionModelDataset: path.join(OPS_DAILY_DIR, "execution_model_dataset_latest.json"),
  executionStageLatency: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_stage_latency_latest.json"),
  mlExperimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
  executionBottleneckDelta: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_bottleneck_delta_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const status = report.current_status || {};
  const authority = report.authority_policy && report.authority_policy.degraded_timeout_policy || {};
  const lines = [
    "# BEST OpenClaw Autonomy Contract",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- goal_id: ${report.goal_id || "N/A"}`,
    `- goal_state: ${summary.goal_state || "N/A"}`,
    `- authority_state: ${summary.authority_state || "N/A"}`,
    `- change_authority_state: ${summary.change_authority_state || "N/A"} / pending ${summary.change_authority_pending ? "YES" : "NO"}`,
    `- phase_d_status: ${summary.phase_d_status || "N/A"}`,
    `- ops_status: ${summary.ops_status || "N/A"}`,
    `- server_signal_authority: ${summary.server_signal_authority_status || "N/A"}`,
    `- server_signal_quality: ${summary.server_signal_quality_status || "N/A"}`,
    `- server_transition: ${summary.server_signal_transition_status || "N/A"} / ${summary.server_signal_transition_progress_pct != null ? `${summary.server_signal_transition_progress_pct}%` : "N/A"}`,
    "",
    "## Objective Policy",
    `- objective_score >= ${report.objective_policy && report.objective_policy.min_objective_score != null ? report.objective_policy.min_objective_score : "N/A"}`,
    `- monthly_run_rate_krw >= ${report.objective_policy && report.objective_policy.min_monthly_run_rate_krw != null ? report.objective_policy.min_monthly_run_rate_krw : "N/A"}`,
    `- win_rate >= ${report.objective_policy && report.objective_policy.min_win_rate != null ? report.objective_policy.min_win_rate : "N/A"}`,
    "",
    "## Authority Policy",
    `- mode/unit: ${report.authority_mode || "N/A"} / ${report.review_unit || "N/A"}`,
    `- degraded_timeout: ${authority.enabled ? "ENABLED" : "DISABLED"} / min_streak=${authority.min_timeout_streak != null ? authority.min_timeout_streak : "N/A"}`,
    `- allowed_target_units: ${Array.isArray(authority.allow_target_deploy_units) && authority.allow_target_deploy_units.length ? authority.allow_target_deploy_units.join(", ") : "none"}`,
    "",
    "## Current Status",
    `- objective_score/monthly/win: ${status.objective_score != null ? status.objective_score : "N/A"} / ${status.monthly_run_rate_krw != null ? status.monthly_run_rate_krw : "N/A"} / ${status.win_rate != null ? status.win_rate : "N/A"}`,
    `- authority_pending: ${status.authority_pending ? "YES" : "NO"}`,
    `- phase_d_ready: ${status.phase_d_acceptance_ready ? "YES" : "NO"} / ${status.phase_d_acceptance_reason || "N/A"}`,
    `- ops_healthy: ${status.ops_healthy ? "YES" : "NO"} / scheduler=${status.scheduler_mode || "N/A"} / watchdog=${status.watchdog_verdict || "N/A"}`,
    `- server_signal: source=${status.server_signal_source_mode || "N/A"} / drift=${status.server_signal_drift_status || "N/A"} / quality=${status.server_signal_quality_status || "N/A"}`,
    `- server_signal_flow_24h: authoritative=${status.server_signal_authoritative_24h_n != null ? status.server_signal_authoritative_24h_n : "N/A"} / shadow=${status.server_signal_shadow_24h_n != null ? status.server_signal_shadow_24h_n : "N/A"} / entry=${status.server_signal_entry_24h_n != null ? status.server_signal_entry_24h_n : "N/A"} / intent=${status.server_signal_intent_24h_n != null ? status.server_signal_intent_24h_n : "N/A"} / fill=${status.server_signal_fill_24h_n != null ? status.server_signal_fill_24h_n : "N/A"}`,
    `- market_regime: ${summary.market_regime_board_status || "N/A"} / rescue=${summary.market_regime_rescue_n != null ? summary.market_regime_rescue_n : "N/A"} / keep_drop=${summary.market_regime_keep_drop_n != null ? summary.market_regime_keep_drop_n : "N/A"} / top_rescue=${summary.market_regime_top_rescue_market || "N/A"} / top_keep_drop=${summary.market_regime_top_keep_drop_market || "N/A"}`,
    `- execution_quality: ${summary.execution_quality_status || "N/A"} / latency_p95=${status.execution_quality_latency_p95_ms != null ? status.execution_quality_latency_p95_ms : "N/A"} / slippage_p95=${status.execution_quality_slippage_p95_bps != null ? status.execution_quality_slippage_p95_bps : "N/A"} / partial=${status.execution_quality_partial_fill_rate_pct != null ? status.execution_quality_partial_fill_rate_pct : "N/A"}`,
    `- lineage/account: ${summary.lineage_status || "N/A"} / account=${summary.account_integrity_status || "N/A"} / account_issues=${status.account_integrity_issue_n != null ? status.account_integrity_issue_n : "N/A"} / ops=${status.account_ops_status || "N/A"}:${status.account_ops_mode || "N/A"}`,
    `- microstructure: ${summary.execution_microstructure_status || "N/A"} / tp0_hit=${status.tp0_hit_rate != null ? status.tp0_hit_rate : "N/A"} / tp1_hit=${status.tp1_hit_rate != null ? status.tp1_hit_rate : "N/A"} / cluster=${summary.portfolio_cluster_risk_status || "N/A"}`,
    `- model_readiness: ${summary.model_readiness_status || "N/A"} / rows=${status.model_readiness_rows_n != null ? status.model_readiness_rows_n : "N/A"} / realized=${status.model_readiness_realized_n != null ? status.model_readiness_realized_n : "N/A"} / invalid=${status.model_readiness_invalid_n != null ? status.model_readiness_invalid_n : "N/A"}`,
    `- feature_store: ${summary.feature_store_status || "N/A"} / rows=${status.feature_store_rows_n != null ? status.feature_store_rows_n : "N/A"} / keys=${status.feature_store_keys_n != null ? status.feature_store_keys_n : "N/A"}`,
    `- execution_model_dataset: ${summary.execution_model_dataset_status || "N/A"} / rows=${status.execution_model_dataset_rows_n != null ? status.execution_model_dataset_rows_n : "N/A"} / filled=${status.execution_model_dataset_filled_n != null ? status.execution_model_dataset_filled_n : "N/A"} / rejected=${status.execution_model_dataset_rejected_n != null ? status.execution_model_dataset_rejected_n : "N/A"}`,
    "",
    "## Server Transition",
    ...(report.server_signal_transition && Array.isArray(report.server_signal_transition.phases)
      ? report.server_signal_transition.phases.map((row) => `- ${row.label}: ${row.status}`)
      : ["- N/A"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objective = readJsonRawSafe(INPUTS.objective, null);
  const objectiveSupervisor = readJsonRawSafe(INPUTS.objectiveSupervisor, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [objectiveSupervisor, objective],
  });
  const report = deriveOpenClawAutonomyContract({
    objective,
    objectiveSupervisor,
    objectiveRecoveryGovernor: readJsonRawSafe(INPUTS.objectiveRecoveryGovernor, null),
    deploymentPlan: readJsonRawSafe(INPUTS.deploymentPlan, null),
    serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
    watchdog: readJsonRawSafe(INPUTS.watchdog, null),
    serverSignalAuthority: readJsonRawSafe(INPUTS.serverSignalAuthority, null),
    serverSignalQuality: readJsonRawSafe(INPUTS.serverSignalQuality, null),
    serverSignalRuntime: readJsonRawSafe(INPUTS.serverSignalRuntime, null),
    marketRegimeBoard: readJsonRawSafe(INPUTS.marketRegimeBoard, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
    objectiveRetrospective: readJsonSafe(INPUTS.objectiveRetrospective, null),
    overallAccountReport: readJsonRawSafe(INPUTS.overallAccountReport, null),
    signalLineageHealth: readJsonRawSafe(INPUTS.signalLineageHealth, null),
    modelReadiness: readJsonRawSafe(INPUTS.modelReadiness, null),
    featureStore: readJsonRawSafe(INPUTS.featureStore, null),
    executionModelDataset: readJsonRawSafe(INPUTS.executionModelDataset, null),
    executionStageLatency: readJsonRawSafe(INPUTS.executionStageLatency, null),
    mlExperimentRegistry: readJsonRawSafe(INPUTS.mlExperimentRegistry, null),
    executionBottleneckDelta: readJsonRawSafe(INPUTS.executionBottleneckDelta, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: { ...INPUTS },
    ...report,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_openclaw_autonomy_contract.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_openclaw_autonomy_contract.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("openclaw_autonomy_contract_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("openclaw_autonomy_contract_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  if (selfEvolutionLatestJson && selfEvolutionLatestJson !== latestJsonPath) copySelfEvolutionLatest(jsonPath, selfEvolutionLatestJson);
  if (selfEvolutionLatestMd && selfEvolutionLatestMd !== latestMdPath) copySelfEvolutionLatest(mdPath, selfEvolutionLatestMd);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_OPENCLAW_AUTONOMY_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
