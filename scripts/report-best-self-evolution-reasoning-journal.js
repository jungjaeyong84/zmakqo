#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  readJsonSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildReasoningJournal } = require("../src/utils/openclawReasoningJournal");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  serverSignalQuality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  cutover: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  policyPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json"),
  objectiveRetrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
  overallAccountReport: path.join(OPS_DAILY_DIR, "overall_account_report_latest.json"),
  signalLineageHealth: path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json"),
  lineageSloDropMonitor: path.join(OPS_DAILY_DIR, "lineage_slo_drop_monitor_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
});

const RUNTIME_JOURNAL_PATH = path.join(OPS_RUNTIME_DIR, "openclaw_reasoning_journal.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const entries = Array.isArray(report.entries) ? report.entries : [];
  const lines = [
    "# BEST Self-Evolution Reasoning Journal",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- entry_n: ${summary.entry_n ?? 0}`,
    `- contradiction_n: ${summary.contradiction_n ?? 0}`,
    `- verified_n: ${summary.verified_n ?? 0}`,
    `- fast_track_verified_n: ${summary.fast_track_verified_n ?? 0}`,
    `- not_met_n: ${summary.not_met_n ?? 0}`,
    `- unknown_n: ${summary.unknown_n ?? 0}`,
    `- deferred_n: ${summary.deferred_n ?? 0}`,
    `- verification_rate: ${summary.verification_rate != null ? summary.verification_rate : "N/A"}`,
    `- objective_verdict: ${summary.current_objective_verdict || "N/A"}`,
    `- authority_state: ${summary.current_authority_state || "N/A"} / change=${summary.current_change_authority_state || "N/A"}`,
    `- dominant_issue: ${summary.current_dominant_issue || "N/A"} / source=${summary.current_dominant_issue_source || "N/A"}`,
    `- recommended_action: ${summary.current_recommended_action || "N/A"}`,
    `- execution_quality/lineage/account: ${summary.current_execution_quality_status || "N/A"} / ${summary.current_lineage_status || "N/A"} / ${summary.current_account_integrity_status || "N/A"}`,
    `- execution_structure_upgrade: ${summary.current_execution_structure_upgrade_contract_status || "N/A"} / mode=${summary.current_execution_structure_upgrade_mode || "N/A"} / sequence_ready=${summary.current_execution_structure_upgrade_stage_sequence_ready ? "YES" : "NO"} / survivability=${summary.current_execution_structure_upgrade_survivability_ready ? "YES" : "NO"} / labels=${summary.current_execution_structure_upgrade_label_support_ready ? "YES" : "NO"} / tp0=${summary.current_execution_structure_upgrade_tp0_stage_active ? "YES" : "NO"} / tp1=${summary.current_execution_structure_upgrade_tp1_stage_active ? "YES" : "NO"} / trail=${summary.current_execution_structure_upgrade_trail_stage_active ? "YES" : "NO"} / block_n=${summary.current_execution_structure_upgrade_blocking_reason_n ?? "N/A"}`,
    `- cost_control_engine: ${summary.current_cost_control_engine_contract_status || "N/A"} / mode=${summary.current_cost_control_engine_contract_mode || "N/A"} / entry_suppression=${summary.current_cost_control_engine_automatic_entry_suppression_ready ? "YES" : "NO"} / reentry=${summary.current_cost_control_engine_system_reentry_control_ready ? "YES" : "NO"} / expectancy=${summary.current_cost_control_engine_expectancy_gate_active ? "YES" : "NO"} / cost_block=${summary.current_cost_control_engine_cost_block_mode_active ? "YES" : "NO"} / cooldown=${summary.current_cost_control_engine_cooldown_reentry_control_active ? "YES" : "NO"} / reverse=${summary.current_cost_control_engine_reverse_reentry_control_active ? "YES" : "NO"} / block_n=${summary.current_cost_control_engine_blocking_reason_n ?? "N/A"}`,
    `- cohort_regime_parameter_split: ${summary.current_cohort_regime_parameter_split_contract_status || "N/A"} / mode=${summary.current_cohort_regime_parameter_split_contract_mode || "N/A"} / cohort_scope=${summary.current_cohort_regime_parameter_split_cohort_scope || "N/A"} / cohorts=${summary.current_cohort_regime_parameter_split_active_cohort_n ?? "N/A"} / parameterization=${summary.current_cohort_regime_parameter_split_cohort_parameterization_ready ? "YES" : "NO"} / regime_switch=${summary.current_cohort_regime_parameter_split_regime_switch_ready ? "YES" : "NO"} / policy_scope=${summary.current_cohort_regime_parameter_split_policy_scoped_ready ? "YES" : "NO"} / auto_transition=${summary.current_cohort_regime_parameter_split_automatic_transition_ready ? "YES" : "NO"} / block_n=${summary.current_cohort_regime_parameter_split_blocking_reason_n ?? "N/A"}`,
    `- ev_gate_policy: ${summary.current_ev_gate_policy_status || "N/A"} / basis=${summary.current_ev_gate_policy_basis || "N/A"} / canonical=${summary.current_ev_gate_canonical_policy_version || "N/A"} / metric=${summary.current_ev_gate_threshold_metric || "N/A"}`,
    `- ev_candidate: ${summary.current_ev_candidate_id || "N/A"} / canonical=${summary.current_ev_candidate_canonical_id || "N/A"} / top=${summary.current_top_candidate_id || "N/A"}`,
    `- ev_policy_review: ${summary.current_ev_policy_review_mode || "N/A"} / drag=${summary.current_ev_policy_top_return_drag_profile || "N/A"}:${summary.current_ev_policy_top_return_drag_driver || "N/A"} / mixed=${summary.current_ev_policy_top_mixed_profile || "N/A"}:${summary.current_ev_policy_top_mixed_driver || "N/A"}`,
    `- server_signal_ev_unknown_gen_relax: enabled=${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_enabled ? "YES" : "NO"} / mode=${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_mode || "N/A"} / active_window=${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_active_window ? "YES" : "NO"} / review_after_h=${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours ?? "N/A"} / window_h=${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_window_hours ?? "N/A"} / deltas=${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta ?? "N/A"}/${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta ?? "N/A"}/${summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta ?? "N/A"}`,
    `- filter_layers_1_5: 1=${summary.current_filter_layer_1_integrity_mode || "N/A"}:${summary.current_filter_layer_1_integrity_coverage_pass ? "PASS" : "BLOCK"} / 2=${summary.current_filter_layer_2_entry_quality_candidate_verdict || "N/A"}:${summary.current_filter_layer_2_entry_quality_actions ?? "N/A"} / 3=${summary.current_filter_layer_3_state_soft_sizing_ml_action || "N/A"}:${summary.current_filter_layer_3_state_soft_sizing_physics_action || "N/A"}:${summary.current_filter_layer_3_state_soft_sizing_qty_scale ?? "N/A"} / 4=${summary.current_filter_layer_4_ev_time_value_tuner_reason || "N/A"}:${summary.current_filter_layer_4_ev_time_value_policy_version || "N/A"} / 5=${summary.current_filter_layer_5_wait_timing_tuner_reason || "N/A"}:${summary.current_filter_layer_5_wait_timing_wait_action || "N/A"}`,
    `- execution_model_dataset: ${summary.current_execution_model_dataset_status || "N/A"}`,
    `- ml_global_canary: ${summary.current_ml_global_canary_status || "N/A"} / evidence=${summary.current_ml_global_canary_evidence_status || "N/A"} / blocker=${summary.current_ml_global_canary_dominant_blocker || "N/A"} / replay=${summary.current_ml_global_canary_replay_evidence_status || "N/A"}:${summary.current_ml_global_canary_replay_dominant_issue || "N/A"} / sample_gap=${summary.current_ml_global_canary_replay_sample_gap_status || "N/A"}:${summary.current_ml_global_canary_replay_sample_gap_n ?? "N/A"} / projected_ready_if_gap_closed=${summary.current_ml_global_canary_replay_projected_ready_if_sample_gap_closed ? "YES" : "NO"} / residual=${summary.current_ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed || "N/A"} / ready=${summary.current_ml_global_canary_ready ? "YES" : "NO"}`,
    `- ml_ev_replay_delta: ${summary.current_ml_ev_replay_delta_diagnostics_status || "N/A"} / driver=${summary.current_ml_ev_replay_delta_driver_class || "N/A"} / applied_gap_role=${summary.current_ml_ev_replay_delta_historical_applied_gap_role || "N/A"} / top+=${summary.current_ml_ev_replay_delta_top_positive_market || "N/A"} / top-=${summary.current_ml_ev_replay_delta_top_negative_market || "N/A"}`,
    `- ml_ev_replay_market: ${summary.current_ml_ev_replay_market_contribution_status || "N/A"} / pattern=${summary.current_ml_ev_replay_market_dominant_drag_pattern || "N/A"} / positive=${summary.current_ml_ev_replay_market_positive_objective_market_n ?? "N/A"} / drag=${summary.current_ml_ev_replay_market_return_drag_market_n ?? "N/A"} / mixed=${summary.current_ml_ev_replay_market_positive_with_return_drag_market_n ?? "N/A"} / top_drag=${summary.current_ml_ev_replay_market_top_return_drag_market || "N/A"} / top_mixed=${summary.current_ml_ev_replay_market_top_mixed_market || "N/A"}`,
    `- ml_ev_replay_profile: ${summary.current_ml_ev_replay_profile_contribution_status || "N/A"} / evidence=${summary.current_ml_ev_replay_profile_evidence_status || "N/A"} / drag=${summary.current_ml_ev_replay_profile_top_return_drag_market || "N/A"}:${summary.current_ml_ev_replay_profile_top_return_drag_profile || "N/A"} / mixed=${summary.current_ml_ev_replay_profile_top_mixed_market || "N/A"}:${summary.current_ml_ev_replay_profile_top_mixed_profile || "N/A"}`,
    `- ml_ev_replay_stale_pos: ${summary.current_ml_ev_replay_stale_pos_diagnostics_status || "N/A"} / evidence=${summary.current_ml_ev_replay_stale_pos_evidence_status || "N/A"} / drag=${summary.current_ml_ev_replay_stale_pos_top_return_drag_profile || "N/A"} / drag_lb=${summary.current_ml_ev_replay_stale_pos_top_return_drag_avg_ev_lb ?? "N/A"} / drag_delay=${summary.current_ml_ev_replay_stale_pos_top_return_drag_avg_delay_cost ?? "N/A"} / mixed=${summary.current_ml_ev_replay_stale_pos_top_mixed_profile || "N/A"} / mixed_lb=${summary.current_ml_ev_replay_stale_pos_top_mixed_avg_ev_lb ?? "N/A"} / mixed_delay=${summary.current_ml_ev_replay_stale_pos_top_mixed_avg_delay_cost ?? "N/A"}`,
    `- ml_ev_profile_review: ${summary.current_ml_ev_profile_review_tracking_status || "N/A"} / evidence=${summary.current_ml_ev_profile_review_tracking_evidence_status || "N/A"} / mode=${summary.current_ml_ev_profile_review_mode || "N/A"} / targets=${summary.current_ml_ev_profile_review_target_n ?? "N/A"} / split_ready=${summary.current_ml_ev_profile_review_split_ready ? "YES" : "NO"} / blocker=${summary.current_ml_ev_profile_review_split_blocker || "N/A"} / drag=${summary.current_ml_ev_profile_review_top_return_drag_profile || "N/A"}:${summary.current_ml_ev_profile_review_top_return_drag_driver || "N/A"} / mixed=${summary.current_ml_ev_profile_review_top_mixed_profile || "N/A"}:${summary.current_ml_ev_profile_review_top_mixed_driver || "N/A"}`,
    `- ml_model_specific_canary: ${summary.current_ml_model_specific_canary_status || "N/A"} / binding=${summary.current_ml_model_specific_canary_binding_mode || "N/A"} / evidence=${summary.current_ml_model_specific_canary_evidence_status || "N/A"} / ready=${summary.current_ml_model_specific_canary_ready ? "YES" : "NO"}`,
    `- ml_rollback_arm: ${summary.current_ml_rollback_arm_status || "N/A"} / source=${summary.current_ml_rollback_arm_binding_source || "N/A"} / evidence=${summary.current_ml_rollback_arm_evidence_status || "N/A"} / ready=${summary.current_ml_rollback_arm_ready ? "YES" : "NO"}`,
    `- validation_deployment_pipeline: ${summary.current_validation_deployment_pipeline_contract_status || "N/A"} / mode=${summary.current_validation_deployment_pipeline_contract_mode || "N/A"} / stage=${summary.current_validation_deployment_pipeline_current_deployment_stage || "N/A"} / shadow=${summary.current_validation_deployment_pipeline_shadow_numeric_gate_ready ? "YES" : "NO"} / canary=${summary.current_validation_deployment_pipeline_canary_numeric_gate_ready ? "YES" : "NO"} / live=${summary.current_validation_deployment_pipeline_live_numeric_gate_ready ? "YES" : "NO"} / judgement=${summary.current_validation_deployment_pipeline_numeric_judgement_ready ? "YES" : "NO"} / rollback=${summary.current_validation_deployment_pipeline_automatic_rollback_ready ? "YES" : "NO"} / block_n=${summary.current_validation_deployment_pipeline_blocking_reason_n ?? "N/A"}`,
    `- performance_kpi_upgrade: ${summary.current_performance_kpi_upgrade_contract_status || "N/A"} / mode=${summary.current_performance_kpi_upgrade_contract_mode || "N/A"} / micro=${summary.current_performance_kpi_upgrade_microstructure_kpi_ready ? "YES" : "NO"} / survivability=${summary.current_performance_kpi_upgrade_survivability_kpi_ready ? "YES" : "NO"} / expectancy=${summary.current_performance_kpi_upgrade_expectancy_kpi_ready ? "YES" : "NO"} / structure=${summary.current_performance_kpi_upgrade_structure_alignment_ready ? "YES" : "NO"} / cost=${summary.current_performance_kpi_upgrade_cost_alignment_ready ? "YES" : "NO"} / tp0=${summary.current_performance_kpi_upgrade_tp0_hit_rate ?? "N/A"} / tp1=${summary.current_performance_kpi_upgrade_tp1_hit_rate ?? "N/A"} / conversion=${summary.current_performance_kpi_upgrade_tp0_to_tp1_conversion_rate ?? "N/A"} / expectancy_net=${summary.current_performance_kpi_upgrade_fee_adjusted_expectancy ?? "N/A"} / block_n=${summary.current_performance_kpi_upgrade_blocking_reason_n ?? "N/A"}`,
    `- ml_promotion_canary: ${summary.current_ml_promotion_model_specific_canary_gate_status || "N/A"} / global=${summary.current_ml_promotion_global_canary_gate_status || "N/A"} / blocker=${summary.current_ml_promotion_global_canary_dominant_blocker || "N/A"} / replay=${summary.current_ml_promotion_global_canary_replay_evidence_status || "N/A"}:${summary.current_ml_promotion_global_canary_replay_dominant_issue || "N/A"} / replay_gap=${summary.current_ml_promotion_global_canary_replay_sample_gap_status || "N/A"}:${summary.current_ml_promotion_global_canary_replay_sample_gap_n ?? "N/A"} / projected_ready_if_gap_closed=${summary.current_ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed ? "YES" : "NO"} / residual=${summary.current_ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed || "N/A"} / binding=${summary.current_ml_promotion_model_specific_canary_binding_mode || "N/A"} / evidence=${summary.current_ml_promotion_model_specific_canary_evidence_status || "N/A"} / rollback=${summary.current_ml_promotion_rollback_gate_status || "N/A"}`,
    `- microstructure: tp0_hit=${summary.current_microstructure_tp0_hit_rate != null ? summary.current_microstructure_tp0_hit_rate : "N/A"} / tp1_hit=${summary.current_microstructure_tp1_hit_rate != null ? summary.current_microstructure_tp1_hit_rate : "N/A"} / pre_tp1_time_stop=${summary.current_microstructure_pre_tp1_time_stop_rate != null ? summary.current_microstructure_pre_tp1_time_stop_rate : "N/A"} / chase_reject=${summary.current_microstructure_chase_reject_n != null ? summary.current_microstructure_chase_reject_n : "N/A"} / cluster_reduce=${summary.current_microstructure_cluster_reduce_n != null ? summary.current_microstructure_cluster_reduce_n : "N/A"} / cluster_block=${summary.current_microstructure_cluster_block_n != null ? summary.current_microstructure_cluster_block_n : "N/A"}`,
    `- compacted_context: ${report.compacted_context || "N/A"}`,
    "",
    "## Entries",
  ];
  if (!entries.length) {
    lines.push("- none");
  } else {
    for (const row of entries.slice(0, 10)) {
      lines.push(`- ${row.cycle_id || "N/A"}: issue=${row.dominant_issue || "UNKNOWN"} / action=${row.recommended_action || "MONITOR_ONLY"} / objective=${row.objective_verdict || "N/A"} / authority=${row.authority_state || "N/A"} / change=${row.change_authority_state || "N/A"} / pending=${row.pending_verification && row.pending_verification.metric || "none"} / verification=${row.verification_outcome && row.verification_outcome.status || "UNRESOLVED"} / hypothesis=${row.hypothesis || "N/A"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = buildReasoningJournal({
    cycleId: cycleMeta.cycle_id,
    nowKst: nowMeta.kst,
    objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
    autonomyContract: readJsonRawSafe(INPUTS.autonomyContract, null),
    quality: readJsonRawSafe(INPUTS.serverSignalQuality, null),
    cutover: readJsonRawSafe(INPUTS.cutover, null),
    policyPlan: readJsonRawSafe(INPUTS.policyPlan, null),
    objectiveRetrospective: readJsonSafe(INPUTS.objectiveRetrospective, null),
    overallAccountReport: readJsonRawSafe(INPUTS.overallAccountReport, null),
    signalLineageHealth: readJsonRawSafe(INPUTS.signalLineageHealth, null),
    lineageSloDropMonitor: readJsonRawSafe(INPUTS.lineageSloDropMonitor, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
    previousJournal: readJsonSafe(RUNTIME_JOURNAL_PATH, null),
  });

  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS, runtimeJournal: RUNTIME_JOURNAL_PATH },
    ...report,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_reasoning_journal.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_reasoning_journal.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_reasoning_journal_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_reasoning_journal_latest.md");

  writeJson(RUNTIME_JOURNAL_PATH, output);
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("reasoning_journal_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("reasoning_journal_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: output.cycle_id,
    dominant_issue: output.summary.current_dominant_issue,
    recommended_action: output.summary.current_recommended_action,
    contradiction_n: output.summary.contradiction_n,
    verified_n: output.summary.verified_n,
    fast_track_verified_n: output.summary.fast_track_verified_n,
    verification_rate: output.summary.verification_rate,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_REASONING_JOURNAL_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
