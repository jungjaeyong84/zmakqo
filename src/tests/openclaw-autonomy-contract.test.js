"use strict";

const assert = require("assert");
const { deriveOpenClawAutonomyContract } = require("../../src/utils/openclawAutonomyContract");

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -7.4, snapshot: { win_rate: 0.44 } } },
    objectiveSupervisor: {
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
    marketRegimeBoard: { summary: { status: "RESCUE_COHORT_ACTIVE", rescue_market_n: 2, keep_drop_market_n: 3, top_rescue_market: "SOLUSDT", top_keep_drop_market: "AXSUSDT" } },
    executionQuality: { summary: { status: "EXECUTION_QUALITY_REVIEW", created_to_fill_p95_ms: 59871, adverse_slippage_p95_bps: 81.37, partial_fill_rate_pct: 67.57, top_latency_market: "AXSUSDT" } },
    objectiveRetrospective: { display: { generated_at_kst: "2026-04-05 15:33:52 KST", execution_microstructure: { tp0_hit_rate: 0.85, tp1_hit_rate: 0, pre_tp1_time_stop_rate: 0, chase_reject_n: 1, portfolio_cluster_reduce_n: 2, portfolio_cluster_block_n: 0 } } },
    overallAccountReport: { integrity: { ok: false, issue_count: 4, active_market_count: 3, position_doc_count: 3 }, operations: { status: "보류", mode: "비용 차단" } },
    signalLineageHealth: { summary: { verdict: "PASS", fills_intent_id_null_rate: 0, fills_signal_doc_id_null_rate: 0, intents_signal_doc_id_null_rate: 0 } },
    modelReadiness: { summary: { status: "MODEL_READINESS_READY", rows_n: 344, realized_n: 18, invalid_n: 0, mfe_mae_labeled_n: 7, mfe_mae_label_rate: 0.0203, tp1_time_labeled_n: 1, tp1_time_label_rate: 0.0029, tp0_time_labeled_n: 0, tp0_time_label_rate: 0, tp0_to_tp1_converted_n: 0, pre_tp1_time_stop_n: 0, schema_version: "2026-04-05.v1" } },
    featureStore: { summary: { status: "FEATURE_STORE_READY", rows_n: 344, feature_keys_n: 287, schema_version: "2026-04-05.v1" } },
    executionModelDataset: { summary: { status: "EXECUTION_MODEL_DATASET_READY", rows_n: 4112, entry_rows_n: 1325, exit_rows_n: 2787, filled_n: 2058, rejected_n: 3, partial_n: 14, created_to_fill_p95_ms: 966453, created_to_fill_measured_p95_ms: 61234, signal_to_intent_p95_ms: 81234, signal_to_fill_p95_ms: 966453, webhook_to_intent_p95_ms: 42000, webhook_to_outcome_p95_ms: 12000, slippage_p95_bps: 12.4, top_webhook_to_intent_latency_groups: [{ key: "EARLY_LONG|TV_WEBHOOK|BTCUSDT", market: "BTCUSDT", source: "TV_WEBHOOK", webhook_to_intent_p95_ms: 42000 }], top_webhook_delay_reasons: [{ key: "WAIT_NEXT_BAR", rows_n: 4 }], top_webhook_delay_causes: [{ key: "SCHEDULED_WAIT_NEXT_BAR", rows_n: 4 }], top_signal_to_intent_latency_groups: [{ key: "EARLY_LONG|MANUAL_REPLAY|XRPUSDT", market: "XRPUSDT", source: "MANUAL_REPLAY", signal_to_intent_p95_ms: 533960686 }], top_operational_signal_to_intent_latency_groups: [{ key: "EARLY_LONG|TV_WEBHOOK|BTCUSDT", market: "BTCUSDT", source: "TV_WEBHOOK", signal_to_intent_p95_ms: 81234 }], top_entry_measured_latency_groups: [{ key: "EARLY_LONG|UNKNOWN|BINANCE_USER_TRADES|BTCUSDT", market: "BTCUSDT", primary_fill_source: "BINANCE_USER_TRADES", created_to_fill_p95_ms: 6315271 }], top_entry_fallback_latency_groups: [{ key: "CORE_LONG|UNKNOWN|BINANCE_ORDER|XRPUSDT", market: "XRPUSDT", primary_fill_source: "BINANCE_ORDER", created_to_fill_p95_ms: 7580368 }], by_primary_fill_source: [{ key: "NO_FILL", rows_n: 2054, slippage_zero_rate: 1, slippage_measured_rate: 0.0004 }], top_no_fill_reasons: [{ key: "LIVE_EXCEPTION", rows_n: 1201 }], top_no_fill_reason_families: [{ key: "RUNTIME_ERROR", rows_n: 1425 }], top_no_fill_subtypes: [{ key: "TIMING_IMMEDIATE_EXEC", rows_n: 1172 }] } },
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
  assert.strictEqual(report.summary.portfolio_cluster_risk_status, "REDUCING");
  assert.strictEqual(report.summary.feature_store_status, "FEATURE_STORE_READY");
  assert.strictEqual(report.current_status.market_regime_top_rescue_market, "SOLUSDT");
  assert.strictEqual(report.current_status.execution_quality_latency_p95_ms, 59871);
  assert.strictEqual(report.current_status.account_integrity_issue_n, 4);
  assert.strictEqual(report.current_status.tp0_hit_rate, 0.85);
  assert.strictEqual(report.current_status.model_readiness_mfe_mae_labeled_n, 7);
  assert.strictEqual(report.current_status.model_readiness_tp1_time_labeled_n, 1);
  assert.strictEqual(report.current_status.feature_store_rows_n, 344);
  assert.strictEqual(report.current_status.feature_store_keys_n, 287);
  assert.strictEqual(report.current_status.portfolio_cluster_reduce_n, 2);
  assert.strictEqual(report.current_status.execution_model_dataset_top_entry_latency_market, "BTCUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_signal_to_intent_latency_group, "EARLY_LONG|MANUAL_REPLAY|XRPUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_operational_signal_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_webhook_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.current_status.execution_model_dataset_top_webhook_delay_reason, "WAIT_NEXT_BAR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_fill_source, "NO_FILL");
  assert.strictEqual(report.current_status.execution_model_dataset_top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(report.current_status.execution_model_dataset_top_no_fill_reason_family, "RUNTIME_ERROR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_no_fill_subtype, "TIMING_IMMEDIATE_EXEC");
  assert.strictEqual(report.summary.execution_model_dataset_top_entry_latency_group, "EARLY_LONG|UNKNOWN|BINANCE_USER_TRADES|BTCUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_signal_to_intent_latency_group, "EARLY_LONG|MANUAL_REPLAY|XRPUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_operational_signal_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_webhook_to_intent_latency_group, "EARLY_LONG|TV_WEBHOOK|BTCUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_webhook_delay_reason, "WAIT_NEXT_BAR");
  assert.strictEqual(report.summary.execution_model_dataset_top_webhook_delay_cause, "SCHEDULED_WAIT_NEXT_BAR");
  assert.strictEqual(report.current_status.execution_model_dataset_top_fallback_latency_group, "CORE_LONG|UNKNOWN|BINANCE_ORDER|XRPUSDT");
  assert.strictEqual(report.summary.execution_model_dataset_top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(report.summary.execution_model_dataset_top_no_fill_reason_family, "RUNTIME_ERROR");
  assert.strictEqual(report.summary.execution_model_dataset_top_no_fill_subtype, "TIMING_IMMEDIATE_EXEC");
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
