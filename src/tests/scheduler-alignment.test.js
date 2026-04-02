"use strict";

const assert = require("assert");
const { __test } = require("../../src/scheduler/scheduler");

(() => {
  const nowMs = Date.parse("2026-04-02T04:22:45.000Z");
  const delayMs = __test.computeNextLoopDelayMs({
    nowMs,
    intervalMs: 15 * 60 * 1000,
    signalTf: "15m",
    graceMs: 15 * 1000,
  });

  assert.strictEqual(delayMs, 7 * 60 * 1000 + 30 * 1000);
})();

(() => {
  const nowMs = Date.parse("2026-04-02T04:22:45.000Z");
  const delayMs = __test.computeNextLoopDelayMs({
    nowMs,
    intervalMs: 5 * 60 * 1000,
    signalTf: "15m",
    graceMs: 15 * 1000,
  });

  assert.strictEqual(delayMs, 5 * 60 * 1000);
})();

console.log("SCHEDULER_ALIGNMENT_TEST_OK");
