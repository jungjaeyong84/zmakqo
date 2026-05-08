"use strict";

const assert = require("assert");
const {
  __test: {
    extractFrozenEvidence,
    evaluateBundleEvidence,
  },
} = require("../../scripts/audit-v2-openclaw-bundle-evidence");

(function passesWhenFrozenEvidenceIsPresent() {
  const row = {
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
    },
  };
  const frozen = extractFrozenEvidence(row);
  assert.strictEqual(frozen.btc_feature_contract, "LONG");
  assert.strictEqual(frozen.mtf_feature_contract, "SHORT");
  assert.strictEqual(frozen.btc_market_metrics, "LONG");
  assert.strictEqual(frozen.mtf_market_metrics, "SHORT");
  const verdict = evaluateBundleEvidence(row);
  assert.strictEqual(verdict.ok, true);
  assert.deepStrictEqual(verdict.missing, []);
  assert.deepStrictEqual(verdict.warnings, []);
})();

(function failsWhenFrozenEvidenceIsMissing() {
  const row = {
    bundle_payload: {
      signalCriteria: {
        feature_snapshot_contract: {
          mtf_1h_direction: "LONG",
        },
      },
      marketDataQuality: {
        metrics: {},
      },
    },
  };
  const verdict = evaluateBundleEvidence(row);
  assert.strictEqual(verdict.ok, false);
  assert.ok(verdict.missing.includes("BTC_1H_TREND_MISSING"));
  assert.ok(verdict.warnings.includes("FEATURE_CONTRACT:BTC_1H_TREND_MISSING"));
  assert.ok(verdict.warnings.includes("MARKET_METRICS:BTC_1H_TREND_MISSING"));
  assert.ok(verdict.warnings.includes("MARKET_METRICS:MTF_1H_DIRECTION_MISSING"));
})();

(function passesWhenFeatureContractAloneHasFrozenEvidence() {
  const row = {
    bundle_payload: {
      signalCriteria: {
        feature_snapshot_contract: {
          btc_1h_trend: "LONG",
          mtf_1h_direction: "SHORT",
        },
      },
      marketDataQuality: {
        metrics: {},
      },
    },
  };
  const verdict = evaluateBundleEvidence(row);
  assert.strictEqual(verdict.ok, true);
  assert.deepStrictEqual(verdict.missing, []);
  assert.ok(verdict.warnings.includes("MARKET_METRICS:BTC_1H_TREND_MISSING"));
  assert.ok(verdict.warnings.includes("MARKET_METRICS:MTF_1H_DIRECTION_MISSING"));
})();

console.log("AUDIT_V2_OPENCLAW_BUNDLE_EVIDENCE_TEST_OK");
