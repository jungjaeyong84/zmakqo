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
    "../utils/entryBudgetGuard",
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
    LIVE_EXEC_POLICY_POLICY_PLAN_ENABLED: "0",
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
      entryBudgetGuardOverride: {
        applicable: true,
        ok: true,
        reason: "ENTRY_BUDGET_GUARD_OK",
        budgetMax: 15,
        leverage: 2,
        minRequiredQuote: 5,
        notionalQuote: 9.6,
        requiredQtyPct: 5 / (15 * 2),
        requiredBudget: 5 / (0.32 * 2),
        shortfallQuote: 0,
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.authority.blockingLayer, "NONE");
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_ok, true);
    assert.ok(Number(res.featuresPatch._openclaw_authority_qty_after_openclaw) > 0);
    assert.ok(Number(res.qtyPctFinal) > 0);
    assert.ok(Number(res.qtyPctFinal) <= Number(res.featuresPatch._openclaw_authority_qty_after_openclaw));
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "0",
    LIVE_EXEC_POLICY_ENABLED: "1",
    LIVE_EXEC_POLICY_QUARANTINE_HARD_BLOCK: "0",
    LIVE_EXEC_POLICY_POLICY_PLAN_ENABLED: "1",
    LIVE_EXEC_POLICY_POLICY_PLAN_APPLY: "1",
    LIVE_EXEC_POLICY_RECENT_WIN_RATE_GUARD_ENABLED: "0",
    LIVE_EXEC_POLICY_EXIT_INTEGRITY_ENABLED: "0",
    LIVE_EXEC_POLICY_LINEAGE_SLO_ENABLED: "0",
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED: "1",
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_MARKETS: "BTCUSDT,ETHUSDT",
  }, async () => {
    const { evaluateOpenClawExecutionAuthority } = freshRequire("../services/openclawExecutionAuthority");
    const res = await evaluateOpenClawExecutionAuthority({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 1,
      features: {},
      stage: "WEBHOOK_SIGNAL",
      applyScale: true,
      snapshotOverride: {
        allocator: { by_market: [] },
        quarantine: { by_market: [] },
        quality: { by_market: [] },
        policyPlan: { status: "READY", global_qty_scale: 0.5, mode: "ACTIVE" },
        allocatorByMarket: new Map(),
        quarantineByMarket: new Map(),
        qualityByMarket: new Map(),
        policyPlanByMarket: new Map(),
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
      entryBudgetGuardOverride: {
        applicable: true,
        ok: false,
        reason: "MIN_ORDER_EXCEEDS_BUDGET",
        budgetMax: 30,
        leverage: 2,
        minRequiredQuote: 50,
        notionalQuote: 24,
        requiredQtyPct: 50 / (30 * 2),
        requiredBudget: 50 / (0.4 * 2),
        shortfallQuote: 26,
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.authority.blockingLayer, "NONE");
    assert.strictEqual(res.qtyPctFinal, 50 / (30 * 2));
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_floor_applied, true);
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_floor_qty_pct, 50 / (30 * 2));
    assert.ok(Number(res.featuresPatch._openclaw_authority_entry_budget_guard_floor_previous_qty_pct) > 0);
    assert.ok(Number(res.featuresPatch._openclaw_authority_entry_budget_guard_floor_previous_qty_pct) < (50 / (30 * 2)));
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_ok, true);
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_notional_quote, 50);
    assert.strictEqual(res.authority.entryBudgetFloor.applied, true);
  });

  await withEnv({
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED: "1",
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_MARKETS: null,
  }, async () => {
    const { __test } = freshRequire("../services/openclawExecutionAuthority");
    const adjustment = __test.resolveEntryBudgetGuardMinQtyFloor({
      symbol: "DOGEUSDT",
      qtyRequested: 0.5,
      openclawQty: 0.375,
      finalQty: 0.075,
      entryBudgetGuard: {
        applicable: true,
        ok: false,
        reason: "MIN_ORDER_EXCEEDS_BUDGET",
        requiredQtyPct: 1 / 6,
      },
    });
    assert.strictEqual(adjustment.applied, true);
    assert.strictEqual(adjustment.snappedQtyPct, 1 / 6);
    assert.strictEqual(adjustment.maxSnapQtyPct, 0.375);
  });

  await withEnv({
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED: "1",
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_MARKETS: null,
    ENTRY_BUDGET_GUARD_SOFT_REDUCE_BYPASS_ENABLED: "1",
    ENTRY_BUDGET_GUARD_FULL_ONLY_THRESHOLD: "0.8",
  }, async () => {
    const { __test } = freshRequire("../services/openclawExecutionAuthority");
    const reducedFeasibleBand = __test.resolveEntryBudgetGuardFeasibleBand({
      applicable: true,
      ok: false,
      reason: "MIN_ORDER_EXCEEDS_BUDGET",
      requiredQtyPct: 1 / 6,
    });
    assert.deepStrictEqual(reducedFeasibleBand, {
      band: "REDUCED_FEASIBLE",
      fullOnly: false,
      minTradableQtyPct: 1 / 6,
    });

    const feasibleBand = __test.resolveEntryBudgetGuardFeasibleBand({
      applicable: true,
      ok: false,
      reason: "MIN_ORDER_EXCEEDS_BUDGET",
      requiredQtyPct: 50 / (30 * 2),
    });
    assert.deepStrictEqual(feasibleBand, {
      band: "FULL_ONLY",
      fullOnly: true,
      minTradableQtyPct: 50 / (30 * 2),
    });

    const adjustment = __test.resolveEntryBudgetGuardMinQtyFloor({
      symbol: "BTCUSDT",
      qtyRequested: 1,
      openclawQty: 0.65,
      finalQty: 0.325,
      entryBudgetGuard: {
        applicable: true,
        ok: false,
        reason: "MIN_ORDER_EXCEEDS_BUDGET",
        requiredQtyPct: 50 / (30 * 2),
      },
    });
    assert.strictEqual(adjustment.applied, true);
    assert.strictEqual(adjustment.snappedQtyPct, 50 / (30 * 2));
    assert.strictEqual(adjustment.maxSnapQtyPct, 1);
    assert.strictEqual(adjustment.feasibleBand, "FULL_ONLY");
    assert.strictEqual(adjustment.fullOnly, true);
    assert.strictEqual(adjustment.softReduceBypassed, true);
    assert.strictEqual(adjustment.snapSource, "REQUESTED_QTY");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    LIVE_EXEC_POLICY_ENABLED: "1",
    LIVE_EXEC_POLICY_QUARANTINE_HARD_BLOCK: "0",
    LIVE_EXEC_POLICY_POLICY_PLAN_APPLY: "0",
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED: "1",
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_MARKETS: "BTCUSDT,ETHUSDT",
  }, async () => {
    const { evaluateOpenClawExecutionAuthority } = freshRequire("../services/openclawExecutionAuthority");
    const res = await evaluateOpenClawExecutionAuthority({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.65,
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
      capitalAllocatorSnapshot: { by_market: [] },
      entryBudgetGuardOverride: {
        applicable: true,
        ok: false,
        reason: "MIN_ORDER_EXCEEDS_BUDGET",
        budgetMax: 15,
        leverage: 2,
        minRequiredQuote: 20,
        notionalQuote: 19.5,
        requiredQtyPct: 20 / (15 * 2),
        requiredBudget: 20 / (0.65 * 2),
        shortfallQuote: 0.5,
      },
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "MIN_ORDER_EXCEEDS_BUDGET");
    assert.strictEqual(res.authority.blockingLayer, "ENTRY_BUDGET_GUARD");
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_ok, false);
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_reason, "MIN_ORDER_EXCEEDS_BUDGET");
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_min_required_quote, 20);
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_notional_quote, 19.5);
    assert.strictEqual(res.featuresPatch._openclaw_authority_entry_budget_guard_floor_applied, false);
  });

  console.log("OPENCLAW_EXECUTION_AUTHORITY_TEST_OK");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
