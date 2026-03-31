"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-claude-weekly-patch-engine");

(() => {
  const plain = __test.parseClaudeJson("{\"verdict\":\"HOLD\"}");
  assert.deepStrictEqual(plain, { verdict: "HOLD" });

  const fenced = __test.parseClaudeJson("```json\n{\"verdict\":\"PROMOTE\",\"recommended_candidate_id\":\"AUTO_CORE\"}\n```");
  assert.strictEqual(fenced.verdict, "PROMOTE");
  assert.strictEqual(fenced.recommended_candidate_id, "AUTO_CORE");

  const invalid = __test.parseClaudeJson("not-json");
  assert.strictEqual(invalid, null);

  const reviewReady = __test.deriveReviewReadiness({
    changeControl: {
      auto_promotion: { ready: false },
      auto_rollback: { ready: false },
    },
    selfEvolutionCanary: {
      summary: { ready_n: 2, apply_pass: true, rollback_ready_n: 0 },
    },
  });
  assert.strictEqual(reviewReady.reviewReady, true);
  assert.strictEqual(reviewReady.selfEvolutionPromotionReady, true);
  assert.strictEqual(reviewReady.selfEvolutionRollbackReady, false);

  const bypassReady = __test.deriveReviewReadiness({
    changeControl: {
      auto_promotion: { ready: false },
      auto_rollback: { ready: false },
    },
    selfEvolutionCanary: {
      summary: { ready_n: 0, apply_pass: false, rollback_ready_n: 0 },
    },
    deploymentPlan: {
      summary: { plan_status: "APPLIED_CONFIRMED_PENDING_AUTHORITY", authority_bypass_active: true, external_authority_pending: true, authority_state: "PENDING" },
    },
  });
  assert.strictEqual(bypassReady.reviewReady, true);
  assert.strictEqual(bypassReady.selfEvolutionAuthorityBypass, true);

  const pendingBlock = __test.deriveReviewReadiness({
    changeControl: {
      auto_promotion: { ready: false },
      auto_rollback: { ready: true },
    },
    selfEvolutionCanary: {
      summary: { ready_n: 0, apply_pass: false, rollback_ready_n: 1 },
    },
    deploymentPlan: {
      summary: { plan_status: "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY", authority_bypass_active: true, external_authority_pending: true, authority_state: "PENDING" },
    },
  });
  assert.strictEqual(pendingBlock.pendingSignalConfirmation, true);
  assert.strictEqual(pendingBlock.reviewReady, false);
  assert.strictEqual(pendingBlock.blockedReason, "BUNDLE_ACTIVATION_PENDING_BLOCK");

  console.log("CLAUDE_WEEKLY_PATCH_ENGINE_TEST_OK");
})();
