"use strict";

const assert = require("assert");
const {
  buildOpenClawDecisionBundle,
  buildOpenClawDecisionBundleLedgerDoc,
  persistOpenClawDecisionBundleLedger,
} = require("../v2/openclawControlPlane");
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
const runtimeSnapshotCollector = require("../../scripts/collect-v2-promotion-runtime-snapshot");
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

function buildCollectorSummary(bundle, positionCycle, overrides = {}) {
  const bundleDoc = buildOpenClawDecisionBundleLedgerDoc({ bundle });
  return {
    status: "PASS",
    producer_script: "collect-v2-promotion-runtime-snapshot",
    producer_scope: "openclaw_supreme_control_plane",
    source: "V2_FIRESTORE_COLLECTOR",
    position_cycle_id: positionCycle.position_cycle_id,
    openclaw_decision_id: bundle.openclawDecision.openclaw_decision_id,
    openclaw_decision_bundle_ids: [bundleDoc.openclaw_decision_bundle_id],
    openclaw_decision_bundle_hashes: [bundleDoc.openclaw_decision_bundle_hash],
    openclaw_execution_permit_ids: [],
    openclaw_outcome_adjudication_ids: [],
    collected_at: "2026-04-22T01:02:00.000Z",
        artifact_file: "/tmp/dbj-v2-artifacts/promotion-runtime-snapshot.json",
        artifact_dir: "/tmp/dbj-v2-artifacts",
        artifact_filename: "promotion-runtime-snapshot.json",
        artifact_current_dir_match: true,
        generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_at: "2026-04-22T01:02:00.000Z",
        artifact_generated_age_minutes: 1,
    exchange_write_performed: false,
    blockers: [],
    ...overrides,
  };
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

(async function decisionBundleLedgerPersistsReconstructablePayload() {
  const bundle = buildBundle();
  const doc = buildOpenClawDecisionBundleLedgerDoc({
    bundle,
    source: "UNIT_TEST",
    createdAt: "2026-04-22T00:03:00.000Z",
  });
  assert.ok(doc.openclaw_decision_bundle_id.startsWith("OCDBV2__"));
  assert.strictEqual(doc.openclaw_decision_bundle_hash, bundle.openclawDecisionBundleHash);
  assert.strictEqual(doc.openclaw_decision_id, bundle.openclawDecision.openclaw_decision_id);
  assert.strictEqual(doc.signal_intent_id, bundle.signalIntent.signal_intent_id);
  assert.strictEqual(doc.bundle_payload.openclawDecision.openclaw_decision_bundle_hash, bundle.openclawDecisionBundleHash);
  assert.strictEqual(doc.bundle_payload.mlAiSignalProposal.size_ratio, 0.5);
  assert.strictEqual(
    storage.__test.DOC_ID_FIELDS.OPENCLAW_DECISION_BUNDLES,
    "openclaw_decision_bundle_id"
  );

  const writes = [];
  const db = {
    collection(name) {
      return {
        doc(id) {
          return {
            async set(payload) {
              writes.push({ collection: name, id, payload });
            },
          };
        },
      };
    },
  };
  const persisted = await persistOpenClawDecisionBundleLedger({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    bundle,
    source: "UNIT_TEST",
    createdAt: "2026-04-22T00:03:00.000Z",
  });
  assert.strictEqual(persisted.ok, true);
  assert.strictEqual(persisted.reason, "OPENCLAW_DECISION_BUNDLE_LEDGER_WRITTEN");
  assert.strictEqual(persisted.persisted.collectionKey, "OPENCLAW_DECISION_BUNDLES");
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].collection, "dbjv2__openclaw_decision_bundles_v2");
  assert.strictEqual(writes[0].payload.openclaw_decision_bundle_hash, bundle.openclawDecisionBundleHash);
})();

