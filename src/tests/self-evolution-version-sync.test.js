"use strict";

const assert = require("assert");

const {
  strategyIdToEngineVersion,
  prependCsvValue,
  mergeCsvValues,
  extractAllowedCsvFromText,
  syncEnvText,
  syncJsText,
  syncCloudBuildText,
} = require("../../scripts/lib/self-evolution-version-sync");

(() => {
  assert.strictEqual(strategyIdToEngineVersion("donbeolja_v6.0.3.1"), "6.0.3.1");
  assert.strictEqual(prependCsvValue("donbeolja_v6.0.3.0,STRAT_v010", "donbeolja_v6.0.3.1"), "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010");
  assert.strictEqual(
    mergeCsvValues("donbeolja_v6.0.3.1", "donbeolja_v6.0.3.0,STRAT_v010", "STRAT_v010,donbeolja_v5.6.0.2"),
    "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2"
  );
  assert.strictEqual(
    extractAllowedCsvFromText(".env", "WEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.0,STRAT_v010\n"),
    "donbeolja_v6.0.3.0,STRAT_v010"
  );

  const envText = syncEnvText(
    "DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.0\nWEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.0,STRAT_v010\n",
    { strategyId: "donbeolja_v6.0.3.1", engineVersion: "6.0.3.1", allowedCsv: "donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2" }
  );
  assert.ok(envText.includes("DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.1"));
  assert.ok(envText.includes("ENGINE_VERSION=6.0.3.1"));
  assert.ok(envText.includes("WEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2"));

  const jsText = syncJsText(
    'ENGINE_VERSION: "6.0.3.0", DONBEOLJA_STRATEGY_ID: "donbeolja_v6.0.3.0", WEBHOOK_ALLOWED_STRATEGY_IDS: "donbeolja_v6.0.3.0,STRAT_v010"',
    { strategyId: "donbeolja_v6.0.3.1", engineVersion: "6.0.3.1", allowedCsv: "donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2" }
  );
  assert.ok(jsText.includes('ENGINE_VERSION: "6.0.3.1"'));
  assert.ok(jsText.includes('DONBEOLJA_STRATEGY_ID: "donbeolja_v6.0.3.1"'));
  assert.ok(jsText.includes('WEBHOOK_ALLOWED_STRATEGY_IDS: "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2"'));

  const cloudbuildText = syncCloudBuildText(
    'DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.0;WEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.0,STRAT_v010;ENGINE_VERSION=6.0.3.0;',
    { strategyId: "donbeolja_v6.0.3.1", engineVersion: "6.0.3.1", allowedCsv: "donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2" }
  );
  assert.ok(cloudbuildText.includes("DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.1"));
  assert.ok(cloudbuildText.includes("ENGINE_VERSION=6.0.3.1"));
  assert.ok(cloudbuildText.includes("WEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2"));

  console.log("SELF_EVOLUTION_VERSION_SYNC_TEST_OK");
})();
