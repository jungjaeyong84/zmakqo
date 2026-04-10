"use strict";

const assert = require("assert");
const { buildReasoningJournal, __test } = require("../../src/utils/openclawReasoningJournal");

(() => {
  const journal = buildReasoningJournal({
    cycleId: "cycle-1",
    nowKst: "2026-04-03 11:10 KST",
    objectiveSupervisor: {
      verdict: "HOLD",
      root_cause: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK",
    },
    autonomyContract: {
      summary: {
        authority_state: "DEGRADED_ACTIVE",
        change_authority_state: "PENDING",
        model_readiness_status: "MODEL_READINESS_READY",
        feature_store_status: "FEATURE_STORE_READY",
        execution_structure_upgrade_contract_status: "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_READY",
        execution_structure_upgrade_mode: "ENTRY_TP0_TP1_TRAIL",
        execution_structure_upgrade_stage_sequence_ready: true,
        execution_structure_upgrade_survivability_ready: true,
        execution_structure_upgrade_label_support_ready: true,
        execution_structure_upgrade_tp0_stage_active: true,
        execution_structure_upgrade_tp1_stage_active: true,
        execution_structure_upgrade_trail_stage_active: true,
        execution_structure_upgrade_blocking_reason_n: 0,
        cost_control_engine_contract_status: "COST_CONTROL_ENGINE_CONTRACT_READY",
        cost_control_engine_contract_mode: "EXPECTANCY_AND_REENTRY_CONTROL",
        cost_control_engine_automatic_entry_suppression_ready: true,
        cost_control_engine_system_reentry_control_ready: true,
        cost_control_engine_expectancy_gate_active: true,
        cost_control_engine_cost_block_mode_active: true,
        cost_control_engine_cooldown_reentry_control_active: true,
        cost_control_engine_reverse_reentry_control_active: true,
        cost_control_engine_blocking_reason_n: 0,
        cohort_regime_parameter_split_contract_status: "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_READY",
        cohort_regime_parameter_split_contract_mode: "COHORT_REGIME_AUTO_SWITCH",
        cohort_regime_parameter_split_cohort_scope: "RESCUE_MIXED_KEEP_DROP",
        cohort_regime_parameter_split_active_cohort_n: 3,
        cohort_regime_parameter_split_cohort_parameterization_ready: true,
        cohort_regime_parameter_split_regime_switch_ready: true,
        cohort_regime_parameter_split_policy_scoped_ready: true,
        cohort_regime_parameter_split_automatic_transition_ready: true,
        cohort_regime_parameter_split_blocking_reason_n: 0,
        validation_deployment_pipeline_contract_status: "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BOOTSTRAPPING",
        validation_deployment_pipeline_contract_mode: "SHADOW_CANARY_LIVE_NUMERIC_GATES",
        validation_deployment_pipeline_current_deployment_stage: "SHADOW_READY",
        validation_deployment_pipeline_shadow_numeric_gate_ready: true,
        validation_deployment_pipeline_canary_numeric_gate_ready: false,
        validation_deployment_pipeline_live_numeric_gate_ready: false,
        validation_deployment_pipeline_numeric_judgement_ready: true,
        validation_deployment_pipeline_automatic_rollback_ready: true,
        validation_deployment_pipeline_blocking_reason_n: 2,
        performance_kpi_upgrade_contract_status: "PERFORMANCE_KPI_UPGRADE_CONTRACT_READY",
        performance_kpi_upgrade_contract_mode: "TP0_TP1_CONVERSION_EXPECTANCY_KPI",
        performance_kpi_upgrade_microstructure_kpi_ready: true,
        performance_kpi_upgrade_survivability_kpi_ready: true,
        performance_kpi_upgrade_expectancy_kpi_ready: true,
        performance_kpi_upgrade_structure_alignment_ready: true,
        performance_kpi_upgrade_cost_alignment_ready: true,
        performance_kpi_upgrade_tp0_hit_rate: 0.85,
        performance_kpi_upgrade_tp1_hit_rate: 0,
        performance_kpi_upgrade_tp0_to_tp1_conversion_rate: 0,
        performance_kpi_upgrade_pre_tp1_time_stop_rate: 0,
        performance_kpi_upgrade_fee_adjusted_expectancy: -0.0011,
        performance_kpi_upgrade_realized_trade_n: 24,
        performance_kpi_upgrade_legacy_win_rate_reference: 0.3333,
        performance_primary_metrics: ["TP0_HIT_RATE", "TP1_HIT_RATE", "FEE_ADJUSTED_EXPECTANCY", "SIGNAL_TO_FILL_CONVERSION"],
        legacy_win_rate_reference_only: true,
        performance_kpi_upgrade_objective_verdict: "FAIL",
        performance_kpi_upgrade_blocking_reason_n: 0,
        ev_gate_policy_status: "EV_GATE_COMPOSITE_POLICY_READY",
        ev_gate_policy_basis: "TP_COMPOSITE_EXIT_VALUE_V1",
        ev_gate_canonical_policy_version: "EV_COMPOSITE_EXIT_VALUE_V1",
        ev_gate_compatibility_policy_version: "TP1_WEIGHT_V1",
        ev_gate_threshold_metric: "exit_value_lower_bound",
        ev_gate_compatibility_drop_reason: "DROP_EV_GATE_TP1_PROB",
        ev_gate_default_tp0_pct: 0.8,
        ev_gate_default_tp0_qty_ratio: 0.25,
        ev_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        ev_candidate_canonical_id: "EV_COMPOSITE_THRESHOLD_TUNE",
        self_evolution_top_candidate_id: "ML_GATE_CORE_SCORE_ABS",
        self_evolution_top_candidate_canonical_id: null,
        server_signal_runtime_ev_gate_unknown_gen_relax_enabled: true,
        server_signal_runtime_ev_gate_unknown_gen_relax_mode: "REPORT_ONLY",
        server_signal_runtime_ev_gate_unknown_gen_relax_started_at: "2026-04-06T22:50:11.452Z",
        server_signal_runtime_ev_gate_unknown_gen_relax_window_hours: 6,
        server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours: 4,
        server_signal_runtime_ev_gate_unknown_gen_relax_active_window: true,
        server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled: false,
        server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_min_delta: 0.04,
        server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta: 0.03,
        server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_kill_delta: 0.02,
        server_signal_runtime_tp1_ladder_enabled: true, server_signal_runtime_tp1_ladder_freeze: true,
        server_signal_runtime_tp1_ladder_stage1_realized_n_min: 12,
        server_signal_runtime_tp1_ladder_stage1_tp0_hit_rate_min: 0.60,
        server_signal_runtime_tp1_ladder_stage1_tp0_to_tp1_conversion_min: 0.28,
        server_signal_runtime_tp1_ladder_stage1_fee_adjusted_expectancy_min: 0,
        server_signal_runtime_tp1_ladder_stage2_realized_n_min: 24,
        server_signal_runtime_tp1_ladder_stage2_tp0_hit_rate_min: 0.68,
        server_signal_runtime_tp1_ladder_stage2_tp1_hit_rate_min: 0.38,
        server_signal_runtime_tp1_ladder_stage2_tp0_to_tp1_conversion_min: 0.45,
        server_signal_runtime_tp1_ladder_stage2_fee_adjusted_expectancy_min: 0.001,
        server_signal_runtime_tp1_ladder_default_profile: "RESCUE",
        server_signal_runtime_tp1_ladder_promotion_mode: "RESCUE_FIRST_FROZEN",
        server_signal_runtime_signal_overlap_enabled: true,
        server_signal_runtime_signal_overlap_bars: 4,
        server_signal_runtime_same_direction_trail_profit_cooldown_enabled: true,
        server_signal_runtime_same_direction_trail_profit_cooldown_ms: 21600000,
        server_signal_runtime_binance_live_state_self_heal_enabled: true,
        server_signal_runtime_binance_live_state_self_heal_max_positions: 12,
        server_signal_runtime_binance_live_state_projection_ssot: "EXCHANGE_LIVE_STATE",
        server_signal_runtime_binance_live_state_projection_writer_mode: "RECONCILE_FIRST",
        server_signal_runtime_binance_live_state_active_position_n: 2,
        server_signal_runtime_binance_live_state_projection_out_of_sync_n: 1,
        server_signal_runtime_binance_live_state_self_heal_required_n: 1,
        server_signal_runtime_binance_live_state_native_stop_missing_n: 0,
        server_signal_runtime_binance_live_state_trail_without_tp1_n: 0,
        server_signal_runtime_binance_live_state_tp1_done_with_tp_order_n: 1,
        server_signal_runtime_binance_live_state_invariant_counts: { TP1_DONE_WITH_TP_ORDER: 1 },
        exit_trailing_contract_canonical_mode: "TRAIL_R_MULTIPLE",
        exit_trailing_contract_active_binance_profile_mode: "BASE",
        exit_trailing_contract_active_binance_tp1_pct: 3.25,
        exit_trailing_contract_active_binance_be_pct: 0.25,
        exit_trailing_contract_active_binance_trail_r_multiple: 0.9,
        runtime_vs_canonical_exit_contract_diverged: true,
        server_signal_runtime_opposite_cooldown_bars_base: 4,
        server_signal_runtime_opposite_cooldown_bars_mixed: 4,
        server_signal_runtime_opposite_cooldown_bars_rescue: 1,
        server_signal_runtime_opposite_cooldown_ms_base: 900000,
        server_signal_runtime_opposite_cooldown_ms_mixed: 300000,
        server_signal_runtime_opposite_cooldown_ms_rescue: 3600000,
        server_signal_runtime_opposite_cooldown_default_profile: "RESCUE",
        server_signal_runtime_opposite_cooldown_promotion_mode: "RESCUE_FIRST_FROZEN",
        server_signal_runtime_opposite_transition_enabled: false,
        server_signal_runtime_opposite_transition_reduce_fraction: 0,
        server_signal_runtime_opposite_transition_confirm_bars: 4,
        server_signal_runtime_operational_drop_watch_reasons: ["POSITION_FULL", "LIVE_RESCUE_ADD_*", "DROP_OVERLAP"],
        server_signal_runtime_reverse_exception_mixed_bypass_tier_block: true,
        server_signal_runtime_reverse_exception_rescue_bypass_tier_block: true,
        server_signal_entry_to_intent_conversion_24h: 0.4,
        server_signal_entry_to_fill_conversion_24h: 0.3,
        server_signal_intent_to_fill_conversion_24h: 0.75,
        filter_layer_1_integrity_mode: "INTEGRITY_GUARD_ONLY",
        filter_layer_1_integrity_expectation: "N/A",
        filter_layer_1_integrity_coverage_pass: true,
        filter_layer_2_entry_quality_candidate_verdict: "HOLD",
        filter_layer_2_entry_quality_actions: 2,
        filter_layer_3_state_soft_sizing_ml_action: "KEEP",
        filter_layer_3_state_soft_sizing_physics_action: "ALLOW",
        filter_layer_3_state_soft_sizing_qty_scale: 1,
        filter_layer_3_state_soft_sizing_dominant_state: "MIXED",
        filter_layer_3_state_soft_sizing_dominant_action: "UNKNOWN",
        filter_layer_4_ev_time_value_tuner_reason: "INSUFFICIENT_SAMPLE",
        filter_layer_4_ev_time_value_observed_tuner_reason: "INSUFFICIENT_SAMPLE",
        filter_layer_4_ev_time_value_fresh: true,
        filter_layer_4_ev_time_value_age_hours: 15.4265,
        filter_layer_4_ev_time_value_policy_version: "TP1_WEIGHT_V1",
        filter_layer_4_ev_time_value_policy_source: "DEFAULT",
        filter_layer_5_wait_timing_tuner_reason: "TRIGGER_SAMPLE_TOO_SMALL",
        filter_layer_5_wait_timing_wait_action: "ALLOW",
        filter_layer_5_wait_timing_febt_calc_ok_rate: 0.2727,
        filter_layer_5_wait_timing_febt_phase_known: 9,
        filter_layer_5_wait_timing_febt_fire_n: 0,
        filter_layer_5_wait_timing_febt_late_n: 0,
        filter_layer_5_wait_timing_febt_void_n: 1,
        filter_layer_5_wait_timing_febt_disagreement_n: 9,
        filter_layer_5_wait_timing_febt_fallback_legacy_n: 24,
        filter_layer_5_wait_timing_febt_missing_rate: 0.7273,
        execution_model_dataset_status: "EXECUTION_MODEL_DATASET_READY",
        execution_fill_inference_status: "EXECUTION_FILL_INFERENCE_READY",
        execution_fill_inference_mismatch_rate: 0.19,
        execution_fill_inference_filled_avg_pred_fill_prob: 0.41,
        execution_fill_inference_policy_blocked_avg_pred_fill_prob: 0.27,
        execution_scope_inference_status: "EXECUTION_SCOPE_INFERENCE_READY",
        execution_scope_inference_mismatch_rate: 0.29,
        execution_scope_inference_top_false_positive_group: "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH",
        execution_scope_tier_raw_diff_top_webhook_execution_profile: "WEBHOOK_PRE_BAR_CLOSE_FILLED",
        execution_scope_tier_raw_diff_top_webhook_bar_timing_profile: "PRE_BAR_CLOSE_GT_5M",
        execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n: 2,
        execution_scope_tier_raw_diff_saved_no_probe_rows_n: 2,
        execution_scope_tier_raw_diff_pre_bar_close_rows_n: 2,
        execution_scope_fp_diagnostics_status: "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY",
        execution_scope_fp_diagnostics_top_shared_feature: "execution.entry_schedule_reason=LATE_EXEC",
        execution_scope_fp_diagnostics_top_context_profile: "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL",
        execution_scope_fp_diagnostics_reference_rows_n: 4,
        execution_model_dataset_version_id: "EXECUTION_MODEL_DATASET__xyz789",
        execution_model_dataset_top_webhook_to_intent_latency_group: "EARLY_LONG|TV_WEBHOOK|BTCUSDT",
        execution_model_dataset_top_webhook_delay_reason: "WAIT_NEXT_BAR",
        execution_model_dataset_top_webhook_delay_cause: "SCHEDULED_WAIT_NEXT_BAR",
        execution_model_dataset_top_operational_webhook_delay_cause: "SCHEDULED_WAIT_NEXT_BAR",
        execution_model_dataset_top_operational_immediate_intent_delay_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT",
        execution_model_dataset_top_signal_to_intent_latency_group: "EARLY_LONG|MANUAL_REPLAY|XRPUSDT",
        execution_model_dataset_top_operational_signal_to_intent_latency_group: "EARLY_LONG|TV_WEBHOOK|BTCUSDT",
        execution_model_dataset_top_entry_latency_group: "EARLY_LONG|UNKNOWN|BINANCE_USER_TRADES|BTCUSDT",
        execution_model_dataset_top_fallback_latency_group: "CORE_LONG|UNKNOWN|BINANCE_ORDER|XRPUSDT",
        execution_model_dataset_top_fill_source: "NO_FILL",
        execution_model_dataset_top_no_fill_reason: "LIVE_EXCEPTION",
        execution_model_dataset_top_no_fill_reason_family: "RUNTIME_ERROR",
        execution_model_dataset_top_no_fill_subtype: "TIMING_IMMEDIATE_EXEC",
        execution_stage_latency_status: "EXECUTION_STAGE_LATENCY_READY",
        execution_stage_latency_top_signal_to_intent_group: "MANUAL_REPLAY|EARLY_LONG|XRPUSDT",
        execution_stage_latency_top_operational_signal_to_intent_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT",
        execution_stage_latency_top_webhook_saved_to_intent_group: "MANUAL_REPLAY|EARLY_LONG|XRPUSDT",
        execution_stage_latency_top_operational_webhook_saved_to_intent_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT",
        ml_experiment_registry_status: "ML_EXPERIMENT_REGISTRY_READY",
        ml_experiment_registry_experiment_id: "ML_BASELINE_ENV__abc123def4567890",
        ml_experiment_registry_execution_dataset_version_id: "EXECUTION_MODEL_DATASET__xyz789",
        ml_train_run_status: "ML_TRAIN_RUN_NOT_STARTED",
        ml_train_run_model_artifact_id: null,
        ml_train_run_quality_gate_status: null,
        ml_train_run_quality_gate_ready: false,
        execution_serving_contract_status: "EXECUTION_SERVING_CONTRACT_READY",
        execution_serving_stage: "SHADOW_READY",
        execution_serving_decision: "ENABLE_SCOPE_SHADOW",
        execution_serving_shadow_ready: true,
        execution_serving_preferred_model_family: "EXECUTION_SCOPE",
        execution_serving_preferred_model_artifact_id: "MODEL_EXEC_SCOPE__s1",
        ml_global_canary_status: "ML_GLOBAL_CANARY_EVIDENCE_READY",
        ml_global_canary_ready: false,
        ml_global_canary_evidence_status: "GLOBAL_CANARY_REPLAY_BLOCKED",
        ml_global_canary_dominant_blocker: "SELF_EVOLUTION_REPLAY_NOT_PASS",
        ml_global_canary_replay_evidence_status: "REPLAY_WARN_INSUFFICIENT_SAMPLE",
        ml_global_canary_replay_dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE",
        ml_global_canary_replay_sample_gap_status: "EV_REPLAY_SAMPLE_GAP",
        ml_global_canary_replay_sample_required_realized_n: 8,
        ml_global_canary_replay_sample_current_effective_realized_n: 7,
        ml_global_canary_replay_sample_gap_n: 1,
        ml_global_canary_replay_sample_dominant_dimension: "GOVERNANCE_EFFECTIVE_REALIZED",
        ml_global_canary_replay_projected_ready_if_sample_gap_closed: false,
        ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA",
        ml_ev_profile_review_tracking_status: "ML_EV_PROFILE_REVIEW_TRACKING_READY",
        ml_ev_profile_review_tracking_evidence_status: "PROFILE_REVIEW_TRACKING_READY",
        ml_ev_profile_review_mode: "PROFILE_CONDITIONAL_REVIEW",
        ml_ev_profile_review_target_n: 2,
        ml_ev_profile_review_split_ready: false,
        ml_ev_profile_review_split_blocker: "PROFILE_REALIZED_DELTA_TOO_SMALL",
        ml_ev_profile_review_top_return_drag_profile: "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE",
        ml_ev_profile_review_top_return_drag_driver: "FAILURE_RISK_HEAVY",
        ml_ev_profile_review_top_mixed_profile: "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED",
        ml_ev_profile_review_top_mixed_driver: "DELAY_LATE_RISK_HEAVY",
        ml_model_specific_canary_status: "ML_MODEL_SPECIFIC_CANARY_READY",
        ml_model_specific_canary_binding_mode: "MODEL_BINDING_MISSING",
        ml_model_specific_canary_evidence_status: "MODEL_SPECIFIC_CANARY_BINDING_MISSING",
        ml_model_specific_canary_ready: false,
        ml_model_specific_canary_preferred_model_artifact_id: "MODEL_EXEC_SCOPE__s1",
        ml_model_specific_canary_preferred_train_run_id: "TRAIN_EXEC_SCOPE__s1",
        ml_model_specific_canary_bound_model_artifact_id: null,
        ml_model_specific_canary_bound_train_run_id: null,
        execution_scope_train_run_status: "ML_TRAIN_RUN_REPORTED",
        execution_scope_train_run_id: "TRAIN_EXEC_SCOPE__s1",
        execution_scope_train_run_model_artifact_id: "MODEL_EXEC_SCOPE__s1",
        execution_scope_train_run_model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1",
        execution_scope_train_run_quality_gate_status: "POLICY_BLOCKED_RECALL_TOO_LOW",
        execution_scope_train_run_quality_gate_ready: false,
        execution_scope_train_run_top_policy_blocked_test_source: "PINE_WEBHOOK",
        execution_scope_train_run_top_policy_blocked_test_source_train_n: 1,
        execution_scope_train_run_top_policy_blocked_test_source_test_n: 13,
        execution_scope_train_run_top_policy_blocked_test_source_test_share: 0.8667,
        ml_model_contract_status: "ML_MODEL_CONTRACT_OFFLINE_ONLY",
        ml_model_contract_deployment_stage: "OFFLINE_ONLY",
        ml_model_contract_canary_gate_status: "BLOCK_MODEL_QUALITY",
        ml_model_contract_promotion_status: "HOLD_MODEL_QUALITY",
        ml_model_contract_model_artifact_id: null,
        ml_promotion_gate_status: "ML_PROMOTION_GATE_READY",
        ml_promotion_stage: "SHADOW_READY",
        ml_promotion_decision: "HOLD_GLOBAL_CANARY",
        ml_promotion_model_specific_canary_binding_mode: "MODEL_BINDING_MISSING",
        ml_promotion_model_specific_canary_evidence_status: "MODEL_SPECIFIC_CANARY_BINDING_MISSING",
        ml_promotion_preferred_model_family: "EXECUTION_SCOPE",
        ml_promotion_preferred_model_artifact_id: "MODEL_EXEC_SCOPE__s1",
        ml_promotion_global_canary_gate_status: "BLOCK",
        ml_promotion_global_canary_evidence_status: "GLOBAL_CANARY_REPLAY_BLOCKED",
        ml_promotion_global_canary_dominant_blocker: "SELF_EVOLUTION_REPLAY_NOT_PASS",
        ml_promotion_global_canary_replay_evidence_status: "REPLAY_WARN_INSUFFICIENT_SAMPLE",
        ml_promotion_global_canary_replay_dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE",
        ml_promotion_global_canary_replay_sample_gap_status: "EV_REPLAY_SAMPLE_GAP",
        ml_promotion_global_canary_replay_sample_required_realized_n: 8,
        ml_promotion_global_canary_replay_sample_current_effective_realized_n: 7,
        ml_promotion_global_canary_replay_sample_gap_n: 1,
        ml_promotion_global_canary_replay_sample_dominant_dimension: "GOVERNANCE_EFFECTIVE_REALIZED",
        ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed: false,
        ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA",
        execution_bottleneck_delta_status: "EXECUTION_BOTTLENECK_DELTA_READY",
        execution_bottleneck_delta_comparable: true,
        execution_bottleneck_delta_interpretation: "USE_DELTA_SIGNAL",
        execution_bottleneck_delta_top_operational_webhook_delay_cause: "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT",
        execution_bottleneck_delta_top_operational_signal_to_intent_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT",
        lineage_entry_fills_intent_null_rate: 0,
        lineage_external_reconciled_fill_intent_null_n: 4,
        lineage_external_reconciled_fill_intent_null_present: true,
        lineage_slo_drop_monitor_status: "LINEAGE_SLO_DROP_MONITOR_READY",
        lineage_slo_drop_monitor_evidence_status: "AWAITING_POST_FIX_DROP_CACHE",
        lineage_slo_drop_monitor_post_fix_lineage_slo_drop_n: 0,
        lineage_slo_drop_monitor_pre_fix_lineage_slo_drop_n: 12,
        lineage_slo_drop_monitor_post_fix_clear: true,
        truth_preservation_audit_status: "TRUTH_PRESERVATION_AUDIT_READY",
        truth_preservation_ready: true,
        truth_preservation_lineage_status: "PASS",
        truth_preservation_stale_comparison_active: true,
        truth_preservation_legacy_webhook_outcome_only_rows_n: 15,
        truth_preservation_blocking_reason_n: 0,
        truth_preservation_warning_reason_n: 2,
        model_readiness_dataset_version_id: "ML_TRAINING_DATASET__abc123",
        feature_store_version_id: "ML_FEATURE_STORE__def456",
        model_readiness_mfe_mae_label_rate: 0.0203,
        model_readiness_tp1_time_label_rate: 0.0029,
        model_readiness_tp0_time_label_rate: 0,
      },
    },
    quality: {
      summary: {
        quality_status: "WATCH_PARITY_DRIFT",
        final_downstream_mismatch_n: 15,
        parity_mismatch_n: 15,
        other_server_policy_mismatch_n: 2,
        top_drop_reason_family: { key: "EV_POLICY", count: 10 },
      },
    },
    cutover: {
      summary: {
        readiness_status: "SERVER_PRIMARY_ACTIVE",
        dominant_mismatch_family: "EV_POLICY",
        recommended_action: "HOLD_EV_POLICY_REVIEW",
        ev_policy_effective_patch_applied: true,
        ev_policy_remediation_min_post_samples: 3,
        ev_policy_post_apply_comparable_n: 4,
      },
    },
    policyPlan: {
      summary: {
        status: "HOLD",
        ev_policy_action: "PRIORITIZE_EV_TP1_THRESHOLD_TUNE",
        ev_policy_review_mode: "PROFILE_CONDITIONAL_REVIEW",
        ev_policy_top_return_drag_profile: "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE",
        ev_policy_top_return_drag_driver: "FAILURE_RISK_HEAVY",
        ev_policy_top_mixed_profile: "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED",
        ev_policy_top_mixed_driver: "DELAY_LATE_RISK_HEAVY",
      },
    },
    objectiveRetrospective: {
      display: {
        execution_microstructure: {
          tp0_hit_rate: 0.85,
          tp1_hit_rate: 0,
          tp0_to_tp1_conversion_rate: 0,
          pre_tp1_time_stop_rate: 0,
          chase_reject_n: 1,
          portfolio_cluster_reduce_n: 2,
          portfolio_cluster_block_n: 0,
        },
      },
    },
    overallAccountReport: {
      integrity: { ok: false, issue_count: 4 },
      operations: { status: "보류", mode: "비용 차단" },
    },
    signalLineageHealth: {
      summary: {
        verdict: "PASS",
        fills_intent_id_null_rate: 0,
        entry_fills_intent_id_null_rate: 0,
        external_reconciled_fills_intent_id_null_n: 4,
        warning_reasons: ["EXTERNAL_RECONCILED_FILL_INTENT_NULL_PRESENT"],
      },
    },
    lineageSloDropMonitor: {
      summary: {
        status: "LINEAGE_SLO_DROP_MONITOR_READY",
        evidence_status: "AWAITING_POST_FIX_DROP_CACHE",
        post_fix_lineage_slo_drop_n: 0,
        pre_fix_lineage_slo_drop_n: 12,
        post_fix_clear: true,
      },
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_REVIEW",
        created_to_fill_p95_ms: 59871,
        top_operational_webhook_delay_cause: "IMMEDIATE_EXEC_TRUE_INTENT_DELAY",
        top_operational_immediate_intent_delay_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT",
        top_no_fill_reason: "LIVE_EXCEPTION",
        top_no_fill_subtype: "TIMING_IMMEDIATE_EXEC",
        execution_scope_quality_gate_status: "POLICY_BLOCKED_RECALL_TOO_LOW",
        execution_scope_quality_gate_ready: false,
        execution_scope_inference_mismatch_rate: 0.29,
        execution_scope_top_false_positive_group: "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH",
        execution_scope_fp_diagnostics_status: "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY",
        execution_scope_fp_diagnostics_top_shared_feature: "execution.entry_schedule_reason=LATE_EXEC",
        execution_scope_fp_diagnostics_top_context_profile: "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL",
        execution_scope_fp_diagnostics_reference_rows_n: 4,
      },
    },
    previousJournal: {
      entries: [
        {
          cycle_id: "cycle-0",
          dominant_issue: "EV_POLICY",
          recommended_action: "RELAX_EV_POLICY_REVIEW",
          pending_verification: {
            metric: "ev_policy_post_apply_comparable_n",
            expected: ">= 3",
            baseline_value: 0,
            fast_track: {
              metric: "final_downstream_mismatch_n",
              expected: "< baseline",
              baseline_value: 15,
            },
          },
        },
        {
          cycle_id: "cycle-neg",
          dominant_issue: "OTHER_SERVER_POLICY",
          recommended_action: "WATCH_ONLY_REVIEW",
          pending_verification: { metric: "other_server_policy_mismatch_n", expected: "< baseline", baseline_value: 2 },
        },
        {
          cycle_id: "cycle-unknown",
          dominant_issue: "AUTHORITY_PENDING",
          recommended_action: "MONITOR_ONLY",
          pending_verification: { metric: "authority_state", expected: "toward READY with parity evidence" },
        },
      ],
    },
  });

  assert.strictEqual(journal.summary.latest_cycle_id, "cycle-1");
  assert.strictEqual(journal.summary.current_dominant_issue, "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK");
  assert.strictEqual(journal.summary.current_recommended_action, "HOLD_EV_POLICY_REVIEW");
  assert.match(journal.summary.current_verification_focus, /ev_policy_post_apply_comparable_n/);
  assert.strictEqual(journal.summary.current_execution_quality_status, "EXECUTION_QUALITY_REVIEW");
  assert.strictEqual(journal.summary.current_execution_structure_upgrade_contract_status, "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_READY");
  assert.strictEqual(journal.summary.current_execution_structure_upgrade_mode, "ENTRY_TP0_TP1_TRAIL");
  assert.strictEqual(journal.summary.current_execution_structure_upgrade_stage_sequence_ready, true);
  assert.strictEqual(journal.summary.current_execution_structure_upgrade_survivability_ready, true);
  assert.strictEqual(journal.summary.current_cost_control_engine_contract_status, "COST_CONTROL_ENGINE_CONTRACT_READY");
  assert.strictEqual(journal.summary.current_cost_control_engine_contract_mode, "EXPECTANCY_AND_REENTRY_CONTROL");
  assert.strictEqual(journal.summary.current_cost_control_engine_automatic_entry_suppression_ready, true);
  assert.strictEqual(journal.summary.current_cost_control_engine_system_reentry_control_ready, true);
  assert.strictEqual(journal.summary.current_cohort_regime_parameter_split_contract_status, "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_READY");
  assert.strictEqual(journal.summary.current_cohort_regime_parameter_split_contract_mode, "COHORT_REGIME_AUTO_SWITCH");
  assert.strictEqual(journal.summary.current_cohort_regime_parameter_split_active_cohort_n, 3);
  assert.strictEqual(journal.summary.current_cohort_regime_parameter_split_cohort_parameterization_ready, true);
  assert.strictEqual(journal.summary.current_cohort_regime_parameter_split_automatic_transition_ready, true);
  assert.strictEqual(journal.summary.current_validation_deployment_pipeline_contract_status, "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BOOTSTRAPPING");
  assert.strictEqual(journal.summary.current_validation_deployment_pipeline_contract_mode, "SHADOW_CANARY_LIVE_NUMERIC_GATES");
  assert.strictEqual(journal.summary.current_validation_deployment_pipeline_shadow_numeric_gate_ready, true);
  assert.strictEqual(journal.summary.current_validation_deployment_pipeline_canary_numeric_gate_ready, false);
  assert.strictEqual(journal.summary.current_validation_deployment_pipeline_automatic_rollback_ready, true);
  assert.strictEqual(journal.summary.current_performance_kpi_upgrade_contract_status, "PERFORMANCE_KPI_UPGRADE_CONTRACT_READY");
  assert.strictEqual(journal.summary.current_performance_kpi_upgrade_contract_mode, "TP0_TP1_CONVERSION_EXPECTANCY_KPI");
  assert.strictEqual(journal.summary.current_performance_kpi_upgrade_microstructure_kpi_ready, true);
  assert.strictEqual(journal.summary.current_performance_kpi_upgrade_expectancy_kpi_ready, true);
  assert.strictEqual(journal.summary.current_performance_kpi_upgrade_tp0_hit_rate, 0.85);
  assert.strictEqual(journal.summary.current_performance_kpi_upgrade_fee_adjusted_expectancy, -0.0011);
  assert.deepStrictEqual(journal.summary.current_performance_primary_metrics, ["TP0_HIT_RATE", "TP1_HIT_RATE", "FEE_ADJUSTED_EXPECTANCY", "SIGNAL_TO_FILL_CONVERSION"]);
  assert.strictEqual(journal.summary.current_legacy_win_rate_reference_only, true);
  assert.strictEqual(journal.summary.current_ev_gate_policy_status, "EV_GATE_COMPOSITE_POLICY_READY");
  assert.strictEqual(journal.summary.current_ev_gate_policy_basis, "TP_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(journal.summary.current_ev_gate_canonical_policy_version, "EV_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(journal.summary.current_ev_gate_threshold_metric, "exit_value_lower_bound");
  assert.strictEqual(journal.summary.current_ev_candidate_id, "EV_TP1_THRESHOLD_TUNE");
  assert.strictEqual(journal.summary.current_ev_candidate_canonical_id, "EV_COMPOSITE_THRESHOLD_TUNE");
  assert.strictEqual(journal.summary.current_ev_policy_review_mode, "PROFILE_CONDITIONAL_REVIEW");
  assert.strictEqual(journal.summary.current_ev_policy_top_return_drag_driver, "FAILURE_RISK_HEAVY");
  assert.strictEqual(journal.summary.current_ev_policy_top_mixed_driver, "DELAY_LATE_RISK_HEAVY");
  assert.strictEqual(journal.summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_enabled, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_mode, "REPORT_ONLY");
  assert.strictEqual(journal.summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_active_window, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_review_after_hours, 4);
  assert.strictEqual(journal.summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_auto_rollback_enabled, false);
  assert.strictEqual(journal.summary.current_server_signal_runtime_ev_gate_unknown_gen_relax_tp1_prob_full_delta, 0.03);
  assert.strictEqual(journal.summary.current_server_signal_runtime_tp1_ladder_enabled, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_tp1_ladder_stage1_realized_n_min, 12);
  assert.strictEqual(journal.summary.current_server_signal_runtime_tp1_ladder_stage2_tp1_hit_rate_min, 0.38);
  assert.strictEqual(journal.summary.current_server_signal_runtime_tp1_ladder_default_profile, "RESCUE");
  assert.strictEqual(journal.summary.current_server_signal_runtime_tp1_ladder_freeze, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_tp1_ladder_promotion_mode, "RESCUE_FIRST_FROZEN");
  assert.strictEqual(journal.summary.current_server_signal_runtime_signal_overlap_enabled, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_signal_overlap_bars, 4);
  assert.strictEqual(journal.summary.current_server_signal_runtime_same_direction_trail_profit_cooldown_enabled, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_same_direction_trail_profit_cooldown_ms, 21600000);
  assert.strictEqual(journal.summary.current_server_signal_runtime_binance_live_state_self_heal_enabled, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_binance_live_state_projection_ssot, "EXCHANGE_LIVE_STATE");
  assert.strictEqual(journal.summary.current_server_signal_runtime_binance_live_state_projection_writer_mode, "RECONCILE_FIRST");
  assert.strictEqual(journal.summary.current_server_signal_runtime_binance_live_state_projection_out_of_sync_n, 1);
  assert.strictEqual(journal.summary.current_server_signal_runtime_binance_live_state_self_heal_required_n, 1);
  assert.deepStrictEqual(journal.summary.current_server_signal_runtime_binance_live_state_invariant_counts, { TP1_DONE_WITH_TP_ORDER: 1 });
  assert.strictEqual(journal.summary.current_exit_trailing_contract_canonical_mode, "TRAIL_R_MULTIPLE");
  assert.strictEqual(journal.summary.current_exit_trailing_contract_active_binance_profile_mode, "BASE");
  assert.strictEqual(journal.summary.current_exit_trailing_contract_active_binance_tp1_pct, 3.25);
  assert.strictEqual(journal.summary.current_exit_trailing_contract_active_binance_be_pct, 0.25);
  assert.strictEqual(journal.summary.current_exit_trailing_contract_active_binance_trail_r_multiple, 0.9);
  assert.strictEqual(journal.summary.current_runtime_vs_canonical_exit_contract_diverged, true);
  assert.strictEqual(journal.summary.current_server_signal_runtime_opposite_cooldown_bars_mixed, 4);
  assert.strictEqual(journal.summary.current_server_signal_runtime_opposite_cooldown_ms_rescue, 3600000);
  assert.strictEqual(journal.summary.current_server_signal_runtime_opposite_cooldown_default_profile, "RESCUE");
  assert.strictEqual(journal.summary.current_server_signal_runtime_opposite_cooldown_promotion_mode, "RESCUE_FIRST_FROZEN");
  assert.strictEqual(journal.summary.current_server_signal_runtime_opposite_transition_enabled, false);
  assert.strictEqual(journal.summary.current_server_signal_runtime_opposite_transition_reduce_fraction, 0);
  assert.strictEqual(journal.summary.current_server_signal_runtime_opposite_transition_confirm_bars, 4);
  assert.deepStrictEqual(journal.summary.current_server_signal_runtime_operational_drop_watch_reasons, ["POSITION_FULL", "LIVE_RESCUE_ADD_*", "DROP_OVERLAP"]);
  assert.strictEqual(journal.summary.current_server_signal_entry_to_intent_conversion_24h, 0.4);
  assert.strictEqual(journal.summary.current_server_signal_entry_to_fill_conversion_24h, 0.3);
  assert.strictEqual(journal.summary.current_server_signal_intent_to_fill_conversion_24h, 0.75);
  assert.strictEqual(journal.summary.current_server_signal_runtime_reverse_exception_rescue_bypass_tier_block, true);
  assert.strictEqual(journal.summary.current_filter_layer_1_integrity_mode, "INTEGRITY_GUARD_ONLY");
  assert.strictEqual(journal.summary.current_filter_layer_2_entry_quality_actions, 2);
  assert.strictEqual(journal.summary.current_filter_layer_3_state_soft_sizing_ml_action, "KEEP");
  assert.strictEqual(journal.summary.current_filter_layer_4_ev_time_value_tuner_reason, "INSUFFICIENT_SAMPLE");
  assert.strictEqual(journal.summary.current_filter_layer_5_wait_timing_wait_action, "ALLOW");
  assert.strictEqual(journal.summary.current_top_candidate_id, "ML_GATE_CORE_SCORE_ABS");
  assert.strictEqual(journal.summary.current_authority_state, "DEGRADED_ACTIVE");
  assert.strictEqual(journal.summary.current_change_authority_state, "PENDING");
  assert.strictEqual(journal.summary.current_lineage_status, "PASS");
  assert.strictEqual(journal.summary.current_lineage_entry_fills_intent_null_rate, 0);
  assert.strictEqual(journal.summary.current_lineage_external_reconciled_fill_intent_null_present, true);
  assert.strictEqual(journal.summary.current_lineage_slo_drop_monitor_evidence_status, "AWAITING_POST_FIX_DROP_CACHE");
  assert.strictEqual(journal.summary.current_lineage_slo_drop_monitor_post_fix_clear, true);
  assert.strictEqual(journal.summary.current_account_integrity_status, "WARN");
  assert.strictEqual(journal.summary.current_model_readiness_status, "MODEL_READINESS_READY");
  assert.strictEqual(journal.summary.current_truth_preservation_audit_status, "TRUTH_PRESERVATION_AUDIT_READY");
  assert.strictEqual(journal.summary.current_truth_preservation_ready, true);
  assert.strictEqual(journal.summary.current_truth_preservation_lineage_status, "PASS");
  assert.strictEqual(journal.summary.current_truth_preservation_stale_comparison_active, true);
  assert.strictEqual(journal.summary.current_truth_preservation_legacy_webhook_outcome_only_rows_n, 15);
  assert.strictEqual(journal.summary.current_model_readiness_mfe_mae_label_rate, 0.0203);
  assert.strictEqual(journal.summary.current_model_readiness_dataset_version_id, "ML_TRAINING_DATASET__abc123");
  assert.strictEqual(journal.summary.current_feature_store_version_id, "ML_FEATURE_STORE__def456");
  assert.strictEqual(journal.summary.current_execution_serving_contract_status, "EXECUTION_SERVING_CONTRACT_READY");
  assert.strictEqual(journal.summary.current_execution_serving_stage, "SHADOW_READY");
  assert.strictEqual(journal.summary.current_execution_serving_shadow_ready, true);
  assert.strictEqual(journal.summary.current_execution_serving_preferred_model_family, "EXECUTION_SCOPE");
  assert.strictEqual(journal.summary.current_ml_global_canary_replay_sample_gap_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(journal.summary.current_ml_global_canary_replay_sample_gap_n, 1);
  assert.strictEqual(journal.summary.current_ml_global_canary_replay_projected_ready_if_sample_gap_closed, false);
  assert.strictEqual(journal.summary.current_ml_global_canary_replay_projected_residual_issue_after_sample_gap_closed, "NEGATIVE_OBJECTIVE_DELTA");
  assert.strictEqual(journal.summary.current_ml_ev_profile_review_tracking_status, "ML_EV_PROFILE_REVIEW_TRACKING_READY");
  assert.strictEqual(journal.summary.current_ml_ev_profile_review_mode, "PROFILE_CONDITIONAL_REVIEW");
  assert.strictEqual(journal.summary.current_ml_ev_profile_review_target_n, 2);
  assert.strictEqual(journal.summary.current_ml_ev_profile_review_split_ready, false);
  assert.strictEqual(journal.summary.current_ml_ev_profile_review_split_blocker, "PROFILE_REALIZED_DELTA_TOO_SMALL");
  assert.strictEqual(journal.summary.current_ml_ev_profile_review_top_return_drag_driver, "FAILURE_RISK_HEAVY");
  assert.strictEqual(journal.summary.current_ml_ev_profile_review_top_mixed_driver, "DELAY_LATE_RISK_HEAVY");
  assert.strictEqual(journal.summary.current_ml_model_specific_canary_status, "ML_MODEL_SPECIFIC_CANARY_READY");
  assert.strictEqual(journal.summary.current_ml_model_specific_canary_binding_mode, "MODEL_BINDING_MISSING");
  assert.strictEqual(journal.summary.current_ml_model_specific_canary_evidence_status, "MODEL_SPECIFIC_CANARY_BINDING_MISSING");
  assert.strictEqual(journal.summary.current_ml_promotion_global_canary_replay_sample_gap_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(journal.summary.current_ml_promotion_global_canary_replay_sample_gap_n, 1);
  assert.strictEqual(journal.summary.current_ml_promotion_global_canary_replay_projected_ready_if_sample_gap_closed, false);
  assert.strictEqual(journal.summary.current_ml_promotion_global_canary_replay_projected_residual_issue_after_sample_gap_closed, "NEGATIVE_OBJECTIVE_DELTA");
  assert.strictEqual(journal.summary.current_ml_model_specific_canary_ready, false);
  assert.strictEqual(journal.summary.current_execution_quality_top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_TRUE_INTENT_DELAY");
  assert.strictEqual(journal.summary.current_execution_quality_top_operational_immediate_intent_delay_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(journal.summary.current_execution_quality_scope_quality_gate_status, "POLICY_BLOCKED_RECALL_TOO_LOW");
  assert.strictEqual(journal.summary.current_execution_quality_scope_quality_gate_ready, false);
  assert.strictEqual(journal.summary.current_execution_quality_scope_inference_mismatch_rate, 0.29);
  assert.strictEqual(journal.summary.current_execution_quality_scope_top_false_positive_group, "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH");
  assert.strictEqual(journal.summary.current_execution_quality_scope_fp_diagnostics_status, "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY");
  assert.strictEqual(journal.summary.current_execution_quality_scope_fp_top_shared_feature, "execution.entry_schedule_reason=LATE_EXEC");
  assert.strictEqual(journal.summary.current_execution_quality_scope_fp_top_context_profile, "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL");
  assert.strictEqual(journal.summary.current_execution_quality_scope_fp_reference_rows_n, 4);
  assert.strictEqual(journal.summary.current_execution_model_top_webhook_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(journal.summary.current_execution_model_top_webhook_delay_reason, "WAIT_NEXT_BAR");
  assert.strictEqual(journal.summary.current_execution_model_top_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(journal.summary.current_execution_model_top_operational_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(journal.summary.current_execution_model_top_operational_immediate_intent_delay_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(journal.summary.current_execution_model_top_signal_to_intent_latency_group, "EARLY_LONG|MANUAL_REPLAY|XRPUSDT");
  assert.strictEqual(journal.summary.current_execution_model_top_operational_signal_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(journal.summary.current_execution_model_top_entry_latency_group, "EARLY_LONG|UNKNOWN|BINANCE_USER_TRADES|BTCUSDT");
  assert.strictEqual(journal.summary.current_execution_model_top_fallback_latency_group, "CORE_LONG|UNKNOWN|BINANCE_ORDER|XRPUSDT");
  assert.strictEqual(journal.summary.current_execution_model_top_fill_source, "NO_FILL");
  assert.strictEqual(journal.summary.current_execution_model_top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(journal.summary.current_execution_model_top_no_fill_reason_family, "RUNTIME_ERROR");
  assert.strictEqual(journal.summary.current_execution_model_top_no_fill_subtype, "TIMING_IMMEDIATE_EXEC");
  assert.strictEqual(journal.summary.current_execution_fill_inference_status, "EXECUTION_FILL_INFERENCE_READY");
  assert.strictEqual(journal.summary.current_execution_fill_inference_mismatch_rate, 0.19);
  assert.strictEqual(journal.summary.current_execution_scope_inference_status, "EXECUTION_SCOPE_INFERENCE_READY");
  assert.strictEqual(journal.summary.current_execution_scope_inference_mismatch_rate, 0.29);
  assert.strictEqual(journal.summary.current_execution_scope_inference_top_false_positive_group, "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH");
  assert.strictEqual(journal.summary.current_execution_scope_tier_raw_diff_top_webhook_execution_profile, "WEBHOOK_PRE_BAR_CLOSE_FILLED");
  assert.strictEqual(journal.summary.current_execution_scope_tier_raw_diff_saved_no_probe_rows_n, 2);
  assert.strictEqual(journal.summary.current_execution_scope_tier_raw_diff_pre_bar_close_rows_n, 2);
  assert.strictEqual(journal.summary.current_execution_scope_fp_diagnostics_status, "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY");
  assert.strictEqual(journal.summary.current_execution_scope_fp_diagnostics_top_shared_feature, "execution.entry_schedule_reason=LATE_EXEC");
  assert.strictEqual(journal.summary.current_execution_scope_fp_diagnostics_top_context_profile, "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL");
  assert.strictEqual(journal.summary.current_execution_scope_fp_diagnostics_reference_rows_n, 4);
  assert.strictEqual(journal.summary.current_execution_model_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");
  assert.strictEqual(journal.summary.current_execution_stage_latency_status, "EXECUTION_STAGE_LATENCY_READY");
  assert.strictEqual(journal.summary.current_execution_stage_latency_top_signal_to_intent_group, "MANUAL_REPLAY|EARLY_LONG|XRPUSDT");
  assert.strictEqual(journal.summary.current_execution_stage_latency_top_operational_signal_to_intent_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(journal.summary.current_execution_stage_latency_top_webhook_saved_to_intent_group, "MANUAL_REPLAY|EARLY_LONG|XRPUSDT");
  assert.strictEqual(journal.summary.current_execution_stage_latency_top_operational_webhook_saved_to_intent_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(journal.summary.current_ml_experiment_registry_status, "ML_EXPERIMENT_REGISTRY_READY");
  assert.strictEqual(journal.summary.current_ml_experiment_registry_experiment_id, "ML_BASELINE_ENV__abc123def4567890");
  assert.strictEqual(journal.summary.current_ml_experiment_registry_execution_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");
  assert.strictEqual(journal.summary.current_ml_train_run_status, "ML_TRAIN_RUN_NOT_STARTED");
  assert.strictEqual(journal.summary.current_ml_train_run_quality_gate_ready, false);
  assert.strictEqual(journal.summary.current_execution_scope_train_run_status, "ML_TRAIN_RUN_REPORTED");
  assert.strictEqual(journal.summary.current_execution_scope_train_run_quality_gate_status, "POLICY_BLOCKED_RECALL_TOO_LOW");
  assert.strictEqual(journal.summary.current_execution_scope_train_run_quality_gate_ready, false);
  assert.strictEqual(journal.summary.current_execution_scope_train_run_top_policy_blocked_test_source, "PINE_WEBHOOK");
  assert.strictEqual(journal.summary.current_execution_scope_train_run_top_policy_blocked_test_source_train_n, 1);
  assert.strictEqual(journal.summary.current_ml_model_contract_status, "ML_MODEL_CONTRACT_OFFLINE_ONLY");
  assert.strictEqual(journal.summary.current_ml_model_contract_deployment_stage, "OFFLINE_ONLY");
  assert.strictEqual(journal.summary.current_ml_promotion_gate_status, "ML_PROMOTION_GATE_READY");
  assert.strictEqual(journal.summary.current_ml_promotion_stage, "SHADOW_READY");
  assert.strictEqual(journal.summary.current_ml_promotion_decision, "HOLD_GLOBAL_CANARY");
  assert.strictEqual(journal.summary.current_ml_promotion_model_specific_canary_binding_mode, "MODEL_BINDING_MISSING");
  assert.strictEqual(journal.summary.current_ml_promotion_model_specific_canary_evidence_status, "MODEL_SPECIFIC_CANARY_BINDING_MISSING");
  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_status, "EXECUTION_BOTTLENECK_DELTA_READY");
  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_comparable, true);
  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_interpretation, "USE_DELTA_SIGNAL");
  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT");
  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_top_operational_signal_to_intent_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(journal.summary.current_microstructure_tp0_hit_rate, 0.85);
  assert.strictEqual(journal.summary.current_microstructure_cluster_reduce_n, 2);
  assert.strictEqual(journal.summary.entry_n, 4);
  assert.strictEqual(journal.summary.verified_n, 0);
  assert.strictEqual(journal.summary.sample_formation_verified_n, 0);
  assert.strictEqual(journal.summary.fast_track_verified_n, 0);
  assert.strictEqual(journal.summary.not_met_n, 1);
  assert.strictEqual(journal.summary.unknown_n, 1);
  assert.strictEqual(journal.summary.deferred_n, 1);
  assert.strictEqual(journal.summary.verification_rate, 0);
  assert.ok(journal.compacted_context.includes("cycle-1"));
  assert.strictEqual(journal.entries.find((row) => row.cycle_id === "cycle-0").verification_outcome.status, "DEFERRED_LOW_SAMPLE");
  assert.strictEqual(journal.entries.find((row) => row.cycle_id === "cycle-neg").verification_outcome.status, "NOT_MET");
  assert.strictEqual(journal.entries.find((row) => row.cycle_id === "cycle-unknown").verification_outcome.status, "UNKNOWN");

  assert.strictEqual(
    __test.deriveDominantIssue({
      objectiveSupervisor: { root_cause: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK" },
      cutover: { summary: { dominant_mismatch_family: "EV_POLICY" } },
    }).dominant_issue,
    "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK"
  );

  assert.strictEqual(
    __test.derivePendingVerification({
      cutover: { summary: { dominant_mismatch_family: "EV_POLICY", ev_policy_patch_applied: true, ev_policy_remediation_min_post_samples: 4 } },
    }).metric,
    "ev_policy_post_apply_comparable_n"
  );

  assert.strictEqual(
    __test.derivePendingVerification({
      cutover: { summary: { dominant_mismatch_family: "EV_POLICY", ev_policy_patch_applied: false, ev_policy_remediation_min_post_samples: 4 } },
    }).metric,
    "ev_policy_effective_patch_applied"
  );

  assert.strictEqual(
    __test.derivePendingVerification({
      autonomyContract: { summary: { authority_state: "DEGRADED_ACTIVE", change_authority_state: "PENDING" } },
      quality: { summary: { final_downstream_mismatch_n: 11 } },
    }).metric,
    "final_downstream_mismatch_n"
  );

  const friendlyHypothesis = __test.deriveVerificationFriendlyHypothesis({
    dominantIssue: "OTHER_SERVER_POLICY",
    dominantIssueSource: "SERVER_SIGNAL",
    recommendedAction: "WATCH_ONLY_REVIEW",
    pendingVerification: { metric: "other_server_policy_mismatch_n", expected: "< baseline", baseline_value: 3 },
    autonomyContract: { summary: { authority_state: "DEGRADED_ACTIVE", change_authority_state: "PENDING" } },
  });
  assert.strictEqual(friendlyHypothesis.hypothesis_class, "MEASURABLE");
  assert.match(friendlyHypothesis.verification_focus, /other_server_policy_mismatch_n/);

  assert.strictEqual(
    __test.countContradictions([
      { dominant_issue: "EV_POLICY", recommended_action: "A" },
      { dominant_issue: "EV_POLICY", recommended_action: "B" },
    ]),
    1
  );

  assert.strictEqual(__test.evaluateExpected(">= 3", 4).status, "VERIFIED");
  assert.strictEqual(__test.evaluateExpected("< baseline", 3, 2).status, "NOT_MET");
  assert.strictEqual(__test.evaluateExpected("toward READY with parity evidence", "PENDING").status, "UNKNOWN");
  assert.strictEqual(
    __test.resolveVerificationOutcome(
      {
        cycle_id: "cycle-fast",
        pending_verification: {
          metric: "ev_policy_post_apply_comparable_n",
          expected: ">= 5",
          baseline_value: 0,
          fast_track: {
            metric: "ev_policy_post_apply_mismatch_rate",
            expected: "<= 0.6",
            baseline_value: 1,
          },
        },
      },
      {
        ev_policy_post_apply_comparable_n: 1,
        ev_policy_post_apply_mismatch_rate: 0.4,
        ev_policy_remediation_min_post_samples: 5,
      }
    ).status,
    "DEFERRED_LOW_SAMPLE"
  );
  assert.strictEqual(
    __test.resolveVerificationOutcome(
      {
        cycle_id: "cycle-fast-verified",
        pending_verification: {
          metric: "ev_policy_post_apply_comparable_n",
          expected: ">= 5",
          baseline_value: 2,
          fast_track: {
            metric: "ev_policy_post_apply_mismatch_rate",
            expected: "<= 0.6",
            baseline_value: 1,
          },
        },
      },
      {
        ev_policy_post_apply_comparable_n: 4,
        ev_policy_post_apply_mismatch_rate: 0.4,
        ev_policy_remediation_min_post_samples: 5,
      }
    ).status,
    "DEFERRED_LOW_SAMPLE"
  );
  assert.strictEqual(
    __test.resolveVerificationOutcome(
      {
        cycle_id: "cycle-fast-ready",
        pending_verification: {
          metric: "ev_policy_post_apply_comparable_n",
          expected: ">= 5",
          baseline_value: 2,
          fast_track: {
            metric: "ev_policy_post_apply_mismatch_rate",
            expected: "<= 0.6",
            baseline_value: 1,
          },
        },
      },
      {
        ev_policy_post_apply_comparable_n: 5,
        ev_policy_post_apply_mismatch_rate: 0.4,
        ev_policy_remediation_min_post_samples: 5,
      }
    ).status,
    "VERIFIED"
  );
  assert.strictEqual(
    __test.resolveVerificationOutcome(
      {
        cycle_id: "cycle-sample",
        pending_verification: {
          metric: "ev_policy_post_apply_comparable_n",
          expected: ">= 3",
          baseline_value: 0,
          fast_track: {
            metric: "final_downstream_mismatch_n",
            expected: "< baseline",
            baseline_value: 15,
          },
        },
      },
      {
        ev_policy_post_apply_comparable_n: 4,
        ev_policy_post_apply_mismatch_rate: 1,
        ev_policy_remediation_min_post_samples: 5,
      }
    ).status,
    "DEFERRED_LOW_SAMPLE"
  );
  assert.strictEqual(
    __test.resolveVerificationOutcome(
      {
        cycle_id: "cycle-sample-verified",
        pending_verification: {
          metric: "ev_policy_post_apply_comparable_n",
          expected: ">= 5",
          baseline_value: 2,
          fast_track: {
            metric: "ev_policy_post_apply_mismatch_rate",
            expected: "<= 0.6",
            baseline_value: 1,
          },
        },
      },
      {
        ev_policy_post_apply_comparable_n: 5,
        ev_policy_post_apply_mismatch_rate: 1,
        ev_policy_remediation_min_post_samples: 5,
      }
    ).status,
    "VERIFIED_SAMPLE_FORMATION"
  );
  assert.strictEqual(
    __test.resolveVerificationOutcome(
      {
        cycle_id: "cycle-deferred",
        pending_verification: {
          metric: "ev_policy_post_apply_comparable_n",
          expected: ">= 3",
          baseline_value: 0,
          fast_track: {
            metric: "final_downstream_mismatch_n",
            expected: "< baseline",
            baseline_value: 17,
          },
        },
      },
      {
        ev_policy_post_apply_comparable_n: 0,
        ev_policy_post_apply_mismatch_rate: null,
        ev_policy_remediation_min_post_samples: 5,
        learning_epoch_exception_release_applied: "TRUE",
        ev_policy_patch_report_only_applied: "TRUE",
      }
    ).status,
    "DEFERRED_LEARNING_EPOCH"
  );
  assert.deepStrictEqual(
    __test.collectCurrentVerificationState({
      cutover: { summary: { ev_policy_post_apply_comparable_n: 5, ev_policy_patch_report_only_applied: true, learning_epoch_exception_release_applied: true, final_downstream_mismatch_n: 8 } },
      quality: { summary: { other_server_policy_mismatch_n: 2, final_downstream_mismatch_n: 7 } },
      autonomyContract: { summary: { authority_state: "PENDING" } },
    }),
    {
      ev_policy_post_apply_comparable_n: 5,
      ev_policy_effective_patch_applied: "TRUE",
      learning_epoch_exception_release_applied: "TRUE",
      ev_policy_patch_report_only_applied: "TRUE",
      ev_policy_remediation_min_post_samples: 5,
      ev_policy_post_apply_mismatch_n: null,
      ev_policy_post_apply_mismatch_rate: null,
      other_server_policy_mismatch_n: 2,
      final_downstream_mismatch_n: 7,
      authority_state: "PENDING",
    }
  );

  console.log("OPENCLAW_REASONING_JOURNAL_TEST_OK");
})();

(() => {
  const journal = buildReasoningJournal({
    cycleId: "cycle-stale",
    nowKst: "2026-04-05 21:00 KST",
    autonomyContract: {
      summary: {
        authority_state: "DEGRADED_ACTIVE",
        change_authority_state: "PENDING",
        execution_bottleneck_delta_status: "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON",
        execution_bottleneck_delta_comparable: false,
        execution_bottleneck_delta_interpretation: "SKIP_STALE_COMPARISON",
      },
    },
  });

  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_status, "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON");
  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_comparable, false);
  assert.strictEqual(journal.summary.current_execution_bottleneck_delta_interpretation, "SKIP_STALE_COMPARISON");
})();
