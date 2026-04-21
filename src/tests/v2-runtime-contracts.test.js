"use strict";

const assert = require("assert");
const contracts = require("../v2/contracts");

(function positionCycleRequiresEntryLineage() {
  let err = null;
  try {
    contracts.buildPositionCycleDoc({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entryEventId: null,
      entryOrderId: "123",
      entryFillGroupId: "fill-group-1",
      positionSide: "LONG",
      entryPrice: 100000,
      entryQtyAbs: 0.01,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "entry_event_id_REQUIRED");
})();

(function positionCycleBuildsStableId() {
  const doc = contracts.buildPositionCycleDoc({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__1",
    entryOrderId: "ORDER__1",
    entryFillGroupId: "FILL_GROUP__1",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.01,
  });
  assert.ok(doc.position_cycle_id.startsWith("PCY__BINANCEFUT__BTCUSDT__LONG__"));
})();

(function transitionDocRequiresAllowedStagesAndEvents() {
  const cycle = contracts.buildPositionCycleDoc({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__1",
    entryOrderId: "ORDER__ETH__1",
    entryFillGroupId: "FILL_GROUP__ETH__1",
    positionSide: "SHORT",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const transition = contracts.buildCanonicalExitTransitionDoc({
    positionCycleId: cycle.position_cycle_id,
    transitionEvent: "TP1_REACHED",
    previousStage: "PRE_TP1",
    nextStage: "TP1_DONE",
    sourceFillId: "FILL__1",
    sourceOrderId: "ORDER__TP1",
    entryEventId: cycle.entry_event_id,
    ledgerPatch: { tp1_filled_qty_abs: 0.5, runner_remaining_qty_abs: 0.5 },
    sourceExchangeEvidence: {
      evidence_kind: "TP1_FILL",
      source_fill_id: "FILL__1",
      raw_payload: { execution_type: "TRADE" },
    },
  });
  assert.ok(transition.canonical_transition_id.includes("TP1_REACHED"));
  assert.strictEqual(transition.next_stage, "TP1_DONE");
  assert.strictEqual(transition.source_exchange_evidence.evidence_kind, "TP1_FILL");
  assert.strictEqual(transition.source_exchange_evidence.raw_payload.execution_type, "TRADE");
})();

(function projectionAndOutboxUseCanonicalIds() {
  const projection = contracts.buildExitRuntimeProjectionDoc({
    positionCycleId: "PCY__BINANCEFUT__ETHUSDT__LONG__abc123",
    stage: "TRAIL_ACTIVE",
    tp1Done: true,
    trailActive: true,
    entryQtyAbs: 1,
    tp1TargetQtyAbs: 0.5,
    tp1FilledQtyAbs: 0.5,
    runnerRemainingQtyAbs: 0.5,
    runnerFloorStop: 2010,
    trailStopByR: 2020,
    chosenStopSource: "TRAIL",
    chosenStopPrice: 2020,
    finalEffectiveStop: 2020,
    nativeStopPrice: 2020,
    healthStatus: "HEALTHY",
  });
  assert.strictEqual(projection.stage, "TRAIL_ACTIVE");

  const outbox = contracts.buildTradeAlertOutboxDoc({
    canonicalTransitionId: "CETV2__PCY__1__TP1_REACHED__abc",
    positionCycleId: "PCY__1",
    alertType: "EXIT_TRANSITION_ALERT",
    status: "PENDING",
    attemptCount: 1,
  });
  assert.ok(outbox.alert_outbox_id.startsWith("TAOV2__EXIT_TRANSITION_ALERT__"));
})();

(function alertStatusesRemainExplicit() {
  const failed = contracts.buildTradeAlertOutboxDoc({
    canonicalTransitionId: "CETV2__PCY__1__TP1_REACHED__abc",
    positionCycleId: "PCY__1",
    alertType: "EXIT_TRANSITION_ALERT",
    status: "FAILED",
    attemptCount: 3,
    lastReason: "TELEGRAM_TIMEOUT",
  });
  assert.strictEqual(failed.status, "FAILED");
  assert.strictEqual(failed.attempt_count, 3);
  assert.strictEqual(failed.last_reason, "TELEGRAM_TIMEOUT");
  assert.strictEqual(failed.last_attempt_at, null);
  assert.strictEqual(failed.last_reason_family, null);
  assert.strictEqual(failed.retry_policy_code, null);
  assert.deepStrictEqual(failed.runbook_refs, []);
})();

(function signalIntentAndDecisionContractsAreExplicit() {
  const signalIntent = contracts.buildSignalIntentDoc({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__BTC__1",
    symbol: "BTCUSDT",
    side: "LONG",
    qualityScore: 0.81,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
  });
  assert.ok(signalIntent.signal_intent_id.startsWith("SIGINTV2__SERVER_NATIVE_ML_AI__BTCUSDT__LONG__"));

  const featureSnapshot = contracts.buildFeatureSnapshotDoc({
    signalIntentId: signalIntent.signal_intent_id,
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    symbol: "BTCUSDT",
    side: "LONG",
    timeframe: "15M",
    schemaVersion: "ml_features_v1",
    featureVectorHash: "feat_hash_btc_v1",
    featureValues: {
      trend_bias: 0.71,
      volatility_rank: 0.42,
      volume_impulse: 0.63,
    },
    marketRegime: "TREND",
    snapshotAt: "2026-04-20T12:00:00.000Z",
  });
  assert.ok(featureSnapshot.feature_snapshot_id.startsWith("FSV2__"));
  assert.strictEqual(featureSnapshot.feature_schema_version, "ml_features_v1");

  const proposal = contracts.buildMlAiSignalProposalDoc({
    signalIntentId: signalIntent.signal_intent_id,
    featureSnapshotId: featureSnapshot.feature_snapshot_id,
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    symbol: "BTCUSDT",
    side: "LONG",
    timeframe: "15M",
    decisionMode: "SHADOW",
    proposalVerdict: "SHADOW",
    qualityScore: 0.81,
    rankScore: 0.64,
    sizeRatio: 0.35,
    riskBand: "MEDIUM",
    strategyFilterName: "HTF_DIRECTION_ALIGNMENT",
    strategyFilterVerdict: "PASS",
    rationaleSummary: "native shadow proposal retained for comparison",
  });
  assert.ok(proposal.ml_ai_signal_proposal_id.startsWith("MSPV2__SHADOW__SHADOW__"));
  assert.strictEqual(proposal.feature_snapshot_id, featureSnapshot.feature_snapshot_id);

  const decision = contracts.buildOpenClawDecisionDoc({
    signalIntentId: signalIntent.signal_intent_id,
    decisionMode: "SHADOW",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "shadow decision accepted for canary prep",
    policyScope: "BTC_15M",
    strategyFilterResult: {
      filter_name: "HTF_DIRECTION_ALIGNMENT",
      verdict: "PASS",
      reason: "HTF_DIRECTION_CONFIRMED",
    },
    canonicalEvidenceSummary: {
      strategy_filter: { verdict: "PASS" },
    },
    mlAiEvidenceDecisionId: "MLAIV2__SHADOW__abc123",
  });
  assert.ok(decision.openclaw_decision_id.startsWith("OCDV2__SHADOW__APPROVE_ENTRY__"));
  assert.strictEqual(decision.strategy_filter_name, "HTF_DIRECTION_ALIGNMENT");
  assert.strictEqual(decision.ml_ai_evidence_decision_id, "MLAIV2__SHADOW__abc123");

  const mlEvidence = contracts.buildMlAiEvidenceLedgerDoc({
    signalIntentId: signalIntent.signal_intent_id,
    featureSnapshotId: featureSnapshot.feature_snapshot_id,
    featureSchemaVersion: featureSnapshot.feature_schema_version,
    decisionMode: "SHADOW",
    featuresHash: featureSnapshot.feature_vector_hash,
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "native long approved in shadow mode",
    recommendedAction: "APPROVE_ENTRY",
  });
  assert.strictEqual(mlEvidence.feature_snapshot_id, featureSnapshot.feature_snapshot_id);
  assert.strictEqual(mlEvidence.feature_schema_version, "ml_features_v1");
})();

(function trailObservationContractIsExplicit() {
  const observation = contracts.buildTrailObservationDoc({
    positionCycleId: "PCY__BINANCEFUT__ETHUSDT__LONG__abc123",
    stage: "TRAIL_ACTIVE",
    marketPrice: 2050,
    watermarkPrice: 2050,
    runnerFloorStop: 2000,
    trailStopByR: 2030.2,
    chosenStopSource: "TRAIL",
    chosenStopPrice: 2030.2,
    finalEffectiveStop: 2030.2,
    nativeStopPrice: 2012,
    issueCodes: ["TRAIL_STOP_MISSING"],
    observedAt: "2026-04-20T10:00:00.000Z",
  });
  assert.ok(observation.trail_observation_id.startsWith("TROBSV2__"));
  assert.deepStrictEqual(observation.issue_codes, ["TRAIL_STOP_MISSING"]);
})();

(function repairRequestContractIsExplicit() {
  const request = contracts.buildRepairRequestDoc({
    positionCycleId: "PCY__BINANCEFUT__ETHUSDT__LONG__abc123",
    stage: "TRAIL_ACTIVE",
    issueCode: "TRAIL_STOP_MISSING",
    healthStatus: "DEGRADED_UNPROTECTED",
    requestedAction: "REFRESH_NATIVE_STOP",
    detail: { native_stop_price: null },
    createdAt: "2026-04-20T12:30:00.000Z",
  });
  assert.ok(request.exit_repair_request_id.startsWith("RQRV2__TRAIL_STOP_MISSING__"));
  assert.strictEqual(request.requested_action, "REFRESH_NATIVE_STOP");
})();

(function protectionRuntimeMustCarryBothNativeOrders() {
  const runtime = contracts.buildProtectionRuntimeDoc({
    positionCycleId: "PCY__BINANCEFUT__BTCUSDT__LONG__abc123",
    slOrderId: "STOP__1",
    tp1OrderId: "TP1__1",
    nativeStopPrice: 98000,
    nativeTp1Price: 101680,
    nativeRefreshStatus: "OK",
    healthStatus: "HEALTHY",
    lastExchangeEvidence: {
      evidence_kind: "STOP_EXIT",
      raw_payload: { stop_price: "98000" },
    },
    lastEvidenceObservedAt: "2026-04-20T12:45:00.000Z",
  });
  assert.strictEqual(runtime.sl_order_id, "STOP__1");
  assert.strictEqual(runtime.tp1_order_id, "TP1__1");
  assert.strictEqual(runtime.last_exchange_evidence.evidence_kind, "STOP_EXIT");
  assert.strictEqual(runtime.last_evidence_observed_at, "2026-04-20T12:45:00.000Z");
})();

console.log("V2_RUNTIME_CONTRACTS_TEST_OK");
