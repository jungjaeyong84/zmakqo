const assert = require("assert");
const { __test } = require("../../scripts/lib/best-febt-supervisor");

function run() {
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

  console.log("BEST_FEBT_SUPERVISOR_TEST_OK");
}

run();
