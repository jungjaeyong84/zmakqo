const assert = require("assert");
const { __test } = require("../services/tradeExecutionAlert");

async function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildMessage, "function", "buildMessage export missing");
  assert.strictEqual(typeof __test.buildFailureMessage, "function", "buildFailureMessage export missing");
  assert.strictEqual(typeof __test.parseExitEventMeta, "function", "parseExitEventMeta export missing");
  assert.strictEqual(typeof __test.resolveEffectiveExitMeta, "function", "resolveEffectiveExitMeta export missing");
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
    exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
  });
  assert.ok(tp1Failure, "tp1 failure message should exist");
  assert.strictEqual(tp1Failure.title, "SOLUSDT 익절(TP1) 1.65% 주문 실패");
  assert.ok(tp1Failure.body.includes("방향: 숏 청산"), "failure message should include exit direction");
  assert.ok(tp1Failure.body.includes("실행계약: TP1_1.65"), "failure message should show executed contract");
  assert.ok(tp1Failure.body.includes("주문비율: 50%"), "failure message should include close ratio");
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
    executionMode: "LIVE",
    reason: "ORDER_REJECTED",
    closeRatio: 0.25,
    features: {
      openclaw_market_regime_cohort: "RESCUE",
    },
    exitRules: { SL: -0.0165, TP_P1: 0.028, TRAIL_R_MULTIPLE: 0.9, TRAIL_PCT: 0.01, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
  });
  assert.ok(tp0Failure, "tp0 failure message should exist");
  assert.ok(tp0Failure.title.includes("익절(TP0) 0.8% 주문 실패"), "tp0 failure title should be explicit");
  assert.ok(tp0Failure.body.includes("실행계약: TP0_0.8"), "tp0 failure should show executed contract");
  assert.ok(tp0Failure.body.includes("전략계약: SL_1.65 / TP1_2.8 / TRAIL_0.9R / RUNNER_MIN_2 / BE_0.25"), "tp0 failure should keep strategy contract under separate label");
  assert.ok(tp0Failure.body.includes("시장군: RESCUE"), "tp0 failure should include cohort");

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
    exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(externalSync, "external sync message should exist");
  assert.strictEqual(externalSync.title, "BTCUSDT EXTERNAL_SYNC 전량 청산");
  assert.ok(externalSync.body.includes("종류: 외부 동기화 청산"), "external sync label should be explicit");
  assert.ok(externalSync.body.includes("동기화맥락: 트레일 종료 후 외부 동기화"), "external sync should explain prior stage context");
  assert.ok(externalSync.body.includes("동기화사유: EXTERNAL_FILL_RECONCILED"), "external sync should include reconciliation reason");
  assert.ok(externalSync.body.includes("동기화주문: MARKET / close_position=false"), "external sync should include order context");

  const canonicalTrail = __test.buildMessage({
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
    canonicalExitEvent: "EXIT_TRAIL",
    canonicalExitStage: "TRAIL",
    canonicalTransitionEvent: "TRAIL_PARTIAL",
    canonicalTransitionEvents: ["TRAIL_PARTIAL"],
    contractEntryQtyAbs: 0.887,
    contractTp0AllowedAbs: 0.22175,
    contractTp1AllowedAbs: 0.332625,
    contractRunnerRemainingAbs: 0.167,
    contractObservedQtyAbs: 0.167,
    exitRules: { SL: -0.0165, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, RUNNER_MIN_PROFIT_PCT: 0.0165, BE_PCT: 0.0015 },
  });
  assert.ok(canonicalTrail, "canonical trail message should exist");
  assert.strictEqual(canonicalTrail.title, "ETHUSDT TRAIL 50% 청산");
  assert.ok(canonicalTrail.body.includes("종류: 트레일링"), "canonical override should switch label to trail");
  assert.ok(canonicalTrail.body.includes("실행계약: TRAIL"), "canonical override should switch executed contract to trail");
  assert.ok(canonicalTrail.body.includes("체결수량(base): 0.167"), "alert should include observed absolute fill qty");
  assert.ok(canonicalTrail.body.includes("계약수량(base): ENTRY 0.887 / TP0 0.22175 / TP1 0.332625 / RUNNER 0.167"), "alert should include absolute contract ledger");
  assert.ok(canonicalTrail.body.includes("정본단계: TRAIL"), "canonical override should expose canonical stage");
  assert.ok(canonicalTrail.body.includes("정본전이: TRAIL_PARTIAL"), "canonical override should expose transition");
  assert.ok(canonicalTrail.body.includes("이벤트: EXIT_TP_P1_1.65P"), "raw event should remain visible for evidence");

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
  assert.strictEqual(canonicalTp1Event.title, "BTCUSDT TP1_3 50% 청산");
  assert.ok(canonicalTp1Event.body.includes("종류: 익절(TP1) 3%"), "canonical exit event should control displayed label");
  assert.ok(canonicalTp1Event.body.includes("실행계약: TP1_3"), "canonical exit event should control executed contract");

  console.log("TRADE_EXECUTION_ALERT_TEST_OK");
}

run().catch((err) => {
  console.error("TRADE_EXECUTION_ALERT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
