"use strict";

const assert = require("assert");

const { __test } = require("../../scripts/ack-self-evolution-manual-paste");

(() => {
  assert.strictEqual(
    __test.parseStrategyId('/definitely/missing/file.txt'),
    null
  );

  const envText = "DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.1\nWEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.1,donbeolja_v6.0.3.0\n";
  assert.strictEqual(
    __test.parseEnvLine(envText, "WEBHOOK_ALLOWED_STRATEGY_IDS"),
    "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0"
  );

  console.log("ACK_SELF_EVOLUTION_MANUAL_PASTE_TEST_OK");
})();
