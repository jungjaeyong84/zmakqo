"use strict";

const assert = require("assert");
const { __test } = require("../scheduler/marketRunner");

(async () => {
  assert.strictEqual(typeof __test.buildMarketRunnerBarClaimDocPath, "function", "buildMarketRunnerBarClaimDocPath export missing");
  assert.strictEqual(typeof __test.runWithMarketRunnerBarClaim, "function", "runWithMarketRunnerBarClaim export missing");

  assert.strictEqual(
    __test.buildMarketRunnerBarClaimDocPath({
      exchange: "BINANCEFUT",
      market: "ETHUSDT",
      tf: "15m",
      barCloseMs: 1775808000000,
    }),
    "runtime_locks/market_runner_bar__BINANCEFUT__ETHUSDT__15M__1775808000000"
  );

  let releaseCalls = 0;
  let runnerCalls = 0;
  const claimed = await __test.runWithMarketRunnerBarClaim({
    exchange: "BINANCEFUT",
    market: "ETHUSDT",
    tf: "15m",
    barCloseMs: 1775808000000,
    acquireClaim: async () => ({ acquired: true, holderId: "test-holder" }),
    heartbeatClaim: async () => ({ ok: true, holderId: "test-holder" }),
    releaseClaim: async () => {
      releaseCalls += 1;
    },
    runner: async () => {
      runnerCalls += 1;
      return { ok: true, executed: true };
    },
  });
  assert.strictEqual(claimed.ok, true);
  assert.strictEqual(claimed.executed, true);
  assert.strictEqual(runnerCalls, 1, "runner should execute once after acquiring the bar claim");
  assert.strictEqual(releaseCalls, 1, "bar claim should release after execution");

  const skipped = await __test.runWithMarketRunnerBarClaim({
    exchange: "BINANCEFUT",
    market: "ETHUSDT",
    tf: "15m",
    barCloseMs: 1775808000000,
    waitMs: 0,
    acquireClaim: async () => ({ acquired: false, holder: "other-runner" }),
    heartbeatClaim: async () => ({ ok: false, holder: "other-runner" }),
    releaseClaim: async () => {
      throw new Error("release should not run when claim was never acquired");
    },
    runner: async () => {
      throw new Error("runner should not execute while the bar claim is held");
    },
  });
  assert.strictEqual(skipped.skipped, true);
  assert.strictEqual(skipped.reason, "BAR_CLAIM_HELD");

  console.log("MARKET_RUNNER_CLAIM_TEST_OK");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
