"use strict";

const assert = require("assert");
const { resolveRegimeRecord, enrichFeaturesWithRegime, __test } = require("../utils/regime");

(() => {
  assert.strictEqual(__test.fuzzyCanonicalRegime("tend"), "trend");
  assert.strictEqual(__test.fuzzyCanonicalRegime("tansition"), "transition");
  assert.strictEqual(resolveRegimeRecord({ features_json: { pro_regime_state: "t\rend" } }), "trend");
  assert.strictEqual(resolveRegimeRecord({ features_json: { pro_regime_state: "t\ransition" } }), "transition");
  assert.strictEqual(resolveRegimeRecord({ features_json: { pro_env_txt: "횡보 / 중립" } }), "range");
  assert.strictEqual(resolveRegimeRecord({ features_json: { market_state: "TRANSITION" } }), "transition");
  assert.strictEqual(resolveRegimeRecord({ features_json: { _openclaw_executor_regime: "TREND" } }), "trend");

  const enriched = enrichFeaturesWithRegime({ pro_regime_state: "t\rend" });
  assert.strictEqual(enriched.regime, "trend");
  assert.strictEqual(enriched.market_regime, "trend");
  assert.strictEqual(enriched.features.regime, "trend");
  assert.strictEqual(enriched.features.market_regime, "trend");
  console.log("REGIME_UTILS_TEST_OK");
})();
