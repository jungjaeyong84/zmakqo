"use strict";

const assert = require("assert");
const { buildFamilyScoreboard } = require("../../src/utils/openclawFamilyScoreboard");

(() => {
  const report = buildFamilyScoreboard({
    quality: {
      summary: {
        other_server_policy_mismatch_n: 3,
      },
      rows: {
        final_downstream_family_actions: [
          { family: "EV_POLICY", mismatch_n: 10, recommended_action: "RELAX_EV_POLICY_REVIEW" },
          { family: "OTHER_SERVER_POLICY", mismatch_n: 3, recommended_action: "WATCH_ONLY_REVIEW" },
          { family: "COOLDOWN_POLICY", mismatch_n: 1, recommended_action: "RELAX_OPPOSITE_COOLDOWN_REVIEW" },
        ],
      },
    },
    cutover: {
      summary: {
        dominant_mismatch_family: "EV_POLICY",
      },
    },
    observation: {
      summary: {
        top_other_server_policy_reason_action: {
          reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED",
          mismatch_n: 2,
          recommended_action: "WATCH_ONLY_REVIEW",
        },
      },
    },
    reasoningJournal: {
      summary: {
        current_objective_verdict: "HOLD",
        current_authority_state: "PENDING",
      },
    },
    autonomyParity: {
      summary: {
        current_objective_verdict: "HOLD",
        current_authority_state: "PENDING",
      },
    },
    otherServerPolicyReview: {
      summary: {
        status: "MONITOR_WITH_TARGETED_REVIEW",
        top_reason_recommended_action: "WATCH_ONLY_REVIEW",
        verification_target: {
          metric: "other_server_policy_mismatch_n",
          expected: "< baseline",
          baseline_value: 3,
        },
      },
    },
    cooldownPolicyReview: {
      summary: {
        status: "MONITOR_WITH_TARGETED_REVIEW",
        recommended_action: "RELAX_OPPOSITE_COOLDOWN_REVIEW",
        verification_target: {
          metric: "final_downstream_mismatch_n",
          expected: "< baseline",
          baseline_value: 13,
        },
      },
    },
    capabilities: [
      { id: "ev_gate_rescue", trigger: { dominant_mismatch_family_in: ["EV_POLICY"] } },
      { id: "other_server_policy_review", trigger: { dominant_mismatch_family_in: ["OTHER_SERVER_POLICY"] } },
      { id: "cooldown_policy_review", trigger: { dominant_mismatch_family_in: ["COOLDOWN_POLICY"] } },
      { id: "server_signal_observation_24h_context", trigger: {} },
    ],
  });

  assert.strictEqual(report.summary.tracked_family_n, 3);
  assert.strictEqual(report.summary.dominant_mismatch_family, "EV_POLICY");
  assert.strictEqual(report.rows[0].family, "EV_POLICY");
  const otherServerPolicyRow = report.rows.find((row) => row.family === "OTHER_SERVER_POLICY");
  assert.ok(otherServerPolicyRow.capability_ids.includes("other_server_policy_review"));
  assert.strictEqual(otherServerPolicyRow.review_status, "MONITOR_WITH_TARGETED_REVIEW");
  assert.strictEqual(otherServerPolicyRow.review_action, "WATCH_ONLY_REVIEW");
  assert.strictEqual(otherServerPolicyRow.verification_hint, "other_server_policy_mismatch_n < baseline (baseline=3)");
  const cooldownRow = report.rows.find((row) => row.family === "COOLDOWN_POLICY");
  assert.ok(cooldownRow.capability_ids.includes("cooldown_policy_review"));
  assert.strictEqual(cooldownRow.review_status, "MONITOR_WITH_TARGETED_REVIEW");
  assert.strictEqual(cooldownRow.review_action, "RELAX_OPPOSITE_COOLDOWN_REVIEW");
  assert.strictEqual(cooldownRow.verification_hint, "final_downstream_mismatch_n < baseline (baseline=13)");
  assert.ok(report.rows.find((row) => row.family === "EV_POLICY").capability_ids.includes("ev_gate_rescue"));

  console.log("OPENCLAW_FAMILY_SCOREBOARD_TEST_OK");
})();
