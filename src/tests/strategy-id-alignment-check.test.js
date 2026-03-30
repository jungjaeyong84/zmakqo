"use strict";

const assert = require("assert");

const {
  normalizeStrategyIdCsv,
  strategyIdCsvEqual,
  resolveMismatchAuditCounts,
} = require("../../scripts/strategy-id-alignment-check");

(() => {
  const normalized = normalizeStrategyIdCsv("donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v6.0.3.1,donbeolja_v6.0.3.0");
  assert.deepStrictEqual(normalized, ["donbeolja_v6.0.3.1", "donbeolja_v6.0.3.0", "STRAT_v010"]);

  assert.strictEqual(
    strategyIdCsvEqual(
      "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010",
      "STRAT_v010,donbeolja_v6.0.3.0,donbeolja_v6.0.3.1"
    ),
    true
  );

  assert.strictEqual(
    strategyIdCsvEqual(
      "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010",
      "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0"
    ),
    false
  );

  assert.deepStrictEqual(
    resolveMismatchAuditCounts({
      mismatchTotal: 18,
      mismatchHistoricalCount: 18,
      mismatchFreshness: {
        total_count: 19,
        created_before_live_revision_count: 19,
      },
    }),
    { total: 19, historical: 19 }
  );

  console.log("STRATEGY_ID_ALIGNMENT_CHECK_TEST_OK");
})();
