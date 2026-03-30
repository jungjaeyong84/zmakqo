const assert = require("assert");
const { __test } = require("../../scripts/lib/best-febt-supervisor");

function run() {
  const selfEvolution = __test.buildSelfEvolutionPolicySpec();
  assert.strictEqual(selfEvolution.master_spec_path.endsWith("BEST_SELF_EVOLUTION_MASTER_SPEC.md"), true);
  assert.strictEqual(selfEvolution.dataset_latest_path.endsWith("best_self_evolution_dataset_latest.json"), true);
  assert.strictEqual(selfEvolution.objective_latest_path.endsWith("best_self_evolution_objective_latest.json"), true);
  assert.strictEqual(selfEvolution.attribution_latest_path.endsWith("best_self_evolution_attribution_latest.json"), true);
  assert.strictEqual(selfEvolution.candidates_latest_path.endsWith("best_self_evolution_candidates_latest.json"), true);
  assert.strictEqual(selfEvolution.replay_latest_path.endsWith("best_self_evolution_replay_latest.json"), true);
  assert.strictEqual(selfEvolution.canary_latest_path.endsWith("best_self_evolution_canary_latest.json"), true);
  assert.strictEqual(selfEvolution.memory_latest_path.endsWith("best_self_evolution_memory_latest.json"), true);
  assert.strictEqual(selfEvolution.weight_tuning_latest_path.endsWith("best_self_evolution_weight_tuning_latest.json"), true);
  assert.strictEqual(Array.isArray(selfEvolution.linked_paths), true);
  assert.strictEqual(selfEvolution.linked_paths.length >= 6, true);
  assert.strictEqual(selfEvolution.status, "ACTIVE");
  assert.strictEqual(selfEvolution.deployment_guards_latest_path.endsWith("best_self_evolution_deployment_guards_latest.json"), true);
  assert.strictEqual(selfEvolution.deployment_plan_latest_path.endsWith("best_self_evolution_deployment_plan_latest.json"), true);
  assert.strictEqual(selfEvolution.loop_monitor_latest_path.endsWith("best_self_evolution_loop_monitor_latest.json"), true);
  assert.strictEqual(selfEvolution.loop_run_latest_path.endsWith("best_self_evolution_loop_run_latest.json"), true);
  assert.strictEqual(selfEvolution.current_focus, "P0_DATASET,P1_OBJECTIVE,P2_ATTRIBUTION,P3_CANDIDATE_CHANGESET,P4_REPLAY,P5_CANARY,P6_AUTOROLLBACK,P7_MEMORY_LEDGER,CANARY_SCALE,DEPLOYMENT_GUARDS,DEPLOYMENT_HANDOFF,LOOP_MONITORING,LOOP_ORCHESTRATION,CYCLE_ATOMICITY,MEMORY_PREBLOCK,WEIGHT_TUNING_ADVISORY");
  assert.strictEqual(selfEvolution.next_focus, "PINE_MANUAL_PASTE_HANDOFF");

  const contracts = __test.deriveBestFebtMarketContracts({
    governance: {
      current: {
        quality: {
          chain_rows: [
            {
              market: "BTCUSDT",
              febt_phase: "FIRE",
              febt_calc_ok: true,
              febt_payload_missing: false,
              febt_shadow_disagrees_legacy_wait: true,
              febt_shadow_disagreement_reason: "FEBT_ALLOW_LEGACY_WAIT",
              febt_shadow_fallback_to_legacy: false,
              febt_shadow_verdict: "ALLOW",
              febt_shadow_legacy_wait_action: "WAIT_HARD",
            },
            {
              market: "DOGEUSDT",
              febt_phase: "LATE",
              febt_calc_ok: true,
              febt_payload_missing: false,
              febt_shadow_disagrees_legacy_wait: true,
              febt_shadow_disagreement_reason: "FEBT_BLOCK_LEGACY_ALLOW",
              febt_shadow_fallback_to_legacy: false,
              febt_shadow_verdict: "BLOCK",
              febt_shadow_legacy_wait_action: "ALLOW",
            },
          ],
        },
      },
    },
    objectiveSupervisor: {
      verdict: "HOLD",
    },
    selfEvolutionDataset: {
      summary: {
        febt_active_eligible_by_market: [
          { key: "ETHUSDT", eligible_n: 10, with_febt_n: 6, coverage_rate: 0.6 },
          { key: "DOGEUSDT", eligible_n: 4, with_febt_n: 0, coverage_rate: 0 },
        ],
        entry_fallback_pending_active_by_market: [
          { key: "ETHUSDT", count: 2 },
          { key: "DOGEUSDT", count: 1 },
        ],
        entry_fallback_payload_missing_by_market: [
          { key: "ETHUSDT", count: 2 },
          { key: "DOGEUSDT", count: 1 },
        ],
      },
    },
  });

  assert.strictEqual(Array.isArray(contracts), true);
  assert.strictEqual(contracts.length, 3);
  const byMarket = new Map(contracts.map((row) => [row.market, row]));
  assert.strictEqual(byMarket.get("BTCUSDT").mode, "NORMAL");
  assert.strictEqual(byMarket.get("DOGEUSDT").mode, "COUNT_GUARD_ACTIVE");
  assert.strictEqual(byMarket.get("DOGEUSDT").dominant_disagreement_reason, "FEBT_BLOCK_LEGACY_ALLOW");
  assert.strictEqual(byMarket.get("ETHUSDT").calc_ok_rate, 0.6);
  assert.strictEqual(byMarket.get("ETHUSDT").dominant_shadow_verdict, "ACTIVE_DATASET");

  const marketGuard = __test.deriveBestFebtMarketGuardContract({
    contract: { mode: "NORMAL" },
    marketContracts: contracts,
  });
  assert.strictEqual(marketGuard.market, "DOGEUSDT");
  assert.strictEqual(marketGuard.mode, "COUNT_GUARD_ACTIVE");

  console.log("BEST_FEBT_SUPERVISOR_TEST_OK");
}

run();
