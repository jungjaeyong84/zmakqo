"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-objective-retrospective");

function run() {
  const usdNormalizer = __test.buildPnlNormalizer("BINANCEFUT", 1400);
  const normalizedTrades = __test.normalizeTradesToKrw([
    { symbol: "BTCUSDT", pnl_krw: 10, pnl_pct: 0.03 },
    { symbol: "ETHUSDT", pnl_krw: -5, pnl_pct: -0.01 },
  ], usdNormalizer);
  assert.strictEqual(normalizedTrades[0].pnl_krw, 14000);
  assert.strictEqual(normalizedTrades[1].pnl_krw, -7000);

  const trades = [
    { symbol: "BTCUSDT", pnl_krw: 120000, pnl_pct: 0.03 },
    { symbol: "BTCUSDT", pnl_krw: -20000, pnl_pct: -0.01 },
    { symbol: "ETHUSDT", pnl_krw: -90000, pnl_pct: -0.04 },
  ];
  const byMarket = __test.summarizeTradesByMarket(trades);
  assert.strictEqual(byMarket[0].symbol, "BTCUSDT");
  assert.strictEqual(byMarket[0].trade_n, 2);
  assert.strictEqual(byMarket[1].symbol, "ETHUSDT");

  const logicalTrades = __test.summarizeRealizedTrades([
    { entry_event_id: "ENTRY1", symbol: "BTCUSDT", close_ms: 10, pnl_krw_normalized: 1000, pnl_quote_raw: 1, pnl_pct: 0.01 },
    { entry_event_id: "ENTRY1", symbol: "BTCUSDT", close_ms: 10, pnl_krw_normalized: 500, pnl_quote_raw: 0.5, pnl_pct: 0.01 },
    { entry_event_id: "ENTRY2", symbol: "ETHUSDT", close_ms: 12, pnl_krw_normalized: -300, pnl_quote_raw: -0.3, pnl_pct: -0.02 },
  ], { fromMs: 0, toMs: 20 });
  assert.strictEqual(logicalTrades.realized_n, 2);
  assert.strictEqual(logicalTrades.win_n, 1);
  assert.strictEqual(logicalTrades.net_pnl_quote, 1200);

  const executedEntries = __test.summarizeExecutedEntriesFromTradeAlerts([
    { type: "TRADE_EXECUTION_ALERT", event: "ENTRY_LONG", symbol: "BTCUSDT", payload: { intentId: "I1" } },
    { type: "TRADE_EXECUTION_ALERT", event: "ENTRY_LONG", symbol: "BTCUSDT", payload: { intentId: "I1" } },
    { type: "TRADE_EXECUTION_ALERT", event: "ENTRY_SHORT", symbol: "ETHUSDT", payload: { intentId: "I2" } },
  ]);
  assert.strictEqual(executedEntries.executed_n, 2);
  assert.deepStrictEqual(executedEntries.entry_markets, ["BTCUSDT", "ETHUSDT"]);

  const daily = {
    objective: { period_target_krw: 50000 },
    entry_cohort: { signals_n: 9, executed_n: 3, execution_rate: 1 / 3 },
    execution_microstructure: { entry_markets: ["BTCUSDT"] },
    realized_trades: { trade_n: 3, net_pnl_quote: 10000, trades },
    drops: { top_reasons: [{ reason: "DROP_EV_GATE_TP1_PROB", n: 4, stage: "EV" }] },
    quality_by_tier: { CORE: { executed_n: 3, avg_ret_net: -0.01 } },
  };
  const weekly = {
    objective: { period_target_krw: 150000 },
    realized_trades: { net_pnl_quote: -40000 },
  };
  const monthly = {
    objective: { period_target_krw: 150000 },
    realized_trades: { net_pnl_quote: -180000 },
  };

  const evaluation = __test.buildDailyTradeEvaluation({ daily, weekly, monthly });
  assert.ok(Array.isArray(evaluation.lines));
  assert.ok(evaluation.lines.some((line) => line.includes("실현 거래는 3건")));
  assert.ok(evaluation.lines.some((line) => line.includes("오늘 신규 진입 시장은 BTCUSDT")));
  assert.ok(evaluation.lines.some((line) => line.includes("실현 손익 기준 가장 좋았던 시장")));

  const realizedOnlyDaily = {
    objective: { period_target_krw: 50000 },
    entry_cohort: { signals_n: 9, executed_n: 0, execution_rate: 0 },
    execution_microstructure: { entry_markets: [] },
    realized_trades: { trade_n: 3, realized_n: 3, net_pnl_quote: -1500, trades },
    drops: { top_reasons: [{ reason: "DROP_EV_GATE_TP1_PROB", n: 4, stage: "EV" }] },
    quality_by_tier: { CORE: { executed_n: 0, avg_ret_net: -0.01 } },
  };
  const realizedOnlyEval = __test.buildDailyTradeEvaluation({ daily: realizedOnlyDaily, weekly, monthly });
  assert.ok(realizedOnlyEval.lines.some((line) => line.includes("오늘 신규 진입 시장은 없었고")));

  const reflection = __test.buildReflection({
    periodLabel: "당일",
    objective: { failed_checks: ["NO_TRADE_ACTIVITY", "NET_NOT_POSITIVE"] },
    entryOverall: { executed_n: 0 },
    realizedOverall: { realized_n: 3, net_pnl_quote: -1500 },
    dropSummary: { counts: {}, top_reasons: [] },
    quality: {},
  });
  assert.ok(reflection.some((line) => line.includes("기존 포지션 청산만 3건")));
  assert.ok(reflection.some((line) => line.includes("실현 순손익 -1,500 KRW가 양수가 아니었습니다")));

  daily.daily_trade_evaluation = evaluation;

  const critique = __test.buildSelfCritique({
    failedPeriods: ["DAILY", "MONTHLY"],
    daily,
    weekly,
    monthly,
  });
  assert.ok(critique.some((line) => line.includes("일간 목표")));
  assert.ok(critique.some((line) => line.includes("서버 신호")));

  const plan = __test.buildTomorrowStrategy({
    failedPeriods: ["DAILY"],
    daily,
    weekly,
    monthly,
    quality: daily,
  });
  assert.ok(plan.some((line) => line.includes("서버 신호 기준")));
  assert.ok(plan.some((line) => line.includes("EV")));

  console.log("OBJECTIVE_RETROSPECTIVE_TEST_OK");
}

run();
