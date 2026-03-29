"use strict";

const assert = require("assert");
const { buildFilterFeatureSignature } = require("../utils/filterFeatureBuckets");

function run() {
  const sig = buildFilterFeatureSignature({
    signal_bar_close_time_utc_ms: Date.UTC(2026, 2, 26, 0, 0, 0),
    features_json: {
      score: -41.2,
      confidence: 0.53,
      zz_wave_conf: 0.66,
      _late_by_bars: 1,
      ev_gate_atr_pct: 0.008,
      market_state_summary_state: "MIXED",
      market_state_summary_action: "REDUCE",
      wait_one_bar_market_state_action: "DROP",
      ev_gate_policy_version: "TP1_WEIGHT_V1",
      ev_gate_policy_source: "DEFAULT",
    },
    regime: "trend",
  });
  assert.strictEqual(sig.regime, "trend");
  assert.strictEqual(sig.score_bucket, "35-44");
  assert.strictEqual(sig.conf_bucket, "0.50-0.54");
  assert.strictEqual(sig.wave_bucket, "0.65-0.69");
  assert.strictEqual(sig.late_bucket, "late1");
  assert.strictEqual(sig.volatility_bucket, "0.5-0.99%");
  assert.strictEqual(sig.session_bucket, "asia");
  assert.strictEqual(sig.market_state_summary_state, "MIXED");
  assert.strictEqual(sig.market_state_summary_action, "REDUCE");
  assert.strictEqual(sig.wait_one_bar_market_state_action, "DROP");
  assert.strictEqual(sig.ev_gate_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(sig.ev_gate_policy_source, "DEFAULT");
  console.log("FILTER_FEATURE_BUCKETS_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FILTER_FEATURE_BUCKETS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
