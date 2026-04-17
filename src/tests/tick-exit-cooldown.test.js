"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");
const { __test: runnerTest } = require("../engine/paperBinanceRunner");
const { __test: observationTest } = require("../storage/positionRuntimeObservations");

async function run() {
  const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  __test._symbolCooldownState.clear();
  assert.strictEqual(typeof __test.buildTickTrailObservationDocUpdate, "function", "trail observation update helper missing");
  assert.strictEqual(typeof __test.buildTickTrailReconcileRunId, "function", "trail reconcile run id helper missing");
  assert.strictEqual(typeof __test.buildBinanceTickExitNativeProtectionRefreshArgs, "function", "tick exit native refresh args helper missing");
  assert.strictEqual(typeof __test.refreshBinanceTickExitNativeProtection, "function", "tick exit native refresh helper missing");
  assert.strictEqual(typeof __test.heartbeatTickExitLease, "function", "tick exit lease heartbeat helper missing");
  assert.strictEqual(typeof __test.runTickExitSelfHealPhase, "function", "tick exit self-heal helper missing");
  assert.strictEqual(typeof __test.applyTrailObservationToPosition, "function", "tick exit trail observation apply helper missing");
  assert.strictEqual(typeof __test.isNativeStopLessProtectiveThanTrigger, "function", "tick exit trail floor helper missing");
  assert.strictEqual(typeof __test.collectTriggeredKinds, "function", "tick exit trigger collector helper missing");
  assert.strictEqual(typeof __test.resolveTickExitSymbolsToCheck, "function", "tick exit target symbol resolver helper missing");
  assert.strictEqual(typeof observationTest.buildTrailObservationPayload, "function", "trail observation payload helper missing");
  assert.strictEqual(typeof observationTest.resolveTrailObservationSnapshot, "function", "trail observation snapshot helper missing");
  assert.strictEqual(typeof observationTest.shouldRejectStaleTrailObservation, "function", "trail observation stale guard helper missing");
  assert.strictEqual(typeof runnerTest.applyTrailObservationSnapshotToMeta, "function", "trail observation apply helper missing");

  const obsPatch = __test.buildTickTrailObservationDocUpdate({ "meta.trail_high": 1.23, "meta.trail_high_at_ms": 123 }, "2026-04-10T00:00:00.000Z");
  assert.deepStrictEqual(obsPatch, {
    "meta.trail_high": 1.23,
    "meta.trail_high_at_ms": 123,
    updated_at: "2026-04-10T00:00:00.000Z",
  }, "tick exit should only write trail observation fields directly");
  assert.strictEqual(
    __test.buildTickTrailReconcileRunId("dogeusdt", 12345),
    "RUN__TRAIL_RECONCILE__BINANCEFUT__DOGEUSDT__12345",
    "trail reconcile run id must normalize symbol"
  );
  assert.deepStrictEqual(
    __test.resolveTickExitSymbolsToCheck({
      exCfg: { markets: ["BTCUSDT", "ETHUSDT", "XRPUSDT"] },
      targetSymbols: ["ethusdt", "ETHUSDT", "DOGEUSDT"],
    }),
    ["ETHUSDT"],
    "targeted exit-worker burst must only scan configured requested symbols"
  );
  assert.deepStrictEqual(
    __test.resolveTickExitSymbolsToCheck({
      exCfg: { markets: ["BTCUSDT", "ETHUSDT"] },
      targetSymbols: null,
    }),
    ["BTCUSDT", "ETHUSDT"],
    "full exit-worker burst must keep configured market scope"
  );
  assert.deepStrictEqual(
    __test.buildBinanceTickExitNativeProtectionRefreshArgs({
      liveCfg: { apiKey: "x", apiSecret: "y" },
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      position: {
        avg_price: 2258.08,
        leverage: 2,
        meta: {
          external_leverage: 3,
          exit_rules_override: { TP_P1: 0.0168 },
          marker: "keep",
        },
      },
      fallbackSide: "SELL",
    }),
    {
      liveCfg: { apiKey: "x", apiSecret: "y" },
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 2258.08,
      fallbackLeverage: 3,
      exitRulesOverride: { TP_P1: 0.0168 },
      posMeta: {
        external_leverage: 3,
        exit_rules_override: { TP_P1: 0.0168 },
        marker: "keep",
      },
      writerSource: "BINANCE_TICK_EXIT",
    },
    "tick exit native refresh args helper must pin stop authority to BINANCE_TICK_EXIT"
  );
  let capturedRefreshArgs = null;
  await __test.refreshBinanceTickExitNativeProtection({
    liveCfg: { apiKey: "a", apiSecret: "b" },
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    position: {
      avg_price: 100,
      leverage: 2,
      meta: {
        position_side: "SHORT",
        exit_rules_override: { SL: -0.0165 },
      },
    },
    refreshFn: async (args) => {
      capturedRefreshArgs = args;
      return { ok: true, reason: "OK" };
    },
  });
  assert.ok(capturedRefreshArgs, "tick exit native refresh helper must call injected refresh fn");
  assert.strictEqual(capturedRefreshArgs.writerSource, "BINANCE_TICK_EXIT");
  assert.strictEqual(capturedRefreshArgs.fallbackSide, "SELL");
  assert.strictEqual(capturedRefreshArgs.fallbackEntryPrice, 100);
  assert.strictEqual(capturedRefreshArgs.fallbackLeverage, 2);
  assert.deepStrictEqual(
    observationTest.buildTrailObservationPayload({
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      side: "LONG",
      entryEventId: "BINANCEFUT|DOGEUSDT|15m|123|LONG|LONG",
      entryExecBarMs: 123,
      trailHigh: 1.23,
      trailHighAtMs: 123,
      source: "TICK_EXIT",
    }).trail_observation,
    {
      side: "LONG",
      entry_event_id: "BINANCEFUT|DOGEUSDT|15m|123|LONG|LONG",
      entry_exec_bar_ms: 123,
      entry_price: null,
      entry_r_distance: null,
      trail_r_multiple: null,
      trail_high: 1.23,
      trail_high_at_ms: 123,
      trail_low: null,
      trail_low_at_ms: null,
      runner_floor_stop: null,
      computed_trail_stop: null,
      trail_stop_raw: null,
      trail_stop_by_r: null,
      r_based_trail_stop: null,
      trail_stop_by_pct: null,
      chosen_stop_source: null,
      chosen_stop_price: null,
      final_effective_stop: null,
      native_stop_price: null,
      native_stop_order_id: null,
      native_refresh_status: null,
      last_reprice_at_ms: null,
      runtime_eval_at_ms: null,
      source: "TICK_EXIT",
    },
    "trail observation payload should keep trail snapshot in observation store format"
  );
  assert.deepStrictEqual(
    observationTest.resolveTrailObservationSnapshot({
      meta: {
        trail_high: 1.21,
        trail_high_at_ms: 100,
        trail_low: null,
        trail_low_at_ms: null,
        native_protection_stop_price: 1.2,
        native_protection_stop_order_id: "old_stop",
        native_protection_refresh_status: "OK",
        native_protection_refresh_at_ms: 100,
      },
      observation: {
        trail_observation: {
          entry_event_id: "BINANCEFUT|DOGEUSDT|15m|123|LONG|LONG",
          entry_exec_bar_ms: 123,
          trail_high: 1.23,
          trail_high_at_ms: 123,
          runner_floor_stop: 1.25,
          computed_trail_stop: 1.251,
          native_stop_price: 1.251,
          native_stop_order_id: "new_stop",
          native_refresh_status: "OK",
          runtime_eval_at_ms: 123,
          trail_low: null,
          trail_low_at_ms: null,
          source: "TICK_EXIT",
        },
      },
    }),
    {
      trail_high: 1.23,
      trail_high_at_ms: 123,
      trail_low: null,
      trail_low_at_ms: null,
      trail_source: "TICK_EXIT",
      entry_price: null,
      entry_r_distance: null,
      trail_r_multiple: null,
      runner_floor_stop: 1.25,
      computed_trail_stop: 1.251,
      trail_stop_raw: null,
      trail_stop_by_r: null,
      r_based_trail_stop: null,
      trail_stop_by_pct: null,
      chosen_stop_source: "RUNNER_FLOOR",
      chosen_stop_price: 1.25,
      final_effective_stop: 1.25,
      native_stop_price: 1.251,
      native_stop_order_id: "new_stop",
      native_refresh_status: "OK",
      last_reprice_at_ms: null,
      runtime_eval_at_ms: 123,
    },
    "newer observation trail snapshot should override stale meta trail snapshot"
  );
  assert.deepStrictEqual(
    observationTest.normalizeChosenStopAuthority({
      side: "LONG",
      runnerFloorStop: 2276.70916,
      trailStopByR: 2335.9146,
      chosenStopSource: "TRAIL",
      chosenStopPrice: 2276.70916,
    }),
    {
      chosenStopSource: "TRAIL",
      chosenStopPrice: 2335.9146,
    },
    "chosen stop authority should prefer the stronger trail stop over a stale floor-labelled price"
  );
  assert.strictEqual(
    observationTest.shouldRejectStaleTrailObservation({
      currentObservation: { runtime_eval_at_ms: 200 },
      nextObservation: { runtime_eval_at_ms: 100 },
    }),
    true,
    "older runtime observations must not overwrite newer trail truth"
  );
  assert.deepStrictEqual(
    runnerTest.applyTrailObservationSnapshotToMeta({
      meta: {
        trail_high: 1.21,
        trail_high_at_ms: 100,
        trail_low: null,
        trail_low_at_ms: null,
      },
      observation: {
        trail_observation: {
          side: "LONG",
          entry_event_id: "BINANCEFUT|DOGEUSDT|15m|123|LONG|LONG",
          entry_exec_bar_ms: 123,
          trail_high: 1.23,
          trail_high_at_ms: 123,
          source: "TICK_EXIT",
        },
      },
      positionSide: "LONG",
      entryLineage: {
        entry_event_id: "BINANCEFUT|DOGEUSDT|15m|123|LONG|LONG",
        entry_exec_bar_ms: 123,
      },
      allowDuringEntryTransition: true,
    }),
    {
      trail_high: 1.23,
      trail_high_at_ms: 123,
      trail_low: null,
      trail_low_at_ms: null,
    },
    "sync path should apply newer same-side trail observation snapshot"
  );
  assert.deepStrictEqual(
    runnerTest.applyTrailObservationSnapshotToMeta({
      meta: {
        trail_high: null,
        trail_high_at_ms: null,
        trail_low: null,
        trail_low_at_ms: null,
      },
      observation: {
        trail_observation: {
          side: "LONG",
          entry_event_id: "BINANCEFUT|DOGEUSDT|15m|123|LONG|LONG",
          entry_exec_bar_ms: 123,
          trail_high: 1.23,
          trail_high_at_ms: 123,
          source: "TICK_EXIT",
        },
      },
      positionSide: "SHORT",
      allowDuringEntryTransition: true,
    }),
    {
      trail_high: null,
      trail_high_at_ms: null,
      trail_low: null,
      trail_low_at_ms: null,
    },
    "sync path must ignore opposite-side trail observations"
  );
  assert.deepStrictEqual(
    runnerTest.applyTrailObservationSnapshotToMeta({
      meta: {
        trail_high: null,
        trail_high_at_ms: null,
        trail_low: null,
        trail_low_at_ms: null,
      },
      observation: {
        trail_observation: {
          side: "LONG",
          entry_event_id: "BINANCEFUT|DOGEUSDT|15m|123|LONG|LONG",
          entry_exec_bar_ms: 123,
          trail_high: 1.23,
          trail_high_at_ms: 123,
          source: "TICK_EXIT",
        },
      },
      positionSide: "LONG",
      entryLineage: {
        entry_event_id: "BINANCEFUT|DOGEUSDT|15m|456|LONG|LONG",
        entry_exec_bar_ms: 456,
      },
      allowDuringEntryTransition: true,
    }),
    {
      trail_high: null,
      trail_high_at_ms: null,
      trail_low: null,
      trail_low_at_ms: null,
    },
    "sync path must ignore stale same-side trail observations when entry lineage changed"
  );
  assert.deepStrictEqual(
    __test.applyTrailObservationToPosition({
      pos: {
        avg_price: 100,
        meta: {
          position_side: "LONG",
          trail_high: 1.21,
          trail_high_at_ms: 100,
          trail_low: null,
          trail_low_at_ms: null,
        },
      },
      observation: {
        trail_observation: {
          side: "LONG",
          trail_high: 1.23,
          trail_high_at_ms: 123,
          source: "TICK_EXIT",
        },
      },
    }).meta,
    {
      position_side: "LONG",
      trail_high: 1.23,
      trail_high_at_ms: 123,
      trail_low: null,
      trail_low_at_ms: null,
    },
    "tick exit should evaluate triggers against the freshest trail observation snapshot"
  );
  assert.strictEqual(
    __test.isNativeStopLessProtectiveThanTrigger({
      meta: { native_protection_stop_price: 1.3368 },
      triggerPrice: 1.359124,
      side: "LONG",
    }),
    true,
    "long trailing stop below runner floor must be treated as protection deficit"
  );
  assert.strictEqual(
    __test.isNativeStopLessProtectiveThanTrigger({
      meta: { native_protection_stop_price: 99.8 },
      triggerPrice: 99.175,
      side: "SHORT",
    }),
    true,
    "short trailing stop above runner floor must be treated as protection deficit"
  );
  assert.strictEqual(
    __test.isNativeStopLessProtectiveThanTrigger({
      meta: { native_protection_stop_price: 1.36 },
      triggerPrice: 1.359124,
      side: "LONG",
    }),
    false,
    "already protective long native stop must not trigger refresh"
  );
  assert.deepStrictEqual(
    __test.collectTriggeredKinds({
      price: 99.1,
      triggers: [{ kind: "TRAIL", price: 99.2 }, { kind: "SL", price: 98.4 }],
      nearPct: 0.002,
      side: "LONG",
    }),
    ["TRAIL"],
    "trail trigger collector should isolate trail-only near/crossed states"
  );
  const simplifiedV2TriggerKinds = __test.computeExitTriggers({
    pos: {
      avg_price: 100,
      exchange: "BINANCEFUT",
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0168,
          SL: -0.0165,
        },
      },
    },
    rules: {
      TP_P0: 0.008,
      TP_P1: 0.0168,
      SL: -0.0165,
    },
    leverageEff: 2,
    nativeProtectionState: {
      stopActive: false,
      tpActive: false,
    },
  }).map((row) => row.kind);
  assert.ok(!simplifiedV2TriggerKinds.includes("TP_P0"), "simplified exit v2 must not emit TP_P0 triggers in tick-exit");
  assert.ok(simplifiedV2TriggerKinds.includes("SL"), "simplified exit v2 must keep SL trigger in tick-exit");
  assert.ok(simplifiedV2TriggerKinds.includes("TP_P1"), "simplified exit v2 must keep TP1 trigger in tick-exit");

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const missingFlagTriggerKinds = __test.computeExitTriggers({
    pos: {
      avg_price: 100,
      exchange: "BINANCEFUT",
      position_side: "LONG",
      meta: {
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0168,
          SL: -0.0165,
        },
      },
    },
    rules: {
      TP_P0: 0.008,
      TP_P1: 0.0168,
      SL: -0.0165,
    },
    leverageEff: 2,
    nativeProtectionState: {
      stopActive: false,
      tpActive: false,
    },
  }).map((row) => row.kind);
  assert.ok(!missingFlagTriggerKinds.includes("TP_P0"), "missing simplified-exit flag must fail closed for tick-exit TP0");
  assert.ok(missingFlagTriggerKinds.includes("TP_P1"), "missing simplified-exit flag must still keep TP1 tick trigger");
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;

  assert.strictEqual(typeof runnerTest.computeTrailingMetaUpdate, "function", "computeTrailingMetaUpdate export missing");
  assert.strictEqual(typeof runnerTest.sanitizeBarLoopMetaUpdates, "function", "sanitizeBarLoopMetaUpdates export missing");
  const trailUpdate = runnerTest.computeTrailingMetaUpdate({
    exchange: "BINANCEFUT",
    bar: { close: 101, bar_close_time_utc_ms: 555 },
    position: { state: "ACTIVE", position_side: "LONG" },
    posMeta: { tp_p1_done: true, trail_active: false, trail_high: 100, exit_rules_override: { TRAIL_R_MULTIPLE: 0.6 } },
    positionSideFallback: "LONG",
  });
  assert.deepStrictEqual(trailUpdate, { trail_high: 101, trail_high_at_ms: 555 }, "runner trailing update should only write observation fields");
  assert.deepStrictEqual(
    runnerTest.sanitizeBarLoopMetaUpdates({
      tp_p1_pending: true,
      opposite_transition_stage: 1,
      core_probe_long_remaining_pct: 0.2,
      last_entry_bar_ms_long: 123,
      trail_active: true,
      native_protection_stop_order_id: "bad",
    }),
    {
      tp_p1_pending: true,
      opposite_transition_stage: 1,
      core_probe_long_remaining_pct: 0.2,
      last_entry_bar_ms_long: 123,
    },
    "bar loop direct writes must exclude projection-owned fields"
  );

  const symbol = "BTCUSDT";
  const cooldownMs = 120000;
  const t0 = 1_700_000_000_000;

  const first = __test.shouldRunBySymbolCooldown({ symbol, now: t0, cooldownMs });
  assert.strictEqual(first.ok, true, "first execution must pass");

  const second = __test.shouldRunBySymbolCooldown({ symbol, now: t0 + 30000, cooldownMs });
  assert.strictEqual(second.ok, false, "second execution within cooldown must be blocked");
  assert.ok(second.remainingMs > 0 && second.remainingMs <= cooldownMs, "remainingMs should be valid");

  const third = __test.shouldRunBySymbolCooldown({ symbol, now: t0 + cooldownMs + 1, cooldownMs });
  assert.strictEqual(third.ok, true, "execution after cooldown must pass");

  let healCalls = 0;
  const healSkipped = __test.runTickExitSelfHealPhase({
    enabled: true,
    leaseHeartbeatOk: false,
    runSelfHeal: async () => {
      healCalls += 1;
      return { ok: true };
    },
  });
  assert.ok(healSkipped && typeof healSkipped.then === "function", "self-heal helper should remain async");

  return healSkipped.then(async (skipped) => {
    assert.strictEqual(skipped.skipped, true, "lease lost should skip self-heal");
    assert.strictEqual(skipped.reason, "LEASE_LOST");
    assert.strictEqual(healCalls, 0, "lease lost path must not call self-heal");

    const executed = await __test.runTickExitSelfHealPhase({
      enabled: true,
      leaseHeartbeatOk: true,
      reason: "TICK_EXIT_LOOP",
      maxPositions: 7,
      runSelfHeal: async (args) => {
        healCalls += 1;
        return { ok: true, args };
      },
    });
    assert.strictEqual(executed.ok, true);
    assert.strictEqual(executed.args.reason, "TICK_EXIT_LOOP");
    assert.strictEqual(executed.args.maxPositions, 7);
    assert.strictEqual(healCalls, 1, "healthy lease path should call self-heal once");
  });
}

try {
  Promise.resolve(run()).then(() => {
    console.log("TICK_EXIT_COOLDOWN_TEST_OK");
  }).catch((err) => {
    console.error("TICK_EXIT_COOLDOWN_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} catch (err) {
  console.error("TICK_EXIT_COOLDOWN_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
