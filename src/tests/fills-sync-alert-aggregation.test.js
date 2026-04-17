"use strict";

const assert = require("assert");
const { __test: fillsSyncTest } = require("../services/binanceFuturesFillsSync");
const { __test: alertTest } = require("../services/tradeExecutionAlert");

function approxEqual(actual, expected, epsilon = 1e-9) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

async function run() {
  const rescueExitRules = fillsSyncTest.resolveAlertExitRules({
    position: {
      meta: {
        openclaw_market_regime_cohort: "RESCUE",
        exit_rules_override: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      },
    },
  }, { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 });
  assert.ok(approxEqual(rescueExitRules.TP_P1, 0.0165), "rescue cohort alert must use current TP1");
  assert.ok(approxEqual(rescueExitRules.TRAIL_R_MULTIPLE, 0.6), "rescue cohort alert must use current trailing R");
  assert.ok(approxEqual(rescueExitRules.RUNNER_MIN_PROFIT_PCT, 0.0165), "rescue cohort alert must honor minimum Binance runner floor");
  assert.ok(approxEqual(rescueExitRules.BE_PCT, 0.0015), "rescue cohort alert must use current BE");
  assert.strictEqual(
    fillsSyncTest.normalizeExitEventForRules("EXIT_TP_P1_3.25P", rescueExitRules),
    "EXIT_TP_P1_1.65P",
    "legacy TP1 event label must be normalized to current cohort rule"
  );

  const firstCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: { qty_fraction: 0.5 },
    qtyScale: { ratio: 0.394 },
  });
  const secondCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: { qty_fraction: 0.5 },
    qtyScale: { ratio: 0.606 },
  });

  assert.ok(approxEqual(firstCloseRatio, 0.197), "first split close ratio must be scaled from intent qty_fraction");
  assert.ok(approxEqual(secondCloseRatio, 0.303), "second split close ratio must be scaled from intent qty_fraction");
  assert.strictEqual(
    fillsSyncTest.resolveFillSyncAlertFullExit({
      event: "EXIT_TP_P1_3.25P",
      orderMeta: { closePosition: false },
      closeRatio: firstCloseRatio,
    }),
    false,
    "TP1 must not be classified as full exit"
  );
  assert.strictEqual(
    fillsSyncTest.resolveFillSyncAlertFullExit({
      event: "EXIT_TRAIL",
      orderMeta: { closePosition: false },
      closeRatio: 0.375,
    }),
    false,
    "partial trailing fills must not be classified as full exit"
  );
  assert.strictEqual(
    fillsSyncTest.resolveFillSyncAlertFullExit({
      event: "EXIT_TRAIL",
      orderMeta: { closePosition: false },
      closeRatio: 1,
    }),
    true,
    "trailing fills may be classified as full exit only when the close ratio proves it"
  );

  const batches = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(batches, {
    symbol: "XRPUSDT",
    event: "EXIT_TP_P1_3.25P",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 99123, clientOrderId: "fut_xrp_tp1" },
    tradeMs: 1_777_777_001_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      event: "EXIT_TP_P1_3.25P",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 158.49,
      execPrice: 1.395,
      canonicalExitEvent: "EXIT_TP_P1_3.25P",
      canonicalExitStage: "TP1",
      canonicalTransitionEvent: "TP1_REACHED",
      canonicalTransitionEvents: ["TP1_REACHED", "TRAIL_ACTIVE"],
      closeRatio: firstCloseRatio,
      fullExit: false,
      realizedPnl: 2.511,
      positionSideBefore: "LONG",
      positionSideAfter: null,
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_PCT: 0.01, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__XRPUSDT",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(batches, {
    symbol: "XRPUSDT",
    event: "EXIT_TP_P1_3.25P",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 99123, clientOrderId: "fut_xrp_tp1" },
    tradeMs: 1_777_777_001_100,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      event: "EXIT_TP_P1_3.25P",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 243.88,
      execPrice: 1.395,
      canonicalExitEvent: "EXIT_TP_P1_3.25P",
      canonicalExitStage: "TP1",
      canonicalTransitionEvent: "TP1_REACHED",
      canonicalTransitionEvents: ["TP1_REACHED", "TRAIL_ACTIVE"],
      closeRatio: secondCloseRatio,
      fullExit: false,
      realizedPnl: 3.863,
      positionSideBefore: "LONG",
      positionSideAfter: null,
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_PCT: 0.01, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__XRPUSDT",
    },
  });

  assert.strictEqual(batches.size, 1, "split fills from the same TP1 order must be aggregated into one alert");
  const merged = Array.from(batches.values())[0];
  assert.ok(approxEqual(merged.payload.notional, 402.37), "aggregated notional must be summed");
  assert.ok(approxEqual(merged.payload.realizedPnl, 6.374), "aggregated pnl must be summed");
  assert.ok(approxEqual(merged.payload.closeRatio, 0.5), "aggregated close ratio must represent 50% TP1");
  assert.strictEqual(merged.payload.fullExit, false, "aggregated TP1 alert must remain partial");
  assert.strictEqual(merged.payload.closeRatioAggregation, "SUM", "scaled split TP1 must sum close ratio");

  const trailTransitionCooldownKey = fillsSyncTest.buildFillSyncAlertCooldownKey({
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 7711, clientOrderId: "trail_eth" },
    payload: {
      symbol: "ETHUSDT",
      event: "EXIT_TRAIL",
      intent: "EXIT",
      side: "SELL",
      canonicalExitEvent: "EXIT_TRAIL",
      canonicalTransitionEvent: "TRAIL_PARTIAL",
      canonicalTransitionEvents: ["TRAIL_PARTIAL"],
    },
  });
  const trailFinalCooldownKey = fillsSyncTest.buildFillSyncAlertCooldownKey({
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 7711, clientOrderId: "trail_eth" },
    payload: {
      symbol: "ETHUSDT",
      event: "EXIT_TRAIL",
      intent: "EXIT",
      side: "SELL",
      canonicalExitEvent: "EXIT_TRAIL",
      canonicalTransitionEvent: "TRAIL_FINAL_EXIT",
      canonicalTransitionEvents: ["TRAIL_FINAL_EXIT"],
    },
  });
  assert.notStrictEqual(
    trailTransitionCooldownKey,
    trailFinalCooldownKey,
    "trailing partial/final alerts must use distinct cooldown identities"
  );

  const trailingBatches = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(trailingBatches, {
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 7711, clientOrderId: "trail_eth" },
    tradeMs: 1_777_777_201_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_TRAIL",
      side: "SELL",
      intent: "EXIT",
      canonicalExitEvent: "EXIT_TRAIL",
      canonicalExitStage: "TRAIL",
      canonicalTransitionEvent: "TRAIL_PARTIAL",
      canonicalTransitionEvents: ["TRAIL_PARTIAL"],
      closeRatio: 0.1,
      fullExit: false,
      positionSideBefore: "LONG",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(trailingBatches, {
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 7711, clientOrderId: "trail_eth" },
    tradeMs: 1_777_777_201_200,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_TRAIL",
      side: "SELL",
      intent: "EXIT",
      canonicalExitEvent: "EXIT_TRAIL",
      canonicalExitStage: "TRAIL",
      canonicalTransitionEvent: "TRAIL_FINAL_EXIT",
      canonicalTransitionEvents: ["TRAIL_FINAL_EXIT"],
      closeRatio: 0.275,
      fullExit: true,
      positionSideBefore: "LONG",
    },
  });
  assert.strictEqual(
    trailingBatches.size,
    2,
    "TRAIL_PARTIAL and TRAIL_FINAL_EXIT must not collapse into one fill-sync batch"
  );

  const nativeTp0CloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P0_0.8P",
    intent: null,
    qtyScale: { ratio: null },
    execQtyBase: 24.595,
    positionCtx: {
      qtyBase: 98.38,
      nativeProtectionTp0QtyBase: 24.595,
      nativeProtectionTp0QtyRatio: 0.25,
    },
    rules: { TP_P0_QTY: 0.25 },
  });
  assert.ok(approxEqual(nativeTp0CloseRatio, 0.25), "native TP0 close ratio must use TP0 quantity metadata");

  const missingTp0MetaCloseRatioInfo = fillsSyncTest.resolveFillSyncAlertCloseRatioInfo({
    event: "EXIT_TP_P0_0.8P",
    intent: null,
    qtyScale: { ratio: null, qtyPct: null, mode: "NO_INTENT_QTY" },
    execQtyBase: 0.342,
    positionCtx: { qtyBase: 0.344 },
    rules: { TP_P0_QTY: 0.25 },
  });
  assert.ok(
    approxEqual(missingTp0MetaCloseRatioInfo.closeRatio, 0.25),
    "TP0 without reliable qty metadata must fall back to the contract TP0 quantity"
  );
  assert.strictEqual(
    missingTp0MetaCloseRatioInfo.aggregation,
    "MAX",
    "TP0 contract fallback must not sum split fills into an oversized ratio"
  );
  assert.strictEqual(
    missingTp0MetaCloseRatioInfo.source,
    "CONTRACT_TP0_QTY_FALLBACK",
    "TP0 contract fallback source must be explicit for auditability"
  );

  assert.strictEqual(
    fillsSyncTest.normalizeExitEventForRules("EXIT_TP_P0_0.8P", rescueExitRules),
    "EXIT_TP_P1_1.65P",
    "legacy TP0 raw evidence must normalize to canonical TP1 under current rules"
  );

  const nativeTpCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: null,
    qtyScale: { ratio: null },
    execQtyBase: 49.19,
    positionCtx: {
      qtyBase: 49.19,
      nativeProtectionTpQtyBase: 49.19,
      nativeProtectionTpQtyRatio: 0.5,
    },
  });
  assert.ok(approxEqual(nativeTpCloseRatio, 0.5), "native TP1 close ratio must prefer native TP quantity metadata");

  const partialTp1CloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_1.65P",
    intent: { qty_fraction: 1 },
    qtyScale: { qtyPct: 0.5, ratio: 0.5 },
    execQtyBase: 365.5,
    positionCtx: {
      qtyBase: 731,
      nativeProtectionTpQtyBase: 365.5,
      nativeProtectionTpQtyRatio: 0.5,
    },
  });
  assert.ok(
    approxEqual(partialTp1CloseRatio, 0.5),
    "TP1 alert close ratio must prefer synced/native partial size over stale full intent fraction"
  );

  const ethLikeCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: null,
    qtyScale: { ratio: null },
    execQtyBase: 0.165,
    positionCtx: {
      qtyBase: 0.166,
      nativeProtectionTpQtyBase: 0.165,
      nativeProtectionTpQtyRatio: 0.4984894259818731,
    },
  });
  assert.ok(
    approxEqual(ethLikeCloseRatio, 0.4984894259818731),
    "ETH-like TP1 sync must not treat current remaining qty as the close ratio denominator"
  );

  const missingTpMetaCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: null,
    qtyScale: { ratio: null },
    execQtyBase: 0.165,
    positionCtx: { qtyBase: 0.166 },
    rules: { TP_P1_QTY: 0.5 },
  });
  assert.ok(
    approxEqual(missingTpMetaCloseRatio, 0.5),
    "TP1 without reliable intent/native metadata must fall back to the contract remaining quantity"
  );

  const tp1HintedMeta = fillsSyncTest.buildStageHintedMeta(
    { tp_p0_done: false, tp_p1_done: false, trail_active: false, tp_p1_pending: true },
    "EXIT_TP_P1_1.65P",
    { time: 1_777_777_000_000, price: 2276.75 }
  );
  assert.strictEqual(tp1HintedMeta.tp_p0_done, true, "TP1 stage hint must imply TP0 done");
  assert.strictEqual(tp1HintedMeta.tp_p1_done, true, "TP1 stage hint must promote TP1 done");
  assert.strictEqual(tp1HintedMeta.trail_active, true, "TP1 stage hint must immediately arm trailing state");
  assert.strictEqual(tp1HintedMeta.tp_p1_pending, false, "TP1 stage hint must clear pending TP1");

  const repeatedTp1HintedMeta = fillsSyncTest.buildStageHintedMeta(
    {
      tp_p0_done: true,
      tp_p1_done: true,
      trail_active: true,
      tp_p1_price: 2276.75,
      tp_p1_at: "2026-04-13T22:07:04.040Z",
      tp_p1_bar_ms: 1_777_777_000_000,
    },
    "EXIT_TP_P1_1.65P",
    { time: 1_777_778_000_000, price: 2330.94 }
  );
  assert.strictEqual(repeatedTp1HintedMeta.tp_p1_price, 2276.75, "repeated post-TP1 fills must not overwrite the original TP1 price");
  assert.strictEqual(repeatedTp1HintedMeta.tp_p1_at, "2026-04-13T22:07:04.040Z", "repeated post-TP1 fills must not overwrite the original TP1 time");
  assert.strictEqual(repeatedTp1HintedMeta.tp_p1_bar_ms, 1_777_777_000_000, "repeated post-TP1 fills must not overwrite the original TP1 bar timestamp");

  const canonicalTrail = fillsSyncTest.resolveCanonicalExternalExitEvent({
    authorityMap: new Map(),
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    entryEventId: "ENTRY__ETH",
    orderMeta: { orderId: 12345 },
    positionCtx: { tpP0Done: true, tpP1Done: true, trailActive: true },
    recentTp1: { event: "EXIT_TP_P1_1.65P" },
    rules: { TP_P0: 0.008, TP_P1: 0.0165, TP_P0_QTY: 0.25, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6 },
  });
  assert.strictEqual(canonicalTrail.stage, "TRAIL", "post-TP1 fills must be canonically locked to TRAIL");
  assert.strictEqual(canonicalTrail.event, "EXIT_TRAIL", "post-TP1 fills must emit trail event only");

  const batchesAfterTp1 = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(batchesAfterTp1, {
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 12345, clientOrderId: "fut_eth_runner" },
    tradeMs: 1_777_778_000_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_TRAIL",
      canonicalExitStage: "TRAIL",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 100,
      execPrice: 2330.94,
      closeRatio: 0.188,
      closeRatioAggregation: "SUM",
      fullExit: false,
      realizedPnl: 12.16,
      positionSideBefore: "LONG",
      exitRules: { TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6 },
      entryEventId: "ENTRY__ETH",
      classificationVerified: true,
      alertStageHintTp0Done: true,
      alertStageHintTp1Done: true,
      alertStageHintTrailActive: true,
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(batchesAfterTp1, {
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 12345, clientOrderId: "fut_eth_runner" },
    tradeMs: 1_777_778_000_100,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P1_1.65P",
      canonicalExitStage: "TRAIL",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 120,
      execPrice: 2331.12,
      closeRatio: 0.188,
      closeRatioAggregation: "SUM",
      fullExit: false,
      realizedPnl: 12.4,
      positionSideBefore: "LONG",
      exitRules: { TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6 },
      entryEventId: "ENTRY__ETH",
      classificationVerified: true,
      alertStageHintTp0Done: true,
      alertStageHintTp1Done: true,
      alertStageHintTrailActive: true,
    },
  });
  const mergedAfterTp1 = Array.from(batchesAfterTp1.values())[0];
  assert.strictEqual(mergedAfterTp1.payload.event, "EXIT_TRAIL", "batch merge must preserve TRAIL once canonical stage is locked");
  assert.strictEqual(
    fillsSyncTest.buildFillSyncAlertCooldownKey({
      symbol: "ETHUSDT",
      event: "EXIT_TP_P1_1.65P",
      intent: "EXIT",
      side: "SELL",
      orderMeta: { orderId: 12345, clientOrderId: "fut_eth_runner" },
      payload: {
        canonicalExitEvent: "EXIT_TRAIL",
        canonicalTransitionEvent: "TRAIL_PARTIAL",
        canonicalTransitionEvents: ["TRAIL_PARTIAL"],
      },
    }).includes("TRANSITION::TRAIL_PARTIAL"),
    true,
    "alert identity keys must follow canonical transition identity"
  );

  const mergedHintedMeta = fillsSyncTest.mergeRecentExitHintsIntoMeta(
    { tp_p0_done: false, tp_p1_done: false, trail_active: false },
    {
      recentTp0: { event: "EXIT_TP_P0_0.8P" },
      recentTp1: { event: "EXIT_TP_P1_1.65P" },
      recentTrail: null,
    }
  );
  assert.strictEqual(mergedHintedMeta.tp_p0_done, true, "recent TP0 hint must survive across sync runs");
  assert.strictEqual(mergedHintedMeta.tp_p1_done, true, "recent TP1 hint must survive across sync runs");
  assert.strictEqual(mergedHintedMeta.trail_active, true, "recent TP1 hint must re-arm trailing refresh");

  const tinyResidual = fillsSyncTest.resolveTinyResidualCloseDecision({
    position: {
      symbol: "SOLUSDT",
      positionAmt: "-0.01",
      markPrice: "81.97",
    },
    exchangeInfo: {
      minQty: 0.01,
      minNotional: 5,
      stepSize: 0.01,
    },
  });
  assert.strictEqual(tinyResidual.shouldClose, true, "minQty-sized residual must be force-closed");
  assert.strictEqual(tinyResidual.side, "BUY");
  assert.ok(approxEqual(tinyResidual.qty, 0.01), "dust close must preserve exchange step size");

  const normalResidual = fillsSyncTest.resolveTinyResidualCloseDecision({
    position: {
      symbol: "ETHUSDT",
      positionAmt: "0.25",
      markPrice: "2150",
    },
    exchangeInfo: {
      minQty: 0.001,
      minNotional: 5,
      stepSize: 0.001,
    },
  });
  assert.strictEqual(normalResidual.shouldClose, false, "normal residual must not be force-closed by fills sync");

  const msg = alertTest.buildMessage(merged.payload);
  assert.ok(msg, "aggregated TP1 alert message must be buildable");
  assert.strictEqual(msg.title, "XRPUSDT TP1_3.25 50% 청산");
  assert.ok(msg.body.includes("종류: 익절(TP1) 3.25%"), "TP1 label must be preserved");
  assert.ok(msg.body.includes("청산규모: 402.37 USDT"), "aggregated notional must be visible");

  const repeatedContractRatioBatches = new Map();
  for (const [tradeMs, notional, realizedPnl] of [
    [1_777_910_000_000, 15.1, 0.12],
    [1_777_910_000_100, 293.0, 2.1],
    [1_777_910_000_200, 187.69, 1.54],
  ]) {
    fillsSyncTest.queueFillSyncAlertBatch(repeatedContractRatioBatches, {
      symbol: "BNBUSDT",
      event: "EXIT_TP_P0_0.8P",
      intent: "EXIT",
      side: "SELL",
      orderMeta: { orderId: 88629471310, clientOrderId: "fut_bnb_tp0" },
      tradeMs,
      payload: {
        exchange: "BINANCEFUT",
        symbol: "BNBUSDT",
        event: "EXIT_TP_P0_0.8P",
        side: "SELL",
        intent: "EXIT",
        executionMode: "LIVE",
        notional,
        execPrice: 606.2,
        closeRatio: 0.25,
        closeRatioAggregation: "MAX",
        fullExit: false,
        realizedPnl,
        positionSideBefore: "LONG",
        positionSideAfter: null,
        appliedLeverage: 2,
        leverageReason: "BINANCE_USER_TRADES_SYNC",
        exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_PCT: 0.01, BE_PCT: 0.0015 },
        runId: "FILL_SYNC__BNBUSDT",
      },
    });
  }
  assert.strictEqual(repeatedContractRatioBatches.size, 1, "same TP0 order split fills must collapse into one alert");
  const repeatedContractRatioMerged = Array.from(repeatedContractRatioBatches.values())[0];
  assert.ok(approxEqual(repeatedContractRatioMerged.payload.notional, 495.79), "split TP0 notional must still sum");
  assert.ok(approxEqual(repeatedContractRatioMerged.payload.realizedPnl, 3.76), "split TP0 pnl must still sum");
  assert.ok(approxEqual(repeatedContractRatioMerged.payload.closeRatio, 0.25), "repeated TP0 order contract ratio must not over-sum across split fills");
  assert.strictEqual(repeatedContractRatioMerged.payload.closeRatioAggregation, "MAX", "repeated TP0 contract ratio must use MAX merge");

  const repeatedTp1ContractRatioBatches = new Map();
  for (const [tradeMs, notional, realizedPnl] of [
    [1_777_920_000_000, 112.38, 1.12],
    [1_777_920_000_050, 7.32, 0.09],
  ]) {
    fillsSyncTest.queueFillSyncAlertBatch(repeatedTp1ContractRatioBatches, {
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P1_1.65P",
      intent: "EXIT",
      side: "SELL",
      orderMeta: { orderId: 96030000001, clientOrderId: "fut_doge_tp1" },
      tradeMs,
      payload: {
        exchange: "BINANCEFUT",
        symbol: "DOGEUSDT",
        event: "EXIT_TP_P1_1.65P",
        side: "SELL",
        intent: "EXIT",
        executionMode: "LIVE",
        notional,
        execPrice: 0.095,
        closeRatio: 0.5,
        closeRatioAggregation: "MAX",
        fullExit: false,
        realizedPnl,
        positionSideBefore: "LONG",
        positionSideAfter: null,
        appliedLeverage: 2,
        leverageReason: "BINANCE_USER_TRADES_SYNC",
        exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_PCT: 0.01, BE_PCT: 0.0015 },
        runId: "FILL_SYNC__DOGEUSDT",
      },
    });
  }
  const repeatedTp1ContractRatioMerged = Array.from(repeatedTp1ContractRatioBatches.values())[0];
  assert.ok(approxEqual(repeatedTp1ContractRatioMerged.payload.closeRatio, 0.5), "repeated TP1 order contract ratio must remain 50%");
  assert.strictEqual(repeatedTp1ContractRatioMerged.payload.fullExit, false, "repeated TP1 order contract ratio must not become full exit");

  const oppositeBatches = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(oppositeBatches, {
    symbol: "BTCUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 1001, clientOrderId: "first_partial" },
    tradeMs: 1_777_888_100_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 535.82,
      execPrice: 66977.2,
      closeRatio: 0.5,
      fullExit: true,
      realizedPnl: -0.062,
      positionSideBefore: "SHORT",
      entryEventId: "BINANCEFUT|BTCUSDT|15m|1775372400000|SHORT|SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__BTCUSDT",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(oppositeBatches, {
    symbol: "BTCUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 1002, clientOrderId: "second_partial" },
    tradeMs: 1_777_888_100_200,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 267.92,
      execPrice: 66979.6,
      closeRatio: 0.25,
      fullExit: true,
      realizedPnl: -0.041,
      positionSideBefore: "SHORT",
      entryEventId: "BINANCEFUT|BTCUSDT|15m|1775372400000|SHORT|SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__BTCUSDT",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(oppositeBatches, {
    symbol: "BTCUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 1003, clientOrderId: "third_partial" },
    tradeMs: 1_777_888_100_350,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 267.92,
      execPrice: 66979.6,
      closeRatio: 0.25,
      fullExit: true,
      realizedPnl: -0.041,
      positionSideBefore: "SHORT",
      entryEventId: "BINANCEFUT|BTCUSDT|15m|1775372400000|SHORT|SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__BTCUSDT",
    },
  });

  assert.strictEqual(oppositeBatches.size, 1, "split opposite-signal fills from the same entry must be aggregated into one alert");
  const mergedOpposite = Array.from(oppositeBatches.values())[0];
  assert.ok(approxEqual(mergedOpposite.payload.notional, 1071.66), "aggregated opposite close notional must be summed");
  assert.ok(approxEqual(mergedOpposite.payload.realizedPnl, -0.144), "aggregated opposite close pnl must be summed");
  assert.ok(approxEqual(mergedOpposite.payload.closeRatio, 1), "aggregated opposite close ratio must clamp to full exit");
  assert.strictEqual(mergedOpposite.payload.fullExit, true, "aggregated opposite close must remain full exit");

  const rescueTrailMsg = alertTest.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    canonicalExitEvent: "EXIT_TRAIL",
    canonicalExitStage: "TRAIL",
    canonicalTransitionEvent: "TRAIL_FINAL_EXIT",
    canonicalTransitionEvents: ["TRAIL_FINAL_EXIT"],
    side: "BUY",
    intent: "EXIT",
    executionMode: "LIVE",
    notional: 743.89,
    execPrice: 2038.06,
    fullExit: true,
    realizedPnl: 5.92,
    positionSideBefore: "SHORT",
    positionSideAfter: null,
    appliedLeverage: 2,
    leverageReason: "BINANCE_USER_TRADES_SYNC",
    features: { openclaw_market_regime_cohort: "RESCUE" },
    exitRules: rescueExitRules,
  });
  assert.ok(rescueTrailMsg.body.includes("실행계약: TRAIL"), "trail alert must show executed contract separately");
  assert.ok(rescueTrailMsg.body.includes("전략계약: SL_1.65 / TP1_1.65 / TRAIL_0.6R / RUNNER_MIN_1.65 / BE_0.15"), "trail alert must reflect current rescue cohort rules under strategy label");

  const sameOrderAsRecentTp1 = fillsSyncTest.isSameOrderAsRecentTp1(
    { orderId: 14608292413, clientOrderId: "dbj_same_order" },
    { orderId: 14608292413, clientOrderId: "dbj_other", event: "EXIT_TP_P1_3.25P" }
  );
  assert.strictEqual(sameOrderAsRecentTp1, true, "same order id must be recognized as the same TP1 order");

  const sameOrderEvent = await fillsSyncTest.resolveExternalExitEvent({
    intent: null,
    trade: { realizedPnl: 9.792, time: 1_777_810_631_082, symbol: "AXSUSDT" },
    orderMeta: {
      orderId: 14608292413,
      clientOrderId: "dbj_same_order",
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      trailActive: true,
    },
    recentTp1: {
      orderId: 14608292413,
      clientOrderId: "dbj_same_order",
      event: "EXIT_TP_P1_3.25P",
      tradeMs: 1_777_810_631_082,
    },
    rules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_PCT: 0.01, BE_PCT: 0.0025 },
  });
  assert.strictEqual(
    sameOrderEvent,
    "EXIT_TP_P1_3.25P",
    "split fills from the same triggered TP1 order must stay classified as TP1, not TRAIL"
  );

  const postFillRemainingAwareTp0 = await fillsSyncTest.resolveExternalExitEvent({
    intent: null,
    trade: { realizedPnl: 2.1, qty: 0.228, time: 1_777_777_777_000, symbol: "ETHUSDT" },
    orderMeta: {
      orderId: 12345001,
      clientOrderId: "eth_tp0_ambiguous",
      orderType: "TAKE_PROFIT",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      qtyBase: 0.686,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
    },
    recentTp1: null,
    recentTp0: null,
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5 },
    qtyPct: null,
  });
  assert.strictEqual(
    postFillRemainingAwareTp0,
    "EXIT_TP_P1_1.65P",
    "post-fill remaining-aware inference must map legacy TP0 evidence into canonical TP1"
  );

  const postFillRemainingAwareTp1 = await fillsSyncTest.resolveExternalExitEvent({
    intent: null,
    trade: { realizedPnl: 7.209, qty: 0.342, time: 1_777_777_888_000, symbol: "ETHUSDT" },
    orderMeta: {
      orderId: 12345002,
      clientOrderId: "eth_tp1_ambiguous",
      orderType: "TAKE_PROFIT",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      qtyBase: 0.344,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
    },
    recentTp1: null,
    recentTp0: null,
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5 },
    qtyPct: null,
  });
  assert.strictEqual(
    postFillRemainingAwareTp1,
    "EXIT_TP_P1_1.65P",
    "post-fill remaining-aware inference must reclassify ETH-like oversized TP0 alerts to TP1"
  );

  const activeExitStageBackstop = fillsSyncTest.applyActiveExitStageBackstopOverride({
    event: "EXIT_TP_P0_0.8P",
    trade: { qty: 698 },
    orderMeta: {
      orderId: 14728630395,
      clientOrderId: "dbj_axs_tp1_split",
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      qtyBase: 699,
      tpP0Done: true,
      tpP1Done: false,
      trailActive: false,
    },
    recentTp1: null,
    recentTp0: { event: "EXIT_TP_P0_0.8P" },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5 },
    qtyPct: null,
  });
  assert.strictEqual(
    activeExitStageBackstop,
    "EXIT_TP_P1_1.65P",
    "active stage backstop must promote repeated TP0 classifications to TP1 once TP0 is already done"
  );

  const tp0AfterTp1MustTrail = fillsSyncTest.applyActiveExitStageBackstopOverride({
    event: "EXIT_TP_P0_0.8P",
    trade: { qty: 0.167 },
    orderMeta: {
      orderId: 8389766154752959000,
      clientOrderId: "dbj_eth_runner_reduce",
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      qtyBase: 0.334,
      tpP0Done: true,
      tpP1Done: true,
      trailActive: true,
    },
    recentTp1: { event: "EXIT_TP_P1_1.65P" },
    recentTp0: { event: "EXIT_TP_P0_0.8P" },
    recentTrail: null,
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6 },
    qtyPct: null,
  });
  assert.strictEqual(
    tp0AfterTp1MustTrail,
    "EXIT_TRAIL",
    "once TP1 is done, any later TP0-like runner reduction must be forced into trail stage"
  );

  const repeatedTp1AfterTrailMustStayTrail = fillsSyncTest.applyActiveExitStageBackstopOverride({
    event: "EXIT_TP_P1_1.65P",
    trade: { qty: 0.167 },
    orderMeta: {
      orderId: 8389766154752959000,
      clientOrderId: "dbj_eth_runner_reduce",
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      qtyBase: 0.167,
      tpP0Done: true,
      tpP1Done: true,
      trailActive: true,
    },
    recentTp1: { event: "EXIT_TP_P1_1.65P" },
    recentTp0: { event: "EXIT_TP_P0_0.8P" },
    recentTrail: { event: "EXIT_TRAIL" },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6 },
    qtyPct: null,
  });
  assert.strictEqual(
    repeatedTp1AfterTrailMustStayTrail,
    "EXIT_TRAIL",
    "once trailing is active, repeated TP1 labels must be force-canonicalized to trail"
  );

  const firstStageTp0Preserved = fillsSyncTest.applyActiveExitStageBackstopOverride({
    event: "EXIT_TP_P0_0.8P",
    trade: { qty: 0.085 },
    orderMeta: {
      orderId: 12345003,
      clientOrderId: "eth_tp0_real",
      orderType: "TAKE_PROFIT",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      qtyBase: 0.686,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
    },
    recentTp1: null,
    recentTp0: null,
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5 },
    qtyPct: null,
  });
  assert.strictEqual(
    firstStageTp0Preserved,
    "EXIT_TP_P0_0.8P",
    "active stage backstop must preserve genuine first-stage TP0 exits"
  );

  const sentPayloads = [];
  const crossRunBatches1 = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(crossRunBatches1, {
    symbol: "DOGEUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 96035243539, clientOrderId: "doge_tp1_same_order" },
    tradeMs: 1_777_900_000_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P1_1.65P",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 119.7,
      execPrice: 0.095,
      closeRatio: 0.49,
      fullExit: false,
      realizedPnl: 1.499,
      positionSideBefore: "LONG",
      runId: "FILL_SYNC__DOGEUSDT",
      orderId: 96035243539,
      clientOrderId: "doge_tp1_same_order",
    },
  });
  await fillsSyncTest.flushFillSyncAlertBatches(crossRunBatches1, {
    sendTradeAlert: async (payload) => {
      sentPayloads.push(payload);
      return { ok: true };
    },
  });
  const crossRunBatches2 = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(crossRunBatches2, {
    symbol: "DOGEUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 96035243539, clientOrderId: "doge_tp1_same_order" },
    tradeMs: 1_777_900_030_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P1_1.65P",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 7.315,
      execPrice: 0.095,
      closeRatio: 0.03,
      fullExit: false,
      realizedPnl: 0.092,
      positionSideBefore: "LONG",
      runId: "FILL_SYNC__DOGEUSDT",
      orderId: 96035243539,
      clientOrderId: "doge_tp1_same_order",
    },
  });
  await fillsSyncTest.flushFillSyncAlertBatches(crossRunBatches2, {
    sendTradeAlert: async (payload) => {
      sentPayloads.push(payload);
      return { ok: true };
    },
  });
  assert.strictEqual(sentPayloads.length, 1, "same order partial fills across sync runs must emit only one alert");

  const conflictingStageBatches = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(conflictingStageBatches, {
    symbol: "AXSUSDT",
    event: "EXIT_TP_P1_1.65P_UNVERIFIED",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 14728630395, clientOrderId: "dbj_axs_tp_conflict" },
    tradeMs: 1_777_810_115_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "AXSUSDT",
      event: "EXIT_TP_P1_1.65P_UNVERIFIED",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 44.21,
      execPrice: 1.061,
      closeRatio: 0.089,
      closeRatioAggregation: "SUM",
      fullExit: false,
      realizedPnl: 0.167,
      positionSideBefore: "SHORT",
      classificationVerified: false,
      alertStageHintTp0Done: true,
      alertStageHintTp1Done: false,
      alertStageHintTrailActive: false,
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
      runId: "FILL_SYNC__AXSUSDT",
      orderId: 14728630395,
      clientOrderId: "dbj_axs_tp_conflict",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(conflictingStageBatches, {
    symbol: "AXSUSDT",
    event: "EXIT_TP_P0_0.8P",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 14728630395, clientOrderId: "dbj_axs_tp_conflict" },
    tradeMs: 1_777_810_115_010,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "AXSUSDT",
      event: "EXIT_TP_P0_0.8P",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 88.42,
      execPrice: 1.061,
      canonicalExitEvent: "EXIT_TP_P0_0.8P",
      canonicalExitStage: "TP0",
      canonicalTransitionEvent: "TP0_REACHED",
      canonicalTransitionEvents: ["TP0_REACHED"],
      closeRatio: 0.25,
      closeRatioAggregation: "MAX",
      fullExit: false,
      realizedPnl: 0.333,
      positionSideBefore: "SHORT",
      classificationVerified: true,
      alertStageHintTp0Done: true,
      alertStageHintTp1Done: false,
      alertStageHintTrailActive: false,
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
      runId: "FILL_SYNC__AXSUSDT",
      orderId: 14728630395,
      clientOrderId: "dbj_axs_tp_conflict",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(conflictingStageBatches, {
    symbol: "AXSUSDT",
    event: "EXIT_TP_P1_1.65P_UNVERIFIED",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 14728630395, clientOrderId: "dbj_axs_tp_conflict" },
    tradeMs: 1_777_810_115_020,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "AXSUSDT",
      event: "EXIT_TP_P1_1.65P_UNVERIFIED",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 22.11,
      execPrice: 1.061,
      closeRatio: 0.044,
      closeRatioAggregation: "SUM",
      fullExit: false,
      realizedPnl: 0.084,
      positionSideBefore: "SHORT",
      classificationVerified: false,
      alertStageHintTp0Done: true,
      alertStageHintTp1Done: false,
      alertStageHintTrailActive: false,
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
      runId: "FILL_SYNC__AXSUSDT",
      orderId: 14728630395,
      clientOrderId: "dbj_axs_tp_conflict",
    },
  });
  assert.strictEqual(conflictingStageBatches.size, 1, "same-order conflicting TP0/TP1 sync fills must collapse into one authoritative alert");
  const conflictingStageMerged = Array.from(conflictingStageBatches.values())[0];
  assert.strictEqual(conflictingStageMerged.payload.event, "EXIT_TP_P0_0.8P", "verified TP0 must beat conflicting TP1_UNVERIFIED alert labels");
  assert.ok(approxEqual(conflictingStageMerged.payload.closeRatio, 0.25), "conflicting same-order TP close ratios must clamp to authoritative TP0 contract ratio");
  assert.strictEqual(conflictingStageMerged.payload.closeRatioAggregation, "MAX", "conflicting same-order TP stages must not over-sum close ratios");
  const conflictingStageMsg = alertTest.buildMessage(conflictingStageMerged.payload);
  assert.strictEqual(conflictingStageMsg, null, "runtime/user-facing alert layer must no longer render TP0 messages");

  const oppositeNoEntryBatches = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(oppositeNoEntryBatches, {
    symbol: "ETHUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 10001, clientOrderId: "NA" },
    tradeMs: 1_777_900_100_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 1000,
      execPrice: 2200,
      closeRatio: 1,
      fullExit: true,
      realizedPnl: 0.1,
      positionSideBefore: "SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      runId: "FILL_SYNC__ETHUSDT",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(oppositeNoEntryBatches, {
    symbol: "ETHUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 10002, clientOrderId: "NA" },
    tradeMs: 1_777_900_160_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 1100,
      execPrice: 2210,
      closeRatio: 1,
      fullExit: true,
      realizedPnl: 0.2,
      positionSideBefore: "SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      runId: "FILL_SYNC__ETHUSDT",
    },
  });
  assert.strictEqual(
    oppositeNoEntryBatches.size,
    2,
    "opposite-signal alerts without entry_event_id must stay separated by order identity"
  );

  assert.strictEqual(
    fillsSyncTest.shouldEmitExternalFillSyncExitAlert({
      event: "EXIT_TP_P1_3.25P",
      realizedPnl: 0,
      canonicalStage: "TP1",
      canonicalTransitionEvents: ["TP1_REACHED"],
      ledgerBlockedInvariant: false,
      canonicalEntryLineageMissing: false,
    }),
    true,
    "canonical TP exits from external fill sync must alert even when realized pnl is zero"
  );

  assert.strictEqual(
    fillsSyncTest.shouldEmitExternalFillSyncExitAlert({
      event: "EXIT_TP_P0_0.8P",
      realizedPnl: 0,
      canonicalStage: "TP0",
      canonicalTransitionEvents: [],
      ledgerBlockedInvariant: false,
      canonicalEntryLineageMissing: false,
    }),
    false,
    "raw TP exits without canonical transitions must remain suppressed"
  );
}

(async () => {
  try {
    await run();
    console.log("FILL_SYNC_ALERT_AGGREGATION_TEST_OK");
  } catch (err) {
    console.error("FILL_SYNC_ALERT_AGGREGATION_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
