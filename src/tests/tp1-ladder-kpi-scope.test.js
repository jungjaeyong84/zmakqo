"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  assert.strictEqual(typeof __test.resolveTp1LadderKpiForContext, "function", "resolveTp1LadderKpiForContext export missing");

  const snapshot = {
    global: {
      realized_n: 24,
      tp0_hit_rate: 0.75,
      tp1_hit_rate: 0.375,
      tp0_to_tp1_conversion: 0,
      fee_adjusted_expectancy: -0.001,
    },
    byMarket: new Map([
      ["BNBUSDT", {
        realized_n: 30,
        tp0_hit_rate: 0.7,
        tp1_hit_rate: 0.45,
        tp0_to_tp1_conversion: 0.4,
        fee_adjusted_expectancy: 0.002,
      }],
    ]),
    byCohort: new Map([
      ["RESCUE", {
        realized_n: 12,
        tp0_hit_rate: 0.6,
        tp1_hit_rate: 0.25,
        tp0_to_tp1_conversion: 0.22,
        fee_adjusted_expectancy: 0.0001,
      }],
    ]),
  };

  const marketPick = __test.resolveTp1LadderKpiForContext(snapshot, {
    market: "BNBUSDT",
    cohort: "MIXED",
  });
  assert.strictEqual(marketPick.scope, "MARKET");
  assert.strictEqual(marketPick.kpi.realized_n, 30);

  const cohortPick = __test.resolveTp1LadderKpiForContext(snapshot, {
    market: "XRPUSDT",
    cohort: "RESCUE",
  });
  assert.strictEqual(cohortPick.scope, "COHORT");
  assert.strictEqual(cohortPick.kpi.realized_n, 12);

  const globalPick = __test.resolveTp1LadderKpiForContext(snapshot, {
    market: "XRPUSDT",
    cohort: "KEEP_DROP",
  });
  assert.strictEqual(globalPick.scope, "GLOBAL");
  assert.strictEqual(globalPick.kpi.realized_n, 24);
}

try {
  run();
  console.log("TP1_LADDER_KPI_SCOPE_TEST_OK");
} catch (err) {
  console.error("TP1_LADDER_KPI_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
