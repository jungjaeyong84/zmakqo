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
        execution_model_dataset_status: "EXECUTION_MODEL_DATASET_READY",
        execution_fill_inference_status: "EXECUTION_FILL_INFERENCE_READY",
        execution_fill_inference_mismatch_rate: 0.19,
        execution_fill_inference_filled_avg_pred_fill_prob: 0.41,
        execution_fill_inference_policy_blocked_avg_pred_fill_prob: 0.27,
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
        ml_model_contract_status: "ML_MODEL_CONTRACT_OFFLINE_ONLY",
        ml_model_contract_deployment_stage: "OFFLINE_ONLY",
        ml_model_contract_canary_gate_status: "BLOCK_MODEL_QUALITY",
        ml_model_contract_promotion_status: "HOLD_MODEL_QUALITY",
        ml_model_contract_model_artifact_id: null,
        execution_bottleneck_delta_status: "EXECUTION_BOTTLENECK_DELTA_READY",
        execution_bottleneck_delta_comparable: true,
        execution_bottleneck_delta_interpretation: "USE_DELTA_SIGNAL",
        execution_bottleneck_delta_top_operational_webhook_delay_cause: "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT",
        execution_bottleneck_delta_top_operational_signal_to_intent_group: "TV_WEBHOOK|EARLY_LONG|BTCUSDT",
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
  assert.strictEqual(journal.summary.current_authority_state, "DEGRADED_ACTIVE");
  assert.strictEqual(journal.summary.current_change_authority_state, "PENDING");
  assert.strictEqual(journal.summary.current_lineage_status, "PASS");
  assert.strictEqual(journal.summary.current_account_integrity_status, "WARN");
  assert.strictEqual(journal.summary.current_model_readiness_status, "MODEL_READINESS_READY");
  assert.strictEqual(journal.summary.current_model_readiness_mfe_mae_label_rate, 0.0203);
  assert.strictEqual(journal.summary.current_model_readiness_dataset_version_id, "ML_TRAINING_DATASET__abc123");
  assert.strictEqual(journal.summary.current_feature_store_version_id, "ML_FEATURE_STORE__def456");
  assert.strictEqual(journal.summary.current_execution_quality_top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_TRUE_INTENT_DELAY");
  assert.strictEqual(journal.summary.current_execution_quality_top_operational_immediate_intent_delay_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
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
  assert.strictEqual(journal.summary.current_ml_model_contract_status, "ML_MODEL_CONTRACT_OFFLINE_ONLY");
  assert.strictEqual(journal.summary.current_ml_model_contract_deployment_stage, "OFFLINE_ONLY");
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
