"use strict";

const assert = require("assert");
const { buildEventTruthAlphaValidation, __test } = require("../utils/eventTruthAlphaValidation");

(() => {
  const summary = buildEventTruthAlphaValidation({
    dataset: {
      immutable_source: true,
      source_collection: "UNIFIED_EVENT_TIMELINE",
      dataset_hash: "DATASET_HASH",
      source_manifest: {
        immutable_source: true,
        strict_event_truth_only: true,
        source_collection: "UNIFIED_EVENT_TIMELINE",
        manifest_hash: "MANIFEST_HASH",
      },
      rows: [
        { market: "BTCUSDT", label_snapshot: { is_executed: true, is_realized: true, realized_direction: "POSITIVE", realized_ret_net: 0.03, realized_pnl_quote: 12, tp0_hit: true, tp0_to_tp1_converted: true } },
        { market: "BTCUSDT", label_snapshot: { is_executed: true, is_realized: true, realized_direction: "NEGATIVE", realized_ret_net: -0.01, realized_pnl_quote: -4, tp0_hit: false, tp0_to_tp1_converted: false } },
        { market: "ETHUSDT", label_snapshot: { is_executed: true, is_realized: true, realized_direction: "POSITIVE", realized_ret_net: 0.02, realized_pnl_quote: 6, tp0_hit: true, tp0_to_tp1_converted: false } },
      ],
    },
  });
  assert.strictEqual(summary.status, "EVENT_TRUTH_ALPHA_VALIDATION_READY");
  assert.strictEqual(summary.strict_event_truth_only, true);
  assert.strictEqual(summary.realized_rows_n, 3);
  assert.strictEqual(summary.positive_n, 2);
  assert.strictEqual(summary.top_positive_market, "ETHUSDT");
  assert.ok(Array.isArray(summary.by_strategy));
  assert.ok(Array.isArray(summary.by_regime));
  assert.ok(Array.isArray(summary.by_market_side));
  assert.ok(Array.isArray(summary.by_market_side_regime));
  assert.ok(summary.periods && summary.periods.DAYS_30);
  assert.strictEqual(summary.evidence_status, "EVENT_TRUTH_SAMPLE_LOW");
})();

(() => {
  const normalized = __test.normalizeDataset({
    ok: true,
    dataset: {
      immutable_source: true,
      source_collection: "UNIFIED_EVENT_TIMELINE",
      rows: [],
    },
  });
  assert.strictEqual(normalized.immutable_source, true);
  assert.strictEqual(normalized.source_collection, "UNIFIED_EVENT_TIMELINE");
})();

(() => {
  const summary = buildEventTruthAlphaValidation({
    dataset: {
      ok: true,
      dataset: {
        immutable_source: true,
        source_collection: "UNIFIED_EVENT_TIMELINE",
        dataset_hash: "DATASET_HASH_WRAPPED",
        source_manifest: {
          immutable_source: true,
          strict_event_truth_only: true,
          source_collection: "UNIFIED_EVENT_TIMELINE",
          manifest_hash: "MANIFEST_HASH_WRAPPED",
        },
        rows: new Array(36).fill(null).map((_, idx) => ({
          market: idx % 2 === 0 ? "BTCUSDT" : "ETHUSDT",
          label_snapshot: {
            is_executed: true,
            is_realized: true,
            realized_direction: idx < 25 ? "POSITIVE" : "NEGATIVE",
            realized_ret_net: idx < 25 ? 0.01 : -0.003,
            realized_pnl_quote: idx < 25 ? 3 : -1,
            tp0_hit: idx < 28,
            tp0_to_tp1_converted: idx < 18,
          },
        })),
      },
    },
  });
  assert.strictEqual(summary.strict_event_truth_only, true);
  assert.strictEqual(summary.realized_rows_n, 36);
  assert.strictEqual(summary.evidence_status, "EVENT_TRUTH_ALPHA_PASS");
  assert.strictEqual(summary.alpha_ready, true);
  assert.ok(summary.top_positive_strategy);
  assert.ok(summary.top_positive_regime);
  assert.ok(summary.by_market_side_regime.find((row) => row.key === "BTCUSDT|UNKNOWN|UNKNOWN"));
  assert.ok(summary.periods && summary.periods.DAYS_90);
  assert.strictEqual(summary.periods.DAYS_30.label, "최근 30일");
  assert.strictEqual(summary.periods.DAYS_90.label, "최근 90일");
})();

console.log("EVENT_TRUTH_ALPHA_VALIDATION_TEST_OK");
