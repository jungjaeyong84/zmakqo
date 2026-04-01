"use strict";

const assert = require("assert");
const { deriveServerPrimaryLearningEpoch } = require("../utils/serverPrimaryLearningEpoch");

(() => {
  const active = deriveServerPrimaryLearningEpoch({
    epochState: { started_at: "2026-03-28T00:00:00.000Z" },
    runtime: { summary: { canonical_engine_source_mode: "SERVER_PRIMARY" } },
    serverPrimaryAcceptanceWatch: { summary: { acceptance_ready: false, server_primary_executed_n: 3 } },
    nowMs: Date.parse("2026-04-01T00:00:00.000Z"),
  });
  assert.strictEqual(active.status, "SERVER_PRIMARY_EPOCH_ACTIVE");
  assert.strictEqual(active.learning_focus, "SERVER_SIGNAL_ONLY");
  assert.ok(active.penalty_weight < 1);
  assert.ok(active.realized_sample_floor_scale < 1);

  const matured = deriveServerPrimaryLearningEpoch({
    epochState: { started_at: "2026-03-01T00:00:00.000Z" },
    runtime: { summary: { source_mode: "SERVER_PRIMARY" } },
    serverPrimaryAcceptanceWatch: { summary: { acceptance_ready: true, server_primary_executed_n: 12 } },
    nowMs: Date.parse("2026-04-01T00:00:00.000Z"),
  });
  assert.strictEqual(matured.status, "SERVER_PRIMARY_EPOCH_MATURED");
  assert.strictEqual(matured.penalty_weight, 1);
  assert.strictEqual(matured.realized_sample_floor_scale, 1);
})();

console.log("SERVER_PRIMARY_LEARNING_EPOCH_TEST_OK");
