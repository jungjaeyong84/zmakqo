"use strict";

const { buildV2EntryBootstrap } = require("./entryBootstrap");
const { reduceCanonicalExit } = require("./canonicalExitReducer");
const { prepareExitTransitionAlert, applyAlertDeliveryResult } = require("./alertWorker");
const { evaluateActiveExitWatchdog } = require("./watchdog");
const { buildOpenClawDecisionBundle } = require("./openclawControlPlane");

function withExchangeEvidence(transition, evidenceKind, rawPayload) {
  return {
    ...transition,
    source_exchange_evidence: {
      evidence_kind: evidenceKind,
      observed_at: transition.created_at,
      source_fill_id: transition.source_fill_id,
      source_order_id: transition.source_order_id,
      raw_payload: { ...(rawPayload || {}) },
    },
  };
}

function buildTerminalProtectionRuntime({ positionCycleId, transition, nativeStopPrice = null, slOrderId = null, tp1OrderId = null }) {
  return {
    position_cycle_id: positionCycleId,
    sl_order_id: slOrderId,
    tp1_order_id: tp1OrderId,
    native_stop_price: nativeStopPrice,
    native_refresh_status: "OK",
    health_status: "TERMINAL_EXITED",
    last_exchange_evidence: {
      evidence_kind: transition.source_exchange_evidence.evidence_kind,
      observed_at: transition.created_at,
      source_fill_id: transition.source_fill_id,
      source_order_id: transition.source_order_id,
      raw_payload: { ...transition.source_exchange_evidence.raw_payload },
    },
    last_evidence_observed_at: transition.created_at,
  };
}

function buildDeliveredOutboxes({ positionCycle, transitions, projection }) {
  return transitions.map((transition) => {
    const prep = prepareExitTransitionAlert({
      positionCycle,
      transition,
      projection: transition.next_stage === projection.stage ? projection : {
        ...projection,
        stage: transition.next_stage,
        health_status: transition.next_stage.startsWith("EXITED_") ? "TERMINAL_EXITED" : "HEALTHY",
      },
    });
    return applyAlertDeliveryResult({ outbox: prep.outbox, deliveryOk: prep.ok === true });
  });
}

function buildReferencePassEpisode() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__RG1",
    entryOrderId: "ORDER__ETH__RG1",
    entryFillGroupId: "FILL_GROUP__ETH__RG1",
    entryIntentId: "EINTV2__eth_rg1",
    signalIntentId: "SIGINTV2__eth_rg1",
    openclawDecisionId: "OCDV2__eth_rg1",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP_FULL__RG1",
      sourceOrderId: "ORDER__TP_FULL__RG1",
      fillQtyAbs: 1,
    },
  });
  const tp1Transition = withExchangeEvidence(tp1.transition, "TP1_FILL", {
    execution_type: "TRADE",
    order_type: "TAKE_PROFIT_MARKET",
    quantity_abs: 1,
    full_exit: true,
    position_amt_after: "0",
  });
  const protectionRuntime = buildTerminalProtectionRuntime({
    positionCycleId: base.positionCycle.position_cycle_id,
    transition: tp1Transition,
    nativeStopPrice: null,
    slOrderId: "STOP__RG1",
    tp1OrderId: "TP1__RG1",
  });
  const outboxes = buildDeliveredOutboxes({
    positionCycle: base.positionCycle,
    transitions: [tp1Transition],
    projection: tp1.nextProjection,
  });
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    protectionRuntime,
    exchangeState: {
      has_active_position: false,
    },
  });

  return {
    label: "TP_FULL_EXIT_PASS",
    positionCycle: base.positionCycle,
    transitions: [tp1Transition],
    projection: tp1.nextProjection,
    protectionRuntime,
    outboxes,
    watchdog,
  };
}