(function decisionBundleCarriesStableHashIntoDecisionDoc() {
  const left = buildBundle();
  const right = buildBundle();
  assert.ok(left.openclawDecisionBundleHash);
  assert.strictEqual(left.openclawDecisionBundleHash, right.openclawDecisionBundleHash);
  assert.strictEqual(left.openclawDecision.openclaw_decision_bundle_hash, left.openclawDecisionBundleHash);
  const changed = buildBundle({ rankScore: 0.78 });
  assert.notStrictEqual(changed.openclawDecisionBundleHash, left.openclawDecisionBundleHash);
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
    ttlMinutes: 120,
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
    decisive_outcome_n: 1,
    model_error_rate: 0,
    max_model_error_rate: 0.5,
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

(function learnerReadinessBlocksModelErrorDriftWhenSummaryProvidesOutcomeStats() {
  const readiness = evaluateOpenClawLearnerShadowPromotionReadiness({
    evaluation_n: 2,
    shadow_only_n: 2,
    live_applied_n: 0,
    stale_evaluation_n: 0,
    decisive_outcome_n: 2,
    model_error_rate: 0.75,
    max_model_error_rate: 0.5,
  });
  assert.strictEqual(readiness.ok, false);
  assert.ok(readiness.blockers.includes("LEARNER_MODEL_ERROR_DRIFT_BLOCKED"));
})();

(function supremeSummaryRequiresSingleLineageAcrossPermitOutcomeAndLearner() {
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
    ttlMinutes: 120,
  });
  const positionCycle = {
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__SUPREME",
  };
  const adjudication = adjudicateOpenClawOutcome({
    bundle,
    positionCycle,
    realizedExitEvent: "TP1_REACHED",
    realizedPnl: 0.02,
    adjudicatedAt: "2026-04-22T01:00:00.000Z",
  });
  const evaluation = buildOpenClawLearnerShadowEvaluation({
    adjudication,
    evaluatedAt: "2026-04-22T01:01:00.000Z",
  });
  const summary = runtimeSnapshotCollector.__test.buildOpenClawSupremeControlPlaneSummary({
    worldState,
    decisionBundles: [buildOpenClawDecisionBundleLedgerDoc({ bundle })],
    executionPermits: [permit],
    outcomeAdjudications: [adjudication],
    learnerShadowEvaluations: [evaluation],
    expectedOpenClawDecisionId: bundle.openclawDecision.openclaw_decision_id,
    expectedPositionCycleId: positionCycle.position_cycle_id,
    collectorExecutionSummary: buildCollectorSummary(bundle, positionCycle, {
      openclaw_execution_permit_ids: [permit.openclaw_execution_permit_id],
      openclaw_outcome_adjudication_ids: [adjudication.openclaw_outcome_adjudication_id],
    }),
    nowMs: Date.parse("2026-04-22T01:02:00.000Z"),
  });
  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.lineage_consistency_summary.ok, true);
  assert.strictEqual(summary.lineage_consistency_summary.permit_lineage_mismatch_n, 0);
  assert.strictEqual(summary.lineage_consistency_summary.decision_bundle_lineage_mismatch_n, 0);
  assert.strictEqual(summary.lineage_consistency_summary.outcome_lineage_mismatch_n, 0);
  assert.strictEqual(summary.lineage_consistency_summary.learner_lineage_mismatch_n, 0);
  assert.strictEqual(summary.learner_shadow_summary.max_observed_evaluation_age_minutes, 1);
  assert.strictEqual(summary.learner_shadow_summary.latest_evaluated_at, "2026-04-22T01:01:00.000Z");
  assert.strictEqual(summary.learner_shadow_summary.model_win_n, 1);
  assert.strictEqual(summary.learner_shadow_summary.model_ok_n, 1);
  assert.strictEqual(summary.learner_shadow_summary.model_error_n, 0);
  assert.strictEqual(summary.learner_shadow_summary.model_error_rate, 0);
  assert.strictEqual(summary.collector_execution_summary.producer_script, "collect-v2-promotion-runtime-snapshot");
  assert.deepStrictEqual(summary.lineage_consistency_summary.expected_openclaw_execution_permit_ids, [permit.openclaw_execution_permit_id]);
  assert.strictEqual(summary.lineage_consistency_summary.expected_openclaw_decision_bundle_hash, bundle.openclawDecisionBundleHash);
  assert.deepStrictEqual(summary.lineage_consistency_summary.expected_openclaw_outcome_adjudication_ids, [adjudication.openclaw_outcome_adjudication_id]);

  const mismatchedLearner = {
    ...evaluation,
    openclaw_outcome_adjudication_id: "OCOAV2__OTHER",
  };
  const broken = runtimeSnapshotCollector.__test.buildOpenClawSupremeControlPlaneSummary({
    worldState,
    decisionBundles: [buildOpenClawDecisionBundleLedgerDoc({ bundle })],
    executionPermits: [permit],
    outcomeAdjudications: [adjudication],
    learnerShadowEvaluations: [mismatchedLearner],
    expectedOpenClawDecisionId: bundle.openclawDecision.openclaw_decision_id,
    expectedPositionCycleId: positionCycle.position_cycle_id,
    collectorExecutionSummary: buildCollectorSummary(bundle, positionCycle, {
      openclaw_execution_permit_ids: [permit.openclaw_execution_permit_id],
      openclaw_outcome_adjudication_ids: [adjudication.openclaw_outcome_adjudication_id],
    }),
    nowMs: Date.parse("2026-04-22T01:02:00.000Z"),
  });
  assert.strictEqual(broken.ok, false);
  assert.strictEqual(broken.lineage_consistency_summary.ok, false);
  assert.strictEqual(broken.lineage_consistency_summary.learner_lineage_mismatch_n, 1);
  assert.ok(broken.blockers.includes("OPENCLAW_LEARNER_OUTCOME_LINEAGE_MISMATCH"));
})();

