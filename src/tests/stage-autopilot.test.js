"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-stage-autopilot");

(() => {
  const aiCandidate = __test.buildAiStageCandidate({
    data: {
      generated_at_kst: "2026-03-28 10:00:00 KST",
      self_validation: { ok: true },
      stage_samples: { ai_n: 64 },
      recommendations: {
        AI: {
          action: "REVIEW_UPDATE",
          key: "ai_missing_policy",
          next: "REDUCE",
          next_reduce_pct: 0.35,
          reason: "tighten ai missing",
          support_n: 24,
          support_rate: 0.41,
        },
      },
    },
  }, {
    ai_missing_policy: "ALLOW",
    ai_missing_reduce_pct: 0.5,
  }, {
    objective: { enough_sample: true },
  });
  assert.strictEqual(aiCandidate.actionable, true);
  assert.strictEqual(aiCandidate.nextSettings.ai_missing_policy, "REDUCE");
  assert.strictEqual(aiCandidate.nextSettings.ai_missing_reduce_pct, 0.35);

  const marketCandidate = __test.buildMarketStageCandidate({
    data: {
      self_validation: { ok: true },
      stage_samples: { market_n: 40 },
      coverage: { ai_bias_rate: 0.12 },
      recommendations: {
        MARKET: {
          action: "REVIEW_TIGHTEN",
          key: "ai_bias_gate_opposite_mult",
          next: 0.30,
          reason: "tighten opposite mult",
        },
      },
    },
  }, {
    ai_bias_gate_opposite_mult: 0.35,
  }, {
    objective: { enough_sample: true },
    guards: { market_coverage_pass: true },
  });
  assert.strictEqual(marketCandidate.actionable, true);
  assert.strictEqual(marketCandidate.nextSettings.ai_bias_gate_opposite_mult, 0.30);

  const pinePromote = __test.buildPineCandidate(
    { data: { verdict: "PATCH_CANDIDATE", promotion: { candidate_id: "AUTO_CORE_SCORE_TIGHTEN" }, reason: "AUTO_PROMOTION_READY" } },
    { data: { verdict: "PROMOTE" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pinePromote.actionable, true);
  assert.strictEqual(pinePromote.kind, "PROMOTE");

  const pineRollbackBlocked = __test.buildPineCandidate(
    { data: { verdict: "ROLLBACK_CANDIDATE", rollback: { rollback_file_path: "/tmp/rb.pine" }, reason: "AUTO_ROLLBACK_READY" } },
    { data: { verdict: "HOLD" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pineRollbackBlocked.actionable, false);
  assert.strictEqual(pineRollbackBlocked.kind, "ROLLBACK");

  const budgetBlocked = __test.stageChangeBudgetOk([
    { stage: "AI", action: "AUTO_APPLY", ts_ms: 1_000_000 },
  ], 1_000_000 + (12 * 60 * 60 * 1000), "AI");
  assert.strictEqual(budgetBlocked, false);

  const stableSig = __test.stableSignature({ b: 2, a: 1 });
  assert.strictEqual(stableSig, 'a=1|b=2');

  console.log("STAGE_AUTOPILOT_TEST_OK");
})();
