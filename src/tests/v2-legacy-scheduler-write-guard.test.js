"use strict";

const assert = require("assert");
const createSchedulerRoutes = require("../routes/scheduler.routes");

const {
  parseBoolEnv,
  isV2LegacySchedulerWriteBlocked,
  legacySchedulerBlockedPayload,
} = createSchedulerRoutes.__test;

{
  assert.strictEqual(parseBoolEnv("1"), true);
  assert.strictEqual(parseBoolEnv("true"), true);
  assert.strictEqual(parseBoolEnv("0"), false);
  assert.strictEqual(parseBoolEnv("", true), true);
}

{
  assert.strictEqual(isV2LegacySchedulerWriteBlocked({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES: "0",
  }), true);
  assert.strictEqual(isV2LegacySchedulerWriteBlocked({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES: "1",
  }), false);
  assert.strictEqual(isV2LegacySchedulerWriteBlocked({
    DONBEOLJA_V2_ENABLED: "0",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
  }), false);
}

{
  const payload = legacySchedulerBlockedPayload("/scheduler/ai-allocation");
  assert.strictEqual(payload.ok, false);
  assert.strictEqual(payload.error, "V2_LEGACY_SCHEDULER_WRITE_BLOCKED");
  assert.strictEqual(payload.route, "/scheduler/ai-allocation");
}

console.log("V2_LEGACY_SCHEDULER_WRITE_GUARD_TEST_OK");
