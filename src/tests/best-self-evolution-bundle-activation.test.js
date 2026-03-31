"use strict";

const assert = require("assert");
const { deriveBundleActivation } = require("../../src/utils/bestSelfEvolutionBundleActivation");

(() => {
  const report = deriveBundleActivation({
    manualPasteAck: {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-31T01:00:00.000Z",
      applied_strategy_id: "donbeolja_v6.0.3.3",
      canonical_source_synced: true,
      confirmation_timeout_minutes: 180,
    },
    systemSettings: {
      canonical_engine_source_mode: "PINE_PRIMARY",
      canonical_engine_core_score_abs: 33,
      canonical_engine_transition_core_score_abs: 29,
      canonical_engine_market_overrides: {},
    },
    signalsCache: {
      docs: [
        {
          signal_id: "SIG__1",
          created_at: "2026-03-31T01:05:00.000Z",
          event: "LONG",
          features_json: { strategy_id: "donbeolja_v6.0.3.3", event: "LONG" },
        },
      ],
    },
    dropsCache: { docs: [] },
    postApplyProbe: {
      generated_at_iso: "2026-03-31T01:06:00.000Z",
    },
    nowMs: Date.parse("2026-03-31T01:06:30.000Z"),
  });

  assert.strictEqual(report.summary.engine_bundle_loaded, true);
  assert.strictEqual(report.summary.policy_bundle_loaded, true);
  assert.strictEqual(report.summary.market_data_flow_ok, true);
  assert.strictEqual(report.summary.first_decision_seen, true);
  assert.strictEqual(report.summary.activation_confirmed, true);
  assert.strictEqual(report.summary.activation_reason, "ACTIVE_BY_FIRST_DECISION");
})();

(() => {
  const report = deriveBundleActivation({
    manualPasteAck: {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-31T01:00:00.000Z",
      applied_strategy_id: "donbeolja_v6.0.3.3",
      canonical_source_synced: true,
      confirmation_timeout_minutes: 60,
    },
    systemSettings: {
      canonical_engine_source_mode: "PINE_PRIMARY",
      canonical_engine_core_score_abs: 33,
      canonical_engine_transition_core_score_abs: 29,
      canonical_engine_market_overrides: {},
    },
    signalsCache: { docs: [] },
    dropsCache: { docs: [] },
    postApplyProbe: {
      generated_at_iso: "2026-03-31T01:10:00.000Z",
    },
    nowMs: Date.parse("2026-03-31T02:30:00.000Z"),
  });

  assert.strictEqual(report.summary.first_decision_seen, false);
  assert.strictEqual(report.summary.timeout_elapsed, true);
  assert.strictEqual(report.summary.activation_confirmed, true);
  assert.strictEqual(report.summary.activation_reason, "ACTIVE_BY_PROBE");
})();

(() => {
  const report = deriveBundleActivation({
    manualPasteAck: {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-31T01:00:00.000Z",
      applied_strategy_id: "donbeolja_v6.0.3.3",
      canonical_source_synced: true,
      confirmation_timeout_minutes: 60,
    },
    systemSettings: {
      canonical_engine_source_mode: "PINE_PRIMARY",
      canonical_engine_core_score_abs: 33,
      canonical_engine_transition_core_score_abs: 29,
      canonical_engine_market_overrides: {},
    },
    signalsCache: { docs: [] },
    dropsCache: { docs: [] },
    postApplyProbe: {
      generated_at_iso: "2026-03-31T01:10:00.000Z",
    },
    nowMs: Date.parse("2026-03-31T08:30:00.000Z"),
  });

  assert.strictEqual(report.summary.activation_confirmed, false);
  assert.strictEqual(report.summary.activation_pending, false);
  assert.strictEqual(report.summary.activation_status, "TIMEOUT");
  assert.strictEqual(report.summary.activation_reason, "DEPLOYMENT_CONFIRM_TIMEOUT");
  console.log("BEST_SELF_EVOLUTION_BUNDLE_ACTIVATION_TEST_OK");
})();
