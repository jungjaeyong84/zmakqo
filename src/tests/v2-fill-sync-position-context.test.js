"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

async function run() {
  const ctx = __test.buildV2PositionEntryContext({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    positionCycle: {
      position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__SHORT__abc123",
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      status: "ACTIVE_PROTECTED",
      position_side: "SHORT",
      entry_event_id: "ENTRYV2__ETHUSDT__SHORT__8389766168172990000",
      signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__ETHUSDT__SHORT__abc",
      openclaw_decision_id: "OCDV2__CANARY__APPROVE_ENTRY__abc",
      openclaw_decision_bundle_hash: "bundlehash123",
      signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1777521600000__SHORT",
      signal_doc_id: "SIG__BINANCEFUT__ETHUSDT__15m__1777521600000__SHORT",
      entry_price: 2252.02,
      entry_qty_abs: 0.053,
      leverage: 3,
      created_at: "2026-04-30T04:01:17.485Z",
    },
    projection: {
      position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__SHORT__abc123",
      stage: "PRE_TP1",
      entry_qty_abs: 0.053,
      tp1_target_qty_abs: 0.053,
      tp1_filled_qty_abs: 0,
      runner_remaining_qty_abs: 0,
      tp1_done: false,
      trail_active: false,
    },
    protectionRuntime: {
      position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__SHORT__abc123",
      protection_runtime_id: "PRTV2__PCY__BINANCEFUT__ETHUSDT__SHORT__abc123",
      tp1_order_id: "4000001199561848",
      sl_price: 2289.18,
      native_refresh_status: "OK",
    },
  });
  assert.strictEqual(ctx.entryEventId, "ENTRYV2__ETHUSDT__SHORT__8389766168172990000");
  assert.strictEqual(ctx.positionSide, "SHORT");
  assert.strictEqual(ctx.qtyBase, 0.053);
  assert.strictEqual(ctx.entry_qty_base, 0.053);
  assert.strictEqual(ctx.qty_base, 0.053);
  assert.strictEqual(ctx.meta.entry_event_id, "ENTRYV2__ETHUSDT__SHORT__8389766168172990000");
  assert.strictEqual(ctx.simplifiedExitV2Enabled, true);
  assert.strictEqual(ctx.tpP1Done, false);
  assert.strictEqual(ctx.trailActive, false);
  assert.strictEqual(ctx.nativeProtectionTpQtyBase, 0.053);
  assert.strictEqual(ctx.nativeProtectionTpQtyRatio, 1);
  assert.strictEqual(ctx.entryTimeMs, 1777521677485);
  assert.strictEqual(__test.isTradeBeforePositionEntry(ctx, 1777521600000), true);
  assert.strictEqual(__test.isTradeBeforePositionEntry(ctx, 1777521680000), false);
  assert.strictEqual(ctx.position.meta.tp_p0_done, false);
  assert.strictEqual(ctx.position.meta.simplified_exit_v2_enabled, true);
  assert.strictEqual(ctx.openclaw_decision_id, "OCDV2__CANARY__APPROVE_ENTRY__abc");
  assert.strictEqual(ctx.signal_intent_id, "SIGINTV2__SERVER_NATIVE_ML_AI__ETHUSDT__SHORT__abc");
  assert.strictEqual(ctx.openclaw_decision_bundle_hash, "bundlehash123");
  assert.strictEqual(ctx.signal_id, "SIG__BINANCEFUT__ETHUSDT__15m__1777521600000__SHORT");
  assert.strictEqual(ctx.meta.openclaw_decision_id, "OCDV2__CANARY__APPROVE_ENTRY__abc");

  const signalRefs = __test.resolveSignalRefsForExternalFill({
    positionCtx: ctx,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    execTf: "15m",
  });
  assert.strictEqual(signalRefs.source, "POSITION_CYCLE_LINEAGE");
  assert.strictEqual(signalRefs.signalId, "SIG__BINANCEFUT__ETHUSDT__15m__1777521600000__SHORT");

  const lineagePatch = __test.buildV2FillLineagePatch({
    intent: null,
    positionCtx: ctx,
    signalRefs,
    entryContext: {
      entryEventId: ctx.entryEventId,
      entrySignalType: ctx.entrySignalType,
    },
  });
  assert.strictEqual(lineagePatch.topLevel.position_cycle_id, "PCY__BINANCEFUT__ETHUSDT__SHORT__abc123");
  assert.strictEqual(lineagePatch.topLevel.openclaw_decision_id, "OCDV2__CANARY__APPROVE_ENTRY__abc");
  assert.strictEqual(lineagePatch.topLevel.signal_intent_id, "SIGINTV2__SERVER_NATIVE_ML_AI__ETHUSDT__SHORT__abc");
  assert.strictEqual(lineagePatch.featuresJson.openclaw_lineage_source, "POSITION_CYCLE");
  assert.strictEqual(lineagePatch.featuresJson.openclaw_decision_bundle_hash, "bundlehash123");

  const event = await __test.resolveExternalExitEvent({
    trade: {
      symbol: "ETHUSDT",
      qty: "0.026",
      realizedPnl: "0.49296000",
    },
    orderMeta: {
      orderId: 8389766168226013000,
      orderType: null,
      closePosition: false,
      reduceOnly: false,
    },
    positionCtx: ctx,
    rules: { TP_P1: 0.025, TP_P1_QTY: 0.5 },
    qtyPct: null,
  });
  assert.strictEqual(event, "EXIT_TP_P1_2.5P",
    "V2 fallback context must classify half-size profitable fill as TP1 when order metadata is unavailable");
  const eventWithStaleSyntheticTrailIntent = await __test.resolveExternalExitEvent({
    intent: {
      event: "EXIT_TRAIL",
      reason: "EXTERNAL_FILL_SYNC",
      filled_via: "BINANCE_USER_TRADES",
      external_sync_synthetic_intent: true,
    },
    trade: {
      symbol: "ETHUSDT",
      qty: "0.026",
      realizedPnl: "0.49296000",
    },
    orderMeta: {
      orderId: 8389766168226013000,
      orderType: null,
      closePosition: false,
      reduceOnly: false,
    },
    positionCtx: ctx,
    rules: { TP_P1: 0.025, TP_P1_QTY: 0.5 },
    qtyPct: null,
  });
  assert.strictEqual(eventWithStaleSyntheticTrailIntent, "EXIT_TP_P1_2.5P",
    "stale synthetic fill-sync intents must not override fresh V2 TP1 evidence");
  const backstoppedEvent = __test.applyActiveExitStageBackstopOverride({
    event: "EXIT_TRAIL",
    trade: {
      symbol: "ETHUSDT",
      qty: "0.026",
    },
    orderMeta: {},
    positionCtx: ctx,
    rules: { TP_P1: 0.025, TP_P1_QTY: 0.5 },
    qtyPct: null,
  });
  assert.strictEqual(backstoppedEvent, "EXIT_TP_P1_2.5P",
    "V2 pre-TP1 half-size fills must not remain classified as TRAIL due stale symbol-level hints");

  const fullTpCtx = {
    ...ctx,
    exit_contract_mode: "TP_FULL_ONLY",
    meta: {
      ...ctx.meta,
      exit_contract_mode: "TP_FULL_ONLY",
      exit_rules_override: {
        TP_P1: 0.025,
        TP_P1_QTY: 1,
        exit_contract_mode: "TP_FULL_ONLY",
      },
    },
    position: {
      ...ctx.position,
      meta: {
        ...(ctx.position && ctx.position.meta ? ctx.position.meta : {}),
        exit_contract_mode: "TP_FULL_ONLY",
        exit_rules_override: {
          TP_P1: 0.025,
          TP_P1_QTY: 1,
          exit_contract_mode: "TP_FULL_ONLY",
        },
      },
    },
  };
  const fullTpBackstoppedEvent = __test.applyActiveExitStageBackstopOverride({
    event: "EXIT_TP_P1_2.5P",
    trade: {
      symbol: "ETHUSDT",
      qty: "0.053",
    },
    orderMeta: {},
    positionCtx: fullTpCtx,
    rules: { TP_P1: 0.025, TP_P1_QTY: 1, exit_contract_mode: "TP_FULL_ONLY" },
    qtyPct: null,
  });
  assert.strictEqual(fullTpBackstoppedEvent, "EXIT_TP_FULL_2.5P",
    "TP_FULL_ONLY fills must be classified as full TP at source, not later reclassified from TP1");
  assert.strictEqual(__test.filterRecentExitHintForEntry({
    event: "EXIT_TP_P1_2.5P",
    entryEventId: "ENTRYV2__OTHER",
  }, ctx.entryEventId), null);
  assert.deepStrictEqual(__test.filterRecentExitHintForEntry({
    event: "EXIT_TP_P1_2.5P",
    entryEventId: ctx.entryEventId,
  }, ctx.entryEventId), {
    event: "EXIT_TP_P1_2.5P",
    entryEventId: ctx.entryEventId,
  });
  const canonical = __test.resolveCanonicalExternalExitEvent({
    authorityMap: new Map(),
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event,
    entryEventId: ctx.entryEventId,
    positionCtx: ctx,
    rules: { TP_P1: 0.025, TP_P1_QTY: 1 },
  });
  assert.strictEqual(canonical.stage, "TP1");
  assert.ok(canonical.transitionEvents.includes("TP1_FULL_EXIT"));
  assert.strictEqual(canonical.entryLineageMissing, false);
  assert.strictEqual(canonical.ledger.entry_qty_abs, 0.053);
  assert.strictEqual(canonical.ledger.tp1_allowed_abs, 0.053);

  const canonicalSl = __test.resolveCanonicalExternalExitEvent({
    authorityMap: new Map(),
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    event: "EXIT_SL_1.65P",
    entryEventId: "ENTRYV2__AXSUSDT__SHORT__14854215841",
    signalDocId: "SIG__BINANCEFUT__AXSUSDT__15m__0__V2_PROTECTED_ENTRY",
    orderMeta: {
      orderId: 14854300798,
      orderType: "MARKET",
      closePosition: true,
      reduceOnly: true,
      clientOrderId: "SL__PRATTV2__ec458ab3cc",
    },
    positionCtx: null,
    rules: { SL: -0.0165, TP_P1: 0.025, TP_P1_QTY: 0.5 },
  });
  assert.strictEqual(canonicalSl.stage, "SL");
  assert.deepStrictEqual(canonicalSl.transitionEvents, ["SL_HIT"]);
  assert.strictEqual(canonicalSl.primaryTransitionEvent, "SL_HIT");
  assert.strictEqual(canonicalSl.entryLineageMissing, false);

  assert.strictEqual(__test.shouldRunExternalExitSideEffects({
    upserted: {
      ok: true,
      inserted: false,
      event_changed: false,
      previous_event: "EXIT_TRAIL",
    },
    looksLikeExit: true,
    event: "EXIT_TRAIL",
    force: true,
  }), true, "manual reprocess must be able to repair missing canonical side effects for existing fills");
  assert.strictEqual(__test.shouldRunExternalExitSideEffects({
    upserted: {
      ok: true,
      inserted: false,
      event_changed: true,
      previous_event: "EXIT_TRAIL",
    },
    looksLikeExit: true,
    event: "EXIT_TP_P1_1.65P",
    canonicalEntryLineageMissing: true,
  }), false, "pre-entry backfill rows without lineage must not mutate current V2 canonical side effects");

  const ctx2 = __test.buildV2PositionEntryContext({
    symbol: "ETHUSDT",
    positionCycle: {
      position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__SHORT__abc123",
      position_side: "SHORT",
      entry_event_id: "ENTRYV2__ETHUSDT__SHORT__1",
      entry_qty_abs: 0.053,
    },
    projection: {
      stage: "TRAIL_ACTIVE",
      entry_qty_abs: 0.053,
      tp1_target_qty_abs: 0.0265,
      tp1_filled_qty_abs: 0.0265,
      tp1_done: true,
      trail_active: true,
    },
  });
  assert.strictEqual(ctx2.tpP1Done, true);
  assert.strictEqual(ctx2.trailActive, true);
  assert.strictEqual(ctx2.position.meta.tp_p1_entry_event_id, "ENTRYV2__ETHUSDT__SHORT__1");
}

run()
  .then(() => console.log("V2_FILL_SYNC_POSITION_CONTEXT_TEST_OK"))
  .catch((err) => {
    console.error("V2_FILL_SYNC_POSITION_CONTEXT_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
