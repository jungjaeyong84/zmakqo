const assert = require("assert");
const { __test } = require("../services/tradeExecutionAlert");

async function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildMessage, "function", "buildMessage export missing");
  assert.strictEqual(typeof __test.buildFailureMessage, "function", "buildFailureMessage export missing");
  assert.strictEqual(typeof __test.parseExitEventMeta, "function", "parseExitEventMeta export missing");
  assert.strictEqual(typeof __test.resolveSimplifiedExitV2AlertProjection, "function", "resolveSimplifiedExitV2AlertProjection export missing");
  assert.strictEqual(typeof __test.resolveEffectiveExitMeta, "function", "resolveEffectiveExitMeta export missing");
  assert.strictEqual(typeof __test.resolveCanonicalExitAlertRequirement, "function", "resolveCanonicalExitAlertRequirement export missing");
  assert.strictEqual(typeof __test.resolveDirection, "function", "resolveDirection export missing");

  const shortEntry = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "PRE_REAL_SHORT",
    intent: "ENTRY",
    side: "BUY",
    positionSideBefore: "LONG",
    positionSideAfter: "LONG",
    executionMode: "LIVE",
    notional: 2007.1,
    execPrice: 84.12,
    appliedLeverage: 2,
    leverageReason: "REGIME_NOT_TREND",
    exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
    features: {
      market_bias_mult: 0.5,
      ev_mult: 0.7,
      market_ev_final_mult: 0.35,
      openclaw_market_regime_cohort: "RESCUE",
      openclaw_market_regime_drop_verdict: "FAVOR_RESCUE",
    },
  });
  assert.ok(shortEntry, "short entry message should exist");
  assert.strictEqual(shortEntry.title, "SOLUSDT 숏 진입");
  assert.ok(shortEntry.body.includes("노출금액: 2,007.10 USDT"), "entry alert should show notional separately");
  assert.ok(shortEntry.body.includes("증거금추정: 1,003.55 USDT"), "entry alert should show estimated margin separately");
  assert.ok(shortEntry.body.includes("체결수량: 23.86 SOL"), "entry alert should show base quantity");
  assert.ok(shortEntry.body.includes("티어: PRE_REAL"), "entry alert should show entry tier");
  assert.ok(shortEntry.body.includes("이벤트: SHORT"), "entry event tag should be canonical SHORT");
  assert.ok(shortEntry.body.includes("수량조정: 시황 50% × EV 70%"), "entry alert should include sizing reductions");
  assert.ok(shortEntry.body.includes("최종비중: 35%"), "entry alert should include final sizing");
  assert.ok(shortEntry.body.includes("시장군: RESCUE"), "entry alert should include cohort");
  assert.ok(shortEntry.body.includes("시장판정: FAVOR_RESCUE"), "entry alert should include market verdict");
  assert.ok(shortEntry.body.includes("TRAIL_0.9R"), "entry alert should prefer R-based trailing contract");

  const timeStop = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "EXIT_TIME_STOP_18B",
    intent: "EXIT",
    side: "BUY",
    positionSideBefore: "SHORT",
    executionMode: "LIVE",
    notional: 147.23,
    execPrice: 84.13,
    fullExit: true,
    realizedPnl: -0.018,
    appliedLeverage: 2,
    leverageReason: "BINANCE_USER_TRADES_SYNC",
    reason: "EXIT_TIME_STOP_PRE_TP1",
    features: {
      time_stop_scope: "PRE_TP1",
      openclaw_market_regime_cohort: "RESCUE",
    },
    exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
  });
  assert.ok(timeStop, "time stop message should exist");
  assert.strictEqual(timeStop.title, "SOLUSDT TIME_STOP_18B 전량 청산");
  assert.ok(timeStop.body.includes("종류: 시간청산 18봉 (pre-TP1)"), "pre-tp1 time stop label should be explicit");
  assert.ok(timeStop.body.includes("실행계약: TIME_STOP_18B"), "exit alert should show executed contract");
  assert.ok(timeStop.body.includes("시장군: RESCUE"), "exit alert should include cohort");
  assert.ok(timeStop.body.includes("이벤트: EXIT_TIME_STOP_18B"), "raw exit event should remain visible");

  const tp1Failure = __test.buildFailureMessage({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "BUY",
    positionSideBefore: "SHORT",
    executionMode: "LIVE",
    reason: "MARGIN_TYPE_SET_FAILED",
    note: "margin type change rejected",
    closeRatio: 0.5,
    appliedLeverage: 2,
    leverageReason: "REGIME_NOT_TREND",
    canonicalExitEvent: "EXIT_TP_P1_3.25P",
    canonicalExitStage: "TP1",
    canonicalTransitionEvent: "TP1_REACHED",
    canonicalTransitionEvents: ["TP1_REACHED", "TRAIL_ACTIVE"],
    exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
  });
  assert.ok(tp1Failure, "tp1 failure message should exist");
  assert.strictEqual(tp1Failure.title, "SOLUSDT 정본재분류 TP1_1.65->TP1_3.25 주문 실패");
  assert.ok(tp1Failure.body.includes("방향: 숏 청산"), "failure message should include exit direction");
  assert.ok(tp1Failure.body.includes("종류: 익절(TP1) 3.25%"), "failure message should use canonical stage label");
  assert.ok(tp1Failure.body.includes("실행계약: TP1_3.25"), "failure message should show canonical executed contract");
  assert.ok(tp1Failure.body.includes("주문비율: 50%"), "failure message should include close ratio");
  assert.ok(tp1Failure.body.includes("정본재분류: TP1_1.65 -> TP1_3.25"), "failure message should expose canonical reclassification");
  assert.ok(tp1Failure.body.includes("전략계약: SL_1.65 / TP1_3.25 / TRAIL_0.9R / RUNNER_MIN_2 / BE_0.25"), "failure message should separate strategy contract from executed stage");
  assert.ok(tp1Failure.body.includes("RUNNER_MIN_2"), "failure message should include runner floor rule");
  assert.ok(tp1Failure.body.includes("실패사유: MARGIN_TYPE_SET_FAILED"), "failure reason should be explicit");
  assert.ok(tp1Failure.body.includes("메모: margin type change rejected"), "failure note should be explicit");

  const tp0Failure = __test.buildFailureMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    intent: "EXIT",
    side: "BUY",
    positionSideBefore: "SHORT",
    executionMode: "PAPER",
    reason: "ORDER_REJECTED",
    closeRatio: 0.25,
    simplified_exit_v2_enabled: false,
    features: {
      openclaw_market_regime_cohort: "RESCUE",
    },
    canonicalExitEvent: "EXIT_TP_P0_0.8P",
    canonicalExitStage: "TP0",
    canonicalTransitionEvent: "TP0_REACHED",
    canonicalTransitionEvents: ["TP0_REACHED"],
    exitRules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.028, TRAIL_R_MULTIPLE: 0.9, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
  });
  assert.ok(tp0Failure, "tp0 failure message should exist");
  assert.ok(tp0Failure.title.includes("익절(TP1) 0.8% 주문 실패"), "tp0 failure title should be normalized to TP1");
  assert.ok(!tp0Failure.title.includes("TP0"), "tp0 failure title must not expose TP0");
  assert.ok(tp0Failure.body.includes("실행계약: TP1_0.8"), "tp0 failure should show normalized executed contract");
  assert.ok(tp0Failure.body.includes("전략계약: SL_1.65 / TP1_2.8 / TRAIL_0.9R / RUNNER_MIN_2 / BE_0.25"), "tp0 failure should keep strategy contract under separate label");
  assert.ok(tp0Failure.body.includes("시장군: RESCUE"), "tp0 failure should include cohort");

  const simplifiedTp0FailureReclassified = __test.buildFailureMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    reason: "ORDER_REJECTED",
    closeRatio: 0.5,
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_TP_P1_1.68P",
    canonicalExitStage: "TP1",
    canonicalTransitionEvent: "TP1_REACHED",
    canonicalTransitionEvents: ["TP1_REACHED"],
    exitRules: { SL: -0.0165, TP_P1: 0.0168, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(simplifiedTp0FailureReclassified, "simplified v2 tp0 failure reclassification should exist");
  assert.strictEqual(simplifiedTp0FailureReclassified.title, "ETHUSDT 익절(TP1) 1.68% 주문 실패");
  assert.ok(!simplifiedTp0FailureReclassified.title.includes("TP0"), "v2 failure title must not expose TP0");
  assert.ok(simplifiedTp0FailureReclassified.body.includes("종류: 익절(TP1) 1.68%"), "v2 failure must show TP1 label");
  assert.ok(simplifiedTp0FailureReclassified.body.includes("실행계약: TP1_1.68"), "v2 failure must show TP1 executed contract");
  assert.ok(simplifiedTp0FailureReclassified.body.includes("정본재분류: RAW_EVIDENCE -> TP1_1.68"), "v2 failure must keep reclassification while hiding legacy TP0 contract namespace");
  assert.ok(simplifiedTp0FailureReclassified.body.includes("이벤트: EXIT_TP_P0_0.8P"), "raw TP0 evidence should remain visible in v2 failure alert");

  const externalSync = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 515.4,
    execPrice: 73623,
    fullExit: true,
    realizedPnl: 1.23,
    appliedLeverage: 2,
    leverageReason: "BINANCE_USER_TRADES_SYNC",
    reason: "EXTERNAL_FILL_RECONCILED",
    externalSyncHintStage: "TRAIL_AFTER_TP1",
    externalSyncOrderType: "MARKET",
    externalSyncClosePosition: false,
    replayReason: "TRADE_EXECUTION_ALERT_MISSING_FILL_REPLAY",
    exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(externalSync, "external sync message should exist");
  assert.strictEqual(externalSync.title, "BTCUSDT EXTERNAL_SYNC 전량 청산");
  assert.ok(externalSync.body.includes("종류: 외부 동기화 청산"), "external sync label should be explicit");
  assert.ok(externalSync.body.includes("동기화맥락: 트레일 종료 후 외부 동기화"), "external sync should explain prior stage context");
  assert.ok(externalSync.body.includes("동기화사유: EXTERNAL_FILL_RECONCILED"), "external sync should include reconciliation reason");
  assert.ok(externalSync.body.includes("동기화주문: MARKET / close_position=false"), "external sync should include order context");
  assert.ok(externalSync.body.includes("재발송사유: TRADE_EXECUTION_ALERT_MISSING_FILL_REPLAY"), "replay reason should be explicit when present");

  const canonicalTrail = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "PAPER",
    simplified_exit_v2_enabled: false,
    notional: 389.27,
    execPrice: 2330.94,
    closeRatio: 0.5,
    fullExit: false,
    realizedPnl: 12.168,
    canonicalExitEvent: "EXIT_TRAIL",
    canonicalExitStage: "TRAIL",
    canonicalTransitionEvent: "TRAIL_PARTIAL",
    canonicalTransitionEvents: ["TRAIL_PARTIAL"],
    contractEntryQtyAbs: 0.887,
    contractTp0AllowedAbs: 0.22175,
    contractTp1AllowedAbs: 0.332625,
    contractRunnerRemainingAbs: 0.167,
    contractObservedQtyAbs: 0.167,
    stopDivergenceItems: [
      { code: "RUNNER_MIN_GUARANTEE_MISSED", display: "RUNNER_MIN_GUARANTEE_MISSED · 최소 보장 수익 미준수" },
      { code: "TRAIL_R_MISMATCH", display: "TRAIL_R_MISMATCH · TRAIL_R_MULTIPLE 불일치" },
    ],
    chosenStopSource: "RUNNER_FLOOR",
    chosenStopPrice: 2276.7092,
    runnerFloorStop: 2276.7092,
    trailStopByR: 2323.5347,
    nativeStopPrice: 2276.7,
    exitRules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(canonicalTrail, "canonical trail message should exist");
  assert.strictEqual(canonicalTrail.title, "ETHUSDT 정본재분류 TP1_1.65->TRAIL 50% 청산");
  assert.ok(canonicalTrail.body.includes("종류: 트레일링"), "canonical override should switch label to trail");
  assert.ok(canonicalTrail.body.includes("실행계약: TRAIL"), "canonical override should switch executed contract to trail");
  assert.ok(canonicalTrail.body.includes("정본재분류: TP1_1.65 -> TRAIL"), "canonical override should expose explicit reclassification");
  assert.ok(canonicalTrail.body.includes("체결수량(base): 0.167"), "alert should include observed absolute fill qty");
  assert.ok(canonicalTrail.body.includes("계약수량(base): ENTRY 0.887 / TP1 0.332625 / RUNNER 0.167"), "alert should include absolute contract ledger");
  assert.ok(!canonicalTrail.body.includes("/ TP0 "), "alert ledger must not expose TP0");
  assert.ok(canonicalTrail.body.includes("정본단계: TRAIL"), "canonical override should expose canonical stage");
  assert.ok(canonicalTrail.body.includes("정본전이: TRAIL_PARTIAL"), "canonical override should expose transition");
  assert.ok(canonicalTrail.body.includes("청산경고: RUNNER_MIN_GUARANTEE_MISSED · 최소 보장 수익 미준수 / TRAIL_R_MISMATCH · TRAIL_R_MULTIPLE 불일치"), "alert should expose canonical stop divergence codes");
  assert.ok(canonicalTrail.body.includes("stop근거: chosen RUNNER_FLOOR 2,276.71 / floor 2,276.71 / r 2,323.53 / native 2,276.70"), "alert should expose stop authority evidence");
  assert.ok(canonicalTrail.body.includes("이벤트: EXIT_TP_P1_1.65P"), "raw event should remain visible for evidence");

  const simplifiedTrailLedger = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 389.27,
    execPrice: 2330.94,
    closeRatio: 0.5,
    fullExit: false,
    realizedPnl: 12.168,
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_TRAIL",
    canonicalExitStage: "TRAIL",
    canonicalTransitionEvent: "TRAIL_FINAL_EXIT",
    canonicalTransitionEvents: ["TRAIL_FINAL_EXIT"],
    contractEntryQtyAbs: 0.887,
    contractTp0AllowedAbs: 0.22175,
    contractTp1AllowedAbs: 0.4435,
    contractRunnerRemainingAbs: 0.167,
    contractObservedQtyAbs: 0.167,
    exitRules: { SL: -0.0165, TP_P1: 0.0168, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(simplifiedTrailLedger, "simplified v2 trail message should exist");
  assert.ok(simplifiedTrailLedger.body.includes("계약수량(base): ENTRY 0.887 / TP1 0.4435 / RUNNER 0.167"), "v2 ledger should omit TP0 contract line");
  assert.ok(!simplifiedTrailLedger.body.includes("/ TP0 "), "v2 ledger should not expose TP0 contract part");

  const simplifiedTp0EvidenceReclassified = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 389.27,
    execPrice: 2330.94,
    closeRatio: 0.5,
    fullExit: false,
    realizedPnl: 12.168,
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_TP_P1_1.68P",
    canonicalExitStage: "TP1",
    canonicalTransitionEvent: "TP1_REACHED",
    canonicalTransitionEvents: ["TP1_REACHED"],
    contractEntryQtyAbs: 0.887,
    contractTp1AllowedAbs: 0.4435,
    contractRunnerRemainingAbs: 0.4435,
    contractObservedQtyAbs: 0.4435,
    exitRules: { SL: -0.0165, TP_P1: 0.0168, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(simplifiedTp0EvidenceReclassified, "simplified v2 tp evidence message should exist");
  assert.strictEqual(simplifiedTp0EvidenceReclassified.title, "ETHUSDT TP1_1.68 50% 청산");
  assert.ok(!simplifiedTp0EvidenceReclassified.title.includes("TP0"), "v2 alert title must not expose TP0");
  assert.ok(simplifiedTp0EvidenceReclassified.body.includes("종류: 익절(TP1) 1.68%"), "v2 alert should show TP1 label");
  assert.ok(simplifiedTp0EvidenceReclassified.body.includes("실행계약: TP1_1.68"), "v2 alert should show TP1 executed contract");
  assert.ok(simplifiedTp0EvidenceReclassified.body.includes("정본재분류: RAW_EVIDENCE -> TP1_1.68"), "v2 raw tp0 evidence should be normalized without exposing legacy TP0 contract namespace");
  assert.ok(simplifiedTp0EvidenceReclassified.body.includes("이벤트: EXIT_TP_P0_0.8P"), "raw evidence event should remain visible");

  const simplifiedExternalSyncAfterTp0 = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    simplifiedExitV2Enabled: true,
    notional: 515.4,
    execPrice: 73623,
    fullExit: true,
    realizedPnl: 1.23,
    externalSyncHintStage: "AFTER_TP0",
    reason: "EXTERNAL_FILL_RECONCILED",
    exitRules: { SL: -0.0165, TP_P1: 0.0168, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(simplifiedExternalSyncAfterTp0.body.includes("동기화맥락: 러너 진입 전 외부 동기화"), "v2 external sync context must not expose TP0");

  const canonicalTp1Event = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "EXIT_TP_P1_5P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 200,
    execPrice: 70000,
    closeRatio: 0.5,
    fullExit: false,
    realizedPnl: 4.2,
    canonicalExitEvent: "EXIT_TP_P1_3P",
    canonicalExitStage: "TP1",
    canonicalTransitionEvent: "TP1_REACHED",
    canonicalTransitionEvents: ["TP1_REACHED", "TRAIL_ACTIVE"],
    exitRules: { SL: -0.0165, TP_P1: 0.03, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(canonicalTp1Event, "canonical tp1 event message should exist");
  assert.strictEqual(canonicalTp1Event.title, "BTCUSDT 정본재분류 TP1_5->TP1_3 50% 청산");
  assert.ok(canonicalTp1Event.body.includes("종류: 익절(TP1) 3%"), "canonical exit event should control displayed label");
  assert.ok(canonicalTp1Event.body.includes("실행계약: TP1_3"), "canonical exit event should control executed contract");

  const canonicalTrailWithRawEvidence = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    event: "EXIT_TRAIL",
    rawEvidenceEvent: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 190,
    execPrice: 610.5,
    closeRatio: 0.188,
    realizedPnl: 3.8,
    canonicalExitEvent: "EXIT_TRAIL",
    canonicalExitStage: "TRAIL",
    canonicalTransitionEvent: "TRAIL_FINAL_EXIT",
    canonicalTransitionEvents: ["TRAIL_FINAL_EXIT"],
    exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(canonicalTrailWithRawEvidence.body.includes("이벤트: EXIT_TP_P1_1.65P"), "raw evidence event should remain visible even when payload.event is canonical");

  const missingCanonicalRequirement = __test.resolveCanonicalExitAlertRequirement({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
  });
  assert.strictEqual(missingCanonicalRequirement.required, true);
  assert.strictEqual(missingCanonicalRequirement.satisfied, false);
  assert.strictEqual(missingCanonicalRequirement.reason, "MISSING_CANONICAL_EXIT_TRANSITION");

  const simplifiedTp1 = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 389.27,
    execPrice: 2330.94,
    closeRatio: 0.5,
    fullExit: false,
    realizedPnl: 12.168,
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_TP_P1_1.68P",
    canonicalExitStage: "TP1",
    canonicalTransitionEvent: "TP1_REACHED",
    canonicalTransitionEvents: ["TP1_REACHED"],
    exitRules: { SL: -0.0165, TP_P1: 0.0168, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(simplifiedTp1, "simplified v2 tp1 message should exist");
  assert.strictEqual(simplifiedTp1.title, "ETHUSDT 정본재분류 TP1_1.65->TP1_1.68 50% 청산");
  assert.ok(simplifiedTp1.body.includes("종류: 익절(TP1) 1.68%"), "v2 projection should prefer canonical tp1 contract");
  assert.ok(simplifiedTp1.body.includes("실행계약: TP1_1.68"), "v2 projection should prefer canonical executed contract");
  assert.ok(simplifiedTp1.body.includes("정본전이: TP1_REACHED"), "v2 projection should expose canonical transition only");

  const invalidSimplifiedV2Requirement = __test.resolveCanonicalExitAlertRequirement({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    intent: "EXIT",
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_TRAIL",
    canonicalExitStage: "TRAIL",
    canonicalTransitionEvent: "TRAIL_PARTIAL",
    canonicalTransitionEvents: ["TRAIL_PARTIAL"],
  });
  assert.strictEqual(invalidSimplifiedV2Requirement.required, true);
  assert.strictEqual(invalidSimplifiedV2Requirement.satisfied, false);
  assert.strictEqual(invalidSimplifiedV2Requirement.reason, "INVALID_V2_CANONICAL_TRANSITION");

  const simplifiedProjection = __test.resolveSimplifiedExitV2AlertProjection({
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_TRAIL",
    canonicalTransitionEvent: "TRAIL_ACTIVE",
    canonicalTransitionEvents: ["TRAIL_ACTIVE"],
  });
  assert.strictEqual(simplifiedProjection.enabled, true);
  assert.deepStrictEqual(simplifiedProjection.transitionEvents, ["TRAIL_ACTIVATED"]);
  assert.strictEqual(simplifiedProjection.stage, "TRAIL");

  const simplifiedStopHitProjection = __test.resolveSimplifiedExitV2AlertProjection({
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_SL_1.65P",
    canonicalTransitionEvent: "SL_HIT",
    canonicalTransitionEvents: ["SL_HIT"],
  });
  assert.strictEqual(simplifiedStopHitProjection.enabled, true);
  assert.deepStrictEqual(simplifiedStopHitProjection.transitionEvents, ["SL_HIT"]);
  assert.strictEqual(simplifiedStopHitProjection.stage, "SL");
  assert.strictEqual(simplifiedStopHitProjection.meta.token, "SL_1.65");

  const simplifiedExternalCloseRequirement = __test.resolveCanonicalExitAlertRequirement({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    intent: "EXIT",
    simplifiedExitV2Enabled: true,
    canonicalExitEvent: "EXIT_EXTERNAL_SYNC",
    canonicalTransitionEvent: "EXTERNAL_CLOSE_SYNC",
    canonicalTransitionEvents: ["EXTERNAL_CLOSE_SYNC"],
  });
  assert.strictEqual(simplifiedExternalCloseRequirement.required, true);
  assert.strictEqual(simplifiedExternalCloseRequirement.satisfied, true);
  assert.deepStrictEqual(simplifiedExternalCloseRequirement.canonicalTransitionEvents, ["EXTERNAL_CLOSE_SYNC"]);

  const rawOnlyExitMeta = __test.resolveEffectiveExitMeta({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
  }, "EXIT_TP_P1_1.65P");
  assert.strictEqual(rawOnlyExitMeta.overrideApplied, false);
  assert.strictEqual(rawOnlyExitMeta.canonicalStage, null);

  const missingCanonicalExitAlert = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 190,
    execPrice: 2330.94,
    closeRatio: 0.5,
    realizedPnl: 3.8,
    exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.strictEqual(missingCanonicalExitAlert, null, "stageful exit alerts must require canonical transition evidence");

  const missingCanonicalFailureAlert = __test.buildFailureMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_1.65P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    reason: "LIVE_FAILED",
    closeRatio: 0.5,
    exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.strictEqual(missingCanonicalFailureAlert, null, "stageful failure alerts must require canonical transition evidence");

  const forcedExitMessage = __test.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "FORCE_EXIT_ALL",
    intent: "ENTRY",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    fullExit: true,
    notional: 240,
    execPrice: 2330.94,
    realizedPnl: 12.1,
  });
  assert.ok(forcedExitMessage, "forced exit should emit an exit alert even when raw intent is malformed");
  assert.ok(!forcedExitMessage.title.includes("진입"), "forced exit must not be rendered as an entry");
  assert.ok(forcedExitMessage.body.includes("종류: 강제 전량 청산"));
  assert.ok(forcedExitMessage.body.includes("이벤트: FORCE_EXIT_ALL"));

  // Regression: the qty-reduction recovery path (paperBinanceRunner.js
  // dispatchTradeExecutionAlert call for "EXIT_TP_P1_RECOVERY") was being
  // silenced ~every 30s with reason=MISSING_CANONICAL_EXIT_TRANSITION because
  // the dispatch did not supply canonical transition evidence — even though
  // the event only fires when Binance actually filled TP1 (our fill_sync just
  // missed the primary event). Lock in that (a) a bare recovery payload is
  // correctly gated, and (b) supplying the canonical transition satisfies
  // the gate so the operator gets the alert.
  const bareRecoveryRequirement = __test.resolveCanonicalExitAlertRequirement({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    event: "EXIT_TP_P1_RECOVERY",
    intent: "EXIT",
  });
  assert.strictEqual(bareRecoveryRequirement.required, true);
  assert.strictEqual(bareRecoveryRequirement.satisfied, false);
  assert.strictEqual(bareRecoveryRequirement.reason, "MISSING_CANONICAL_EXIT_TRANSITION");

  const augmentedRecoveryRequirement = __test.resolveCanonicalExitAlertRequirement({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    event: "EXIT_TP_P1_RECOVERY",
    intent: "EXIT",
    rawEvidenceEvent: "EXIT_TP_P1_RECOVERY",
    canonicalExitEvent: "EXIT_TP_P1_RECOVERY",
    canonicalExitStage: "TP1",
    canonicalTransitionEvent: "TP1_REACHED",
    canonicalTransitionEvents: ["TP1_REACHED"],
  });
  assert.strictEqual(augmentedRecoveryRequirement.required, true);
  assert.strictEqual(augmentedRecoveryRequirement.satisfied, true);
  assert.strictEqual(augmentedRecoveryRequirement.reason, null);
  assert.deepStrictEqual(augmentedRecoveryRequirement.canonicalTransitionEvents, ["TP1_REACHED"]);

  console.log("TRADE_EXECUTION_ALERT_TEST_OK");
}

run().catch((err) => {
  console.error("TRADE_EXECUTION_ALERT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