(function supremeSummaryBlocksLearnerShadowModelErrorDrift() {
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
    ttlMinutes: 120,
  });
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
  const evaluation = buildOpenClawLearnerShadowEvaluation({
    adjudication,
    evaluatedAt: "2026-04-22T01:01:00.000Z",
  });
  const summary = runtimeSnapshotCollector.__test.buildOpenClawSupremeControlPlaneSummary({
    worldState,
    decisionBundles: [buildOpenClawDecisionBundleLedgerDoc({ bundle })],
    executionPermits: [permit],
    outcomeAdjudications: [adjudication],
    learnerShadowEvaluations: [evaluation],
    expectedOpenClawDecisionId: bundle.openclawDecision.openclaw_decision_id,
    expectedPositionCycleId: positionCycle.position_cycle_id,
    collectorExecutionSummary: buildCollectorSummary(bundle, positionCycle, {
      openclaw_execution_permit_ids: [permit.openclaw_execution_permit_id],
      openclaw_outcome_adjudication_ids: [adjudication.openclaw_outcome_adjudication_id],
    }),
    nowMs: Date.parse("2026-04-22T01:02:00.000Z"),
    maxLearnerModelErrorRate: 0.5,
  });
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.learner_shadow_summary.ok, false);
  assert.strictEqual(summary.learner_shadow_summary.model_error_n, 1);
  assert.strictEqual(summary.learner_shadow_summary.model_error_rate, 1);
  assert.ok(summary.learner_shadow_summary.blockers.includes("OPENCLAW_LEARNER_MODEL_ERROR_DRIFT_BLOCKED"));
  assert.ok(summary.blockers.includes("OPENCLAW_LEARNER_MODEL_ERROR_DRIFT_BLOCKED"));
})();

(function supremeSummaryRejectsExpiredPermitAndStaleLearnerEvidence() {
  const bundle = buildBundle();
  const worldState = buildOpenClawWorldState({
    mode: "CANARY",
    generatedAt: "2026-04-22T00:00:00.000Z",
  });
  const expiredPermit = issueOpenClawExecutionPermit({
    bundle,
    worldState,
    approvalReason: "TEST_PERMIT",
    issuedAt: "2026-04-22T00:00:00.000Z",
    ttlMinutes: 5,
  });
  const positionCycle = {
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__SUPREME_STALE",
  };
  const adjudication = adjudicateOpenClawOutcome({
    bundle,
    positionCycle,
    realizedExitEvent: "TP1_REACHED",
    realizedPnl: 0.02,
    adjudicatedAt: "2026-04-22T01:00:00.000Z",
  });
  const staleEvaluation = buildOpenClawLearnerShadowEvaluation({
    adjudication,
    evaluatedAt: "2026-04-20T01:00:00.000Z",
  });
  const summary = runtimeSnapshotCollector.__test.buildOpenClawSupremeControlPlaneSummary({
    worldState,
    decisionBundles: [buildOpenClawDecisionBundleLedgerDoc({ bundle })],
    executionPermits: [expiredPermit],
    outcomeAdjudications: [adjudication],
    learnerShadowEvaluations: [staleEvaluation],
    expectedOpenClawDecisionId: bundle.openclawDecision.openclaw_decision_id,
    expectedPositionCycleId: positionCycle.position_cycle_id,
    collectorExecutionSummary: buildCollectorSummary(bundle, positionCycle, {
      openclaw_execution_permit_ids: [expiredPermit.openclaw_execution_permit_id],
      openclaw_outcome_adjudication_ids: [adjudication.openclaw_outcome_adjudication_id],
    }),
    nowMs: Date.parse("2026-04-22T01:02:00.000Z"),
    maxLearnerEvaluationAgeMinutes: 1440,
  });
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.permit_validation_pass_n, 0);
  assert.strictEqual(summary.permit_validation_fail_n, 1);
  assert.strictEqual(summary.learner_shadow_summary.ok, false);
  assert.strictEqual(summary.learner_shadow_summary.stale_evaluation_n, 1);
  assert.strictEqual(summary.learner_shadow_summary.max_observed_evaluation_age_minutes, 2882);
  assert.strictEqual(summary.learner_shadow_summary.latest_evaluated_at, "2026-04-20T01:00:00.000Z");
  assert.ok(summary.blockers.includes("OPENCLAW_EXECUTION_PERMIT_VALIDATION_REQUIRED"));
  assert.ok(summary.blockers.includes("OPENCLAW_LEARNER_SHADOW_EVALUATION_STALE"));
})();

