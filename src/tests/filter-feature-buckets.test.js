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
      wait_one_bar_action: "ALLOW",
      wait_one_bar_trigger_path: "PHYSICS_ASSIST",
      _entry_exec_timing: "IMMEDIATE",
      ev_gate_policy_version: "TP1_WEIGHT_V1",
      ev_gate_policy_source: "DEFAULT",
      febt_mode: "SHADOW",
      febt_phase: "FIRE",
      febt_calc_ok: true,
      febt_calc_reason: "OK",
      febt_timing_action: "OBSERVE",
      febt_authority: "SHADOW_ONLY",
      febt_lock_score: 0.74,
      febt_delay_cost: 0.66,
      febt_late_risk: 0.29,
      febt_failure_risk: 0.18,
      febt_edge: 0.37,
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
  assert.strictEqual(sig.legacy_wait_action, "ALLOW");
  assert.strictEqual(sig.legacy_wait_trigger_path, "PHYSICS_ASSIST");
  assert.strictEqual(sig.entry_exec_timing, "IMMEDIATE");
  assert.strictEqual(sig.ev_gate_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(sig.ev_gate_policy_source, "DEFAULT");
  assert.strictEqual(sig.febt_mode, "SHADOW");
  assert.strictEqual(sig.febt_phase, "FIRE");
  assert.strictEqual(sig.febt_calc_ok, true);
  assert.strictEqual(sig.febt_calc_reason, "OK");
  assert.strictEqual(sig.febt_timing_action, "OBSERVE");
  assert.strictEqual(sig.febt_authority, "SHADOW_ONLY");
  assert.strictEqual(sig.febt_lock_score, 0.74);
  assert.strictEqual(sig.febt_edge, 0.37);
  assert.strictEqual(sig.febt_payload_missing, false);
  console.log("FILTER_FEATURE_BUCKETS_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FILTER_FEATURE_BUCKETS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
