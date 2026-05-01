"use strict";

const assert = require("assert");
const { main, __test } = require("../../scripts/run-v2-liquidation-stream-collector-window");

assert.strictEqual(__test.toPositiveInt("10", 55, 120), 10);
assert.strictEqual(__test.toPositiveInt("0", 55, 120), 55);
assert.strictEqual(__test.toPositiveInt("999", 55, 120), 120);

(async function disabledReturnsImmediately() {
  let started = false;
  const result = await main({
    env: { DONBEOLJA_V2_LIQUIDATION_STREAM_ENABLED: "0" },
    collectorFactory: () => ({
      start() {
        started = true;
        return { ok: true, reason: "LIQUIDATION_STREAM_DISABLED" };
      },
      stop() {
        throw new Error("STOP_SHOULD_NOT_RUN");
      },
      state() {
        return { enabled: false, buffered_event_n: 0 };
      },
    }),
    sleepFn: async () => { throw new Error("SLEEP_SHOULD_NOT_RUN"); },
    setProcessExitCode: false,
  });
  assert.strictEqual(started, true);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "LIQUIDATION_STREAM_DISABLED");
})();

(async function enabledStopsAfterWindow() {
  let stopped = false;
  let sleptMs = null;
  const result = await main({
    env: {
      DONBEOLJA_V2_LIQUIDATION_STREAM_ENABLED: "1",
      DONBEOLJA_V2_LIQUIDATION_STREAM_WINDOW_MS: "7",
    },
    collectorFactory: () => ({
      start() {
        return { ok: true, reason: "LIQUIDATION_STREAM_STARTED" };
      },
      stop() {
        stopped = true;
        return { ok: true, reason: "LIQUIDATION_STREAM_STOPPED" };
      },
      state() {
        return { enabled: true, buffered_event_n: 2 };
      },
    }),
    sleepFn: async (ms) => { sleptMs = ms; },
    setProcessExitCode: false,
  });
  assert.strictEqual(stopped, true);
  assert.strictEqual(sleptMs, 7);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_LIQUIDATION_STREAM_WINDOW_COLLECTED");
  assert.strictEqual(result.buffered_event_n, 2);
})();

console.log("V2_LIQUIDATION_STREAM_WINDOW_COLLECTOR_TEST_OK");
