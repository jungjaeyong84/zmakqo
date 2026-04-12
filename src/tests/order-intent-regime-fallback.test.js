"use strict";

const assert = require("assert");
const { __test } = require("../storage/orderIntentsPaper");

async function run() {
  const enrichIntentFeaturesWithSignalRegime = __test && __test.enrichIntentFeaturesWithSignalRegime;
  assert.strictEqual(typeof enrichIntentFeaturesWithSignalRegime, "function", "enrichIntentFeaturesWithSignalRegime export missing");

  const inherited = await enrichIntentFeaturesWithSignalRegime({
    features: {
      signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1__CORE_SHORT",
    },
    signalDocId: "SIG__BINANCEFUT__ETHUSDT__15m__1__CORE_SHORT",
    signalLookupFn: async (id) => ({
      signal_id: id,
      regime: "trend",
      features_json: { pro_regime_state: "trend" },
    }),
  });
  assert.strictEqual(inherited.regime, "trend");
  assert.strictEqual(inherited.market_regime, "trend");
  assert.strictEqual(inherited.features.regime, "trend");

  const passthrough = await enrichIntentFeaturesWithSignalRegime({
    features: {
      pro_regime_state: "transition",
    },
    signalDocId: "SIG__BINANCEFUT__ETHUSDT__15m__1__CORE_SHORT",
    signalLookupFn: async () => ({
      regime: "trend",
      features_json: { pro_regime_state: "trend" },
    }),
  });
  assert.strictEqual(passthrough.regime, "transition");
  assert.strictEqual(passthrough.features.regime, "transition");

  console.log("ORDER_INTENT_REGIME_FALLBACK_TEST_OK");
}

run().catch((err) => {
  console.error("ORDER_INTENT_REGIME_FALLBACK_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
