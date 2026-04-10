"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

async function run() {
  assert.strictEqual(typeof __test.resolveLiveRescueAddConfig, "function", "resolveLiveRescueAddConfig export missing");
  assert.strictEqual(typeof __test.evaluateLiveRescueAdd, "function", "evaluateLiveRescueAdd export missing");
  assert.strictEqual(typeof __test.resolveReplayRescueAddConfig, "function", "resolveReplayRescueAddConfig export missing");
  assert.strictEqual(typeof __test.evaluateReplayRescueAdd, "function", "evaluateReplayRescueAdd export missing");
  assert.strictEqual(typeof __test.resolveForceAllSignalsAdd, "function", "resolveForceAllSignalsAdd export missing");
  assert.strictEqual(typeof __test.resolveAddRiskConfig, "function", "resolveAddRiskConfig export missing");
  assert.strictEqual(typeof __test.ensureLogicalAddCapState, "function", "ensureLogicalAddCapState export missing");
  assert.strictEqual(typeof __test.resolveCurrentQtyPctForCap, "function", "resolveCurrentQtyPctForCap export missing");
  assert.strictEqual(typeof __test.resolveLogicalCurrentQtyPctForBudget, "function", "resolveLogicalCurrentQtyPctForBudget export missing");
  assert.strictEqual(typeof __test.resolveSyncedAddChainBaseQtyPct, "function", "resolveSyncedAddChainBaseQtyPct export missing");
  assert.strictEqual(typeof __test.collectActivePendingAddIntentState, "function", "collectActivePendingAddIntentState export missing");
  assert.strictEqual(typeof __test.evaluateAddIntentRiskGuard, "function", "evaluateAddIntentRiskGuard export missing");
  assert.strictEqual(typeof __test.applyAddRiskMetaOnFill, "function", "applyAddRiskMetaOnFill export missing");
  assert.strictEqual(typeof __test.buildNativeProtectionMetaPatch, "function", "buildNativeProtectionMetaPatch export missing");
  assert.strictEqual(typeof __test.applyAddAndProtectionMetaOnFill, "function", "applyAddAndProtectionMetaOnFill export missing");
  assert.strictEqual(typeof __test.applyBarLoopObservationMetaUpdate, "function", "applyBarLoopObservationMetaUpdate export missing");
  assert.strictEqual(typeof __test.applyTpP1IntentFillMetaUpdate, "function", "applyTpP1IntentFillMetaUpdate export missing");
  assert.strictEqual(typeof __test.buildFuturesPositionSyncKey, "function", "buildFuturesPositionSyncKey export missing");
  assert.strictEqual(typeof __test.serializeFuturesPositionSync, "function", "serializeFuturesPositionSync export missing");
  assert.strictEqual(typeof __test.buildFuturesPositionSyncLeaseDocPath, "function", "buildFuturesPositionSyncLeaseDocPath export missing");
  assert.strictEqual(typeof __test.runDistributedFuturesPositionSync, "function", "runDistributedFuturesPositionSync export missing");
  assert.strictEqual(typeof __test.buildOpenCloseProjectionResetMetaPatch, "function", "buildOpenCloseProjectionResetMetaPatch export missing");
  assert.strictEqual(typeof __test.buildOpenCloseTransitionMetaPatch, "function", "buildOpenCloseTransitionMetaPatch export missing");
  assert.strictEqual(typeof __test.buildClosingFillMetaPatch, "function", "buildClosingFillMetaPatch export missing");
  assert.strictEqual(typeof __test.buildOpeningFillMetaPatch, "function", "buildOpeningFillMetaPatch export missing");
  assert.strictEqual(typeof __test.evaluateCommittedRescueAddGate, "function", "evaluateCommittedRescueAddGate export missing");
  assert.strictEqual(__test.resolveForceAllSignalsAdd({}, "BINANCEFUT"), false, "Binance default must not auto-upgrade same-direction signals to ADD");
  assert.strictEqual(
    __test.resolveForceAllSignalsAdd({ force_all_signals_add: true, rescue_add_enabled: false }, "BINANCEFUT"),
    true,
    "explicit override should still allow legacy force-all-add mode when intentionally enabled"
  );

  const sysCfg = {
    force_all_signals_add: false,
    rescue_add_enabled: true,
    rescue_add_tiers: ["EARLY", "CORE", "PRE_REAL"],
    rescue_add_sides: ["LONG", "SHORT"],
    rescue_add_size: 1,
    rescue_add_min_loss_pct: 0.1,
    rescue_add_max_loss_pct: 1.4,
    rescue_add_max_adds: 1,
    rescue_add_same_bar_block: true,
    rescue_add_pre_tp1_only: true,
    rescue_add_block_opposite_transition: true,
  };
  const cfg = __test.resolveLiveRescueAddConfig(sysCfg, "BINANCEFUT");
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.addFraction, 1);
  assert.strictEqual(cfg.minLossPct, 0.1);
  assert.strictEqual(cfg.maxLossPct, 1.4);
  assert.strictEqual(cfg.maxAdds, 1);
  assert.strictEqual(__test.resolveForceAllSignalsAdd(sysCfg, "BINANCEFUT"), false);

  const cfgMaxAddZero = __test.resolveLiveRescueAddConfig({
    ...sysCfg,
    rescue_add_max_adds: 0,
  }, "BINANCEFUT");
  assert.strictEqual(cfgMaxAddZero.maxAdds, 0);
  const blockedByZeroMaxAdds = __test.evaluateLiveRescueAdd({
    cfg: cfgMaxAddZero,
    event: "CORE_LONG",
    position: { avg_price: 100, size_pct: 0.25 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(blockedByZeroMaxAdds.ok, false);
  assert.strictEqual(blockedByZeroMaxAdds.reason, "LIVE_RESCUE_ADD_LIMIT_BLOCKED");

  const allowed = __test.evaluateLiveRescueAdd({
    cfg,
    event: "CORE_LONG",
    position: { avg_price: 100, size_pct: 0.25 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(allowed.enabled, true);
  assert.strictEqual(allowed.ok, true);
  assert.ok(Math.abs(allowed.addQtyPct - 0.25) < 1e-12);
  assert.strictEqual(allowed.detail.auto_shrunk, false);

  const earlyUpgradeBlocked = __test.evaluateLiveRescueAdd({
    cfg,
    event: "CORE_LONG",
    position: { avg_price: 100, size_pct: 0.08 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
      last_entry_tier_long: 1,
    },
    posSide: "LONG",
    posSizePct: 0.08,
    bar: { close: 100.5 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(earlyUpgradeBlocked.ok, false);
  assert.strictEqual(earlyUpgradeBlocked.reason, "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED");

  const shrunk = __test.evaluateLiveRescueAdd({
    cfg,
    event: "PRE_REAL_SHORT",
    position: { avg_price: 100, size_pct: 0.70 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
    },
    posSide: "SHORT",
    posSizePct: 0.70,
    bar: { close: 101 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(shrunk.ok, true);
  assert.ok(Math.abs(shrunk.detail.requested_add_qty_pct - 0.70) < 1e-12);
  assert.ok(Math.abs(shrunk.addQtyPct - 0.30) < 1e-12);
  assert.strictEqual(shrunk.detail.auto_shrunk, true);

  const blockedSameBar = __test.evaluateLiveRescueAdd({
    cfg,
    event: "CORE_LONG",
    position: { avg_price: 100, size_pct: 0.25 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T01:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(blockedSameBar.ok, false);
  assert.strictEqual(blockedSameBar.reason, "LIVE_RESCUE_ADD_SAME_BAR_BLOCKED");

  const blockedPending = __test.evaluateLiveRescueAdd({
    cfg,
    event: "CORE_LONG",
    position: { avg_price: 100, size_pct: 0.25 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: true,
      trail_active: false,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(blockedPending.ok, false);
  assert.strictEqual(blockedPending.reason, "LIVE_RESCUE_ADD_POST_TP1_BLOCKED");

  const leverageAware = __test.evaluateLiveRescueAdd({
    cfg,
    event: "CORE_LONG",
    position: {
      avg_price: 100,
      size_pct: 0.25,
      leverage: 2,
      meta: { leverage: 2 },
    },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
      leverage: 2,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99.5 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(leverageAware.ok, true);
  assert.strictEqual(leverageAware.detail.loss_pct, 1);

  const tpP1Update = __test.applyTpP1IntentFillMetaUpdate({
    exchange: "BINANCEFUT",
    pos: { avg_price: 100, meta: { entry_event_id: "ENTRY-1", entry_exec_bar_ms: 123 } },
    nextMeta: { entry_event_id: "ENTRY-1", entry_exec_bar_ms: 123, tp_p0_done: true },
    metaSide: "LONG",
    fillPrice: 101.6,
    execBarCloseMs: 456,
    entryEventIdForFill: "ENTRY-1",
    applyOptimisticFillProjection: true,
  });
  assert.strictEqual(tpP1Update.meta.tp_p1_done, true);
  assert.strictEqual(tpP1Update.meta.tp_p1_source, "INTENT_FILL");
  assert.strictEqual(tpP1Update.meta.native_protection_tp0_order_id, null);
  assert.strictEqual(tpP1Update.nextTrailHigh, 101.6);
  assert.strictEqual(tpP1Update.nextTrailLow, null);

  assert.strictEqual(
    __test.buildFuturesPositionSyncKey("binancefut", "dogeusdt"),
    "BINANCEFUT::DOGEUSDT"
  );
  assert.strictEqual(
    __test.buildFuturesPositionSyncLeaseDocPath("binancefut", "dogeusdt"),
    "runtime_locks/futures_position_sync__BINANCEFUT__DOGEUSDT"
  );

  const ordered = [];
  const firstSync = __test.serializeFuturesPositionSync({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    runner: async () => {
      ordered.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      ordered.push("first-end");
      return "first";
    },
  });
  const secondSync = __test.serializeFuturesPositionSync({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    runner: async () => {
      ordered.push("second-start");
      ordered.push("second-end");
      return "second";
    },
  });
  const [firstResult, secondResult] = await Promise.all([firstSync, secondSync]);
  assert.strictEqual(firstResult, "first");
  assert.strictEqual(secondResult, "second");
  assert.deepStrictEqual(
    ordered,
    ["first-start", "first-end", "second-start", "second-end"],
    "same-symbol futures sync should serialize in-order"
  );

  const leaseTrace = [];
  let acquireCount = 0;
  const distributedResult = await __test.runDistributedFuturesPositionSync({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    waitMs: 500,
    ttlMs: 3000,
    acquireLease: async () => {
      acquireCount += 1;
      if (acquireCount === 1) return { acquired: false, holder: "other-worker" };
      leaseTrace.push("acquired");
      return { acquired: true, holderId: "lease-holder-1" };
    },
    heartbeatLease: async () => {
      leaseTrace.push("heartbeat");
      return { ok: true };
    },
    releaseLease: async () => {
      leaseTrace.push("released");
      return { ok: true };
    },
    sleep: async () => {
      leaseTrace.push("slept");
    },
    runner: async () => {
      leaseTrace.push("runner");
      return { ok: true, source: "runner" };
    },
  });
  assert.strictEqual(distributedResult.ok, true);
  assert.strictEqual(distributedResult.source, "runner");
  assert.deepStrictEqual(
    leaseTrace,
    ["slept", "acquired", "heartbeat", "runner", "released"],
    "distributed sync should wait, acquire lease, heartbeat once, run, then release"
  );

  const resetPatch = __test.buildOpenCloseProjectionResetMetaPatch({ closing: false });
  assert.strictEqual(resetPatch.trail_active, false);
  assert.strictEqual(resetPatch.trail_high, null);
  assert.strictEqual(resetPatch.tp_p1_done, false);
  assert.strictEqual(resetPatch.native_protection_stop_order_id, undefined);

  const closingResetPatch = __test.buildOpenCloseProjectionResetMetaPatch({ closing: true });
  assert.strictEqual(closingResetPatch.native_protection_stop_order_id, null);
  assert.strictEqual(closingResetPatch.native_protection_refresh_status, null);

  const openingTransitionReset = __test.buildOpenCloseTransitionMetaPatch({ closing: false, includeEntryRiskReset: true });
  assert.strictEqual(openingTransitionReset.initial_stop_price, null);
  assert.strictEqual(openingTransitionReset.trail_active, false);
  assert.strictEqual(openingTransitionReset.add_chain_last_qty_base, null);

  const futuresTransitionReset = __test.buildOpenCloseTransitionMetaPatch({ closing: false, includeEntryRiskReset: false });
  assert.strictEqual(futuresTransitionReset.initial_stop_price, undefined);
  assert.strictEqual(futuresTransitionReset.entry_r_distance, undefined);
  assert.strictEqual(futuresTransitionReset.trail_active, false);

  const closingPatch = __test.buildClosingFillMetaPatch({
    execBarCloseMs: 456,
    metaSide: "LONG",
    includeExitProfileRollback: false,
  });
  assert.strictEqual(closingPatch.last_exit_bar_ms, 456);
  assert.strictEqual(closingPatch.last_exit_dir, "LONG");
  assert.strictEqual(closingPatch.exit_profile, null);
  assert.strictEqual(closingPatch.exit_profile_rollback_active, undefined);

  const closingPatchWithRollback = __test.buildClosingFillMetaPatch({
    execBarCloseMs: 789,
    metaSide: "SHORT",
    includeExitProfileRollback: true,
  });
  assert.strictEqual(closingPatchWithRollback.exit_profile_rollback_active, false);
  assert.strictEqual(closingPatchWithRollback.exit_profile_rollback_until_ms, null);

  const openingPatchSimple = __test.buildOpeningFillMetaPatch({
    leverageValue: 2,
    signalTfMs: 900000,
    newSize: 0.25,
    features: { ev_gate_atr_pct: 0.17 },
    marketRegimeCohort: "TRANSITION",
    marketRegimeRow: { objective_score: 0.81, drop_verdict: "hold" },
    entryEventIdFromIntent: "ENTRY-1",
    entrySignalTypeFromIntent: "LONG",
    entryGradeFromIntent: "EARLY",
    entryQtyProfileFromIntent: "FIXED",
    signalBarCloseTimeUtcMs: 111,
    execBarCloseMs: 222,
    includeLeverageReason: false,
    includeEntryRiskFields: false,
  });
  assert.strictEqual(openingPatchSimple.leverage, 2);
  assert.strictEqual(openingPatchSimple.leverage_reason, undefined);
  assert.strictEqual(openingPatchSimple.initial_stop_price, undefined);
  assert.strictEqual(openingPatchSimple.openclaw_market_regime_cohort, "TRANSITION");
  assert.strictEqual(openingPatchSimple.entry_event_id, "ENTRY-1");

  const openingPatchFull = __test.buildOpeningFillMetaPatch({
    leverageValue: 3,
    leverageReason: "ENTRY",
    signalTfMs: 900000,
    newSize: 0.5,
    features: { ev_gate_atr_pct: 0.2 },
    marketRegimeCohort: "CORE",
    marketRegimeRow: { objective_score: 0.9, drop_verdict: "keep" },
    entryEventIdFromIntent: "ENTRY-2",
    entrySignalTypeFromIntent: "SHORT",
    entryGradeFromIntent: "CORE",
    entryQtyProfileFromIntent: "SCALED",
    signalBarCloseTimeUtcMs: 333,
    execBarCloseMs: 444,
    initialStopPrice: 99.1,
    initialStopSource: "STRUCTURE",
    entryRDistance: 1.2,
    trailRMultiple: 0.6,
    includeLeverageReason: true,
    includeEntryRiskFields: true,
  });
  assert.strictEqual(openingPatchFull.leverage_reason, "ENTRY");
  assert.strictEqual(openingPatchFull.initial_stop_price, 99.1);
  assert.strictEqual(openingPatchFull.initial_stop_source, "STRUCTURE");
  assert.strictEqual(openingPatchFull.entry_r_distance, 1.2);
  assert.strictEqual(openingPatchFull.trail_r_multiple, 0.6);

  const baseSizeAware = __test.evaluateLiveRescueAdd({
    cfg,
    event: "CORE_LONG",
    position: {
      avg_price: 100,
      size_pct: 0.18,
      leverage: 2,
      meta: { leverage: 2 },
    },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
      leverage: 2,
      add_chain_base_qty_pct: 0.25,
    },
    posSide: "LONG",
    posSizePct: 0.18,
    bar: { close: 99.5 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(baseSizeAware.ok, true);
  assert.strictEqual(baseSizeAware.detail.base_qty_pct, 0.25);
  assert.strictEqual(baseSizeAware.detail.requested_add_qty_pct, 0.25);
  assert.strictEqual(baseSizeAware.detail.add_qty_pct, 0.25);

  const baseSizeCapAware = __test.evaluateLiveRescueAdd({
    cfg,
    event: "CORE_LONG",
    position: {
      avg_price: 100,
      size_pct: 0.85,
      leverage: 2,
      meta: { leverage: 2 },
    },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
      leverage: 2,
      add_chain_base_qty_pct: 0.25,
    },
    posSide: "LONG",
    posSizePct: 0.85,
    bar: { close: 99.5 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    useBudget: true,
  });
  assert.strictEqual(baseSizeCapAware.ok, true);
  assert.strictEqual(baseSizeCapAware.detail.requested_add_qty_pct, 0.25);
  assert.strictEqual(baseSizeCapAware.detail.remaining_cap_qty_pct, 0.15);
  assert.strictEqual(baseSizeCapAware.detail.add_qty_pct, 0.15);
  assert.strictEqual(baseSizeCapAware.detail.auto_shrunk, true);

  assert.strictEqual(
    __test.resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw: 257, budgetUsedKrw: 192.75 }),
    0.75
  );
  assert.strictEqual(
    __test.resolveSyncedAddChainBaseQtyPct({
      active: true,
      posMeta: { add_chain_count: 1 },
      budgetMaxKrw: 257,
      budgetUsedKrw: 192.75,
    }),
    0.375
  );
  assert.strictEqual(
    __test.resolveSyncedAddChainBaseQtyPct({
      active: false,
      posMeta: { add_chain_count: 1 },
      budgetMaxKrw: 257,
      budgetUsedKrw: 192.75,
    }),
    null
  );

  const pendingAddState = __test.collectActivePendingAddIntentState([
    {
      intent_scope: "BINANCEFUT__BTCUSDT__15m",
      status: "PENDING",
      event: "CORE_LONG",
      side: "BUY",
      signal_bar_close_time_utc_ms: Date.parse("2026-03-11T02:00:00Z"),
      expires_at_ms: Date.parse("2026-03-11T03:00:00Z"),
      features_json: { _event_intent: "ADD" },
    },
    {
      intent_scope: "BINANCEFUT__BTCUSDT__15m",
      status: "PENDING",
      event: "CORE_LONG",
      side: "BUY",
      signal_bar_close_time_utc_ms: Date.parse("2026-03-11T02:30:00Z"),
      expires_at_ms: Date.parse("2026-03-11T02:45:00Z"),
      features_json: { _event_intent: "ENTRY" },
    },
    {
      intent_scope: "BINANCEFUT__BTCUSDT__15m",
      status: "PENDING",
      event: "CORE_SHORT",
      side: "SELL",
      signal_bar_close_time_utc_ms: Date.parse("2026-03-11T02:40:00Z"),
      expires_at_ms: Date.parse("2026-03-11T03:20:00Z"),
      features_json: { _event_intent: "ADD" },
    },
    {
      intent_scope: "BINANCEFUT__BTCUSDT__15m",
      status: "PENDING",
      event: "PRE_REAL_LONG",
      side: "BUY",
      signal_bar_close_time_utc_ms: Date.parse("2026-03-11T01:00:00Z"),
      expires_at_ms: Date.parse("2026-03-11T01:10:00Z"),
      features_json: { _event_intent: "ADD" },
    },
  ], {
    scope: "BINANCEFUT__BTCUSDT__15m",
    nowMs: Date.parse("2026-03-11T02:10:00Z"),
    positionSide: "LONG",
  });
  assert.strictEqual(pendingAddState.count, 1);
  assert.strictEqual(pendingAddState.lastSignalBarMs, Date.parse("2026-03-11T02:00:00Z"));

  const replayCfgZero = __test.resolveReplayRescueAddConfig({
    _replay_rescue_add_enabled: true,
    _replay_rescue_add_size: 1,
    _replay_rescue_add_max_adds: 0,
  });
  assert.strictEqual(replayCfgZero.maxAdds, 0);
  const replayBlockedByZeroMaxAdds = __test.evaluateReplayRescueAdd({
    event: "CORE_LONG",
    features: {
      _replay_rescue_add_enabled: true,
      _replay_rescue_add_size: 1,
      _replay_rescue_add_max_adds: 0,
    },
    position: { avg_price: 100, size_pct: 0.25 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
  });
  assert.strictEqual(replayBlockedByZeroMaxAdds.ok, false);
  assert.strictEqual(replayBlockedByZeroMaxAdds.reason, "REPLAY_RESCUE_ADD_LIMIT_BLOCKED");

  const replayBlockedSameBar = __test.evaluateReplayRescueAdd({
    event: "CORE_LONG",
    features: {
      _replay_rescue_add_enabled: true,
      _replay_rescue_add_size: 1,
      _replay_rescue_add_max_adds: 1,
      _replay_rescue_add_same_bar_block: true,
    },
    position: { avg_price: 100, size_pct: 0.25 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T01:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
  });
  assert.strictEqual(replayBlockedSameBar.ok, false);
  assert.strictEqual(replayBlockedSameBar.reason, "REPLAY_RESCUE_ADD_SAME_BAR_BLOCKED");

  const replayBlockedPendingAdd = __test.evaluateReplayRescueAdd({
    event: "CORE_LONG",
    features: {
      _replay_rescue_add_enabled: true,
      _replay_rescue_add_size: 1,
      _replay_rescue_add_max_adds: 1,
    },
    position: { avg_price: 100, size_pct: 0.25 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
    },
    posSide: "LONG",
    posSizePct: 0.25,
    bar: { close: 99 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    pendingAddCount: 1,
  });
  assert.strictEqual(replayBlockedPendingAdd.ok, false);
  assert.strictEqual(replayBlockedPendingAdd.reason, "REPLAY_RESCUE_ADD_LIMIT_BLOCKED");

  const replayEarlyUpgradeBlocked = __test.evaluateReplayRescueAdd({
    event: "PRE_REAL_LONG",
    features: {
      _replay_rescue_add_enabled: true,
      _replay_rescue_add_size: 1,
      _replay_rescue_add_max_adds: 1,
    },
    position: { avg_price: 100, size_pct: 0.08 },
    posMeta: {
      entry_exec_bar_ms: Date.parse("2026-03-11T00:00:00Z"),
      add_chain_count: 0,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
      last_entry_tier_long: 1,
    },
    posSide: "LONG",
    posSizePct: 0.08,
    bar: { close: 100.5 },
    signalBarCloseMs: Date.parse("2026-03-11T01:00:00Z"),
  });
  assert.strictEqual(replayEarlyUpgradeBlocked.ok, false);
  assert.strictEqual(replayEarlyUpgradeBlocked.reason, "REPLAY_RESCUE_ADD_TIER_BLOCKED");

  const nullCapState = __test.ensureLogicalAddCapState(null, {
    posSizePct: null,
    position: null,
  });
  assert.deepStrictEqual(nullCapState, {
    baseQtyPct: 0,
    currentQtyPct: 0,
    currentQtyPctRaw: 0,
    persistedAddCount: 0,
    effectiveAddCount: 0,
  });
  assert.strictEqual(__test.resolveCurrentQtyPctForCap(null, 0.15), 0.15);
  assert.strictEqual(__test.resolveCurrentQtyPctForCap({ currentQtyPct: 0.25 }, 0.15), 0.25);

  const addGuardCfg = __test.resolveAddRiskConfig({
    add_guard_enabled: true,
    add_guard_soft_drawdown_pct: -0.006,
    add_guard_hard_drawdown_pct: -0.016,
    add_guard_soft_scale: 0.6,
    add_guard_hard_scale: 0.35,
    add_guard_max_loss_streak: 0,
    add_guard_block_hard_drawdown: true,
  }, "BINANCEFUT");
  assert.strictEqual(addGuardCfg.maxLossStreak, null);

  const guardNoStreakBlock = __test.evaluateAddIntentRiskGuard({
    cfg: addGuardCfg,
    intent: "ADD",
    position: {
      avg_price: 100,
      size_pct: 0.25,
      leverage: 2,
      meta: { leverage: 2 },
    },
    posMeta: {
      add_guard_day_loss_streak: 3,
      position_side: "LONG",
    },
    bar: { close: 99.5 },
    barCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    qtyFraction: 0.25,
  });
  assert.strictEqual(guardNoStreakBlock.ok, true);
  assert.strictEqual(guardNoStreakBlock.qtyScale, 0.6);
  assert.strictEqual(guardNoStreakBlock.upnlPct, -0.01);
  assert.strictEqual(guardNoStreakBlock.rawUpnlPct, -0.005);
  assert.strictEqual(guardNoStreakBlock.leverageEff, 2);

  const guardHardBlock = __test.evaluateAddIntentRiskGuard({
    cfg: __test.resolveAddRiskConfig({
      add_guard_enabled: true,
      add_guard_soft_drawdown_pct: -0.006,
      add_guard_hard_drawdown_pct: -0.016,
      add_guard_soft_scale: 0.6,
      add_guard_hard_scale: 0.35,
      add_guard_max_loss_streak: 0,
      add_guard_block_hard_drawdown: true,
    }, "BINANCEFUT"),
    intent: "ADD",
    position: {
      avg_price: 100,
      size_pct: 0.25,
      leverage: 2,
      meta: { leverage: 2 },
    },
    posMeta: {
      position_side: "LONG",
    },
    bar: { close: 99 },
    barCloseMs: Date.parse("2026-03-11T01:00:00Z"),
    qtyFraction: 0.25,
  });
  assert.strictEqual(guardHardBlock.ok, false);
  assert.strictEqual(guardHardBlock.reason, "DROP_ADD_DRAWDOWN_HARD");

  const addMeta = __test.applyAddRiskMetaOnFill({
    posMeta: { add_chain_count: 0, add_chain_active: false },
    intent: "ADD",
    event: "CORE_LONG",
    barCloseMs: Date.parse("2026-03-11T02:00:00Z"),
    opening: false,
    closing: false,
  });
  assert.strictEqual(addMeta.add_chain_count, 1);
  assert.strictEqual(addMeta.add_chain_active, true);
  assert.strictEqual(addMeta.add_chain_last_event, "CORE_LONG");

  const exitMeta = __test.applyAddRiskMetaOnFill({
    posMeta: addMeta,
    intent: "EXIT",
    event: "EXIT_TRAIL_1P",
    barCloseMs: Date.parse("2026-03-11T03:00:00Z"),
    realizedPnlQuote: 12.5,
    opening: false,
    closing: true,
  });
  assert.strictEqual(exitMeta.add_chain_count, 0);
  assert.strictEqual(exitMeta.add_chain_active, false);
  assert.strictEqual(exitMeta.add_guard_last_realized_krw, 12.5);

  const nativeProtectionMeta = __test.buildNativeProtectionMetaPatch({
    nativeProtection: {
      ok: false,
      reason: "ORDER_FAIL",
      attempts: 2,
      max_attempts: 3,
      stop_order_id: "123",
      stop_price: 98.5,
      entry_price: 100,
      position_side: "LONG",
    },
    intent: "ADD",
    execBarCloseMs: Date.parse("2026-03-11T02:00:00Z"),
  });
  assert.strictEqual(nativeProtectionMeta.native_protection_refresh_context, "ADD");
  assert.strictEqual(nativeProtectionMeta.native_protection_refresh_status, "FAILED");
  assert.strictEqual(nativeProtectionMeta.native_protection_stale, true);
  assert.strictEqual(nativeProtectionMeta.native_protection_stop_order_id, null);
  assert.strictEqual(nativeProtectionMeta.native_protection_stop_price, null);
  assert.strictEqual(nativeProtectionMeta.native_protection_tp_order_id, null);

  const nativeProtectionTpMeta = __test.buildNativeProtectionMetaPatch({
    nativeProtection: {
      ok: true,
      stop_order_id: "stop-1",
      tp_order_id: "tp-1",
      stop_price: 98.5,
      tp_price: 103.25,
      tp_qty_base: 0.05,
      tp_qty_ratio: 0.5,
      tp_status: "OK",
      tp_reason: null,
      entry_price: 100,
      position_side: "LONG",
    },
    intent: "ADD",
    execBarCloseMs: Date.parse("2026-03-11T02:00:00Z"),
  });
  assert.strictEqual(nativeProtectionTpMeta.native_protection_tp_order_id, "tp-1");
  assert.strictEqual(nativeProtectionTpMeta.native_protection_tp_price, 103.25);
  assert.strictEqual(nativeProtectionTpMeta.native_protection_tp_qty_base, 0.05);
  assert.strictEqual(nativeProtectionTpMeta.native_protection_tp_qty_ratio, 0.5);
  assert.strictEqual(nativeProtectionTpMeta.native_protection_tp_status, "OK");
  assert.strictEqual(nativeProtectionTpMeta.native_protection_tp_reason, null);

  assert.strictEqual(
    __test.isBinanceImmediateTriggerError('BINANCEFUT_HTTP_400: {"code":-2021,"msg":"Order would immediately trigger."}'),
    true
  );
  assert.strictEqual(__test.isBinanceImmediateTriggerError("other error"), false);

  const nativeProtectionFallbackMeta = __test.buildNativeProtectionMetaPatch({
    nativeProtection: {
      ok: true,
      stop_order_id: "stop-2",
      tp_order_id: "tp-market-1",
      stop_price: 98.5,
      tp_price: 101.65,
      tp_qty_base: 0.03,
      tp_qty_ratio: 0.3,
      tp_status: "OK",
      tp_reason: "MARKET_FALLBACK",
      entry_price: 100,
      position_side: "SHORT",
    },
    intent: "ADD",
    execBarCloseMs: Date.parse("2026-03-11T02:05:00Z"),
  });
  assert.strictEqual(nativeProtectionFallbackMeta.native_protection_tp_status, "OK");
  assert.strictEqual(nativeProtectionFallbackMeta.native_protection_tp_reason, "MARKET_FALLBACK");

  const strippedProjection = __test.stripExchangeOwnedProjectionMeta({
    tp_p0_done: true,
    tp_p1_done: true,
    trail_active: true,
    tp_p1_pending: true,
    tp_p1_pending_at_ms: 123,
    tp_p1_pending_until_ms: 456,
    tp_p1_pending_event: "EXIT_TP_P1",
    tp_p1_bar_ms: 789,
    trail_delay_bars_required: 2,
    trail_delay_mfe_pct_required: 0.4,
    trail_delay_release_reason: "TP1_CONFIRMED",
    trail_delay_release_at: "2026-03-11T02:05:00Z",
    trail_delay_mode: "MFE",
    tp_p1_skip_reason: "EARLY_STAGE",
    tp_p1_skip_note: "skip",
    tp_p1_skip_at: "2026-03-11T02:06:00Z",
    native_protection_stop_order_id: "stop-1",
    native_protection_tp_order_id: "tp-1",
    exchange_projection_source: "BINANCE_LIVE_STATE",
    exchange_projection_in_sync: false,
    exchange_projection_invariants: ["NATIVE_STOP_MISSING"],
    exchange_projection_checked_at: "2026-03-11T02:10:00Z",
    carry_key: "preserve-me",
  });
  assert.strictEqual(strippedProjection.tp_p0_done, undefined);
  assert.strictEqual(strippedProjection.tp_p1_done, undefined);
  assert.strictEqual(strippedProjection.trail_active, undefined);
  assert.strictEqual(strippedProjection.native_protection_stop_order_id, undefined);
  assert.strictEqual(strippedProjection.native_protection_tp_order_id, undefined);
  assert.strictEqual(strippedProjection.exchange_projection_source, undefined);
  assert.strictEqual(strippedProjection.exchange_projection_in_sync, undefined);
  assert.strictEqual(strippedProjection.exchange_projection_invariants, undefined);
  assert.strictEqual(strippedProjection.exchange_projection_checked_at, undefined);
  assert.strictEqual(strippedProjection.tp_p1_pending, true);
  assert.strictEqual(strippedProjection.tp_p1_pending_at_ms, 123);
  assert.strictEqual(strippedProjection.tp_p1_pending_until_ms, 456);
  assert.strictEqual(strippedProjection.tp_p1_pending_event, "EXIT_TP_P1");
  assert.strictEqual(strippedProjection.tp_p1_bar_ms, 789);
  assert.strictEqual(strippedProjection.trail_delay_bars_required, 2);
  assert.strictEqual(strippedProjection.trail_delay_mfe_pct_required, 0.4);
  assert.strictEqual(strippedProjection.trail_delay_release_reason, "TP1_CONFIRMED");
  assert.strictEqual(strippedProjection.trail_delay_release_at, "2026-03-11T02:05:00Z");
  assert.strictEqual(strippedProjection.trail_delay_mode, "MFE");
  assert.strictEqual(strippedProjection.tp_p1_skip_reason, "EARLY_STAGE");
  assert.strictEqual(strippedProjection.tp_p1_skip_note, "skip");
  assert.strictEqual(strippedProjection.tp_p1_skip_at, "2026-03-11T02:06:00Z");
  assert.strictEqual(strippedProjection.carry_key, "preserve-me");

  assert.strictEqual(__test.shouldForceImmediateLiveFuturesReconcile({ exchange: "BINANCEFUT", executionMode: "LIVE" }), true);
  assert.strictEqual(__test.shouldForceImmediateLiveFuturesReconcile({ exchange: "BINANCEFUT", executionMode: "PAPER" }), false);
  assert.strictEqual(__test.shouldForceImmediateLiveFuturesReconcile({ exchange: "UPBIT", executionMode: "LIVE" }), false);
  assert.deepStrictEqual(
    __test.resolveOptimisticNativeProtectionMetaPatch({
      forceLiveReconcile: true,
      nativeProtectionMetaPatch: { native_protection_tp_order_id: "tp-1" },
    }),
    null
  );
  assert.deepStrictEqual(
    __test.resolveOptimisticNativeProtectionMetaPatch({
      forceLiveReconcile: false,
      nativeProtectionMetaPatch: { native_protection_tp_order_id: "tp-1" },
    }),
    { native_protection_tp_order_id: "tp-1" }
  );

  const mergedAddProtectionMeta = __test.applyAddAndProtectionMetaOnFill({
    posMeta: {
      add_chain_count: 0,
      add_chain_active: false,
      native_protection_stop_order_id: "old-stop",
      native_protection_tp_order_id: "old-tp",
    },
    intent: "ADD",
    event: "PRE_REAL_LONG",
    barCloseMs: Date.parse("2026-03-11T02:00:00Z"),
    opening: false,
    closing: false,
    signalBarCloseMs: Date.parse("2026-03-11T01:45:00Z"),
    intentId: "INTENT_ADD_1",
    signalId: "SIG_ADD_1",
    avgBefore: 100,
    avgAfter: 97.5,
    sizeBefore: 0.08,
    sizeAfter: 0.22,
    qtyPct: 0.14,
    qtyBase: 14,
    lossPct: 0.35,
    nativeProtectionMetaPatch: nativeProtectionTpMeta,
  });
  assert.strictEqual(mergedAddProtectionMeta.add_chain_count, 1);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_active, true);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_signal_id, "SIG_ADD_1");
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_intent_id, "INTENT_ADD_1");
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_avg_before, 100);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_avg_after, 97.5);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_size_before, 0.08);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_size_after, 0.22);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_qty_pct, 0.14);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_qty_base, 14);
  assert.strictEqual(mergedAddProtectionMeta.add_chain_last_loss_pct, 0.35);
  assert.strictEqual(mergedAddProtectionMeta.native_protection_refresh_context, "ADD");
  assert.strictEqual(mergedAddProtectionMeta.native_protection_refresh_status, "OK");
  assert.strictEqual(mergedAddProtectionMeta.native_protection_stop_order_id, "stop-1");
  assert.strictEqual(mergedAddProtectionMeta.native_protection_tp_order_id, "tp-1");
  assert.strictEqual(mergedAddProtectionMeta.native_protection_tp_price, 103.25);
  assert.strictEqual(mergedAddProtectionMeta.native_protection_tp_qty_base, 0.05);

  const preservedProtectionMeta = __test.applyAddAndProtectionMetaOnFill({
    posMeta: {
      add_chain_count: 1,
      add_chain_active: true,
      native_protection_stop_order_id: "old-stop",
      native_protection_tp_order_id: "old-tp",
      native_protection_stop_price: 95,
      native_protection_tp_price: 105,
    },
    intent: "ADD",
    event: "CORE_LONG",
    barCloseMs: Date.parse("2026-03-11T02:10:00Z"),
    opening: false,
    closing: false,
    nativeProtectionMetaPatch: nativeProtectionMeta,
  });
  assert.strictEqual(preservedProtectionMeta.native_protection_stop_order_id, null);
  assert.strictEqual(preservedProtectionMeta.native_protection_tp_order_id, null);
  assert.strictEqual(preservedProtectionMeta.native_protection_tp_price, null);

  const committedGuardBlocked = __test.evaluateCommittedRescueAddGate({
    applied: true,
    pendingAddCount: 1,
    maxAdds: 1,
    replay: false,
  });
  assert.strictEqual(committedGuardBlocked.ok, false);
  assert.strictEqual(committedGuardBlocked.reason, "LIVE_RESCUE_ADD_LIMIT_BLOCKED");

  const committedSameBarBlocked = __test.evaluateCommittedRescueAddGate({
    applied: true,
    pendingAddCount: 0,
    maxAdds: 1,
    sameBarBlock: true,
    pendingAddSignalBarMs: Date.parse("2026-03-11T02:00:00Z"),
    signalBarCloseMs: Date.parse("2026-03-11T02:00:00Z"),
    replay: true,
  });
  assert.strictEqual(committedSameBarBlocked.ok, false);
  assert.strictEqual(committedSameBarBlocked.reason, "REPLAY_RESCUE_ADD_SAME_BAR_BLOCKED");
}

run().then(() => {
  console.log("LIVE_RESCUE_ADD_PLAN_TEST_OK");
}).catch((err) => {
  console.error("LIVE_RESCUE_ADD_PLAN_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
