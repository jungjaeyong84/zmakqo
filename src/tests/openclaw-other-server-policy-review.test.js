"use strict";

const assert = require("assert");
const { buildOtherServerPolicyReview } = require("../../src/utils/openclawOtherServerPolicyReview");

(() => {
  const report = buildOtherServerPolicyReview({
    quality: {
      summary: {
        other_server_policy_mismatch_n: 3,
      },
      rows: {
        other_server_policy_reason_actions: [
          {
            reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED",
            mismatch_n: 2,
            recommended_action: "WATCH_ONLY_REVIEW",
            top_markets: [{ market: "ETHUSDT", mismatch_n: 2 }],
          },
        ],
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
    cutover: {
      summary: {
        dominant_mismatch_family: "OTHER_SERVER_POLICY",
      },
    },
  });

  assert.strictEqual(report.summary.status, "PRIORITY_REVIEW");
  assert.strictEqual(report.summary.other_server_policy_mismatch_n, 3);
  assert.strictEqual(report.summary.top_reason, "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED");
  assert.strictEqual(report.summary.top_reason_recommended_action, "WATCH_ONLY_REVIEW");
  assert.strictEqual(report.summary.verification_target.expected, "< baseline");
  assert.strictEqual(report.rows.top_markets[0].market, "ETHUSDT");

  console.log("OPENCLAW_OTHER_SERVER_POLICY_REVIEW_TEST_OK");
})();
