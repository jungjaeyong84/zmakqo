"use strict";

const assert = require("assert");
const { summarizeFebtRows, summarizeFebtByTier, summarizeFebtPhase0Artifact } = require("../utils/febtSummary");

(() => {
  const rows = [
    {
      features_json: {
        febt_mode: "SHADOW",
        febt_phase: "FIRE",
        febt_calc_ok: true,
        febt_lock_score: 0.74,
        febt_delay_cost: 0.66,
        febt_late_risk: 0.29,
        febt_failure_risk: 0.18,
        febt_edge: 0.37,
        febt_shadow_verdict: "ALLOW_CANDIDATE",
        febt_shadow_disagrees_legacy_wait: true,
        febt_shadow_disagreement_reason: "FEBT_ALLOW_LEGACY_WAIT",
        febt_shadow_fallback_to_legacy: false,
      },
    },
    {
      features_json: {
        febt_mode: "SHADOW",
        febt_phase: "LATE",
        febt_calc_ok: false,
        febt_shadow_verdict: "LEGACY_FALLBACK",
        febt_shadow_fallback_to_legacy: true,
        febt_shadow_fallback_reason: "PAYLOAD_MISSING",
        febt_payload_missing: true,
      },
    },
  ];

  const rowSummary = summarizeFebtRows(rows);
  assert.strictEqual(rowSummary.sampled_n, 2);
  assert.strictEqual(Number(rowSummary.calc_ok_rate.toFixed(2)), 0.50);
  assert.strictEqual(rowSummary.fire_n, 1);
  assert.strictEqual(rowSummary.late_n, 1);
  assert.strictEqual(rowSummary.disagreement_n, 1);
  assert.strictEqual(rowSummary.fallback_legacy_n, 1);
  assert.strictEqual(rowSummary.top_verdict, "ALLOW_CANDIDATE");

  const byTierSummary = summarizeFebtByTier({
    EARLY: {
      signals_n: 2,
      executed_n: 2,
      febt_calc_ok_n: 1,
      febt_phase_known_n: 2,
      febt_fire_n: 1,
      febt_late_n: 1,
      febt_void_n: 0,
      febt_disagreement_n: 1,
      febt_fallback_legacy_n: 1,
      febt_payload_missing_n: 1,
      febt_lock_score_sum: 0.74,
      febt_lock_score_n: 1,
      febt_edge_sum: 0.37,
      febt_edge_n: 1,
    },
  });
  assert.strictEqual(byTierSummary.sampled_n, 2);
  assert.strictEqual(byTierSummary.signals_n, 2);
  assert.strictEqual(byTierSummary.fire_n, 1);
  assert.strictEqual(byTierSummary.late_n, 1);
  assert.strictEqual(byTierSummary.payload_missing_n, 1);
  assert.strictEqual(byTierSummary.top_phase, "FIRE");

  const phase0 = summarizeFebtPhase0Artifact({
    fresh: true,
    provider: "BINANCEFUT",
    tf: "15m",
    legacy_wait_baseline: {
      legacy_wait_coverage_rate: 0.62,
      legacy_wait_observed_chain_n: 31,
      immediate_win_rate: 0.57,
      saved_loss_pct: 0.31,
      missed_gain_pct: 0.12,
      saved_loss_minus_missed_gain: 0.19,
    },
    bridge_latency: {
      webhook_to_fill_ms: { p95: 1420 },
      duplicate_count: 1,
      stale_count: 2,
      reject_count: 3,
    },
  });
  assert.strictEqual(phase0.available, true);
  assert.strictEqual(phase0.fresh, true);
  assert.strictEqual(phase0.legacy_wait_observed_chain_n, 31);
  assert.strictEqual(phase0.webhook_to_fill_p95_ms, 1420);
  assert.strictEqual(phase0.stale_count, 2);

  console.log("FEBT_SUMMARY_TEST_OK");
})();