(function supremeSummaryRequiresDecisionBundleLedger() {
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
    ttlMinutes: 120,
  });
  const positionCycle = {
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__SUPREME_NO_BUNDLE",
  };
  const adjudication = adjudicateOpenClawOutcome({
    bundle,
    positionCycle,
    realizedExitEvent: "TP1_REACHED",
    realizedPnl: 0.02,
    adjudicatedAt: "2026-04-22T01:00:00.000Z",
  });
  const evaluation = buildOpenClawLearnerShadowEvaluation({
    adjudication,
    evaluatedAt: "2026-04-22T01:01:00.000Z",
  });
  const summary = runtimeSnapshotCollector.__test.buildOpenClawSupremeControlPlaneSummary({
    worldState,
    decisionBundles: [],
    executionPermits: [permit],
    outcomeAdjudications: [adjudication],
    learnerShadowEvaluations: [evaluation],
    expectedOpenClawDecisionId: bundle.openclawDecision.openclaw_decision_id,
    expectedPositionCycleId: positionCycle.position_cycle_id,
    expectedOpenClawDecisionBundleHash: bundle.openclawDecisionBundleHash,
    collectorExecutionSummary: buildCollectorSummary(bundle, positionCycle, {
      openclaw_decision_bundle_ids: [],
      openclaw_decision_bundle_hashes: [],
      openclaw_execution_permit_ids: [permit.openclaw_execution_permit_id],
      openclaw_outcome_adjudication_ids: [adjudication.openclaw_outcome_adjudication_id],
    }),
    nowMs: Date.parse("2026-04-22T01:02:00.000Z"),
  });
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.openclaw_decision_bundle_n, 0);
  assert.ok(summary.blockers.includes("OPENCLAW_DECISION_BUNDLE_LEDGER_REQUIRED"));
})();

(function supremeSummaryRejectsMissingCollectorProvenance() {
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
    ttlMinutes: 120,
  });
  const positionCycle = {
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__SUPREME_NO_COLLECTOR",
  };
  const adjudication = adjudicateOpenClawOutcome({
    bundle,
    positionCycle,
    realizedExitEvent: "TP1_REACHED",
    realizedPnl: 0.02,
    adjudicatedAt: "2026-04-22T01:00:00.000Z",
  });
  const evaluation = buildOpenClawLearnerShadowEvaluation({
    adjudication,
    evaluatedAt: "2026-04-22T01:01:00.000Z",
  });
  const summary = runtimeSnapshotCollector.__test.buildOpenClawSupremeControlPlaneSummary({
    worldState,
    decisionBundles: [buildOpenClawDecisionBundleLedgerDoc({ bundle })],
    executionPermits: [permit],
    outcomeAdjudications: [adjudication],
    learnerShadowEvaluations: [evaluation],
    expectedOpenClawDecisionId: bundle.openclawDecision.openclaw_decision_id,
    expectedPositionCycleId: positionCycle.position_cycle_id,
    nowMs: Date.parse("2026-04-22T01:02:00.000Z"),
  });
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.collector_execution_summary, null);
  assert.ok(summary.blockers.includes("OPENCLAW_SUPREME_COLLECTOR_PROVENANCE_REQUIRED"));
})();

console.log("V2_OPENCLAW_SUPREME_CONTROL_PLANE_TEST_OK");
