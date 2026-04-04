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

  const daily = {
    objective: { period_target_krw: 50000 },
    entry_cohort: { signals_n: 9, executed_n: 3, execution_rate: 1 / 3 },
    realized_trades: { trade_n: 3, net_pnl_quote: 10000, trades },
    drops: { top_reasons: [{ reason: "DROP_EV_GATE_TP1_PROB", n: 4, stage: "EV" }] },
    quality_by_tier: { CORE: { executed_n: 3, avg_ret_net: -0.01 } },
  };
  const weekly = {
    objective: { period_target_krw: 150000 },
    realized_trades: { net_pnl_quote: -40000 },
  };
  const monthly = {
    objective: { period_target_krw: 1500000 },
    realized_trades: { net_pnl_quote: -180000 },
  };

  const evaluation = __test.buildDailyTradeEvaluation({ daily, weekly, monthly });
  assert.ok(Array.isArray(evaluation.lines));
  assert.ok(evaluation.lines.some((line) => line.includes("실현 거래는 3건")));
  assert.ok(evaluation.lines.some((line) => line.includes("BTCUSDT")));

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
