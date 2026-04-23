"use strict";

const assert = require("assert");
const { evaluateOpenClawPolicyPromotionGate } = require("../v2/openclawPolicyPromotionGate");

{
  const result = evaluateOpenClawPolicyPromotionGate({
    env: {
      DONBEOLJA_V2_POLICY_PROMOTION_MIN_SHADOW_SAMPLE_N: "30",
      DONBEOLJA_V2_POLICY_PROMOTION_MIN_CHALLENGER_SAMPLE_N: "30",
    },
    champion: { policy_id: "champion-v1", sample_n: 100, expectancy_r: 0.1, profit_factor: 1.2, max_drawdown_pct: 4 },
    challenger: { policy_id: "challenger-v2", sample_n: 80, expectancy_r: 0.18, profit_factor: 1.31, max_drawdown_pct: 4 },
    learner: { model_error_rate: 0.05, live_applied_n: 0, stale_evaluation_n: 0 },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.decision, "HOLD_SHADOW");
}

{
  const result = evaluateOpenClawPolicyPromotionGate({
    champion: { policy_id: "same", sample_n: 10, expectancy_r: 0.1, profit_factor: 1.2, max_drawdown_pct: 2 },
    challenger: { policy_id: "same", sample_n: 5, expectancy_r: 0.1, profit_factor: 1.1, max_drawdown_pct: 5 },
    learner: { model_error_rate: 0.5, live_applied_n: 1, stale_evaluation_n: 1 },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_PROMOTION:CHALLENGER_MUST_DIFFER"));
  assert.ok(result.blockers.includes("POLICY_PROMOTION:CHALLENGER_SAMPLE_INSUFFICIENT"));
  assert.ok(result.blockers.includes("POLICY_PROMOTION:LEARNER_LIVE_APPLICATION_FORBIDDEN"));
}

console.log("V2_OPENCLAW_POLICY_PROMOTION_GATE_TEST_OK");
