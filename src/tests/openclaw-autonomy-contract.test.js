"use strict";

const assert = require("assert");
const { deriveOpenClawAutonomyContract } = require("../../src/utils/openclawAutonomyContract");

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -7.4, snapshot: { win_rate: 0.44 } } },
    objectiveSupervisor: {
      raw: {
        objective: { monthly_run_rate_krw: -436.19 },
        self_evolution_objective: { objective_score: -7.4, win_rate: 0.44 },
        filter_layers: {
          integrity: { server_mode: "INTEGRITY_GUARD_ONLY", expectation: "N/A", coverage_pass: true },
          entry_quality: { pine_candidate_verdict: "HOLD", quality_actions: 2 },
          state_soft_sizing: { ml_action: "KEEP", physics_action: "ALLOW", qty_scale: 1, dominant_state: "MIXED", dominant_action: "UNKNOWN" },
          ev_time_value: { tuner_reason: "INSUFFICIENT_SAMPLE", observed_tuner_reason: "INSUFFICIENT_SAMPLE", fresh: true, age_hours: 15.4265, policy_version: "TP1_WEIGHT_V1", policy_source: "DEFAULT" },
          wait_timing: { tuner_reason: "TRIGGER_SAMPLE_TOO_SMALL", wait_action: "ALLOW", febt_calc_ok_rate: 0.2727, febt_phase_known: 9, febt_fire_n: 0, febt_late_n: 0, febt_void_n: 1, febt_disagreement_n: 9, febt_fallback_legacy_n: 24, febt_missing_rate: 0.7273 },
        },
      },
      display: {
        objective: { monthly_run_rate_krw: -436.19 },
        self_evolution_objective: { objective_score: -7.4, win_rate: 0.44 },
      },
    },
    objectiveRecoveryGovernor: {
      summary: {
        degraded_authority_enabled: true,
        degraded_authority_eligible: true,
        governor_status: "RECOVERY_PROMOTION_READY",
      },
    },
    deploymentPlan: {
      summary: {
        plan_status: "APPLIED_ACTIVE_PENDING_AUTHORITY",
        authority_state: "PENDING",
        external_authority_pending: true,
        activation_confirmed: true,
        activation_status: "ACTIVE",
        live_auto_mutation_allowed: true,
        manual_promote_required: false,
      },
    },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 0, pine_shadow_disagreement_rate: 0, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
    serverSignalRuntime: { summary: { runtime_status: "READY", exec_tf: "15m", market_count: 7, ev_gate_unknown_gen_relax_enabled: true, ev_gate_unknown_gen_relax_mode: "REPORT_ONLY", ev_gate_unknown_gen_relax_started_at: "2026-04-06T22:50:11.452Z", ev_gate_unknown_gen_relax_window_hours: 6, ev_gate_unknown_gen_relax_review_after_hours: 4, ev_gate_unknown_gen_relax_active_window: true, ev_gate_unknown_gen_relax_auto_rollback_enabled: false, ev_gate_unknown_gen_relax_tp1_prob_min_delta: 0.04, ev_gate_unknown_gen_relax_tp1_prob_full_delta: 0.03, ev_gate_unknown_gen_relax_tp1_prob_kill_delta: 0.02, tp1_ladder_enabled: true, tp1_ladder_stage1_realized_n_min: 8, tp1_ladder_stage1_tp0_hit_rate_min: 0.55, tp1_ladder_stage1_tp0_to_tp1_conversion_min: 0.20, tp1_ladder_stage1_fee_adjusted_expectancy_min: -0.0005, tp1_ladder_stage2_realized_n_min: 16, tp1_ladder_stage2_tp0_hit_rate_min: 0.60, tp1_ladder_stage2_tp1_hit_rate_min: 0.30, tp1_ladder_stage2_tp0_to_tp1_conversion_min: 0.35, tp1_ladder_stage2_fee_adjusted_expectancy_min: 0, tp1_ladder_default_profile: "RESCUE", tp1_ladder_promotion_mode: "RESCUE_FIRST_PROMOTION", opposite_cooldown_bars_base: 3, opposite_cooldown_bars_mixed: 1, opposite_cooldown_bars_rescue: 0, opposite_cooldown_ms_base: 300000, opposite_cooldown_ms_mixed: 60000, opposite_cooldown_ms_rescue: 0, opposite_cooldown_default_profile: "RESCUE", opposite_cooldown_promotion_mode: "RESCUE_FIRST_PROMOTION", reverse_exception_mixed_bypass_tier_block: true, reverse_exception_rescue_bypass_tier_block: true } },
    marketRegimeBoard: { summary: { status: "RESCUE_COHORT_ACTIVE", rescue_market_n: 2, keep_drop_market_n: 3, top_rescue_market: "SOLUSDT", top_keep_drop_market: "AXSUSDT" } },
    executionQuality: { summary: { status: "EXECUTION_QUALITY_REVIEW", created_to_fill_p95_ms: 59871, adverse_slippage_p95_bps: 81.37, partial_fill_rate_pct: 67.57, top_latency_market: "AXSUSDT", top_operational_webhook_delay_cause: "IMMEDIATE_EXEC_TRUE_INTENT_DELAY", top_operational_immediate_intent_delay_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT", top_no_fill_reason: "LIVE_EXCEPTION", top_no_fill_subtype: "TIMING_IMMEDIATE_EXEC", execution_scope_quality_gate_status: "POLICY_BLOCKED_RECALL_TOO_LOW", execution_scope_quality_gate_ready: false, execution_scope_inference_mismatch_rate: 0.29, execution_scope_top_false_positive_group: "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH", execution_scope_fp_diagnostics_status: "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY", execution_scope_fp_diagnostics_top_shared_feature: "execution.entry_schedule_reason=LATE_EXEC", execution_scope_fp_diagnostics_top_context_profile: "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL", execution_scope_fp_diagnostics_reference_rows_n: 4, execution_scope_fp_diagnostics_reference_group_mode: "EXACT_SOURCE_EVENT_MARKET", execution_scope_tier_raw_diff_top_webhook_execution_profile: "WEBHOOK_PRE_BAR_CLOSE_FILLED", execution_scope_tier_raw_diff_top_webhook_bar_timing_profile: "PRE_BAR_CLOSE_GT_5M", execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n: 2, execution_scope_tier_raw_diff_saved_no_probe_rows_n: 2, execution_scope_tier_raw_diff_pre_bar_close_rows_n: 2 } },
    objectiveRetrospective: { display: { generated_at_kst: "2026-04-05 15:33:52 KST", execution_microstructure: { tp0_hit_rate: 0.85, tp1_hit_rate: 0, tp0_to_tp1_conversion_rate: 0, pre_tp1_time_stop_rate: 0, chase_reject_n: 1, portfolio_cluster_reduce_n: 2, portfolio_cluster_block_n: 0 } } },
    executionStructureUpgradeContract: { summary: { status: "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_READY", structure_mode: "ENTRY_TP0_TP1_TRAIL", survivability_priority: "PRE_TP1_SURVIVABILITY_FIRST", stage_sequence_ready: true, survivability_ready: true, label_support_ready: true, tp0_stage_active: true, tp1_stage_active: true, trail_stage_active: true, conversion_observable: true, pre_tp1_survivability_observable: true, tp0_pct: 0.8, tp0_qty_ratio: 0.25, tp1_pct: 3.25, trail_r_multiple: 0.9, tp0_to_tp1_conversion_rate: 0, pre_tp1_time_stop_rate: 0, blocking_reason_n: 0 } },
    costControlEngineContract: { summary: { status: "COST_CONTROL_ENGINE_CONTRACT_READY", contract_mode: "EXPECTANCY_AND_REENTRY_CONTROL", automatic_entry_suppression_ready: true, system_reentry_control_ready: true, expectancy_gate_active: true, cost_block_mode_active: true, cooldown_reentry_control_active: true, reverse_reentry_control_active: true, fill_cost_pressure_active: true, expectancy_metric: "exit_value_lower_bound", expectancy_metric_family: "TP_COMPOSITE_EXIT_VALUE", operations_mode: "비용 차단", cooldown_policy_status: "MONITOR_WITH_TARGETED_REVIEW", cooldown_policy_mismatch_n: 1, reverse_policy_status: "REVERSE_POLICY_REVIEW", reverse_blocked_n: 274, reverse_cooldown_n: 22, blocking_reason_n: 0 } },
    cohortRegimeParameterSplitContract: { summary: { status: "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_READY", contract_mode: "COHORT_REGIME_AUTO_SWITCH", cohort_scope: "RESCUE_MIXED_KEEP_DROP", active_market_n: 7, active_cohort_n: 3, rescue_market_n: 2, mixed_market_n: 1, keep_drop_market_n: 3, has_market_split: true, cohort_parameterization_ready: true, regime_switch_ready: true, policy_scoped_ready: true, auto_switch_observability_ready: true, automatic_transition_ready: true, policy_plan_status: "HOLD", policy_plan_mode: "ADVISORY_ONLY", policy_global_qty_scale: 0.55, cohort_action_profile_n: 3, blocking_reason_n: 0 } },
    overallAccountReport: { integrity: { ok: false, issue_count: 4, active_market_count: 3, position_doc_count: 3 }, operations: { status: "보류", mode: "비용 차단" } },
    signalLineageHealth: { summary: { verdict: "PASS", fills_intent_id_null_rate: 0, entry_fills_intent_id_null_rate: 0, external_reconciled_fills_intent_id_null_n: 4, warning_reasons: ["EXTERNAL_RECONCILED_FILL_INTENT_NULL_PRESENT"], fills_signal_doc_id_null_rate: 0, intents_signal_doc_id_null_rate: 0 } },
    lineageSloDropMonitor: { summary: { status: "LINEAGE_SLO_DROP_MONITOR_READY", evidence_status: "AWAITING_POST_FIX_DROP_CACHE", post_fix_lineage_slo_drop_n: 0, pre_fix_lineage_slo_drop_n: 12, latest_lineage_slo_drop_created_at: "2026-04-06T07:45:06.723Z", post_fix_clear: true } },
    modelReadiness: { summary: { status: "MODEL_READINESS_READY", rows_n: 344, realized_n: 18, invalid_n: 0, mfe_mae_labeled_n: 7, mfe_mae_label_rate: 0.0203, tp1_time_labeled_n: 1, tp1_time_label_rate: 0.0029, tp0_time_labeled_n: 0, tp0_time_label_rate: 0, tp0_to_tp1_converted_n: 0, pre_tp1_time_stop_n: 0, schema_version: "2026-04-05.v1", dataset_version_id: "ML_TRAINING_DATASET__abc123" } },
    truthPreservationAudit: { summary: { status: "TRUTH_PRESERVATION_AUDIT_READY", truth_preservation_ready: true, dataset_version_id: "ML_TRAINING_DATASET__abc123", feature_store_version_id: "ML_FEATURE_STORE__def456", execution_dataset_version_id: "EXECUTION_MODEL_DATASET__xyz789", lineage_status: "PASS", stale_comparison_active: true, legacy_webhook_outcome_only_rows_n: 15, blocking_reason_n: 0, warning_reason_n: 2 } },
    featureStore: { summary: { status: "FEATURE_STORE_READY", rows_n: 344, feature_keys_n: 287, schema_version: "2026-04-05.v1", version_id: "ML_FEATURE_STORE__def456" } },
    executionModelDataset: { summary: { status: "EXECUTION_MODEL_DATASET_READY", version_id: "EXECUTION_MODEL_DATASET__xyz789", rows_n: 4112, entry_rows_n: 1325, exit_rows_n: 2787, filled_n: 2058, rejected_n: 3, partial_n: 14, created_to_fill_p95_ms: 966453, created_to_fill_measured_p95_ms: 61234, signal_to_intent_p95_ms: 81234, signal_to_fill_p95_ms: 966453, webhook_to_intent_p95_ms: 42000, webhook_to_outcome_p95_ms: 12000, slippage_p95_bps: 12.4, top_webhook_to_intent_latency_groups: [{ key: "EARLY_LONG|TV_WEBHOOK|BTCUSDT", market: "BTCUSDT", source: "TV_WEBHOOK", webhook_to_intent_p95_ms: 42000 }], top_webhook_delay_reasons: [{ key: "WAIT_NEXT_BAR", rows_n: 4 }], top_webhook_delay_causes: [{ key: "SCHEDULED_WAIT_NEXT_BAR", rows_n: 4 }], top_operational_webhook_delay_causes: [{ key: "SCHEDULED_WAIT_NEXT_BAR", rows_n: 4 }], top_operational_immediate_intent_delay_groups: [{ key: "TV_WEBHOOK|EARLY_LONG|BTCUSDT", source: "TV_WEBHOOK", event: "EARLY_LONG", market: "BTCUSDT", rows_n: 4, webhook_to_intent_p95_ms: 42000 }], top_signal_to_intent_latency_groups: [{ key: "EARLY_LONG|MANUAL_REPLAY|XRPUSDT", market: "XRPUSDT", source: "MANUAL_REPLAY", signal_to_intent_p95_ms: 533960686 }], top_operational_signal_to_intent_latency_groups: [{ key: "EARLY_LONG|TV_WEBHOOK|BTCUSDT", market: "BTCUSDT", source: "TV_WEBHOOK", signal_to_intent_p95_ms: 81234 }], top_entry_measured_latency_groups: [{ key: "EARLY_LONG|UNKNOWN|BINANCE_USER_TRADES|BTCUSDT", market: "BTCUSDT", primary_fill_source: "BINANCE_USER_TRADES", created_to_fill_p95_ms: 6315271 }], top_entry_fallback_latency_groups: [{ key: "CORE_LONG|UNKNOWN|BINANCE_ORDER|XRPUSDT", market: "XRPUSDT", primary_fill_source: "BINANCE_ORDER", created_to_fill_p95_ms: 7580368 }], by_primary_fill_source: [{ key: "NO_FILL", rows_n: 2054, slippage_zero_rate: 1, slippage_measured_rate: 0.0004 }], top_no_fill_reasons: [{ key: "LIVE_EXCEPTION", rows_n: 1201 }], top_no_fill_reason_families: [{ key: "RUNTIME_ERROR", rows_n: 1425 }], top_no_fill_subtypes: [{ key: "TIMING_IMMEDIATE_EXEC", rows_n: 1172 }] } },
    executionFillInference: { summary: { status: "EXECUTION_FILL_INFERENCE_READY", model_artifact_id: "MODEL_EXEC_FILL__m1", mismatch_rate: 0.19, by_scope: [{ key: "FILLED", avg_pred_fill_prob: 0.41 }, { key: "POLICY_BLOCKED", avg_pred_fill_prob: 0.27 }] } },
    executionScopeInference: { summary: { status: "EXECUTION_SCOPE_INFERENCE_READY", model_artifact_id: "MODEL_EXEC_SCOPE__s1", mismatch_rate: 0.29, top_false_positive_groups: [{ key: "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH", rows_n: 9 }] } },
    executionStageLatency: { summary: { status: "EXECUTION_STAGE_LATENCY_READY", signal_to_intent_p95_ms: 81234, webhook_saved_to_intent_p95_ms: 42000, intent_to_fill_measured_p95_ms: 61234, top_signal_to_intent_groups: [{ key: "MANUAL_REPLAY|EARLY_LONG|XRPUSDT" }], top_operational_signal_to_intent_groups: [{ key: "TV_WEBHOOK|EARLY_LONG|BTCUSDT" }], top_webhook_saved_to_intent_groups: [{ key: "MANUAL_REPLAY|EARLY_LONG|XRPUSDT" }], top_operational_webhook_saved_to_intent_groups: [{ key: "TV_WEBHOOK|EARLY_LONG|BTCUSDT" }], top_intent_to_fill_measured_groups: [{ key: "LIVE_RUNTIME|CORE_LONG|ETHUSDT" }] } },
    mlExperimentRegistry: { summary: { status: "ML_EXPERIMENT_REGISTRY_READY", experiment_id: "ML_BASELINE_ENV__abc123def4567890", dataset_version_id: "ML_TRAINING_DATASET__abc123", feature_store_version_id: "ML_FEATURE_STORE__def456", execution_dataset_version_id: "EXECUTION_MODEL_DATASET__xyz789" } },
    executionBottleneckDelta: { summary: { status: "EXECUTION_BOTTLENECK_DELTA_READY", signal_to_intent_p95_delta_ms: -15000, webhook_saved_to_intent_p95_delta_ms: -9000, created_to_fill_p95_delta_ms: -3000, current_top_operational_webhook_delay_cause: "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT", current_top_operational_signal_to_intent_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT" } },
    mlTrainRun: { summary: { status: "ML_TRAIN_RUN_NOT_STARTED", model_artifact_id: null, quality_gate_status: null, quality_gate_ready: false } },
    mlTrainRunScope: { summary: { status: "ML_TRAIN_RUN_REPORTED", train_run_id: "TRAIN_EXEC_SCOPE__s1", model_artifact_id: "MODEL_EXEC_SCOPE__s1", model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1", quality_gate_status: "POLICY_BLOCKED_RECALL_TOO_LOW", quality_gate_ready: false, split_diagnostics: { top_policy_blocked_test_source: "PINE_WEBHOOK", top_policy_blocked_test_source_train_n: 1, top_policy_blocked_test_source_test_n: 13, top_policy_blocked_test_source_test_share: 0.8667 } } },
    executionServingContract: { summary: { status: "EXECUTION_SERVING_CONTRACT_READY", serving_stage: "OFFLINE_ONLY", serving_decision: "HOLD_SCOPE_QUALITY", shadow_ready: false, preferred_model_family: "EXECUTION_SCOPE", preferred_model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1", preferred_model_artifact_id: "MODEL_EXEC_SCOPE__s1" } },
    mlModelSpecificCanary: { summary: { status: "ML_MODEL_SPECIFIC_CANARY_READY", binding_mode: "MODEL_BINDING_MISSING", evidence_status: "MODEL_SPECIFIC_CANARY_BINDING_MISSING", model_specific_canary_ready: false, preferred_model_artifact_id: "MODEL_EXEC_SCOPE__s1", preferred_train_run_id: "TRAIN_EXEC_SCOPE__s1", bound_model_artifact_id: null, bound_train_run_id: null } },
    validationDeploymentPipelineContract: { summary: { status: "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BOOTSTRAPPING", contract_mode: "SHADOW_CANARY_LIVE_NUMERIC_GATES", current_deployment_stage: "SHADOW_READY", shadow_numeric_gate_ready: true, canary_numeric_gate_ready: false, live_numeric_gate_ready: false, numeric_judgement_ready: true, automatic_rollback_ready: true, global_canary_evidence_status: "GLOBAL_CANARY_REPLAY_BLOCKED", global_canary_dominant_blocker: "SELF_EVOLUTION_REPLAY_NOT_PASS", replay_sample_gap_n: 1, replay_projected_ready_if_gap_closed: false, replay_projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA", blocking_reason_n: 2 } },
    performanceKpiUpgradeContract: { summary: { status: "PERFORMANCE_KPI_UPGRADE_CONTRACT_READY", contract_mode: "TP0_TP1_CONVERSION_EXPECTANCY_KPI", microstructure_kpi_ready: true, survivability_kpi_ready: true, expectancy_kpi_ready: true, structure_alignment_ready: true, cost_alignment_ready: true, tp0_hit_rate: 0.85, tp1_hit_rate: 0, tp0_to_tp1_conversion_rate: 0, pre_tp1_time_stop_rate: 0, fee_adjusted_expectancy: -0.0011, realized_trade_n: 24, legacy_win_rate_reference: 0.3333, objective_verdict: "FAIL", blocking_reason_n: 0 } },
    mlModelContract: { summary: { status: "ML_MODEL_CONTRACT_OFFLINE_ONLY", deployment_stage: "OFFLINE_ONLY", canary_gate_status: "BLOCK_MODEL_QUALITY", promotion_status: "HOLD_MODEL_QUALITY", model_artifact_id: null } },
    mlGlobalCanaryEvidence: { summary: { status: "ML_GLOBAL_CANARY_EVIDENCE_READY", global_canary_ready: false, evidence_status: "GLOBAL_CANARY_REPLAY_BLOCKED", dominant_blocker: "SELF_EVOLUTION_REPLAY_NOT_PASS", replay_evidence_status: "REPLAY_WARN_INSUFFICIENT_SAMPLE", replay_dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE", replay_sample_gap_status: "EV_REPLAY_SAMPLE_GAP", replay_sample_required_realized_n: 8, replay_sample_current_effective_realized_n: 7, replay_sample_gap_n: 1, replay_sample_dominant_dimension: "GOVERNANCE_EFFECTIVE_REALIZED", replay_projected_ready_if_sample_gap_closed: false, replay_projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA" } },
    mlEvReplaySampleGap: { summary: { status: "ML_EV_REPLAY_SAMPLE_GAP_READY", evidence_status: "EV_REPLAY_SAMPLE_GAP", required_realized_n: 8, governance_effective_realized_n: 7, governance_effective_gap_n: 1, dominant_sample_dimension: "GOVERNANCE_EFFECTIVE_REALIZED" } },
    mlReplayUnblockProjection: { summary: { status: "ML_REPLAY_UNBLOCK_PROJECTION_READY", projected_replay_ready_if_sample_gap_closed: false, projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA" } },
    mlEvProfileReviewTracking: { summary: { status: "ML_EV_PROFILE_REVIEW_TRACKING_READY", evidence_status: "PROFILE_REVIEW_TRACKING_READY", review_mode: "PROFILE_CONDITIONAL_REVIEW", target_n: 2, split_ready: false, split_blocker: "PROFILE_REALIZED_DELTA_TOO_SMALL", top_return_drag_profile: "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE", top_return_drag_driver: "FAILURE_RISK_HEAVY", top_mixed_profile: "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED", top_mixed_driver: "DELAY_LATE_RISK_HEAVY" } },
    mlPromotionGate: { summary: { status: "ML_PROMOTION_GATE_READY", promotion_stage: "OFFLINE_ONLY", promotion_decision: "HOLD_REPLAY", preferred_model_family: "EXECUTION_SCOPE", preferred_model_artifact_id: "MODEL_EXEC_SCOPE__s1", model_specific_canary_gate_status: "BLOCK", model_specific_canary_ready: false, model_specific_canary_binding_mode: "MODEL_BINDING_MISSING", model_specific_canary_evidence_status: "MODEL_SPECIFIC_CANARY_BINDING_MISSING", global_canary_replay_sample_gap_status: "EV_REPLAY_SAMPLE_GAP", global_canary_replay_sample_required_realized_n: 8, global_canary_replay_sample_current_effective_realized_n: 7, global_canary_replay_sample_gap_n: 1, global_canary_replay_sample_dominant_dimension: "GOVERNANCE_EFFECTIVE_REALIZED", global_canary_replay_projected_ready_if_sample_gap_closed: false, global_canary_replay_projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA" } },
    evGateCompositePolicy: { summary: { status: "EV_GATE_COMPOSITE_POLICY_READY", policy_basis: "TP_COMPOSITE_EXIT_VALUE_V1", canonical_policy_version: "EV_COMPOSITE_EXIT_VALUE_V1", compatibility_policy_version: "TP1_WEIGHT_V1", threshold_metric: "exit_value_lower_bound", threshold_metric_family: "TP_COMPOSITE_EXIT_VALUE", compatibility_drop_reason: "DROP_EV_GATE_TP1_PROB", default_tp0_pct: 0.8, default_tp0_qty_ratio: 0.25, default_tp1_pct: 3.25, default_sl_pct: 1.65, tp1_prob_min_global: 0.55, tp1_prob_min_early: 0.6, tp1_prob_min_core: 0.57, legacy_threshold_setting_keys: ["ev_gate_tp1_prob_min"] } },
    candidates: { summary: { top_candidate_id: "ML_GATE_CORE_SCORE_ABS" }, rows: [{ candidate_id: "ML_GATE_CORE_SCORE_ABS", canonical_candidate_id: null, scope: "ML" }, { candidate_id: "EV_TP1_THRESHOLD_TUNE", canonical_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE", scope: "EV" }] },
  });

  assert.strictEqual(report.current_status.objective_score, -7.4);
  assert.strictEqual(report.current_status.objective_score_source, "OBJECTIVE");
  assert.strictEqual(report.current_status.monthly_run_rate_krw, -436.19);
  assert.strictEqual(report.current_status.win_rate, 0.44);
  assert.strictEqual(report.summary.goal_state, "OBJECTIVE_RECOVERY_REQUIRED");
  assert.strictEqual(report.summary.authority_state, "DEGRADED_ACTIVE");
  assert.strictEqual(report.summary.change_authority_state, "PENDING");
  assert.strictEqual(report.summary.change_authority_pending, true);
  assert.strictEqual(report.current_status.runtime_authority_state, "DEGRADED_ACTIVE");
  assert.strictEqual(report.current_status.change_authority_state, "PENDING");
  assert.strictEqual(report.summary.phase_d_status, "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT");
  assert.strictEqual(report.summary.ops_status, "PASS");
  assert.strictEqual(report.summary.market_regime_board_status, "RESCUE_COHORT_ACTIVE");
  assert.strictEqual(report.summary.execution_quality_status, "EXECUTION_QUALITY_REVIEW");
  assert.strictEqual(report.summary.lineage_status, "PASS");
  assert.strictEqual(report.summary.account_integrity_status, "WARN");
  assert.strictEqual(report.summary.execution_microstructure_status, "ACTIVE");
  assert.strictEqual(report.summary.execution_structure_upgrade_contract_status, "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_READY");
  assert.strictEqual(report.summary.execution_structure_upgrade_mode, "ENTRY_TP0_TP1_TRAIL");
  assert.strictEqual(report.summary.execution_structure_upgrade_stage_sequence_ready, true);
  assert.strictEqual(report.summary.execution_structure_upgrade_survivability_ready, true);
  assert.strictEqual(report.summary.cost_control_engine_contract_status, "COST_CONTROL_ENGINE_CONTRACT_READY");
  assert.strictEqual(report.summary.cost_control_engine_automatic_entry_suppression_ready, true);
  assert.strictEqual(report.summary.cost_control_engine_system_reentry_control_ready, true);
  assert.strictEqual(report.summary.cohort_regime_parameter_split_contract_status, "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_READY");
  assert.strictEqual(report.summary.cohort_regime_parameter_split_contract_mode, "COHORT_REGIME_AUTO_SWITCH");
  assert.strictEqual(report.summary.cohort_regime_parameter_split_cohort_parameterization_ready, true);
  assert.strictEqual(report.summary.cohort_regime_parameter_split_automatic_transition_ready, true);
  assert.strictEqual(report.summary.portfolio_cluster_risk_status, "REDUCING");
  assert.strictEqual(report.summary.truth_preservation_audit_status, "TRUTH_PRESERVATION_AUDIT_READY");
  assert.strictEqual(report.summary.truth_preservation_ready, true);
  assert.strictEqual(report.summary.truth_preservation_lineage_status, "PASS");
  assert.strictEqual(report.summary.truth_preservation_stale_comparison_active, true);
  assert.strictEqual(report.summary.truth_preservation_legacy_webhook_outcome_only_rows_n, 15);
  assert.strictEqual(report.summary.feature_store_status, "FEATURE_STORE_READY");
  assert.strictEqual(report.current_status.market_regime_top_rescue_market, "SOLUSDT");
  assert.strictEqual(report.current_status.execution_quality_latency_p95_ms, 59871);
  assert.strictEqual(report.current_status.execution_quality_top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_TRUE_INTENT_DELAY");
  assert.strictEqual(report.current_status.execution_quality_top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(report.current_status.server_signal_runtime_ev_gate_unknown_gen_relax_enabled, true);
  assert.strictEqual(report.current_status.server_signal_runtime_ev_gate_unknown_gen_relax_mode, "REPORT_ONLY");
  assert.strictEqual(report.current_status.server_signal_runtime_ev_gate_unknown_gen_relax_active_window, true);
  assert.strictEqual(report.current_status.server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours, 4);
  assert.strictEqual(report.current_status.server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled, false);
  assert.strictEqual(report.current_status.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta, 0.04);
  assert.strictEqual(report.current_status.server_signal_runtime_tp1_ladder_enabled, true);
  assert.strictEqual(report.current_status.server_signal_runtime_tp1_ladder_stage1_realized_n_min, 8);
  assert.strictEqual(report.current_status.server_signal_runtime_tp1_ladder_stage2_tp1_hit_rate_min, 0.3);
  assert.strictEqual(report.current_status.server_signal_runtime_tp1_ladder_default_profile, "RESCUE");
  assert.strictEqual(report.current_status.server_signal_runtime_tp1_ladder_promotion_mode, "RESCUE_FIRST_PROMOTION");
  assert.strictEqual(report.current_status.server_signal_runtime_opposite_cooldown_bars_base, 3);
  assert.strictEqual(report.current_status.server_signal_runtime_opposite_cooldown_bars_mixed, 1);
  assert.strictEqual(report.current_status.server_signal_runtime_opposite_cooldown_bars_rescue, 0);
  assert.strictEqual(report.current_status.server_signal_runtime_opposite_cooldown_default_profile, "RESCUE");
  assert.strictEqual(report.current_status.server_signal_runtime_opposite_cooldown_promotion_mode, "RESCUE_FIRST_PROMOTION");
  assert.strictEqual(report.current_status.server_signal_runtime_reverse_exception_rescue_bypass_tier_block, true);
  assert.strictEqual(report.current_status.filter_layer_1_integrity_mode, "INTEGRITY_GUARD_ONLY");
  assert.strictEqual(report.current_status.filter_layer_2_entry_quality_candidate_verdict, "HOLD");
  assert.strictEqual(report.current_status.filter_layer_3_state_soft_sizing_physics_action, "ALLOW");
  assert.strictEqual(report.current_status.filter_layer_4_ev_time_value_tuner_reason, "INSUFFICIENT_SAMPLE");
  assert.strictEqual(report.current_status.filter_layer_5_wait_timing_wait_action, "ALLOW");
  assert.strictEqual(report.current_status.lineage_entry_fills_intent_null_rate, 0);
  assert.strictEqual(report.current_status.lineage_external_reconciled_fill_intent_null_present, true);
  assert.strictEqual(report.current_status.lineage_slo_drop_monitor_evidence_status, "AWAITING_POST_FIX_DROP_CACHE");
  assert.strictEqual(report.current_status.lineage_slo_drop_monitor_post_fix_clear, true);
  assert.strictEqual(report.current_status.account_integrity_issue_n, 4);
  assert.strictEqual(report.current_status.tp0_hit_rate, 0.85);
  assert.strictEqual(report.current_status.execution_structure_upgrade_contract_status, "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_READY");
  assert.strictEqual(report.current_status.execution_structure_upgrade_tp0_stage_active, true);
  assert.strictEqual(report.current_status.execution_structure_upgrade_tp1_stage_active, true);
  assert.strictEqual(report.current_status.execution_structure_upgrade_trail_stage_active, true);
  assert.strictEqual(report.current_status.cost_control_engine_contract_status, "COST_CONTROL_ENGINE_CONTRACT_READY");
  assert.strictEqual(report.current_status.cost_control_engine_expectancy_gate_active, true);
  assert.strictEqual(report.current_status.cost_control_engine_cost_block_mode_active, true);
  assert.strictEqual(report.current_status.cost_control_engine_reverse_reentry_control_active, true);
  assert.strictEqual(report.current_status.cohort_regime_parameter_split_contract_status, "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_READY");
  assert.strictEqual(report.current_status.cohort_regime_parameter_split_active_cohort_n, 3);
  assert.strictEqual(report.current_status.cohort_regime_parameter_split_regime_switch_ready, true);
  assert.strictEqual(report.current_status.cohort_regime_parameter_split_policy_scoped_ready, true);
  assert.strictEqual(report.current_status.model_readiness_mfe_mae_labeled_n, 7);
  assert.strictEqual(report.current_status.model_readiness_tp1_time_labeled_n, 1);
  assert.strictEqual(report.current_status.feature_store_rows_n, 344);
  assert.strictEqual(report.current_status.feature_store_keys_n, 287);
  assert.strictEqual(report.current_status.model_readiness_dataset_version_id, "ML_TRAINING_DATASET__abc123");
  assert.strictEqual(report.current_status.truth_preservation_audit_status, "TRUTH_PRESERVATION_AUDIT_READY");
  assert.strictEqual(report.current_status.truth_preservation_ready, true);
  assert.strictEqual(report.current_status.truth_preservation_lineage_status, "PASS");
  assert.strictEqual(report.current_status.truth_preservation_stale_comparison_active, true);
  assert.strictEqual(report.current_status.truth_preservation_legacy_webhook_outcome_only_rows_n, 15);
  assert.strictEqual(report.current_status.truth_preservation_blocking_reason_n, 0);
  assert.strictEqual(report.current_status.truth_preservation_warning_reason_n, 2);
  assert.strictEqual(report.current_status.feature_store_version_id, "ML_FEATURE_STORE__def456");
  assert.strictEqual(report.current_status.execution_stage_latency_status, "EXECUTION_STAGE_LATENCY_READY");
  assert.strictEqual(report.current_status.execution_stage_latency_top_signal_to_intent_group, "MANUAL_REPLAY|EARLY_LONG|XRPUSDT");
  assert.strictEqual(report.current_status.execution_stage_latency_top_operational_signal_to_intent_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(report.current_status.execution_stage_latency_top_webhook_saved_to_intent_group, "MANUAL_REPLAY|EARLY_LONG|XRPUSDT");
  assert.strictEqual(report.current_status.execution_stage_latency_top_operational_webhook_saved_to_intent_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(report.current_status.ml_experiment_registry_status, "ML_EXPERIMENT_REGISTRY_READY");
  assert.strictEqual(report.current_status.ml_experiment_registry_experiment_id, "ML_BASELINE_ENV__abc123def4567890");
  assert.strictEqual(report.current_status.ml_experiment_registry_execution_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");
  assert.strictEqual(report.current_status.ml_train_run_status, "ML_TRAIN_RUN_NOT_STARTED");
  assert.strictEqual(report.current_status.execution_serving_contract_status, "EXECUTION_SERVING_CONTRACT_READY");
  assert.strictEqual(report.current_status.execution_serving_stage, "OFFLINE_ONLY");
  assert.strictEqual(report.current_status.execution_serving_shadow_ready, false);
  assert.strictEqual(report.current_status.execution_serving_preferred_model_family, "EXECUTION_SCOPE");
  assert.strictEqual(report.current_status.ml_model_specific_canary_status, "ML_MODEL_SPECIFIC_CANARY_READY");
  assert.strictEqual(report.current_status.ml_model_specific_canary_binding_mode, "MODEL_BINDING_MISSING");
  assert.strictEqual(report.current_status.ml_model_specific_canary_evidence_status, "MODEL_SPECIFIC_CANARY_BINDING_MISSING");
  assert.strictEqual(report.current_status.ml_model_specific_canary_ready, false);
  assert.strictEqual(report.current_status.validation_deployment_pipeline_contract_status, "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BOOTSTRAPPING");
  assert.strictEqual(report.current_status.validation_deployment_pipeline_shadow_numeric_gate_ready, true);
  assert.strictEqual(report.current_status.validation_deployment_pipeline_canary_numeric_gate_ready, false);
  assert.strictEqual(report.current_status.validation_deployment_pipeline_automatic_rollback_ready, true);
  assert.strictEqual(report.current_status.performance_kpi_upgrade_contract_status, "PERFORMANCE_KPI_UPGRADE_CONTRACT_READY");
  assert.strictEqual(report.current_status.performance_kpi_upgrade_microstructure_kpi_ready, true);
  assert.strictEqual(report.current_status.performance_kpi_upgrade_fee_adjusted_expectancy, -0.0011);
  assert.strictEqual(report.current_status.ml_global_canary_replay_sample_gap_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(report.current_status.ml_global_canary_replay_sample_gap_n, 1);
  assert.strictEqual(report.current_status.ml_global_canary_replay_projected_ready_if_sample_gap_closed, false);
  assert.strictEqual(report.current_status.ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed, "NEGATIVE_OBJECTIVE_DELTA");
  assert.strictEqual(report.current_status.ml_ev_profile_review_tracking_status, "ML_EV_PROFILE_REVIEW_TRACKING_READY");
  assert.strictEqual(report.current_status.ml_ev_profile_review_mode, "PROFILE_CONDITIONAL_REVIEW");
  assert.strictEqual(report.current_status.ml_ev_profile_review_target_n, 2);
  assert.strictEqual(report.current_status.ml_ev_profile_review_split_ready, false);
  assert.strictEqual(report.current_status.ml_ev_profile_review_split_blocker, "PROFILE_REALIZED_DELTA_TOO_SMALL");
  assert.strictEqual(report.current_status.ml_ev_profile_review_top_return_drag_driver, "FAILURE_RISK_HEAVY");
  assert.strictEqual(report.current_status.ml_ev_profile_review_top_mixed_driver, "DELAY_LATE_RISK_HEAVY");
  assert.strictEqual(report.current_status.ev_gate_policy_status, "EV_GATE_COMPOSITE_POLICY_READY");
  assert.strictEqual(report.current_status.ev_gate_policy_basis, "TP_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(report.current_status.ev_gate_canonical_policy_version, "EV_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(report.current_status.ev_gate_compatibility_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(report.current_status.ev_gate_threshold_metric, "exit_value_lower_bound");
  assert.strictEqual(report.current_status.ev_gate_compatibility_drop_reason, "DROP_EV_GATE_TP1_PROB");
  assert.strictEqual(report.current_status.ev_gate_default_tp0_pct, 0.8);
  assert.strictEqual(report.current_status.ev_gate_default_tp0_qty_ratio, 0.25);
  assert.strictEqual(report.current_status.ev_candidate_id, "EV_TP1_THRESHOLD_TUNE");
  assert.strictEqual(report.current_status.ev_candidate_canonical_id, "EV_COMPOSITE_THRESHOLD_TUNE");
  assert.strictEqual(report.current_status.self_evolution_top_candidate_id, "ML_GATE_CORE_SCORE_ABS");
  assert.strictEqual(report.current_status.execution_bottleneck_delta_status, "EXECUTION_BOTTLENECK_DELTA_READY");
  assert.strictEqual(report.current_status.execution_bottleneck_delta_comparable, true);
  assert.strictEqual(report.current_status.execution_bottleneck_delta_interpretation, "USE_DELTA_SIGNAL");
  assert.strictEqual(report.current_status.execution_bottleneck_delta_top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT");
  assert.strictEqual(report.current_status.execution_bottleneck_delta_top_operational_signal_to_intent_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(report.current_status.portfolio_cluster_reduce_n, 2);
  assert.strictEqual(report.current_status.execution_model_dataset_top_entry_latency_market, "BTCUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_signal_to_intent_latency_group, "EARLY_LONG|MANUAL_REPLAY|XRPUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_operational_signal_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_webhook_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_webhook_delay_reason, "WAIT_NEXT_BAR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_operational_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_operational_immediate_intent_delay_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_fill_source, "NO_FILL");
  assert.strictEqual(report.current_status.execution_model_dataset_top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(report.current_status.execution_model_dataset_top_no_fill_reason_family, "RUNTIME_ERROR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_no_fill_subtype, "TIMING_IMMEDIATE_EXEC");
  assert.strictEqual(report.current_status.execution_fill_inference_status, "EXECUTION_FILL_INFERENCE_READY");
  assert.strictEqual(report.current_status.execution_fill_inference_model_artifact_id, "MODEL_EXEC_FILL__m1");
  assert.strictEqual(report.current_status.execution_scope_inference_status, "EXECUTION_SCOPE_INFERENCE_READY");
  assert.strictEqual(report.current_status.execution_scope_inference_model_artifact_id, "MODEL_EXEC_SCOPE__s1");
  assert.strictEqual(report.current_status.execution_scope_tier_raw_diff_top_webhook_execution_profile, "WEBHOOK_PRE_BAR_CLOSE_FILLED");
  assert.strictEqual(report.current_status.execution_scope_tier_raw_diff_saved_no_probe_rows_n, 2);
  assert.strictEqual(report.current_status.execution_scope_train_run_quality_gate_status, "POLICY_BLOCKED_RECALL_TOO_LOW");
  assert.strictEqual(report.current_status.execution_scope_train_run_quality_gate_ready, false);
  assert.strictEqual(report.current_status.execution_scope_train_run_top_policy_blocked_test_source, "PINE_WEBHOOK");
  assert.strictEqual(report.current_status.execution_scope_train_run_top_policy_blocked_test_source_train_n, 1);
  assert.strictEqual(report.current_status.execution_model_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");
  assert.strictEqual(report.summary.execution_model_dataset_top_entry_latency_group, "EARLY_LONG|UNKNOWN|BINANCE_USER_TRADES|BTCUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_signal_to_intent_latency_group, "EARLY_LONG|MANUAL_REPLAY|XRPUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_operational_signal_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_webhook_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_webhook_delay_reason, "WAIT_NEXT_BAR");
  assert.strictEqual(report.summary.execution_model_dataset_top_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(report.summary.execution_model_dataset_top_operational_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(report.summary.execution_model_dataset_top_operational_immediate_intent_delay_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(report.summary.execution_fill_inference_status, "EXECUTION_FILL_INFERENCE_READY");
  assert.strictEqual(report.summary.execution_scope_inference_status, "EXECUTION_SCOPE_INFERENCE_READY");
  assert.strictEqual(report.summary.execution_scope_inference_top_false_positive_group, "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH");
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_top_webhook_bar_timing_profile, "PRE_BAR_CLOSE_GT_5M");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_status, "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_top_shared_feature, "execution.entry_schedule_reason=LATE_EXEC");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_top_context_profile, "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_reference_rows_n, 4);
  assert.strictEqual(report.current_status.execution_model_dataset_top_fallback_latency_group, "CORE_LONG|UNKNOWN|BINANCE_ORDER|XRPUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(report.summary.execution_model_dataset_top_no_fill_reason_family, "RUNTIME_ERROR");
  assert.strictEqual(report.summary.execution_model_dataset_top_no_fill_subtype, "TIMING_IMMEDIATE_EXEC");
  assert.strictEqual(report.summary.ml_experiment_registry_status, "ML_EXPERIMENT_REGISTRY_READY");
  assert.strictEqual(report.summary.ml_experiment_registry_experiment_id, "ML_BASELINE_ENV__abc123def4567890");
  assert.strictEqual(report.summary.ml_experiment_registry_execution_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");
  assert.strictEqual(report.summary.ml_train_run_status, "ML_TRAIN_RUN_NOT_STARTED");
  assert.strictEqual(report.summary.ml_train_run_quality_gate_ready, false);
  assert.strictEqual(report.summary.execution_serving_contract_status, "EXECUTION_SERVING_CONTRACT_READY");
  assert.strictEqual(report.summary.execution_serving_stage, "OFFLINE_ONLY");
  assert.strictEqual(report.summary.execution_serving_preferred_model_family, "EXECUTION_SCOPE");
  assert.strictEqual(report.summary.validation_deployment_pipeline_contract_status, "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BOOTSTRAPPING");
  assert.strictEqual(report.summary.validation_deployment_pipeline_numeric_judgement_ready, true);
  assert.strictEqual(report.summary.validation_deployment_pipeline_global_canary_dominant_blocker, "SELF_EVOLUTION_REPLAY_NOT_PASS");
  assert.strictEqual(report.summary.performance_kpi_upgrade_contract_status, "PERFORMANCE_KPI_UPGRADE_CONTRACT_READY");
  assert.strictEqual(report.summary.performance_kpi_upgrade_contract_mode, "TP0_TP1_CONVERSION_EXPECTANCY_KPI");
  assert.strictEqual(report.summary.performance_kpi_upgrade_microstructure_kpi_ready, true);
  assert.strictEqual(report.summary.performance_kpi_upgrade_expectancy_kpi_ready, true);
  assert.strictEqual(report.summary.performance_kpi_upgrade_tp0_hit_rate, 0.85);
  assert.strictEqual(report.summary.performance_kpi_upgrade_fee_adjusted_expectancy, -0.0011);
  assert.strictEqual(report.summary.ev_gate_policy_status, "EV_GATE_COMPOSITE_POLICY_READY");
  assert.strictEqual(report.summary.ev_gate_policy_basis, "TP_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(report.summary.ev_gate_canonical_policy_version, "EV_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(report.summary.ev_gate_threshold_metric, "exit_value_lower_bound");
  assert.strictEqual(report.summary.server_signal_runtime_ev_gate_unknown_gen_relax_enabled, true);
  assert.strictEqual(report.summary.server_signal_runtime_ev_gate_unknown_gen_relax_mode, "REPORT_ONLY");
  assert.strictEqual(report.summary.server_signal_runtime_ev_gate_unknown_gen_relax_window_hours, 6);
  assert.strictEqual(report.summary.server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours, 4);
  assert.strictEqual(report.summary.server_signal_runtime_ev_gate_unknown_gen_relax_active_window, true);
  assert.strictEqual(report.summary.server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta, 0.02);
  assert.strictEqual(report.summary.server_signal_runtime_tp1_ladder_enabled, true);
  assert.strictEqual(report.summary.server_signal_runtime_tp1_ladder_stage2_realized_n_min, 16);
  assert.strictEqual(report.summary.server_signal_runtime_tp1_ladder_default_profile, "RESCUE");
  assert.strictEqual(report.summary.server_signal_runtime_tp1_ladder_promotion_mode, "RESCUE_FIRST_PROMOTION");
  assert.strictEqual(report.summary.server_signal_runtime_opposite_cooldown_ms_mixed, 60000);
  assert.strictEqual(report.summary.server_signal_runtime_opposite_cooldown_default_profile, "RESCUE");
  assert.strictEqual(report.summary.server_signal_runtime_opposite_cooldown_promotion_mode, "RESCUE_FIRST_PROMOTION");
  assert.strictEqual(report.summary.server_signal_runtime_reverse_exception_mixed_bypass_tier_block, true);
  assert.strictEqual(report.summary.filter_layer_1_integrity_coverage_pass, true);
  assert.strictEqual(report.summary.filter_layer_2_entry_quality_actions, 2);
  assert.strictEqual(report.summary.filter_layer_3_state_soft_sizing_qty_scale, 1);
  assert.strictEqual(report.summary.filter_layer_4_ev_time_value_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(report.summary.filter_layer_5_wait_timing_febt_fallback_legacy_n, 24);
  assert.strictEqual(report.summary.ev_candidate_canonical_id, "EV_COMPOSITE_THRESHOLD_TUNE");
  assert.strictEqual(report.summary.execution_scope_train_run_status, "ML_TRAIN_RUN_REPORTED");
  assert.strictEqual(report.summary.execution_scope_train_run_quality_gate_status, "POLICY_BLOCKED_RECALL_TOO_LOW");
  assert.strictEqual(report.summary.execution_scope_train_run_quality_gate_ready, false);
  assert.strictEqual(report.summary.execution_scope_train_run_top_policy_blocked_test_source, "PINE_WEBHOOK");
  assert.strictEqual(report.summary.ml_model_contract_status, "ML_MODEL_CONTRACT_OFFLINE_ONLY");
  assert.strictEqual(report.summary.ml_model_contract_deployment_stage, "OFFLINE_ONLY");
  assert.strictEqual(report.summary.ml_promotion_gate_status, "ML_PROMOTION_GATE_READY");
  assert.strictEqual(report.summary.ml_promotion_stage, "OFFLINE_ONLY");
  assert.strictEqual(report.summary.ml_promotion_decision, "HOLD_REPLAY");
  assert.strictEqual(report.summary.ml_promotion_model_specific_canary_binding_mode, "MODEL_BINDING_MISSING");
  assert.strictEqual(report.summary.ml_promotion_model_specific_canary_evidence_status, "MODEL_SPECIFIC_CANARY_BINDING_MISSING");
  assert.strictEqual(report.summary.ml_promotion_global_canary_replay_sample_gap_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(report.summary.ml_promotion_global_canary_replay_sample_gap_n, 1);
  assert.strictEqual(report.summary.ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed, false);
  assert.strictEqual(report.summary.ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed, "NEGATIVE_OBJECTIVE_DELTA");
  assert.strictEqual(report.summary.ml_ev_profile_review_tracking_status, "ML_EV_PROFILE_REVIEW_TRACKING_READY");
  assert.strictEqual(report.summary.ml_ev_profile_review_mode, "PROFILE_CONDITIONAL_REVIEW");
  assert.strictEqual(report.summary.ml_ev_profile_review_target_n, 2);
  assert.strictEqual(report.summary.execution_bottleneck_delta_status, "EXECUTION_BOTTLENECK_DELTA_READY");
  assert.strictEqual(report.summary.execution_bottleneck_delta_comparable, true);
  assert.strictEqual(report.summary.execution_bottleneck_delta_interpretation, "USE_DELTA_SIGNAL");
  assert.strictEqual(report.summary.execution_bottleneck_delta_top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT");
  assert.strictEqual(report.summary.execution_bottleneck_delta_top_operational_signal_to_intent_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(report.authority_policy.degraded_timeout_policy.enabled, true);
  console.log("OPENCLAW_AUTONOMY_CONTRACT_TEST_OK");
})();

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -1.2, snapshot: { win_rate: 0.5 } } },
    objectiveSupervisor: {
      display: {
        objective: { monthly_run_rate_krw: 1000 },
        self_evolution_objective: { objective_score: -1.2, win_rate: 0.5 },
      },
    },
    deploymentPlan: { summary: { plan_status: "APPLIED_ACTIVE", authority_state: "APPROVED", external_authority_pending: false, authority_approved: true } },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 0, pine_shadow_disagreement_rate: 0, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
  });

  assert.strictEqual(report.current_status.authority_pending, false);
  assert.strictEqual(report.current_status.authority_state, "APPROVED");
  assert.strictEqual(report.summary.authority_state, "APPROVED");
})();

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -0.4, snapshot: { win_rate: 0.58 } } },
    objectiveSupervisor: {
      display: {
        objective: { monthly_run_rate_krw: 1200000 },
        self_evolution_objective: { objective_score: -0.4, win_rate: 0.58 },
      },
    },
    deploymentPlan: { summary: { plan_status: "APPLIED_ACTIVE", authority_state: "APPROVED", external_authority_pending: false } },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 1, pine_shadow_disagreement_rate: 0.08, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
    serverSignalAuthority: { summary: { source_mode: "PINE_PRIMARY", drift_status: "PARITY_WATCH", authoritative_server_24h_n: 12, pine_shadow_24h_n: 2 } },
    serverSignalQuality: { summary: { quality_status: "WATCH_PARITY_DRIFT", authoritative_entry_signal_24h_n: 10, order_intent_24h_n: 4, fill_24h_n: 3 } },
  });

  assert.strictEqual(report.current_status.server_signal_source_mode, "PINE_PRIMARY");
  assert.strictEqual(report.current_status.server_signal_quality_status, "WATCH_PARITY_DRIFT");
  assert.strictEqual(report.summary.server_signal_transition_status, "IN_PROGRESS");
  assert.strictEqual(report.summary.server_signal_transition_progress_pct, 88);
  assert.strictEqual(Array.isArray(report.server_signal_transition.phases), true);
  assert.strictEqual(report.server_signal_transition.phases.length, 4);
})();

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -0.8, snapshot: { win_rate: 0.51 } } },
    objectiveSupervisor: { display: { objective: { monthly_run_rate_krw: 500000 }, self_evolution_objective: { objective_score: -0.8, win_rate: 0.51 } } },
    deploymentPlan: { summary: { plan_status: "APPLIED_ACTIVE", authority_state: "APPROVED", external_authority_pending: false } },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 1, pine_shadow_disagreement_rate: 0.08, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
    executionBottleneckDelta: {
      summary: {
        status: "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON",
        signal_to_intent_p95_delta_ms: 0,
        current_top_operational_webhook_delay_cause: "LEGACY_WEBHOOK_OUTCOME_ONLY",
        current_top_operational_signal_to_intent_group: "LIVE_RUNTIME|CORE_SHORT|XRPUSDT",
      },
    },
  });

  assert.strictEqual(report.current_status.execution_bottleneck_delta_status, "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON");
  assert.strictEqual(report.current_status.execution_bottleneck_delta_comparable, false);
  assert.strictEqual(report.current_status.execution_bottleneck_delta_interpretation, "SKIP_STALE_COMPARISON");
  assert.strictEqual(report.current_status.execution_bottleneck_delta_signal_to_intent_p95_delta_ms, null);
  assert.strictEqual(report.current_status.execution_bottleneck_delta_top_operational_webhook_delay_cause, null);
  assert.strictEqual(report.summary.execution_bottleneck_delta_top_operational_signal_to_intent_group, null);
})();
