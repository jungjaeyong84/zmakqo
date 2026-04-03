"use strict";

const assert = require("assert");
const { deriveDeploymentProbe } = require("../../src/utils/bestSelfEvolutionDeploymentProbe");

(() => {
  const report = deriveDeploymentProbe({
    manualPasteAck: {
      acknowledged: true,
      applied_strategy_id: "donbeolja_v6.0.3.3",
      canonical_source_synced: true,
    },
    systemSettings: {
      canonical_engine_source_mode: "SERVER_PRIMARY",
      canonical_engine_core_score_abs: 34,
      canonical_engine_transition_core_score_abs: 30,
      canonical_engine_market_overrides: {
        AXSUSDT: { source_mode: "SERVER_PRIMARY", core_score_abs: 34, transition_core_score_abs: 30 },
      },
    },
    postApplyProbe: {
      generated_at_iso: "2026-03-31T08:36:00.000Z",
    },
    nowMs: Date.parse("2026-03-31T08:40:00.000Z"),
  });

  assert.strictEqual(report.summary.engine_bundle_loaded, true);
  assert.strictEqual(report.summary.policy_bundle_loaded, true);
  assert.strictEqual(report.summary.market_data_flow_ok, true);
  assert.strictEqual(report.summary.probe_pass, true);
  assert.strictEqual(report.summary.probe_status, "PASS");

  const serverPrimary = deriveDeploymentProbe({
    manualPasteAck: { acknowledged: false, applied_strategy_id: null },
    systemSettings: {
      canonical_engine_source_mode: "SERVER_PRIMARY",
      canonical_engine_core_score_abs: 34,
      canonical_engine_transition_core_score_abs: 30,
      canonical_engine_market_overrides: {},
    },
    serverRuntime: {
      summary: {
        runtime_status: "READY",
        canonical_engine_source_mode: "SERVER_PRIMARY",
      },
    },
    cutoverReadiness: {
      summary: {
        readiness_status: "SERVER_PRIMARY_ACTIVE",
      },
    },
    serverPrimaryCanary: {
      summary: {
        acceptance_ready: true,
        apply_pass: true,
      },
    },
    postApplyProbe: {
      generated_at_iso: "2026-03-31T08:36:00.000Z",
    },
    nowMs: Date.parse("2026-03-31T08:40:00.000Z"),
  });
  assert.strictEqual(serverPrimary.summary.manual_paste_acknowledged, false);
  assert.strictEqual(serverPrimary.summary.deployment_ack_satisfied, true);
  assert.strictEqual(serverPrimary.summary.deployment_ack_mode, "SERVER_PRIMARY_RUNTIME");
  assert.strictEqual(serverPrimary.summary.probe_pass, true);
  assert.strictEqual(serverPrimary.summary.probe_reason, "PROBE_PASS_SERVER_PRIMARY");
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PROBE_TEST_OK");
})();
