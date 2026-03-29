const assert = require("assert");
const { buildMarketCanaryRows } = require("../utils/bestSelfEvolutionCanary");

function run() {
  const ready = buildMarketCanaryRows({
    objectiveSupervisor: {
      best_febt_market_contracts: [
        { market: "BTCUSDT", mode: "NORMAL", tightening_allowed: true, recovery_priority: false },
        { market: "DOGEUSDT", mode: "COUNT_GUARD_ACTIVE", tightening_allowed: false, recovery_priority: true },
      ],
      self_evolution_objective: {
        market_objective_scores: [
          { market: "BTCUSDT", objective_score: 0.4, projected_count_ratio_global: 1.02, projected_replacement_ratio: 0.9, constraints: { count_floor_pass: true, replacement_floor_pass: true, latency_budget_pass: true } },
          { market: "DOGEUSDT", objective_score: -1.0, projected_count_ratio_global: 0.95, projected_replacement_ratio: 0.5, constraints: { count_floor_pass: false, replacement_floor_pass: false, latency_budget_pass: true } },
        ],
      },
    },
    candidateChangeSet: {
      rows: [
        { candidate_id: "AUTO_CORE_REGIME_TIGHTEN", scope: "PINE", direction: "TIGHTEN", markets: ["ALL"] },
      ],
    },
    replayReport: {
      validations: [
        { candidate_id: "AUTO_CORE_REGIME_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 0.9 },
      ],
    },
    driftCanary: { golden: { summary: { drift: 0 } }, shadow: { summary: { drift: 0 } } },
  });

  assert.strictEqual(ready.summary.apply_pass, true);
  assert.strictEqual(ready.summary.open_wave, 1);
  const btc = ready.rows.find((row) => row.market === "BTCUSDT");
  const doge = ready.rows.find((row) => row.market === "DOGEUSDT");
  assert.strictEqual(btc.current_stage, "SOFT");
  assert.strictEqual(btc.canary_action, "PROMOTE_SOFT");
  assert.strictEqual(doge.current_stage, "SHADOW");
  assert.strictEqual(doge.blockers.includes("WAVE_NOT_OPEN"), true);

  const rollback = buildMarketCanaryRows({
    objectiveSupervisor: {
      best_febt_market_contracts: [
        { market: "BTCUSDT", mode: "NORMAL", tightening_allowed: true, recovery_priority: false },
      ],
      self_evolution_objective: {
        market_objective_scores: [
          { market: "BTCUSDT", objective_score: -0.5, projected_count_ratio_global: 1.0, projected_replacement_ratio: 0.9, constraints: { count_floor_pass: true, replacement_floor_pass: true, latency_budget_pass: true } },
        ],
      },
    },
    candidateChangeSet: {
      rows: [{ candidate_id: "AUTO_CORE_REGIME_TIGHTEN", scope: "PINE", direction: "TIGHTEN", markets: ["ALL"] }],
    },
    replayReport: {
      validations: [{ candidate_id: "AUTO_CORE_REGIME_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 0.7 }],
    },
    driftCanary: { golden: { summary: { drift: 0 } }, shadow: { summary: { drift: 0 } } },
    previousCanary: {
      rows: [{ market: "BTCUSDT", current_stage: "SOFT" }],
    },
  });
  const btcRollback = rollback.rows.find((row) => row.market === "BTCUSDT");
  assert.strictEqual(btcRollback.canary_action, "AUTO_ROLLBACK");
  assert.strictEqual(rollback.summary.rollback_ready_n, 1);

  const scaled = buildMarketCanaryRows({
    objectiveSupervisor: {
      best_febt_market_contracts: [
        { market: "BTCUSDT", mode: "NORMAL", tightening_allowed: true, recovery_priority: false },
        { market: "SOLUSDT", mode: "NORMAL", tightening_allowed: true, recovery_priority: false },
        { market: "ETHUSDT", mode: "NORMAL", tightening_allowed: true, recovery_priority: false },
      ],
      self_evolution_objective: {
        market_objective_scores: [
          { market: "BTCUSDT", objective_score: 0.5, projected_count_ratio_global: 1.01, projected_replacement_ratio: 0.92, constraints: { count_floor_pass: true, replacement_floor_pass: true, latency_budget_pass: true } },
          { market: "SOLUSDT", objective_score: 0.3, projected_count_ratio_global: 1.01, projected_replacement_ratio: 0.88, constraints: { count_floor_pass: true, replacement_floor_pass: true, latency_budget_pass: true } },
          { market: "ETHUSDT", objective_score: 0.2, projected_count_ratio_global: 1.01, projected_replacement_ratio: 0.86, constraints: { count_floor_pass: true, replacement_floor_pass: true, latency_budget_pass: true } },
        ],
      },
    },
    candidateChangeSet: {
      rows: [{ candidate_id: "WAIT_ONE_BAR_TUNE", scope: "WAIT", direction: "LOOSEN", markets: ["ALL"] }],
    },
    replayReport: {
      validations: [{ candidate_id: "WAIT_ONE_BAR_TUNE", validation_verdict: "PASS", candidate_objective_delta: 0.8 }],
    },
    driftCanary: { golden: { summary: { drift: 0 } }, shadow: { summary: { drift: 0 } } },
    previousCanary: {
      summary: { apply_pass: true, rollback_ready_n: 0 },
      rows: [
        { market: "BTCUSDT", current_stage: "SOFT", canary_verdict: "READY", rollback_ready: false },
        { market: "SOLUSDT", current_stage: "SOFT", canary_verdict: "READY", rollback_ready: false },
      ],
    },
    memoryLedger: { summary: { blocked_candidate_n: 0, rolled_back_n: 0, fail_n: 0, success_n: 1, neutral_n: 0 } },
  });
  assert.strictEqual(scaled.summary.open_wave, 2);
  assert.strictEqual(scaled.summary.scale_allowed, true);

  console.log("BEST_SELF_EVOLUTION_CANARY_TEST_OK");
}

run();
