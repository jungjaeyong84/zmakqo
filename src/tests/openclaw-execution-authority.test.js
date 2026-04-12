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
  [
    "../services/openclawExecutionAuthority",
    "../services/openclawExecutionExecutor",
    "../utils/liveExecutionPolicy",
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

async function run() {
  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    LIVE_EXEC_POLICY_ENABLED: "1",
    LIVE_EXEC_POLICY_QUARANTINE_HARD_BLOCK: "1",
  }, async () => {
    const { evaluateOpenClawExecutionAuthority } = freshRequire("../services/openclawExecutionAuthority");
    const res = await evaluateOpenClawExecutionAuthority({
      exchange: "BINANCEFUT",
      symbol: "AXSUSDT",
      intent: "ENTRY",
      event: "ENTRY_SHORT_REAL",
      side: "SELL",
      qtyPct: 1,
      features: {},
      stage: "WEBHOOK_SIGNAL",
      applyScale: true,
      snapshotOverride: {
        allocator: { by_market: [] },
        quarantine: { by_market: [{ market: "AXSUSDT", quarantine_reason: "EXECUTION_QUALITY_PENALTY" }] },
        quality: { by_market: [] },
        allocatorByMarket: new Map(),
        quarantineByMarket: new Map([["AXSUSDT", { market: "AXSUSDT", quarantine_reason: "EXECUTION_QUALITY_PENALTY" }]]),
        qualityByMarket: new Map(),
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "LIVE_POLICY_QUARANTINE_HARD_BLOCK");
    assert.strictEqual(res.authority.blockingLayer, "LIVE_ENTRY_POLICY");
    assert.strictEqual(res.featuresPatch._openclaw_authority_final_decider, "OPENCLAW_EXECUTION_AUTHORITY");
    assert.strictEqual(res.featuresPatch._openclaw_authority_openclaw_ok, true);
    assert.strictEqual(res.featuresPatch._openclaw_authority_live_policy_ok, false);
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    LIVE_EXEC_POLICY_ENABLED: "1",
    LIVE_EXEC_POLICY_QUARANTINE_HARD_BLOCK: "0",
    LIVE_EXEC_POLICY_POLICY_PLAN_APPLY: "0",
    OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE_SCALE: "0.5",
  }, async () => {
    const { evaluateOpenClawExecutionAuthority } = freshRequire("../services/openclawExecutionAuthority");
    const res = await evaluateOpenClawExecutionAuthority({
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      stage: "RUNNER_SIGNAL",
      applyScale: true,
      snapshotOverride: {
        allocator: { by_market: [] },
        quarantine: { by_market: [] },
        quality: { by_market: [] },
        allocatorByMarket: new Map(),
        quarantineByMarket: new Map(),
        qualityByMarket: new Map(),
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        by_market: [
          { market: "SOLUSDT", recommended_action: "REDUCE", allocation_score: 0.12 },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "LIVE_POLICY_OK");
    assert.strictEqual(res.authority.blockingLayer, "NONE");
    assert.ok(Math.abs(res.featuresPatch._openclaw_authority_qty_after_openclaw - 0.4) < 1e-9);
    assert.ok(Math.abs(res.qtyPctFinal - 0.32000000000000006) < 1e-9);
  });

  console.log("OPENCLAW_EXECUTION_AUTHORITY_TEST_OK");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
