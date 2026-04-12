"use strict";

const assert = require("assert");

function withEnv(overrides, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    prev[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (value === null || value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

async function run() {
  await withEnv({ OPENCLAW_EXECUTOR_ENABLED: "0" }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      positionViews: [],
      recentTimelineRows: [],
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_DISABLED");
    assert.strictEqual(res.qtyPctFinal, 0.8);
  });

  await withEnv({ OPENCLAW_EXECUTOR_ENABLED: "1" }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const nowMs = Date.parse("2026-04-11T12:00:00.000Z");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      nowMs,
      positionViews: [],
      recentTimelineRows: [{
        ts_ms: nowMs - (5 * 60 * 1000),
        event: "EXIT_TRAIL",
        payload: { side: "SELL" },
      }],
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_RECENT_REENTRY_BLOCK");
    assert.strictEqual(res.featuresPatch.openclaw_executor_exit_profile_mode, "BASE");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_REDUCE_THRESHOLD: "2",
    OPENCLAW_EXECUTOR_SAME_SIDE_BLOCK_THRESHOLD: "5",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CLUSTER_REDUCE_SCALE: "0.5",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      positionViews: [
        { symbol: "DOGEUSDT", state: "ACTIVE", position_side: "LONG", qty_base: 10 },
      ],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_CORRELATED_CLUSTER_REDUCE");
    assert.strictEqual(res.qtyPctFinal, 0.4);
    assert.strictEqual(res.featuresPatch.openclaw_executor_exit_profile_mode, "BASE");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "0.9",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CLUSTER_REDUCE_SCALE: "0.5",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      positionViews: [
        { symbol: "BTCUSDT", state: "ACTIVE", position_side: "LONG", size_pct: 0.4 },
      ],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE");
    assert.strictEqual(res.qtyPctFinal, 0.4);
    assert.ok(res.featuresPatch._openclaw_executor_same_side_exposure_after > 1.1);
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        by_market: [
          { market: "XRPUSDT", recommended_action: "QUARANTINE", allocation_score: -0.91 },
        ],
      },
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE");
    assert.strictEqual(res.qtyPctFinal, 0);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_action, "QUARANTINE");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE_SCALE: "0.4",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        by_market: [
          { market: "SOLUSDT", recommended_action: "REDUCE", allocation_score: 0.12 },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.32) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_action, "REDUCE");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_ALLOW_UPSCALE: "1",
    OPENCLAW_EXECUTOR_HIGH_CONF_SCALE: "1.1",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const runner = freshRequire("../engine/paperBinanceRunner");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {
        confidence: 0.91,
        long_posterior: 0.74,
        entry_grade: "CORE",
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_HIGH_CONF_AGGRESSIVE");
    assert.strictEqual(res.featuresPatch.openclaw_executor_exit_profile_mode, "AGGRESSIVE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.88) < 1e-9);

    const resolved = await runner.__test.resolveAdaptiveFuturesExitProfile({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      tf: "15m",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      features: res.featuresPatch,
      nowMs: Date.parse("2026-04-11T12:00:00.000Z"),
      leverageDecision: { leverage: 2, reason: "STATIC" },
      manualProfileMode: null,
    });
    assert.strictEqual(resolved.profile, "AGGRESSIVE");
    assert.strictEqual(resolved.reason, "OPENCLAW_EXECUTOR_HIGH_CONF_AGGRESSIVE");
  });

  console.log("OPENCLAW_EXECUTION_EXECUTOR_TEST_OK");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
