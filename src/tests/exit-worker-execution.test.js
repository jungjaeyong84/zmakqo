"use strict";

const assert = require("assert");
const { runExitWorkerExecution, __test } = require("../services/exitWorkerExecution");

async function run() {
  const fullConfig = __test.resolveExitWorkerExecutionConfig({
    payload: {},
    env: {
      EXIT_WORKER_BURST_MAX_MS: "55000",
      EXIT_WORKER_BURST_MAX_ITERATIONS: "20",
      EXIT_WORKER_EXEC_TIMEOUT_MS: "70000",
    },
  });
  assert.deepStrictEqual(fullConfig, {
    targetMode: false,
    targetSymbols: [],
    maxDurationMs: 55000,
    maxIterations: 20,
    timeoutMs: 70000,
  });

  const targetedConfig = __test.resolveExitWorkerExecutionConfig({
    payload: { target_symbols: ["ethusdt", "ETHUSDT", ""] },
    env: {
      EXIT_WORKER_TARGET_BURST_MAX_MS: "9000",
      EXIT_WORKER_TARGET_BURST_MAX_ITERATIONS: "1",
      EXIT_WORKER_TARGET_EXEC_TIMEOUT_MS: "12000",
    },
  });
  assert.deepStrictEqual(targetedConfig, {
    targetMode: true,
    targetSymbols: ["ETHUSDT"],
    maxDurationMs: 9000,
    maxIterations: 1,
    timeoutMs: 12000,
  });

  const timeoutResult = __test.buildExitWorkerTimeoutResult({
    timeoutMs: 1000,
    startedAt: "2026-04-12T11:00:00.000Z",
    finishedAt: "2026-04-12T11:00:01.000Z",
    reason: "TEST",
    chainDepth: 2,
    targetMode: true,
    targetSymbols: ["ethusdt", "ETHUSDT"],
  });
  assert.strictEqual(timeoutResult.error, "EXIT_WORKER_EXEC_TIMEOUT");
  assert.strictEqual(timeoutResult.timeout_ms, 1000);
  assert.strictEqual(timeoutResult.chain_depth, 2);
  assert.strictEqual(timeoutResult.target_mode, true);
  assert.deepStrictEqual(timeoutResult.target_symbols, ["ETHUSDT"]);
  // 2026-04-18 BTCUSDT-blackout regression guards: timeout must signal
  // "ok with handoff" so tickExitWorker.js dispatches the next burst
  // immediately instead of waiting up to 60s for the external scheduler.
  assert.strictEqual(timeoutResult.ok, true,
    "timeout result must set ok=true so self-dispatch branch in tickExitWorker runs");
  assert.strictEqual(timeoutResult.timed_out, true,
    "timeout result must carry timed_out=true so downstream readers can distinguish handoff from clean completion");
  assert.strictEqual(timeoutResult.reschedule_recommended, true,
    "timeout result must request reschedule so the chain continues");
  assert.strictEqual(timeoutResult.reschedule_reason, "EXIT_WORKER_EXEC_TIMEOUT_HANDOFF");

  const state = {
    lastExecuteAt: null,
    lastFinishedAt: null,
    lastResult: null,
    inFlight: null,
  };
  const result = await runExitWorkerExecution({
    payload: { reason: "TEST", chain_depth: 1, target_symbols: ["BTCUSDT"] },
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
  // 2026-04-18 BTCUSDT-blackout fix: timeout must propagate as ok=true
  // with timed_out=true + reschedule_recommended=true so the chain
  // re-enters promptly. Before the fix, ok=false here caused
  // tickExitWorker.js to skip self-dispatch, leaving BE-raise stranded
  // for up to one scheduler interval (~60s) per egress stall.
  assert.strictEqual(result.ok, true, "timed-out run must propagate ok=true for handoff");
  assert.strictEqual(result.timed_out, true);
  assert.strictEqual(result.error, "EXIT_WORKER_EXEC_TIMEOUT");
  assert.strictEqual(result.reschedule_recommended, true,
    "targetMode timeout must NOT be suppressed — blocked TP1 runner needs another shot immediately");
  assert.strictEqual(result.target_reschedule_suppressed, undefined,
    "timeout handoffs must bypass the target-mode reschedule suppression");
  assert.strictEqual(result.target_mode, true);
  assert.deepStrictEqual(result.target_symbols, ["BTCUSDT"]);
  assert.strictEqual(state.inFlight, null);
  assert.ok(state.lastFinishedAt);

  const targetedNoReschedule = await runExitWorkerExecution({
    payload: { reason: "TARGET_AUDIT", chain_depth: 0, target_symbols: ["ETHUSDT", "BNBUSDT"] },
    state: {
      lastExecuteAt: null,
      lastFinishedAt: null,
      lastResult: null,
      inFlight: null,
    },
    timeoutMs: 10_000,
    runBurst: async () => ({
      ok: true,
      iterations: 1,
      reschedule_recommended: true,
      target_symbols: ["ETHUSDT", "BNBUSDT"],
    }),
  });
  assert.strictEqual(targetedNoReschedule.ok, true);
  assert.strictEqual(targetedNoReschedule.target_mode, true);
  assert.strictEqual(targetedNoReschedule.reschedule_recommended, false, "target runs must not self-chain");
  assert.strictEqual(targetedNoReschedule.target_reschedule_suppressed, true);
}

run()
  .then(() => console.log("EXIT_WORKER_EXECUTION_TEST_OK"))
  .catch((err) => {
    console.error("EXIT_WORKER_EXECUTION_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