function buildReferenceSlEpisode() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__SL1",
    entryOrderId: "ORDER__BTC__SL1",
    entryFillGroupId: "FILL_GROUP__BTC__SL1",
    entryIntentId: "EINTV2__btc_sl1",
    signalIntentId: "SIGINTV2__btc_sl1",
    openclawDecisionId: "OCDV2__btc_sl1",
    positionSide: "LONG",
    entryPrice: 70000,
    entryQtyAbs: 0.02,
  });
  const sl = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "STOP_EXIT_CONFIRMED",
      sourceFillId: "FILL__SL__BTC__1",
      sourceOrderId: "ORDER__SL__BTC__1",
      fillPrice: 69419,
    },
  });
  const slTransition = withExchangeEvidence(sl.transition, "STOP_EXIT", {
    execution_type: "TRADE",
    order_type: "STOP_MARKET",
    fill_price: 69419,
    stop_price: 69419,
    full_exit: true,
    position_amt_after: "0",
  });
  const outboxes = buildDeliveredOutboxes({
    positionCycle: base.positionCycle,
    transitions: [slTransition],
    projection: sl.nextProjection,
  });
  const protectionRuntime = buildTerminalProtectionRuntime({
    positionCycleId: base.positionCycle.position_cycle_id,
    transition: slTransition,
    nativeStopPrice: 69419,
    slOrderId: "STOP__BTC__SL1",
    tp1OrderId: "TP1__BTC__SL1",
  });
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: sl.nextProjection,
    protectionRuntime,
    exchangeState: { has_active_position: false },
  });

  return {
    label: "SL_EXIT_PASS",
    positionCycle: base.positionCycle,
    transitions: [slTransition],
    projection: sl.nextProjection,
    protectionRuntime,
    outboxes,
    watchdog,
  };
}

function buildReferenceExternalCloseEpisode() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    entryEventId: "ENTRY__BNB__EXT1",
    entryOrderId: "ORDER__BNB__EXT1",
    entryFillGroupId: "FILL_GROUP__BNB__EXT1",
    entryIntentId: "EINTV2__bnb_ext1",
    signalIntentId: "SIGINTV2__bnb_ext1",
    openclawDecisionId: "OCDV2__bnb_ext1",
    positionSide: "LONG",
    entryPrice: 600,
    entryQtyAbs: 2,
  });
  const external = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "EXTERNAL_CLOSE_CONFIRMED",
      sourceFillId: "FILL__EXTERNAL__BNB__1",
      sourceOrderId: "ORDER__EXTERNAL__BNB__1",
      fillPrice: 608,
    },
  });
  const externalTransition = withExchangeEvidence(external.transition, "EXTERNAL_CLOSE", {
    execution_type: "ACCOUNT_SYNC",
    fill_price: 608,
    full_exit: true,
    position_amt_after: "0",
  });
  const outboxes = buildDeliveredOutboxes({
    positionCycle: base.positionCycle,
    transitions: [externalTransition],
    projection: external.nextProjection,
  });
  const protectionRuntime = buildTerminalProtectionRuntime({
    positionCycleId: base.positionCycle.position_cycle_id,
    transition: externalTransition,
    nativeStopPrice: null,
    slOrderId: "STOP__BNB__EXT1",
    tp1OrderId: "TP1__BNB__EXT1",
  });
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: external.nextProjection,
    protectionRuntime,
    exchangeState: { has_active_position: false },
  });

  return {
    label: "EXTERNAL_CLOSE_PASS",
    positionCycle: base.positionCycle,
    transitions: [externalTransition],
    projection: external.nextProjection,
    protectionRuntime,
    outboxes,
    watchdog,
  };
}

