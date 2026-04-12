"use strict";

const assert = require("assert");
const { buildFailureLearningLoop, __test } = require("../utils/failureLearningLoop");

(() => {
  assert.strictEqual(__test.deriveFailurePattern({ label_snapshot: { sl_first: true } }), "SL_FIRST");
  assert.strictEqual(__test.deriveFailurePattern({ label_snapshot: { pre_tp1_time_stop: true } }), "PRE_TP1_TIME_STOP");
  const normalized = __test.normalizeDataset({ ok: true, dataset: { rows: [{ label_snapshot: { is_executed: true } }] } });
  assert.strictEqual(Array.isArray(normalized.rows), true);
})();

(() => {
  const summary = buildFailureLearningLoop({
    dataset: {
      dataset_hash: "DATASET_HASH",
      rows: [
        { market: "DOGEUSDT", feature_snapshot: { pnl_krw_gross: -10, fee_value: 1 }, label_snapshot: { is_executed: true, realized_ret_net: -0.03, sl_first: true } },
        { market: "DOGEUSDT", feature_snapshot: { pnl_krw_gross: 2, fee_value: 4 }, label_snapshot: { is_executed: true, realized_ret_net: 0.001 } },
        { market: "ETHUSDT", feature_snapshot: { pnl_krw_gross: -3, fee_value: 0.5 }, label_snapshot: { is_executed: true, realized_ret_net: -0.01, tp0_hit: true, tp0_to_tp1_converted: false } },
      ],
    },
  });
  assert.strictEqual(summary.status, "FAILURE_LEARNING_LOOP_READY");
  assert.strictEqual(summary.executed_rows_n, 3);
  assert.strictEqual(summary.failure_rows_n, 3);
  assert.strictEqual(summary.top_failure_market, "DOGEUSDT");
  assert.strictEqual(summary.market_breakdown[0].dominant_entry_tier, "UNKNOWN");
  assert.ok(summary.recommendations.some((row) => row.key === "RAISE_EXECUTION_QUALITY_AND_REENTRY_FILTER"));
})();

(() => {
  const summary = buildFailureLearningLoop({
    dataset: {
      ok: true,
      dataset: {
        dataset_hash: "DATASET_HASH_WRAPPED",
        rows: new Array(14).fill(null).map((_, idx) => ({
          market: idx < 7 ? "DOGEUSDT" : "ETHUSDT",
          feature_snapshot: { pnl_krw_gross: idx % 3 === 0 ? -8 : 1, fee_value: idx % 4 === 0 ? 2 : (idx >= 10 ? 2.5 : 0.1), entry_tier: idx < 9 ? "CORE" : "EARLY" },
          label_snapshot: {
            is_executed: true,
            realized_ret_net: idx < 7 ? -0.02 : 0.005,
            sl_first: idx < 7,
            tp0_hit: idx >= 7,
            tp0_to_tp1_converted: idx >= 10,
          },
        })),
      },
    },
  });
  assert.strictEqual(summary.failure_rows_n, 13);
  assert.strictEqual(summary.evidence_status, "FAILURE_LEARNING_FAIL_RATE_HIGH");
  assert.strictEqual(summary.learning_ready, true);
  assert.strictEqual(summary.market_breakdown[0].dominant_entry_tier, "CORE");
  assert.ok(Array.isArray(summary.market_breakdown[0].by_pattern));
})();

(() => {
  const summary = buildFailureLearningLoop({
    dataset: {
      ok: true,
      dataset: {
        dataset_hash: "DATASET_HASH_NEG_REVIEW",
        rows: new Array(28).fill(null).map((_, idx) => ({
          market: idx < 6 ? "BTCUSDT" : (idx < 12 ? "ETHUSDT" : "XRPUSDT"),
          feature_snapshot: { pnl_krw_gross: idx < 12 ? -3 : 5, fee_value: 0.2, entry_tier: "EARLY" },
          label_snapshot: {
            is_executed: true,
            realized_ret_net: idx < 6 ? -0.003 : (idx < 12 ? -0.0035 : 0.01),
          },
        })),
      },
    },
  });
  assert.strictEqual(summary.learning_ready, true);
  assert.strictEqual(summary.evidence_status, "FAILURE_LEARNING_NEGATIVE_REVIEW");
  assert.strictEqual(summary.blocking_reasons.includes("FAILURE_LEARNING_NEGATIVE_DOMINANT"), false);
  assert.strictEqual(summary.strong_negative_market_n, 0);
})();

console.log("FAILURE_LEARNING_LOOP_TEST_OK");
