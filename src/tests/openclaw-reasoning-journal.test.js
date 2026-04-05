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
        authority_state: "PENDING",
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
  assert.strictEqual(journal.summary.current_lineage_status, "PASS");
  assert.strictEqual(journal.summary.current_account_integrity_status, "WARN");
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
      autonomyContract: { summary: { authority_state: "PENDING" } },
      quality: { summary: { final_downstream_mismatch_n: 11 } },
    }).metric,
    "final_downstream_mismatch_n"
  );

  const friendlyHypothesis = __test.deriveVerificationFriendlyHypothesis({
    dominantIssue: "OTHER_SERVER_POLICY",
    dominantIssueSource: "SERVER_SIGNAL",
    recommendedAction: "WATCH_ONLY_REVIEW",
    pendingVerification: { metric: "other_server_policy_mismatch_n", expected: "< baseline", baseline_value: 3 },
    autonomyContract: { summary: { authority_state: "PENDING" } },
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