function buildReferenceManualCloseEpisode() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    entryEventId: "ENTRY__XRP__MAN1",
    entryOrderId: "ORDER__XRP__MAN1",
    entryFillGroupId: "FILL_GROUP__XRP__MAN1",
    entryIntentId: "EINTV2__xrp_man1",
    signalIntentId: "SIGINTV2__xrp_man1",
    openclawDecisionId: "OCDV2__xrp_man1",
    positionSide: "LONG",
    entryPrice: 0.5,
    entryQtyAbs: 2000,
  });
  const manual = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "MANUAL_CLOSE_CONFIRMED",
      sourceFillId: "FILL__MANUAL__XRP__1",
      sourceOrderId: "ORDER__MANUAL__XRP__1",
      fillPrice: 0.512,
    },
  });
  const manualTransition = withExchangeEvidence(manual.transition, "MANUAL_CLOSE", {
    execution_type: "ACCOUNT_SYNC",
    fill_price: 0.512,
    full_exit: true,
    position_amt_after: "0",
  });
  const transitions = [manualTransition];
  const outboxes = buildDeliveredOutboxes({
    positionCycle: base.positionCycle,
    transitions,
    projection: manual.nextProjection,
  });
  const protectionRuntime = buildTerminalProtectionRuntime({
    positionCycleId: base.positionCycle.position_cycle_id,
    transition: manualTransition,
    nativeStopPrice: 0.49175,
    slOrderId: "STOP__XRP__MAN1",
    tp1OrderId: "TP1__XRP__MAN1",
  });
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: manual.nextProjection,
    protectionRuntime,
    exchangeState: { has_active_position: false },
  });

  return {
    label: "MANUAL_CLOSE_PASS",
    positionCycle: base.positionCycle,
    transitions,
    projection: manual.nextProjection,
    protectionRuntime,
    outboxes,
    watchdog,
  };
}

function buildReferenceNativeMlEvidencePack() {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__NATIVE__1",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.78,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "native path replay evidence pack",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.74,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v1",
    featureValues: {
      trend_bias: 0.74,
      volatility_rank: 0.46,
      volume_impulse: 0.63,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
    },
    proposalVerdict: "PASS",
    rankScore: 0.77,
    sizeRatio: 0.5,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_native_replay_v1",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "native replay evidence complete",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "ETHUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: {
      htf_regime: { regime: "LONG", alignment_score: 0.94 },
      setup_gate: { setup_type: "PULLBACK_RECLAIM", setup_quality_score: 0.92 },
      trigger_gate: { trigger_confirmed: true, volume_zscore: 2.1, rsi_entry_tf: 65 },
      no_trade_gate: { market_quality_score: 1, spread_bps: 2, mark_index_gap_bps: 1, funding_penalty_bps: 1 },
      expected_edge_gate: { expected_gross_r: 2.2, expected_net_r_after_cost: 0.5, cost_estimate_bps: 5, cost_r_equivalent: 1.7 },
      feature_snapshot_contract: { btc_1h_trend: "LONG", mtf_1h_direction: "LONG" },
    },
  });
}

function buildReferenceReplayFixtureSet(profile = "REFERENCE_PASS") {
  const normalized = String(profile || "").trim().toUpperCase() || "REFERENCE_PASS";
  const passEpisodes = [
    buildReferencePassEpisode(),
    buildReferenceSlEpisode(),
    buildReferenceExternalCloseEpisode(),
    buildReferenceManualCloseEpisode(),
  ];
  if (normalized === "REFERENCE_PASS") {
    return Object.freeze({
      episodes: passEpisodes,
    });
  }
  if (normalized === "REFERENCE_NATIVE_PASS") {
    const evidence = buildReferenceNativeMlEvidencePack();
    return Object.freeze({
      episodes: [{
        ...passEpisodes[0],
        label: "NATIVE_COMPLETE",
        signalIntent: evidence.signalIntent,
        featureSnapshot: evidence.featureSnapshot,
        mlAiSignalProposal: evidence.mlAiSignalProposal,
        mlAiEvidence: evidence.mlAiEvidence,
        openclawDecision: evidence.openclawDecision,
      }, ...passEpisodes.slice(1)],
    });
  }
  if (normalized === "REFERENCE_BLOCKED") {
    return Object.freeze({
      episodes: [{
        ...passEpisodes[0],
        label: "WATCHDOG_FAIL",
        watchdog: {
          issueCodes: ["NATIVE_REFRESH_UNHEALTHY"],
          repairRequests: [],
        },
      }, ...passEpisodes.slice(1)],
    });
  }
  throw new Error(`V2_REPLAY_FIXTURE_PROFILE_INVALID:${normalized}`);
}

module.exports = {
  buildReferencePassEpisode,
  buildReferenceSlEpisode,
  buildReferenceExternalCloseEpisode,
  buildReferenceManualCloseEpisode,
  buildReferenceNativeMlEvidencePack,
  buildReferenceReplayFixtureSet,
};
