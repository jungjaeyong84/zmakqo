"use strict";

const assert = require("assert");
const {
  __test: {
    normalizeBundleEvidence,
    changed,
  },
} = require("../../scripts/backfill-v2-openclaw-bundle-evidence");

(function backfillsMarketMetricsFromFeatureContract() {
  const row = {
    openclaw_decision_bundle_id: "BUNDLE__1",
    bundle_payload: {
      signalCriteria: {
        feature_snapshot_contract: {
          btc_1h_trend: "long",
          mtf_1h_direction: "short",
        },
      },
      marketDataQuality: {
        metrics: {},
      },
      canonicalEvidenceSummary: {
        market_data_quality: {
          metrics: {},
        },
      },
    },
  };
  const nextRow = normalizeBundleEvidence(row);
  assert.strictEqual(nextRow.bundle_payload.signalCriteria.feature_snapshot_contract.btc_1h_trend, "LONG");
  assert.strictEqual(nextRow.bundle_payload.signalCriteria.feature_snapshot_contract.mtf_1h_direction, "SHORT");
  assert.strictEqual(nextRow.bundle_payload.marketDataQuality.metrics.btc_1h_trend, "LONG");
  assert.strictEqual(nextRow.bundle_payload.marketDataQuality.metrics.mtf_1h_direction, "SHORT");
  assert.strictEqual(
    nextRow.bundle_payload.canonicalEvidenceSummary.market_data_quality.metrics.btc_1h_trend,
    "LONG"
  );
  assert.strictEqual(
    nextRow.bundle_payload.canonicalEvidenceSummary.market_data_quality.metrics.mtf_1h_direction,
    "SHORT"
  );
  assert.strictEqual(changed(row, nextRow), true);
})();

(function preservesExistingMetricsWhenAlreadyPresent() {
  const row = {
    openclaw_decision_bundle_id: "BUNDLE__2",
    bundle_payload: {
      signalCriteria: {
        feature_snapshot_contract: {
          btc_1h_trend: "LONG",
          mtf_1h_direction: "SHORT",
        },
      },
      marketDataQuality: {
        metrics: {
          btc_1h_trend: "LONG",
          mtf_1h_direction: "SHORT",
        },
      },
      canonicalEvidenceSummary: {
        market_data_quality: {
          metrics: {
            btc_1h_trend: "LONG",
            mtf_1h_direction: "SHORT",
          },
        },
      },
    },
  };
  const nextRow = normalizeBundleEvidence(row);
  assert.strictEqual(changed(row, nextRow), false);
})();

console.log("BACKFILL_V2_OPENCLAW_BUNDLE_EVIDENCE_TEST_OK");
