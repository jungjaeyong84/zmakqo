const assert = require("assert");
const { __test } = require("../services/tradeExecutionAlert");

async function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildMessage, "function", "buildMessage export missing");
  assert.strictEqual(typeof __test.buildFailureMessage, "function", "buildFailureMessage export missing");
  assert.strictEqual(typeof __test.parseExitEventMeta, "function", "parseExitEventMeta export missing");
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
  assert.ok(timeStop.body.includes("시장군: RESCUE"), "exit alert should include cohort");
  assert.ok(timeStop.body.includes("이벤트: EXIT_TIME_STOP_18B"), "raw exit event should remain visible");

  const tp1Failure = __test.buildFailureMessage({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_3.25P",
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
  assert.strictEqual(tp1Failure.title, "SOLUSDT 익절(TP1) 3.25% 주문 실패");
  assert.ok(tp1Failure.body.includes("방향: 숏 청산"), "failure message should include exit direction");
  assert.ok(tp1Failure.body.includes("주문비율: 50%"), "failure message should include close ratio");
  assert.ok(tp1Failure.body.includes("TRAIL_0.9R"), "failure message should include R-based trailing rule");
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
  assert.ok(tp0Failure.body.includes("시장군: RESCUE"), "tp0 failure should include cohort");

  console.log("TRADE_EXECUTION_ALERT_TEST_OK");
}

run().catch((err) => {
  console.error("TRADE_EXECUTION_ALERT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
