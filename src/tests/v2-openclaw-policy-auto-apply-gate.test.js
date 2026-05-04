"use strict";

const assert = require("assert");
const { evaluateOpenClawPolicyAutoApplyGate } = require("../v2/openclawPolicyAutoApplyGate");

function passingEvidence() {
  return {
    formalLiveReadiness: { ok: true, reason: "FORMAL_LIVE_PROMOTION_READY_REQUIRES_OPERATOR_APPROVAL", blockers: [] },
    policyPromotionGate: { ok: true, reason: "OPENCLAW_POLICY_PROMOTION_GATE_PASS", decision: "READY_FOR_MANUAL_REVIEW_NOT_AUTO_APPLY", blockers: [] },
    performanceGate: { ok: true, reason: "V2_PERFORMANCE_GATE_PASS", blockers: [] },
    safetyStreak: { ok: true, reason: "V2_30D_SAFETY_STREAK_PASS", blockers: [] },
  };
}

function armedEnv(overrides = {}) {
  return {
    DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "1",
    OPENCLAW_AGENT_APPLY_ENABLED: "1",
    ML_LIVE_SERVING_ARMED: "1",
    OPENCLAW_CONDUCTOR_SHADOW_ONLY: "0",
    OPENCLAW_NARRATIVE_SHADOW_ONLY: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_PAID_AI_API_DISABLED: "1",
    OPENCLAW_NARRATIVE_PROVIDER_MODE: "CODEX_CLI_ONLY",
    DONBEOLJA_OPENCLAW_LEARNING_SCOPE: "V2_ONLY_OPENCLAW",
    ...overrides,
  };
}

{
  const result = evaluateOpenClawPolicyAutoApplyGate({
    env: armedEnv(),
    ...passingEvidence(),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.decision, "AUTO_APPLY_ALLOWED");
}

{
  const result = evaluateOpenClawPolicyAutoApplyGate({
    env: armedEnv({
      DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "0",
      OPENCLAW_AGENT_APPLY_ENABLED: "0",
      ML_LIVE_SERVING_ARMED: "0",
      OPENCLAW_CONDUCTOR_SHADOW_ONLY: "1",
      DONBEOLJA_V2_CANARY_ONLY: "1",
    }),
    ...passingEvidence(),
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:EXPLICIT_ENABLE_REQUIRED"));
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:AGENT_APPLY_NOT_ARMED"));
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:ML_LIVE_SERVING_NOT_ARMED"));
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:CONDUCTOR_STILL_SHADOW_ONLY"));
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:CANARY_ONLY_RUNTIME"));
}

{
  const result = evaluateOpenClawPolicyAutoApplyGate({
    env: armedEnv(),
    ...passingEvidence(),
    performanceGate: {
      ok: false,
      reason: "V2_PERFORMANCE_GATE_BLOCKED",
      blockers: ["PERFORMANCE_GATE:EXPECTANCY_NOT_POSITIVE"],
    },
    safetyStreak: {
      ok: false,
      reason: "V2_30D_SAFETY_STREAK_BLOCKED",
      blockers: ["SAFETY_STREAK:INSUFFICIENT_CONSECUTIVE_DAYS"],
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:PERFORMANCE_GATE_NOT_PASS"));
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:SAFETY_STREAK_NOT_PASS"));
  assert.ok(result.blockers.includes("PERFORMANCE:PERFORMANCE_GATE:EXPECTANCY_NOT_POSITIVE"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:SAFETY_STREAK:INSUFFICIENT_CONSECUTIVE_DAYS"));
}

{
  const result = evaluateOpenClawPolicyAutoApplyGate({
    env: armedEnv({ OPENCLAW_NARRATIVE_PROVIDER_MODE: "CLAUDE" }),
    ...passingEvidence(),
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:NON_CODEX_PROVIDER_MODE"));
}

console.log("V2_OPENCLAW_POLICY_AUTO_APPLY_GATE_TEST_OK");
