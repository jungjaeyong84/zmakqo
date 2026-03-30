"use strict";

const assert = require("assert");

const {
  prependUnionCsv,
  buildUpdateEnvCommand,
} = require("../../scripts/lib/self-evolution-live-service-sync");

(() => {
  assert.strictEqual(
    prependUnionCsv(
      "donbeolja_v6.0.3.1",
      "donbeolja_v6.0.3.0,STRAT_v010",
      "STRAT_v010,donbeolja_v6.0.3.1,donbeolja_v5.6.0.2"
    ),
    "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0,STRAT_v010,donbeolja_v5.6.0.2"
  );

  const command = buildUpdateEnvCommand("donbeolja", "asia-northeast3", {
    DONBEOLJA_STRATEGY_ID: "donbeolja_v6.0.3.1",
    ENGINE_VERSION: "6.0.3.1",
    WEBHOOK_ALLOWED_STRATEGY_IDS: "donbeolja_v6.0.3.1,donbeolja_v6.0.3.0",
  });
  assert.ok(command.includes("gcloud run services update donbeolja"));
  assert.ok(command.includes("DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.1"));
  assert.ok(command.includes("ENGINE_VERSION=6.0.3.1"));
  assert.ok(command.includes("WEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.1,donbeolja_v6.0.3.0"));
  assert.ok(command.includes('^:^DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.1:ENGINE_VERSION=6.0.3.1:WEBHOOK_ALLOWED_STRATEGY_IDS=donbeolja_v6.0.3.1,donbeolja_v6.0.3.0'));

  console.log("SELF_EVOLUTION_LIVE_SERVICE_SYNC_TEST_OK");
})();
