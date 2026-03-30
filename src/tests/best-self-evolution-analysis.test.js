"use strict";

const assert = require("assert");
const {
  deriveDatasetObjectiveScore,
  deriveMarketObjectiveScores,
  deriveMarketConcentrationDiagnostics,
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
      min_monthly_net_krw: 1500000,
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
