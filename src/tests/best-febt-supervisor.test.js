const assert = require("assert");
const { __test } = require("../../scripts/lib/best-febt-supervisor");

function run() {
  const selfEvolution = __test.buildSelfEvolutionPolicySpec();
  assert.strictEqual(selfEvolution.master_spec_path.endsWith("BEST_SELF_EVOLUTION_MASTER_SPEC.md"), true);
  assert.strictEqual(selfEvolution.dataset_latest_path.endsWith("best_self_evolution_dataset_latest.json"), true);
  assert.strictEqual(selfEvolution.objective_latest_path.endsWith("best_self_evolution_objective_latest.json"), true);
  assert.strictEqual(selfEvolution.attribution_latest_path.endsWith("best_self_evolution_attribution_latest.json"), true);
  assert.strictEqual(Array.isArray(selfEvolution.linked_paths), true);
  assert.strictEqual(selfEvolution.linked_paths.length >= 6, true);

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
  });

  assert.strictEqual(Array.isArray(contracts), true);
  assert.strictEqual(contracts.length, 2);
  assert.strictEqual(contracts[0].market, "BTCUSDT");
  assert.strictEqual(contracts[0].mode, "NORMAL");
  assert.strictEqual(contracts[1].market, "DOGEUSDT");
  assert.strictEqual(contracts[1].mode, "COUNT_GUARD_ACTIVE");
  assert.strictEqual(contracts[1].dominant_disagreement_reason, "FEBT_BLOCK_LEGACY_ALLOW");

  const marketGuard = __test.deriveBestFebtMarketGuardContract({
    contract: { mode: "NORMAL" },
    marketContracts: contracts,
  });
  assert.strictEqual(marketGuard.market, "DOGEUSDT");
  assert.strictEqual(marketGuard.mode, "COUNT_GUARD_ACTIVE");

  console.log("BEST_FEBT_SUPERVISOR_TEST_OK");
}

run();
