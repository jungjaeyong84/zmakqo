"use strict";

const assert = require("assert");
const {
  buildObjectiveVerdict,
  buildPeriodObjectiveVerdict,
  periodTargetKrw,
} = require("../../scripts/lib/objective-policy");

(() => {
  assert.strictEqual(periodTargetKrw("DAILY", { minMonthlyNetKrw: 150000, monthDays: 30 }), 5000);
  assert.strictEqual(periodTargetKrw("WEEKLY", { minMonthlyNetKrw: 150000, monthDays: 30 }), 35000);
  assert.strictEqual(periodTargetKrw("MONTHLY", { minMonthlyNetKrw: 150000, monthDays: 30 }), 150000);

  const idle = buildObjectiveVerdict(
    { executed_n: 0, realized_n: 0, win_rate: null, avg_ret_net: null, net_pnl_quote: 0 },
    { realizedMinSample: 8, minWinRate: 0.6, minMonthlyNetKrw: 150000, monthlyNetPnlKrw: 0, monthlyObservedDays: 30 }
  );
  assert.strictEqual(idle.activity_pass, false);
  assert.strictEqual(idle.pass, false);
  assert.strictEqual(idle.failed_checks.includes("NO_TRADE_ACTIVITY"), true);
  assert.strictEqual(idle.failed_checks.includes("ZERO_KRW_IDLE"), true);

  const dailyFail = buildPeriodObjectiveVerdict("DAILY", {
    executed_n: 0,
    realized_n: 0,
    win_rate: null,
    avg_ret_net: null,
    net_pnl_quote: 0,
  }, {
    observedDays: 1,
    targetNetKrw: 5000,
    minMonthlyNetKrw: 150000,
    tradeCount: 0,
    realizedMinSample: 1,
  });
  assert.strictEqual(dailyFail.verdict, "FAIL");
  assert.strictEqual(dailyFail.target_pass, false);
  assert.strictEqual(dailyFail.failed_checks.includes("NO_TRADE_ACTIVITY"), true);

  const dailyPass = buildPeriodObjectiveVerdict("DAILY", {
    executed_n: 2,
    realized_n: 2,
    win_rate: 1,
    avg_ret_net: 0.02,
    net_pnl_quote: 6000,
  }, {
    observedDays: 1,
    targetNetKrw: 5000,
    minMonthlyNetKrw: 150000,
    tradeCount: 2,
    realizedMinSample: 1,
  });
  assert.strictEqual(dailyPass.verdict, "PASS");
  assert.strictEqual(dailyPass.pass, true);
  assert.strictEqual(dailyPass.target_pass, true);

  const noNewEntryButNegativeRealized = buildPeriodObjectiveVerdict("DAILY", {
    executed_n: 0,
    realized_n: 2,
    win_rate: 0.5,
    avg_ret_net: -0.01,
    net_pnl_quote: -1200,
  }, {
    observedDays: 1,
    targetNetKrw: 5000,
    minMonthlyNetKrw: 150000,
    tradeCount: 0,
    realizedMinSample: 1,
  });
  assert.strictEqual(noNewEntryButNegativeRealized.failed_checks.includes("ZERO_KRW_IDLE"), false);
  assert.strictEqual(noNewEntryButNegativeRealized.failed_checks.includes("NET_NOT_POSITIVE"), true);

  console.log("OBJECTIVE_POLICY_TEST_OK");
})();
