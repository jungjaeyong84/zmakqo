const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

(() => {
  assert.strictEqual(__test.normalizeSignalStateToken("t\rend"), "trend");
  assert.strictEqual(__test.normalizeSignalStateToken("ra\nnge"), "range");
  assert.strictEqual(__test.pickSignalRegime({ pro_regime_state: "t\rend" }), "trend");
  assert.strictEqual(__test.pickSignalRegime({ pro_regime_state: "x", pro_env_txt: "추세 / 저변동" }), "trend");
  assert.strictEqual(__test.pickSignalRegime({ pro_regime_state: "t\rend", pro_env_txt: "추세 / 저변동" }), "trend");
  console.log("SIGNAL_REGIME_SANITIZE_TEST_OK");
})();
