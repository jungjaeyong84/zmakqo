"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-objective-retrospective");

(() => {
  assert.strictEqual(__test.classifyDropStage("DROP_LONG_GATE_SCORE"), "QUALITY");
  assert.strictEqual(__test.classifyDropStage("DROP_AI_MISSING"), "AI");
  assert.strictEqual(__test.classifyDropStage("DROP_AI_BIAS_NEUTRAL_BLOCK"), "MARKET");
  assert.strictEqual(__test.classifyDropStage("DROP_EV_GATE_TP1_PROB"), "EV");
  assert.strictEqual(__test.classifyDropStage("DROP_WAIT_ONE_BAR_TIMING"), "TIMING");

  const ranges = __test.periodRanges(Date.UTC(2026, 2, 28, 14, 30, 0));
  assert.strictEqual(ranges.DAILY.observedDays, 1);
  assert.strictEqual(ranges.WEEKLY.observedDays, 7);
  assert.strictEqual(ranges.MONTHLY.observedDays, 30);

  const realized = __test.summarizeRealizedTrades([
    { close_ms: 1000, pnl_krw: 10, pnl_pct: 0.01 },
    { close_ms: 2000, pnl_krw: -5, pnl_pct: -0.02 },
  ], { fromMs: 0, toMs: 3000 });
  assert.strictEqual(realized.realized_n, 2);
  assert.strictEqual(realized.win_n, 1);
  assert.strictEqual(Number(realized.net_pnl_quote.toFixed(2)), 5.00);

  const reflection = __test.buildReflection({
    periodLabel: "당일",
    objective: { failed_checks: ["NO_TRADE_ACTIVITY", "ZERO_KRW_IDLE", "PERIOD_TARGET_NOT_MET"] },
    entryOverall: { executed_n: 0 },
    realizedOverall: { realized_n: 0, net_pnl_quote: 0, win_rate: null, avg_ret_net: null },
    dropSummary: { counts: { QUALITY: 4, AI: 1, MARKET: 0, EV: 0, TIMING: 0, OPS: 0 }, top_reasons: [{ reason: "DROP_LONG_GATE_SCORE", n: 3 }] },
    quality: { by_tier: { CORE: { executed_n: 2, avg_ret_net: -0.01 }, EARLY: { executed_n: 1, avg_ret_net: 0.01 } } },
  });
  assert.strictEqual(Array.isArray(reflection), true);
  assert.ok(reflection.some((line) => line.includes("0원")));
  assert.ok(reflection.some((line) => line.includes("1차 상태/무결성")));

  console.log("OBJECTIVE_RETROSPECTIVE_TEST_OK");
})();
