"use strict";

const assert = require("assert");
const { recordSignalDrops } = require("../storage/signalDrops");

function buildFakeDb(calls) {
  return {
    collection(name) {
      calls.push({ type: "collection", name });
      return {
        doc(id) {
          calls.push({ type: "doc", name, id });
          return {
            async set(payload, options) {
              calls.push({ type: "set", name, id, payload, options });
            },
          };
        },
      };
    },
  };
}

async function discoveryCanaryDropsAreShadowedAndExcludedFromFormalEvolution() {
  const calls = [];
  const drop = {
    signal_id: "SIG__BINANCEFUT__LINKUSDT__15m__1777165200000__SHORT",
    bar_close_time_utc_ms: 1777165200000,
    event: "SHORT",
    side: "SELL",
    reason: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
    execution_mode: "LIVE",
    features_json: {
      signal_id: "SIG__BINANCEFUT__LINKUSDT__15m__1777165200000__SHORT",
      strategy_id: "donbeolja_v7.0.0.0",
      discovery_canary_bridge: true,
      v2_discovery_signal_fan_in_handoff: true,
      v2_discovery_entry_filter_authority: "PRODUCTION_ENTRY_ROUTE",
    },
  };

  const result = await recordSignalDrops({
    db: buildFakeDb(calls),
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    tf: "15m",
    runId: "RUN__CANARY_SHADOW",
    drops: [drop],
    tryLockSignalFn: async () => ({ ok: true }),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, 1);
  assert.strictEqual(result.self_evolution_runtime_confirmed_n, 0);
  assert.strictEqual(result.canary_evolution_shadow_n, 1);
  assert.strictEqual(result.canary_evolution_shadow_commit.ok, true);

  const droppedWrite = calls.find((row) => row.type === "set" && row.name === "signals_dropped");
  assert.ok(droppedWrite);
  assert.strictEqual(droppedWrite.payload.signal_id, drop.signal_id);

  const shadowWrite = calls.find((row) => row.type === "set" && row.name === "v2__signals_canary_evolution_shadow");
  assert.ok(shadowWrite);
  assert.strictEqual(shadowWrite.payload.shadow_type, "V2_DISCOVERY_CANARY_SELF_EVOLUTION_SHADOW");
  assert.strictEqual(shadowWrite.payload.formal_self_evolution_confirmed, false);
  assert.strictEqual(shadowWrite.payload.bridge_discovery_canary_enabled, true);
  assert.strictEqual(shadowWrite.payload.signal_id, drop.signal_id);
  assert.strictEqual(shadowWrite.payload.strategy_id, "donbeolja_v7.0.0.0");
}

async function main() {
  await discoveryCanaryDropsAreShadowedAndExcludedFromFormalEvolution();
}

main()
  .then(() => {
    console.log("SIGNAL_DROP_CANARY_EVOLUTION_SHADOW_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
