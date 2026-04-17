"use strict";

const assert = require("assert");
const { __test: clientTest } = require("../services/exitWorkerClient");
const { __test: executionTest } = require("../services/exitWorkerExecution");
const { __test: tickExitTest } = require("../services/binanceTickExit");

(async () => {
  const targetSymbols = clientTest.normalizeTargetSymbols(["btcusdt", "BTCUSDT", "", null]);
  assert.deepStrictEqual(targetSymbols, ["BTCUSDT"]);

  const executionConfig = executionTest.resolveExitWorkerExecutionConfig({
    payload: {
      reason: "MANUAL_REPAIR_BINANCEFUT_BTCUSDT",
      target_symbols: targetSymbols,
      target_exchange: "BINANCEFUT",
    },
    env: {
      EXIT_WORKER_TARGET_BURST_MAX_MS: "8000",
      EXIT_WORKER_TARGET_BURST_MAX_ITERATIONS: "1",
      EXIT_WORKER_TARGET_EXEC_TIMEOUT_MS: "15000",
    },
  });
  assert.strictEqual(executionConfig.targetMode, true);
  assert.strictEqual(executionConfig.maxIterations, 1);
  assert.strictEqual(executionConfig.timeoutMs, 15000);
  assert.deepStrictEqual(executionConfig.targetSymbols, ["BTCUSDT"]);

  const fallbackConfig = executionTest.resolveExitWorkerExecutionConfig({
    payload: {
      reason: "MANUAL_REPAIR_BINANCEFUT_ETHUSDT",
      target_symbols: ["ETHUSDT", "BNBUSDT"],
      target_exchange: "BINANCEFUT",
    },
    env: {},
  });
  assert.strictEqual(fallbackConfig.targetMode, true);
  assert.strictEqual(fallbackConfig.maxDurationMs, 60000);
  assert.strictEqual(fallbackConfig.timeoutMs, 90000);
  assert.deepStrictEqual(fallbackConfig.targetSymbols, ["ETHUSDT", "BNBUSDT"]);

  const resolvedSymbols = tickExitTest.resolveTickExitSymbolsToCheck({
    exCfg: { markets: ["BTCUSDT", "ETHUSDT", "XRPUSDT"] },
    targetSymbols: executionConfig.targetSymbols,
  });
  assert.deepStrictEqual(resolvedSymbols, ["BTCUSDT"]);

  console.log("TARGETED_EXIT_WORKER_REPAIR_PATH_TEST_OK");
})().catch((err) => {
  console.error("TARGETED_EXIT_WORKER_REPAIR_PATH_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
