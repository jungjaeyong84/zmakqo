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
        top_drop_reason_family: { key: "EV_POLICY", count: 10 },
      },
    },
    cutover: {
      summary: {
        readiness_status: "SERVER_PRIMARY_ACTIVE",
        dominant_mismatch_family: "EV_POLICY",
        recommended_action: "HOLD_EV_POLICY_REVIEW",
        ev_policy_remediation_min_post_samples: 3,
      },
    },
    policyPlan: {
      summary: {
        status: "HOLD",
        ev_policy_action: "PRIORITIZE_EV_TP1_THRESHOLD_TUNE",
      },
    },
    previousJournal: {
      entries: [
        {
          cycle_id: "cycle-0",
          dominant_issue: "EV_POLICY",
          recommended_action: "RELAX_EV_POLICY_REVIEW",
          pending_verification: { metric: "ev_policy_post_apply_comparable_n", expected: ">= 3" },
        },
      ],
    },
  });

  assert.strictEqual(journal.summary.latest_cycle_id, "cycle-1");
  assert.strictEqual(journal.summary.current_dominant_issue, "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK");
  assert.strictEqual(journal.summary.current_recommended_action, "HOLD_EV_POLICY_REVIEW");
  assert.strictEqual(journal.summary.entry_n, 2);
  assert.ok(journal.compacted_context.includes("cycle-1"));

  assert.strictEqual(
    __test.deriveDominantIssue({
      objectiveSupervisor: { root_cause: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK" },
      cutover: { summary: { dominant_mismatch_family: "EV_POLICY" } },
    }).dominant_issue,
    "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK"
  );

  assert.strictEqual(
    __test.derivePendingVerification({
      cutover: { summary: { dominant_mismatch_family: "EV_POLICY", ev_policy_remediation_min_post_samples: 4 } },
    }).metric,
    "ev_policy_post_apply_comparable_n"
  );

  assert.strictEqual(
    __test.countContradictions([
      { dominant_issue: "EV_POLICY", recommended_action: "A" },
      { dominant_issue: "EV_POLICY", recommended_action: "B" },
    ]),
    1
  );

  console.log("OPENCLAW_REASONING_JOURNAL_TEST_OK");
})();
