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
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "1.2",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "2.2",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CLUSTER_REDUCE_SCALE: "0.65",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      intent: "ENTRY",
      event: "SHORT",
      side: "SELL",
      qtyPct: 1,
      features: {},
      positionViews: [
        { symbol: "SOLUSDT", state: "ACTIVE", position_side: "SHORT", size_pct: 1, qty_base: 1 },
      ],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.65) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_same_side_exposure_after, 2);
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "0.8",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "1.2",
    OPENCLAW_EXECUTOR_CLUSTER_REDUCE_SCALE: "0.65",
  }, async () => {
    const { evaluateOpenClawExecutionDecision, __test } = freshRequire("../services/openclawExecutionExecutor");
    const trailRow = {
      symbol: "ETHUSDT",
      state: "ACTIVE",
      position_state: "SCALE_OUT",
      position_side: "LONG",
      size_pct: 1,
      qty_base: 0.167,
      runner_allowed_qty_abs: 0.333,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        canonical_exit_stage: "TRAIL",
        runner_allowed_qty_abs: 0.333,
        canonical_runner_remaining_abs: 0.167,
        exit_rules_override: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
      },
    };
    const sizing = __test.resolveEffectiveExposureSizePct(trailRow);
    assert.ok(Math.abs(sizing.sizePct - (0.167 / 0.333 * 0.375)) < 1e-6);
    assert.strictEqual(sizing.source, "CURRENT_OVER_RUNNER_ALLOWED");

    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 1,
      features: {},
      positionViews: [trailRow],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.65) < 1e-9);
    assert.ok(Math.abs(res.featuresPatch._openclaw_executor_correlated_exposure_after - 1.188063063063063) < 1e-9);
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "0.8",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "1.2",
    OPENCLAW_EXECUTOR_CLUSTER_REDUCE_SCALE: "0.65",
    OPENCLAW_EXECUTOR_RUNNER_EXPOSURE_FALLBACK: "0.2",
  }, async () => {
    const { evaluateOpenClawExecutionDecision, __test } = freshRequire("../services/openclawExecutionExecutor");
    const trailRow = {
      symbol: "ETHUSDT",
      state: "ACTIVE",
      position_state: "SCALE_OUT",
      position_side: "LONG",
      size_pct: 1,
      qty_base: 0.167,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        canonical_exit_stage: "TRAIL",
        exit_rules_override: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
      },
    };
    const sizing = __test.resolveEffectiveExposureSizePct(trailRow);
    assert.strictEqual(sizing.sizePct, 0.2);
    assert.strictEqual(sizing.source, "RUNNER_STAGE_FALLBACK");

    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 1,
      features: {},
      positionViews: [trailRow],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.65) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_correlated_exposure_after, 1.2);
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_REDUCE_THRESHOLD: "2",
    OPENCLAW_EXECUTOR_SAME_SIDE_BLOCK_THRESHOLD: "3",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_WEIGHTED_CLUSTER_COUNT_ENABLED: "1",
    OPENCLAW_EXECUTOR_RUNNER_CLUSTER_COUNT_MIN_WEIGHT: "0.35",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const trailRow = {
      symbol: "ETHUSDT",
      state: "ACTIVE",
      position_state: "SCALE_OUT",
      position_side: "LONG",
      size_pct: 1,
      qty_base: 0.167,
      runner_allowed_qty_abs: 0.333,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        canonical_exit_stage: "TRAIL",
        runner_allowed_qty_abs: 0.333,
        canonical_runner_remaining_abs: 0.167,
        exit_rules_override: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
      },
    };
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 1,
      features: {},
      positionViews: [trailRow],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: { by_market: [] },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_OK");
    assert.strictEqual(res.featuresPatch._openclaw_executor_same_side_position_count_after, 2);
    assert.ok(res.featuresPatch._openclaw_executor_same_side_weighted_count_after < 2);
    assert.ok(res.featuresPatch._openclaw_executor_same_side_count_after < 2);
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
    OPENCLAW_EXECUTOR_ALLOCATOR_STALE_MAX_AGE_MS: "21600000",
    OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE_SCALE: "0.4",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const nowMs = Date.parse("2026-04-14T08:00:00.000Z");
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
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: { learning_epoch_active: false },
        mtimeMs: Date.parse("2026-04-12T10:46:33.601Z"),
        generated_at_kst: "2026-04-12 19:46:33 KST",
        by_market: [
          { market: "XRPUSDT", recommended_action: "QUARANTINE", allocation_score: -5.5417, penalty_reasons: ["EXECUTION_HARD"] },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.32) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_action, "QUARANTINE");
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_snapshot_stale, true);
    assert.ok(res.featuresPatch._openclaw_executor_allocator_snapshot_age_ms > 21600000);
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_ALLOCATOR_STALE_MAX_AGE_MS: "21600000",
    OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE_SCALE: "0.5",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const nowMs = Date.parse("2026-04-14T08:00:00.000Z");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      nowMs,
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: {
          learning_epoch_active: false,
          input_freshness_status: "STALE_INPUTS",
          input_stale: true,
          inputs_fresh: false,
        },
        mtimeMs: nowMs,
        generated_at_kst: "2026-04-14 17:00:00 KST",
        by_market: [
          { market: "BNBUSDT", recommended_action: "QUARANTINE", allocation_score: 1.3236, penalty_reasons: ["EXECUTION_HARD"] },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.4) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_snapshot_stale, true);
    assert.deepStrictEqual(res.featuresPatch._openclaw_executor_allocator_snapshot_stale_reasons, ["SUMMARY_INPUT_STALE"]);
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE_SCALE: "0.4",
    OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE_ENABLED: "1",
    OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE_SCALE: "0.4",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: { learning_epoch_active: true },
        by_market: [
          { market: "ETHUSDT", recommended_action: "QUARANTINE", allocation_score: 0.54, penalty_reasons: ["REVERSE_POLICY", "FAILURE_HARD"] },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.32) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_learning_epoch_active, true);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_quarantine_epoch_release_active, true);
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
      symbol: "DOGEUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.8,
      features: {},
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: { learning_epoch_active: true },
        by_market: [
          { market: "DOGEUSDT", recommended_action: "QUARANTINE", allocation_score: -0.24 },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.8) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_learning_epoch_active, true);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_quarantine_epoch_release_active, true);
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
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "LINKUSDT",
      intent: "ENTRY",
      event: "ENTRY_SHORT_REAL",
      side: "SELL",
      qtyPct: 0.7,
      features: {},
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        by_market: [
          { market: "LINKUSDT", recommended_action: "BLOCK", allocation_score: -4.2, penalty_reasons: ["ALPHA_HARD", "EXECUTION_HARD"] },
        ],
      },
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALLOCATOR_BLOCK");
    assert.strictEqual(res.qtyPctFinal, 0);
    assert.deepStrictEqual(res.featuresPatch._openclaw_executor_allocator_penalty_reasons, ["ALPHA_HARD", "EXECUTION_HARD"]);
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
      symbol: "BTCUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.5,
      features: {
        position_side: "LONG",
        openclaw_market_regime_cohort: "TREND",
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: {
          alpha_penalty_context_rows: [
            { market: "BTCUSDT", position_side: "LONG", regime_key: "TREND", severity: "SOFT", realized_n: 3, positive_rate: 0.4, avg_realized_ret_net: -0.002 },
          ],
        },
        by_market: [
          { market: "BTCUSDT", recommended_action: "HOLD", allocation_score: 0.2, penalty_reasons: [] },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.2) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context.severity, "SOFT");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE_SCALE: "0.4",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MIN_REALIZED_N: "20",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_POSITIVE_RATE: "0.15",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_AVG_REALIZED_RET_NET: "-0.003",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      intent: "ENTRY",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      qtyPct: 0.5,
      features: {
        position_side: "LONG",
        openclaw_market_regime_cohort: "TREND",
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: {
          alpha_penalty_context_rows: [
            { market: "XRPUSDT", position_side: "LONG", regime_key: "TREND", severity: "HARD", realized_n: 3, positive_rate: 0, avg_realized_ret_net: -0.005 },
          ],
        },
        by_market: [
          { market: "XRPUSDT", recommended_action: "HOLD", allocation_score: 0.1, penalty_reasons: [] },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.2) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_requested_severity, "HARD");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_effective_severity, "SOFT");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_hard_eligible, false);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_gate_reason, "ALPHA_CONTEXT_HARD_DOWNGRADED_TO_SOFT");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE_SCALE: "0.4",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MIN_REALIZED_N: "20",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_POSITIVE_RATE: "0.15",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_AVG_REALIZED_RET_NET: "-0.003",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      intent: "ENTRY",
      event: "ENTRY_SHORT_REAL",
      side: "SELL",
      qtyPct: 0.5,
      features: {
        position_side: "SHORT",
        openclaw_market_regime_cohort: "TREND",
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: {
          alpha_penalty_context_rows: [
            { market: "ETHUSDT", position_side: "SHORT", regime_key: "TREND", severity: "HARD", realized_n: 30, positive_rate: 0.05, avg_realized_ret_net: -0.005 },
          ],
        },
        by_market: [
          { market: "ETHUSDT", recommended_action: "HOLD", allocation_score: -0.1, penalty_reasons: [] },
        ],
      },
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_BLOCK");
    assert.strictEqual(res.qtyPctFinal, 0);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_requested_severity, "HARD");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_effective_severity, "HARD");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_hard_eligible, true);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_gate_reason, "ALPHA_CONTEXT_HARD_CONFIRMED");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_RELEASE_ENABLED: "1",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_RELEASE_SCALE: "0.6",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MIN_REALIZED_N: "20",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_POSITIVE_RATE: "0.15",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_AVG_REALIZED_RET_NET: "-0.003",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      intent: "ENTRY",
      event: "ENTRY_SHORT_REAL",
      side: "SELL",
      qtyPct: 0.5,
      features: {
        position_side: "SHORT",
        openclaw_market_regime_cohort: "TREND",
      },
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: {
          learning_epoch_active: true,
          alpha_penalty_context_rows: [
            { market: "ETHUSDT", position_side: "SHORT", regime_key: "TREND", severity: "HARD", realized_n: 30, positive_rate: 0.05, avg_realized_ret_net: -0.005 },
          ],
        },
        by_market: [
          { market: "ETHUSDT", recommended_action: "HOLD", allocation_score: -0.1, penalty_reasons: [] },
        ],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.3) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_learning_epoch_active, true);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_epoch_release_active, true);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_requested_severity, "HARD");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_effective_severity, "HARD");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_hard_eligible, true);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_gate_reason, "ALPHA_CONTEXT_HARD_CONFIRMED");
  });

  await withEnv({
    OPENCLAW_EXECUTOR_ENABLED: "1",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD: "99",
    OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE_SCALE: "0.5",
  }, async () => {
    const { evaluateOpenClawExecutionDecision } = freshRequire("../services/openclawExecutionExecutor");
    const nowMs = Date.parse("2026-04-14T08:00:00.000Z");
    const res = await evaluateOpenClawExecutionDecision({
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      intent: "ENTRY",
      event: "ENTRY_SHORT_REAL",
      side: "SELL",
      qtyPct: 0.6,
      features: {
        position_side: "SHORT",
        openclaw_market_regime_cohort: "TREND",
      },
      nowMs,
      positionViews: [],
      recentTimelineRows: [],
      capitalAllocatorSnapshot: {
        summary: {
          input_freshness_status: "STALE_INPUTS",
          input_stale: true,
          alpha_penalty_context_rows: [
            { market: "DOGEUSDT", position_side: "SHORT", regime_key: "TREND", severity: "HARD", realized_n: 2 },
          ],
        },
        mtimeMs: nowMs,
        generated_at_kst: "2026-04-14 17:00:00 KST",
        by_market: [],
      },
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_REDUCE");
    assert.ok(Math.abs(res.qtyPctFinal - 0.33) < 1e-9);
    assert.strictEqual(res.featuresPatch._openclaw_executor_allocator_snapshot_stale, true);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context.severity, "HARD");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_requested_severity, "HARD");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_effective_severity, "SOFT");
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_hard_eligible, false);
    assert.strictEqual(res.featuresPatch._openclaw_executor_alpha_context_gate_reason, "ALPHA_CONTEXT_HARD_DOWNGRADED_TO_SOFT");
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
