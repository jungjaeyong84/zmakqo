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
  truthPreservationAudit: path.join(OPS_DAILY_DIR, "best_self_evolution_truth_preservation_audit_latest.json"),
  featureStore: path.join(OPS_DAILY_DIR, "ml_feature_store_latest.json"),
  executionModelDataset: path.join(OPS_DAILY_DIR, "execution_model_dataset_latest.json"),
  executionFillInference: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_fill_inference_latest.json"),
  executionScopeInference: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.json"),
  executionStageLatency: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_stage_latency_latest.json"),
  mlExperimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
  executionBottleneckDelta: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_bottleneck_delta_latest.json"),
  mlTrainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_latest.json"),
  mlTrainRunScope: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_scope_result_latest.json"),
  executionServingContract: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_serving_contract_latest.json"),
  mlGlobalCanaryEvidence: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_global_canary_evidence_latest.json"),
  mlEvReplaySampleGap: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_sample_gap_latest.json"),
  mlReplayUnblockProjection: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_replay_unblock_projection_latest.json"),
  mlEvReplayDeltaDiagnostics: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_delta_diagnostics_latest.json"),
  mlEvReplayMarketContribution: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_market_contribution_latest.json"),
  mlEvReplayProfileContribution: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_profile_contribution_latest.json"),
  mlEvReplayStalePosDiagnostics: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_replay_stale_pos_diagnostics_latest.json"),
  mlEvProfileReviewTracking: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_ev_profile_review_tracking_latest.json"),
  mlModelSpecificCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_specific_canary_latest.json"),
  mlRollbackArm: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_rollback_arm_latest.json"),
  mlModelContract: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_contract_latest.json"),
  mlPromotionGate: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_promotion_gate_latest.json"),
  evGateCompositePolicy: path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_composite_policy_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
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
    `- truth_preservation: ${summary.truth_preservation_audit_status || "N/A"} / ready=${status.truth_preservation_ready ? "YES" : "NO"} / blocks=${status.truth_preservation_blocking_reason_n != null ? status.truth_preservation_blocking_reason_n : "N/A"} / warnings=${status.truth_preservation_warning_reason_n != null ? status.truth_preservation_warning_reason_n : "N/A"}`,
    `- feature_store: ${summary.feature_store_status || "N/A"} / rows=${status.feature_store_rows_n != null ? status.feature_store_rows_n : "N/A"} / keys=${status.feature_store_keys_n != null ? status.feature_store_keys_n : "N/A"}`,
    `- ml_train_run: ${status.ml_train_run_status || "N/A"} / ${status.ml_train_run_model_kind || "N/A"} / ${status.ml_train_run_id || "N/A"}`,
    `- execution_serving: ${status.execution_serving_contract_status || "N/A"} / ${status.execution_serving_stage || "N/A"} / shadow_ready=${status.execution_serving_shadow_ready ? "YES" : "NO"} / model=${status.execution_serving_preferred_model_family || "N/A"}`,
    `- ml_global_canary: ${status.ml_global_canary_status || "N/A"} / evidence=${status.ml_global_canary_evidence_status || "N/A"} / blocker=${status.ml_global_canary_dominant_blocker || "N/A"} / replay=${status.ml_global_canary_replay_evidence_status || "N/A"}:${status.ml_global_canary_replay_dominant_issue || "N/A"} / sample_gap=${status.ml_global_canary_replay_sample_gap_status || "N/A"}:${status.ml_global_canary_replay_sample_gap_n ?? "N/A"} / projected_ready_if_gap_closed=${status.ml_global_canary_replay_projected_ready_if_sample_gap_closed ? "YES" : "NO"} / residual=${status.ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed || "N/A"} / ready=${status.ml_global_canary_ready ? "YES" : "NO"}`,
    `- ml_ev_replay_delta: ${status.ml_ev_replay_delta_diagnostics_status || "N/A"} / driver=${status.ml_ev_replay_delta_driver_class || "N/A"} / applied_gap_role=${status.ml_ev_replay_delta_historical_applied_gap_role || "N/A"} / top+=${status.ml_ev_replay_delta_top_positive_market || "N/A"} / top-=${status.ml_ev_replay_delta_top_negative_market || "N/A"}`,
    `- ml_ev_replay_market: ${status.ml_ev_replay_market_contribution_status || "N/A"} / pattern=${status.ml_ev_replay_market_dominant_drag_pattern || "N/A"} / positive=${status.ml_ev_replay_market_positive_objective_market_n ?? "N/A"} / drag=${status.ml_ev_replay_market_return_drag_market_n ?? "N/A"} / mixed=${status.ml_ev_replay_market_positive_with_return_drag_market_n ?? "N/A"} / top_drag=${status.ml_ev_replay_market_top_return_drag_market || "N/A"} / top_mixed=${status.ml_ev_replay_market_top_mixed_market || "N/A"}`,
    `- ml_ev_replay_profile: ${status.ml_ev_replay_profile_contribution_status || "N/A"} / evidence=${status.ml_ev_replay_profile_evidence_status || "N/A"} / drag=${status.ml_ev_replay_profile_top_return_drag_market || "N/A"}:${status.ml_ev_replay_profile_top_return_drag_profile || "N/A"} / mixed=${status.ml_ev_replay_profile_top_mixed_market || "N/A"}:${status.ml_ev_replay_profile_top_mixed_profile || "N/A"}`,
    `- ml_ev_replay_stale_pos: ${status.ml_ev_replay_stale_pos_diagnostics_status || "N/A"} / evidence=${status.ml_ev_replay_stale_pos_evidence_status || "N/A"} / drag_profile=${status.ml_ev_replay_stale_pos_top_return_drag_profile || "N/A"} / drag_lb=${status.ml_ev_replay_stale_pos_top_return_drag_avg_ev_lb ?? "N/A"} / drag_delay=${status.ml_ev_replay_stale_pos_top_return_drag_avg_delay_cost ?? "N/A"} / mixed_profile=${status.ml_ev_replay_stale_pos_top_mixed_profile || "N/A"} / mixed_lb=${status.ml_ev_replay_stale_pos_top_mixed_avg_ev_lb ?? "N/A"} / mixed_delay=${status.ml_ev_replay_stale_pos_top_mixed_avg_delay_cost ?? "N/A"}`,
    `- ml_ev_profile_review: ${status.ml_ev_profile_review_tracking_status || "N/A"} / evidence=${status.ml_ev_profile_review_tracking_evidence_status || "N/A"} / mode=${status.ml_ev_profile_review_mode || "N/A"} / targets=${status.ml_ev_profile_review_target_n ?? "N/A"} / split_ready=${status.ml_ev_profile_review_split_ready ? "YES" : "NO"} / blocker=${status.ml_ev_profile_review_split_blocker || "N/A"} / drag=${status.ml_ev_profile_review_top_return_drag_profile || "N/A"}:${status.ml_ev_profile_review_top_return_drag_driver || "N/A"} / mixed=${status.ml_ev_profile_review_top_mixed_profile || "N/A"}:${status.ml_ev_profile_review_top_mixed_driver || "N/A"}`,
    `- ml_model_specific_canary: ${status.ml_model_specific_canary_status || "N/A"} / binding=${status.ml_model_specific_canary_binding_mode || "N/A"} / evidence=${status.ml_model_specific_canary_evidence_status || "N/A"} / ready=${status.ml_model_specific_canary_ready ? "YES" : "NO"}`,
    `- ml_rollback_arm: ${status.ml_rollback_arm_status || "N/A"} / source=${status.ml_rollback_arm_binding_source || "N/A"} / evidence=${status.ml_rollback_arm_evidence_status || "N/A"} / ready=${status.ml_rollback_arm_ready ? "YES" : "NO"}`,
    `- ml_model_contract: ${status.ml_model_contract_status || "N/A"} / ${status.ml_model_contract_deployment_stage || "N/A"} / ${status.ml_model_contract_canary_gate_status || "N/A"}`,
    `- ml_promotion_gate: ${status.ml_promotion_gate_status || "N/A"} / ${status.ml_promotion_stage || "N/A"} / ${status.ml_promotion_decision || "N/A"} / global=${status.ml_promotion_global_canary_gate_status || "N/A"} / replay=${status.ml_promotion_global_canary_replay_evidence_status || "N/A"}:${status.ml_promotion_global_canary_replay_dominant_issue || "N/A"} / replay_gap=${status.ml_promotion_global_canary_replay_sample_gap_status || "N/A"}:${status.ml_promotion_global_canary_replay_sample_gap_n ?? "N/A"} / projected_ready_if_gap_closed=${status.ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed ? "YES" : "NO"} / residual=${status.ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed || "N/A"} / canary=${status.ml_promotion_model_specific_canary_gate_status || "N/A"} / rollback=${status.ml_promotion_rollback_gate_status || "N/A"} / binding=${status.ml_promotion_model_specific_canary_binding_mode || "N/A"}`,
    `- ev_gate_policy: ${summary.ev_gate_policy_status || "N/A"} / basis=${status.ev_gate_policy_basis || "N/A"} / canonical=${status.ev_gate_canonical_policy_version || "N/A"} / metric=${status.ev_gate_threshold_metric || "N/A"} / compat=${status.ev_gate_compatibility_drop_reason || "N/A"}`,
    `- ev_candidate: ${status.ev_candidate_id || "N/A"} / canonical=${status.ev_candidate_canonical_id || "N/A"} / top=${status.self_evolution_top_candidate_id || "N/A"}`,
    `- execution_fill_inference: ${status.execution_fill_inference_status || "N/A"} / mismatch=${status.execution_fill_inference_mismatch_rate != null ? status.execution_fill_inference_mismatch_rate : "N/A"}`,
    `- execution_scope_inference: ${status.execution_scope_inference_status || "N/A"} / mismatch=${status.execution_scope_inference_mismatch_rate != null ? status.execution_scope_inference_mismatch_rate : "N/A"} / gate=${status.execution_scope_train_run_quality_gate_status || "N/A"}`,
    `- execution_model_dataset: ${summary.execution_model_dataset_status || "N/A"} / rows=${status.execution_model_dataset_rows_n != null ? status.execution_model_dataset_rows_n : "N/A"} / filled=${status.execution_model_dataset_filled_n != null ? status.execution_model_dataset_filled_n : "N/A"} / rejected=${status.execution_model_dataset_rejected_n != null ? status.execution_model_dataset_rejected_n : "N/A"}`,
    `- execution_bottleneck_delta: ${summary.execution_bottleneck_delta_status || "N/A"} / comparable=${status.execution_bottleneck_delta_comparable ? "YES" : "NO"} / interpretation=${status.execution_bottleneck_delta_interpretation || "N/A"}`,
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
    truthPreservationAudit: readJsonRawSafe(INPUTS.truthPreservationAudit, null),
    featureStore: readJsonRawSafe(INPUTS.featureStore, null),
    executionModelDataset: readJsonRawSafe(INPUTS.executionModelDataset, null),
    executionFillInference: readJsonRawSafe(INPUTS.executionFillInference, null),
    executionScopeInference: readJsonRawSafe(INPUTS.executionScopeInference, null),
    executionStageLatency: readJsonRawSafe(INPUTS.executionStageLatency, null),
    mlExperimentRegistry: readJsonRawSafe(INPUTS.mlExperimentRegistry, null),
    executionBottleneckDelta: readJsonRawSafe(INPUTS.executionBottleneckDelta, null),
    mlTrainRun: readJsonRawSafe(INPUTS.mlTrainRun, null),
    mlTrainRunScope: readJsonRawSafe(INPUTS.mlTrainRunScope, null),
    executionServingContract: readJsonRawSafe(INPUTS.executionServingContract, null),
    mlGlobalCanaryEvidence: readJsonRawSafe(INPUTS.mlGlobalCanaryEvidence, null),
    mlEvReplaySampleGap: readJsonRawSafe(INPUTS.mlEvReplaySampleGap, null),
    mlReplayUnblockProjection: readJsonRawSafe(INPUTS.mlReplayUnblockProjection, null),
    mlEvReplayDeltaDiagnostics: readJsonRawSafe(INPUTS.mlEvReplayDeltaDiagnostics, null),
    mlEvReplayMarketContribution: readJsonRawSafe(INPUTS.mlEvReplayMarketContribution, null),
    mlEvReplayProfileContribution: readJsonRawSafe(INPUTS.mlEvReplayProfileContribution, null),
    mlEvReplayStalePosDiagnostics: readJsonRawSafe(INPUTS.mlEvReplayStalePosDiagnostics, null),
    mlEvProfileReviewTracking: readJsonRawSafe(INPUTS.mlEvProfileReviewTracking, null),
    mlModelSpecificCanary: readJsonRawSafe(INPUTS.mlModelSpecificCanary, null),
    mlRollbackArm: readJsonRawSafe(INPUTS.mlRollbackArm, null),
    mlModelContract: readJsonRawSafe(INPUTS.mlModelContract, null),
    mlPromotionGate: readJsonRawSafe(INPUTS.mlPromotionGate, null),
    evGateCompositePolicy: readJsonRawSafe(INPUTS.evGateCompositePolicy, null),
    candidates: readJsonRawSafe(INPUTS.candidates, null),
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
