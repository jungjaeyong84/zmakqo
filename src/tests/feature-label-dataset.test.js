"use strict";

const assert = require("assert");
const { buildFeatureLabelDataset, __test } = require("../services/featureLabelDataset");
const { __test: tradesFromFillsTest } = require("../services/tradesFromFills");

async function run() {
  const dataset = await buildFeatureLabelDataset({
    exchange: "BINANCEFUT",
    markets: [],
    tf: "15m",
    limitN: 10,
  });

  assert.strictEqual(dataset.schema_version, "FEATURE_LABEL_DATASET_V2");
  assert.strictEqual(dataset.source_collection, "UNIFIED_EVENT_TIMELINE");
  assert.strictEqual(dataset.immutable_source, true);
  assert.strictEqual(dataset.rows_n, 0);
  assert.deepStrictEqual(dataset.rows, []);
  assert.ok(dataset.created_at);
  assert.ok(dataset.source_manifest);
  assert.strictEqual(dataset.source_manifest.manifest_version, "FEATURE_LABEL_PROVENANCE_V2");
  assert.strictEqual(dataset.source_manifest.strict_event_truth_only, true);
  assert.ok(/^[0-9a-f]{64}$/.test(dataset.source_manifest.manifest_hash));
  assert.ok(/^[0-9a-f]{64}$/.test(dataset.dataset_hash));

  const provenance = __test.buildRowProvenance({
    exchange: "BINANCEFUT",
    market: "BTCUSDT",
    tf: "15m",
    trade: {
      entry_event_id: "ENTRY__1",
      close_ms: 1,
      close_type: "FULL_CLOSE",
      pnl_krw_gross: 100,
      fee_value: 1,
      funding_paid: 0,
      notional_krw: 1000,
      source_event_refs: [
        {
          unified_event_id: "UNIFIED__1",
          source_document_id: "fill_events/FILL_EVENT__1",
          event_kind: "FILL_MUTATION",
          ts_ms: 1,
        },
      ],
    },
  });
  assert.strictEqual(provenance.strict_event_truth_only, true);
  assert.strictEqual(provenance.source_event_refs.length, 1);
  assert.ok(/^[0-9a-f]{64}$/.test(provenance.source_event_manifest_hash));
  __test.assertImmutableEventProvenance([{ provenance }]);

  const featureSnapshot = __test.buildFeatureSnapshot({
    market: "BTCUSDT",
    tf: "15m",
    trade: {
      pnl_krw_gross: 100,
      fee_value: 1,
      funding_paid: 0,
      notional_krw: 1000,
      entry_signal_type: "core",
      position_side: "LONG",
      close_type: "PARTIAL_CLOSE",
      exit_event: "EXIT_TP_P0_0.8P",
      features_json: {
        confidence: 0.88,
        long_posterior: 0.71,
        openclaw_market_regime_cohort: "RESCUE",
        pro_regime_state: "trend",
      },
    },
  });
  assert.strictEqual(featureSnapshot.entry_tier, "CORE");
  assert.strictEqual(featureSnapshot.position_side, "LONG");
  assert.strictEqual(featureSnapshot.close_type, "PARTIAL_CLOSE");
  assert.strictEqual(featureSnapshot.exit_event, "EXIT_TP_P0_0.8P");
  assert.strictEqual(featureSnapshot.confidence, 0.88);
  assert.strictEqual(featureSnapshot.posterior, 0.71);
  assert.strictEqual(featureSnapshot.regime, "TREND");
  assert.strictEqual(featureSnapshot.openclaw_market_regime_cohort, "RESCUE");

  const topLevelRegimeSnapshot = __test.buildFeatureSnapshot({
    market: "ETHUSDT",
    tf: "15m",
    trade: {
      regime: "range",
      market_regime: "range",
      features_json: {
        confidence: 0.52,
      },
    },
  });
  assert.strictEqual(topLevelRegimeSnapshot.regime, "RANGE");

  const normalizedTradeFeatures = tradesFromFillsTest.pickFeaturesJson({
    features_json: {
      pro_regime_state: "t\rend",
      signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1__LONG",
    },
  });
  assert.strictEqual(normalizedTradeFeatures.pro_regime_state, "trend");
  assert.strictEqual(normalizedTradeFeatures.market_regime, "trend");

  console.log("FEATURE_LABEL_DATASET_TEST_OK");
}

run().catch((err) => {
  console.error("FEATURE_LABEL_DATASET_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
