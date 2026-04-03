"use strict";

const assert = require("assert");
const { buildCooldownPolicyReview } = require("../../src/utils/openclawCooldownPolicyReview");

(() => {
  const report = buildCooldownPolicyReview({
    quality: {
      summary: {
        final_downstream_mismatch_n: 15,
      },
      rows: {
        final_downstream_family_actions: [
          { family: "COOLDOWN_POLICY", mismatch_n: 2, recommended_action: "RELAX_OPPOSITE_COOLDOWN_REVIEW" },
        ],
      },
    },
    cutover: {
      summary: {
        dominant_mismatch_family: "COOLDOWN_POLICY",
      },
    },
    driftRemediationPlan: {
      summary: {
        cooldown_policy_market_patch_n: 1,
      },
      rows: {
        cooldown_policy_by_market: [
          { market: "XRPUSDT", mismatch_n: 2, current_bars: 3, proposed_bars: 2, changed: true },
        ],
      },
    },
  });

  assert.strictEqual(report.summary.status, "PRIORITY_REVIEW");
  assert.strictEqual(report.summary.cooldown_policy_mismatch_n, 2);
  assert.strictEqual(report.summary.recommended_action, "RELAX_OPPOSITE_COOLDOWN_REVIEW");
  assert.strictEqual(report.summary.top_market, "XRPUSDT");
  assert.strictEqual(report.summary.verification_target.metric, "final_downstream_mismatch_n");

  console.log("OPENCLAW_COOLDOWN_POLICY_REVIEW_TEST_OK");
})();
