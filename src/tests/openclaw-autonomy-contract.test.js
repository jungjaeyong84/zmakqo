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
    featureStore: { summary: { status: "FEATURE_STORE_READY", rows_n: 344, feature_keys_n: 287, schema_version: "2026-04-05.v1" } },
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
  assert.strictEqual(report.current_status.feature_store_rows_n, 344);
  assert.strictEqual(report.current_status.feature_store_keys_n, 287);
  assert.strictEqual(report.current_status.portfolio_cluster_reduce_n, 2);
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
