"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { buildOpenClawWorldState } = require("../v2/openclawWorldState");
const {
  issueOpenClawExecutionPermit,
  validateOpenClawExecutionPermit,
} = require("../v2/openclawExecutionPermit");
const {
  adjudicateOpenClawOutcome,
} = require("../v2/openclawOutcomeAdjudicator");
const {
  buildOpenClawLearnerShadowEvaluation,
  evaluateOpenClawLearnerShadowPromotionReadiness,
} = require("../v2/openclawLearnerShadow");
const storage = require("../v2/storage");

function buildBundle(overrides = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__SUPREME_CONTROL",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.84,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "supreme control plane approved fixture",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.8,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.78,
      volatility_rank: 0.42,
    },
    proposalVerdict: "PASS",
    rankScore: 0.77,
    sizeRatio: 0.5,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_supreme_control",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "tp1 probability accepted by OpenClaw",
    createdAt: "2026-04-22T00:00:00.000Z",
    ...overrides,
  });
}

(function worldStateHashIsDeterministicAndCollectionMapped() {
  const left = buildOpenClawWorldState({
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    mode: "CANARY",
    marketState: { b: 2, a: 1 },
    generatedAt: "2026-04-22T00:00:00.000Z",
  });
  const right = buildOpenClawWorldState({
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    mode: "CANARY",
    marketState: { a: 1, b: 2 },
    generatedAt: "2026-04-22T00:00:00.000Z",
  });
  assert.strictEqual(left.world_state_hash, right.world_state_hash);
  assert.ok(left.openclaw_world_state_id.startsWith("OCWSV2__"));
  assert.strictEqual(
    storage.__test.DOC_ID_FIELDS.OPENCLAW_WORLD_STATES,
    "openclaw_world_state_id"
  );
})();

(function executionPermitBindsDecisionWorldStateAndTtl() {
  const bundle = buildBundle();
  const worldState = buildOpenClawWorldState({
    mode: "CANARY",
    generatedAt: "2026-04-22T00:00:00.000Z",
  });
  const permit = issueOpenClawExecutionPermit({
    bundle,
    worldState,
    approvalReason: "TEST_PERMIT",
    issuedAt: "2026-04-22T00:00:00.000Z",
    ttlMinutes: 5,
  });
  assert.ok(permit.openclaw_execution_permit_id.startsWith("OCEPV2__"));
  assert.strictEqual(permit.world_state_hash, worldState.world_state_hash);
  const validation = validateOpenClawExecutionPermit({
    permit,
    bundle,
    worldState,
    now: () => "2026-04-22T00:04:00.000Z",
  });
  assert.strictEqual(validation.ok, true);

  const expired = validateOpenClawExecutionPermit({
    permit,
    bundle,
    worldState,
    now: () => "2026-04-22T00:06:00.000Z",
  });
  assert.strictEqual(expired.ok, false);
  assert.ok(expired.failed_check_ids.includes("PERMIT_NOT_EXPIRED"));
})();

(function executionPermitRejectsTamperedDecision() {
  const bundle = buildBundle();
  const otherBundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__SUPREME_CONTROL_TAMPERED",
  });
  const worldState = buildOpenClawWorldState({
    mode: "CANARY",
    generatedAt: "2026-04-22T00:00:00.000Z",
  });
  const permit = issueOpenClawExecutionPermit({
    bundle,
    worldState,
    approvalReason: "TEST_PERMIT",
    issuedAt: "2026-04-22T00:00:00.000Z",
    ttlMinutes: 5,
  });
  const validation = validateOpenClawExecutionPermit({
    permit,
    bundle: otherBundle,
    worldState,
    now: () => "2026-04-22T00:01:00.000Z",
  });
  assert.strictEqual(validation.ok, false);
  assert.ok(validation.failed_check_ids.includes("PERMIT_DECISION_MATCH"));
  assert.ok(validation.failed_check_ids.includes("PERMIT_SIGNAL_INTENT_MATCH"));
})();

(function outcomeAdjudicationFeedsShadowOnlyLearner() {
  const bundle = buildBundle();
  const positionCycle = {
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__SUPREME",
  };
  const adjudication = adjudicateOpenClawOutcome({
    bundle,
    positionCycle,
    realizedExitEvent: "SL_HIT",
    realizedPnl: -0.012,
    executionOk: true,
    protectionOk: true,
    modelApproved: true,
    adjudicatedAt: "2026-04-22T01:00:00.000Z",
  });
  assert.strictEqual(adjudication.adjudication_label, "MODEL_ERROR");
  assert.strictEqual(adjudication.adjudication_family, "MODEL");
  assert.strictEqual(adjudication.model_ok, false);

  const evaluation = buildOpenClawLearnerShadowEvaluation({
    adjudication,
    evaluatedAt: "2026-04-22T01:01:00.000Z",
  });
  assert.strictEqual(evaluation.shadow_only, true);
  assert.strictEqual(evaluation.proposed_action, "SHADOW_REDUCE_SIZE_OR_BLOCK_COHORT");
  assert.ok(evaluation.openclaw_learner_shadow_evaluation_id.startsWith("OCLSEV2__"));

  const readiness = evaluateOpenClawLearnerShadowPromotionReadiness({
    evaluation_n: 1,
    shadow_only_n: 1,
    live_applied_n: 0,
    stale_evaluation_n: 0,
  });
  assert.strictEqual(readiness.ok, true);
})();

(function learnerReadinessBlocksLiveApplication() {
  const readiness = evaluateOpenClawLearnerShadowPromotionReadiness({
    evaluation_n: 1,
    shadow_only_n: 0,
    live_applied_n: 1,
    stale_evaluation_n: 0,
  });
  assert.strictEqual(readiness.ok, false);
  assert.ok(readiness.blockers.includes("LEARNER_SHADOW_ONLY_COVERAGE_REQUIRED"));
  assert.ok(readiness.blockers.includes("LEARNER_LIVE_APPLICATION_FORBIDDEN"));
})();

console.log("V2_OPENCLAW_SUPREME_CONTROL_PLANE_TEST_OK");
