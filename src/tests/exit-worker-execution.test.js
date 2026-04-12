"use strict";

const assert = require("assert");
const { runExitWorkerExecution, __test } = require("../services/exitWorkerExecution");

async function run() {
  const timeoutResult = __test.buildExitWorkerTimeoutResult({
    timeoutMs: 1000,
    startedAt: "2026-04-12T11:00:00.000Z",
    finishedAt: "2026-04-12T11:00:01.000Z",
    reason: "TEST",
    chainDepth: 2,
  });
  assert.strictEqual(timeoutResult.error, "EXIT_WORKER_EXEC_TIMEOUT");
  assert.strictEqual(timeoutResult.timeout_ms, 1000);
  assert.strictEqual(timeoutResult.chain_depth, 2);

  const state = {
    lastExecuteAt: null,
    lastFinishedAt: null,
    lastResult: null,
    inFlight: null,
  };
  const result = await runExitWorkerExecution({
    payload: { reason: "TEST", chain_depth: 1 },
    state,
    timeoutMs: 1000,
    nowIso: (() => {
      const values = [
        "2026-04-12T11:00:00.000Z",
        "2026-04-12T11:00:01.050Z",
        "2026-04-12T11:00:01.100Z",
      ];
      return () => values.shift() || "2026-04-12T11:00:01.100Z";
    })(),
    runBurst: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 1200)),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "EXIT_WORKER_EXEC_TIMEOUT");
  assert.strictEqual(state.inFlight, null);
  assert.ok(state.lastFinishedAt);
}

run()
  .then(() => console.log("EXIT_WORKER_EXECUTION_TEST_OK"))
  .catch((err) => {
    console.error("EXIT_WORKER_EXECUTION_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
