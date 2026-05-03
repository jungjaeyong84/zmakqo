"use strict";

const assert = require("assert");
const {
  deriveDatasetObjectiveScore,
  deriveMarketObjectiveScores,
  deriveMarketConcentrationDiagnostics,
  deriveCanonicalParityDiagnostics,
  deriveCanonicalProvenanceDiagnostics,
  deriveServerPrimaryCanaryDiagnostics,
  derivePineShadowDriftDiagnostics,
  deriveAttribution,
} = require("../../src/utils/bestSelfEvolutionAnalysis");

function run() {
  const dataset = {
    summary: {
      rows_n: 6,
      executed_n: 3,
      drop_n: 1,
      missed_n: 1,
      fallback_n: 1,
      features_coverage_rate: 0.9,
      avg_realized_ret_net: 0.01,
    },
    rows: [
      {
        market: "BTCUSDT",
        source_row_type: "EXECUTED",
        febt_phase: "FIRE",
        realized_ret_net: 0.03,
        realized_pnl_quote: 300,
        tp1_first: true,
        features_json: { ok: true },
      },
      {
        market: "BTCUSDT",
        source_row_type: "EXECUTED",
        febt_phase: "LATE",
        realized_ret_net: -0.02,
        realized_pnl_quote: -200,
        tp1_first: false,
        features_json: { ok: true },
      },
      {
        market: "ETHUSDT",
        source_row_type: "EXECUTED",
        febt_phase: "FIRE",
        realized_ret_net: -0.01,
        realized_pnl_quote: -100,
        tp1_first: false,
        features_json: { ok: true },
      },
      {
        market: "SOLUSDT",
        source_row_type: "FALLBACK",
        febt_phase: "ARMED",
        realized_ret_net: -0.005,
        realized_pnl_quote: -50,
        tp1_first: false,
        fallback_reason: "LEGACY_WAIT",
        features_json: { ok: true },
      },
      {
        market: "DOGEUSDT",
        source_row_type: "DROP",
        febt_phase: "FIRE",
        drop_stage_key: "TIMING",
        drop_reason: "DROP_WAIT_ONE_BAR_TIMING",
        realized_ret_net: 0.03,
        realized_pnl_quote: 300,
        features_json: { ok: true },
      },
      {
        market: "XRPUSDT",
        source_row_type: "MISSED",
        febt_phase: "PREPARE",
        drop_stage_key: "QUALITY",
        drop_reason: "DROP_MARKET_PHYSICS_DISORDER",
        features_json: null,
      },
    ],
  };
  const governance = {
    current: {
      objective: {
        monthly_run_rate_krw: 1700000,
        monthly_pass: true,
        pass: true,
      },
      overall: {
        win_rate: 0.55,
        avg_ret_net: 0.01,
      },
    },
    objective: {
      min_monthly_net_krw: 150000,
    },
  };
  const phase0 = {
    bridge_latency: {
      webhook_to_fill_ms: { p95: 1400 },
      duplicate_count: 1,
      reject_count: 0,
    },
    legacy_wait_baseline: {
      immediate_win_rate: 0.57,
    },
  };
  const tuningContract = {
    projected_count_ratio_global: 1.02,
    projected_replacement_ratio: 0.83,
    disagreement_n: 1,
    fallback_legacy_n: 1,
    fire_n: 2,
    late_n: 1,
    void_n: 0,
  };
  const marketContracts = [
    { market: "BTCUSDT", projected_count_ratio_global: 1.05, projected_replacement_ratio: 1.0, disagreement_n: 0, fallback_legacy_n: 0, sampled_n: 2, mode: "NORMAL" },
    { market: "ETHUSDT", projected_count_ratio_global: 0.95, projected_replacement_ratio: 0.5, disagreement_n: 1, fallback_legacy_n: 0, sampled_n: 1, mode: "COUNT_GUARD_ACTIVE" },
    { market: "SOLUSDT", projected_count_ratio_global: 1.0, projected_replacement_ratio: 1.0, disagreement_n: 0, fallback_legacy_n: 1, sampled_n: 1, mode: "NORMAL" },
  ];

  const objective = deriveDatasetObjectiveScore({
    dataset,
    governance,
    phase0,
    tuningContract,
  });
  assert.strictEqual(typeof objective.objective_score, "number");
  assert.strictEqual(objective.constraints.count_floor_pass, true);
  assert.strictEqual(objective.constraints.replacement_floor_pass, true);
  assert.strictEqual(objective.constraints.latency_budget_pass, true);
  assert.strictEqual(objective.snapshot.cohort_scope, "SELF_EVOLUTION_ENTRY_EXECUTED_COHORT");
  assert.strictEqual(objective.snapshot.executed_n, 4);
  assert.strictEqual(objective.snapshot.strict_executed_n, 3);
  assert.strictEqual(objective.snapshot.fallback_n, 1);
  assert.strictEqual(objective.snapshot.win_rate, 0.25);
  assert.strictEqual(objective.snapshot.fire_n, 2);

  const markets = deriveMarketObjectiveScores({
    dataset,
    governance,
    phase0,
    marketContracts,
  });
  assert.strictEqual(Array.isArray(markets), true);
  assert.strictEqual(markets.length >= 3, true);
  assert.strictEqual(markets[0].market, "BTCUSDT");
  assert.ok(markets.some((row) => row.market === "ETHUSDT" && row.mode === "COUNT_GUARD_ACTIVE"));

  const concentration = deriveMarketConcentrationDiagnostics({
    globalObjectiveScore: objective.objective_score,
    marketObjectiveScores: markets,
  });
  assert.strictEqual(concentration.available, true);
  assert.strictEqual(typeof concentration.objective_score_ex_bottom_market, "number");

  const parity = deriveCanonicalParityDiagnostics({
    summary: {
      rows_n: 90,
      shadow_applicable_n: 7,
      shadow_observed_n: 7,
      parity_mismatch_n: 4,
      parity_mismatch_rate: 0.5714285714,
      source_parity_match_n: 7,
      source_parity_mismatch_n: 0,
      final_downstream_mismatch_n: 4,
      by_actual_drop_reason_family: [
        { key: "EV_POLICY", count: 2 },
        { key: "COOLDOWN_POLICY", count: 1 },
        { key: "STRATEGY_GATE", count: 1 },
      ],
    },
  });
  assert.strictEqual(parity.available, true);
  assert.strictEqual(parity.source_quality_pass, true);
  assert.strictEqual(parity.downstream_ev_pressure, true);
  assert.strictEqual(parity.ev_policy_mismatch_n, 2);
  assert.strictEqual(parity.dominant_mismatch_family, "EV_POLICY");

  const provenance = deriveCanonicalProvenanceDiagnostics({
    summary: {
      eligible_n: 7,
      complete_n: 5,
      with_bundle_version_n: 6,
      with_threshold_bundle_version_n: 5,
      with_source_mode_n: 7,
      with_actual_source_decision_n: 6,
      by_collection: [
        { collection: "signals", complete_rate: 1 },
        { collection: "signals_dropped", complete_rate: 0.5 },
      ],
    },
  });
  assert.strictEqual(provenance.available, true);
  assert.strictEqual(provenance.storage_contract_pass, false);
  assert.strictEqual(provenance.storage_contract_gap_n, 2);
  assert.strictEqual(provenance.dominant_gap_collection, "signals_dropped");

  const cutoverProvenance = deriveCanonicalProvenanceDiagnostics({
    summary: {
      cutover_reference_iso: "2026-03-31T09:06:01.827Z",
      cutover_reference_source: "SOURCE_MODE",
      post_cutover_status: "NO_ENGINE_ROWS_AFTER_CUTOVER",
      post_cutover_engine_eligible_n: 0,
      post_cutover_complete_n: 0,
      post_cutover_with_bundle_version_n: 0,
      post_cutover_with_threshold_bundle_version_n: 0,
      post_cutover_with_source_mode_n: 0,
      post_cutover_with_actual_source_decision_n: 0,
      post_cutover_by_collection: [],
    },
  });
  assert.strictEqual(cutoverProvenance.using_cutover_cohort, true);
  assert.strictEqual(cutoverProvenance.awaiting_post_cutover_rows, true);
  assert.strictEqual(cutoverProvenance.storage_contract_pass, null);
  assert.strictEqual(cutoverProvenance.storage_contract_gap_n, 0);

  const serverPrimaryCanary = deriveServerPrimaryCanaryDiagnostics({
    summary: {
      server_primary_executed_n: 3,
      server_primary_realized_n: 2,
      pine_shadow_disagreement_n: 1,
      pine_shadow_disagreement_rate: 0.3333,
      server_primary_win_rate: 0.5,
      server_primary_avg_ret_net: -0.01,
      rollback_trigger_n: 1,
      apply_pass: false,
      acceptance_min_executed: 2,
      acceptance_ready: false,
      acceptance_reason: "SERVER_PRIMARY_CANARY_BLOCK",
    },
  });
  assert.strictEqual(serverPrimaryCanary.available, true);
  assert.strictEqual(serverPrimaryCanary.executed_n, 3);
  assert.strictEqual(serverPrimaryCanary.rollback_trigger_n, 1);
  assert.strictEqual(serverPrimaryCanary.apply_pass, false);
  assert.strictEqual(serverPrimaryCanary.acceptance_ready, false);
  assert.strictEqual(serverPrimaryCanary.acceptance_reason, "SERVER_PRIMARY_CANARY_BLOCK");

  const pineShadowDrift = derivePineShadowDriftDiagnostics({
    summary: {
      audit_only: true,
      observed_n: 4,
      drift_n: 1,
      drift_rate: 0.25,
      executed_drift_n: 1,
      drop_drift_n: 0,
      by_market: [{ key: "AXSUSDT", count: 1 }],
    },
  });
  assert.strictEqual(pineShadowDrift.available, true);
  assert.strictEqual(pineShadowDrift.audit_only, true);
  assert.strictEqual(pineShadowDrift.drift_present, true);
  assert.strictEqual(pineShadowDrift.top_drift_market, "AXSUSDT");

  const attribution = deriveAttribution({ dataset });
  assert.strictEqual(attribution.summary.drop_top_layer.key, "QUALITY");
  assert.strictEqual(attribution.summary.late_loss_top_market.key, "BTCUSDT");
  assert.strictEqual(attribution.summary.false_fire_top_market.key, "ETHUSDT");
  assert.strictEqual(attribution.summary.missed_recovery_top_reason.key, "DROP_WAIT_ONE_BAR_TIMING");
  assert.strictEqual(attribution.summary.fallback_cost_top_market.key, "SOLUSDT");
  assert.strictEqual(attribution.drop_attribution[0].avg_ret_net, 0.03);
  assert.strictEqual(attribution.drop_attribution[0].missed_gain_pct, 1);
  assert.strictEqual(attribution.drop_attribution[0].saved_loss_pct, 0);

  console.log("BEST_SELF_EVOLUTION_ANALYSIS_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_ANALYSIS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
