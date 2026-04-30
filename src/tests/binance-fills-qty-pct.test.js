const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;

async function run() {
  const clearConsumedTakeProfitProtectionMeta = __test && __test.clearConsumedTakeProfitProtectionMeta;
  assert.strictEqual(typeof clearConsumedTakeProfitProtectionMeta, "function", "clearConsumedTakeProfitProtectionMeta export missing");
  const clearedProtectionMeta = clearConsumedTakeProfitProtectionMeta({
    native_protection_stop_order_id: "stop-1",
    native_protection_tp0_order_id: "tp0-1",
    native_protection_tp_order_id: "tp1-1",
    native_protection_tp0_status: "OK",
    native_protection_tp_status: "OK",
    native_protection_tp0_qty_ratio: 0.25,
    native_protection_tp_qty_ratio: 0.5,
  });
  assert.strictEqual(clearedProtectionMeta.native_protection_stop_order_id, "stop-1");
  assert.strictEqual(clearedProtectionMeta.native_protection_tp0_order_id, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp_order_id, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_consumed_tp0_order_id, "tp0-1");
  assert.strictEqual(clearedProtectionMeta.native_protection_consumed_tp_order_id, "tp1-1");
  assert.strictEqual(clearedProtectionMeta.native_protection_tp0_status, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp_status, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp0_qty_ratio, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp_qty_ratio, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_consumed_tp0_qty_ratio, 0.25);
  assert.strictEqual(clearedProtectionMeta.native_protection_consumed_tp_qty_ratio, 0.5);

  const fn = __test && __test.computeSyncedQtyPct;
  assert.strictEqual(typeof fn, "function", "computeSyncedQtyPct export missing");
  const resolveFillSyncAlertCloseRatio = __test && __test.resolveFillSyncAlertCloseRatio;
  assert.strictEqual(typeof resolveFillSyncAlertCloseRatio, "function", "resolveFillSyncAlertCloseRatio export missing");
  const applyExternalExitQtyAuthorityFn = __test && __test.applyExternalExitQtyAuthority;
  assert.strictEqual(typeof applyExternalExitQtyAuthorityFn, "function", "applyExternalExitQtyAuthority export missing");
  const shouldRunExternalExitSideEffects = __test && __test.shouldRunExternalExitSideEffects;
  assert.strictEqual(typeof shouldRunExternalExitSideEffects, "function", "shouldRunExternalExitSideEffects export missing");
  const resolvePostCanonicalPersistedExitEvent = __test && __test.resolvePostCanonicalPersistedExitEvent;
  assert.strictEqual(typeof resolvePostCanonicalPersistedExitEvent, "function", "resolvePostCanonicalPersistedExitEvent export missing");
  const resolveExternalSyncHintStage = __test && __test.resolveExternalSyncHintStage;
  assert.strictEqual(typeof resolveExternalSyncHintStage, "function", "resolveExternalSyncHintStage export missing");

  const tp1Authority = applyExternalExitQtyAuthorityFn({
    authorityMap: new Map(),
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "EXIT_TP_P1_1.65P",
    entryEventId: "ENTRY_A",
    qtyPct: 0.5,
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.ok(Math.abs(tp1Authority.acceptedQtyPct - 0.375) < 1e-12);
  assert.ok(Math.abs(tp1Authority.droppedQtyPct - 0.125) < 1e-12);
  assert.strictEqual(tp1Authority.capped, true);

  const scaledByNotional = fn({
    intent: { qty_pct: 0.15, notional: 15000 },
    tradeNotional: 1500,
    execQtyBase: 1,
  });
  assert.ok(Math.abs(scaledByNotional.qtyPct - 0.015) < 1e-12);
  assert.strictEqual(scaledByNotional.mode, "SCALED_NOTIONAL");

  const capped = fn({
    intent: { qty_pct: 0.15, notional: 15000 },
    tradeNotional: 30000,
    execQtyBase: 1,
  });
  assert.ok(Math.abs(capped.qtyPct - 0.15) < 1e-12);

  const scaledByQtyBase = fn({
    intent: { qty_pct: 0.20, qty_base: 4 },
    tradeNotional: null,
    execQtyBase: 1,
  });
  assert.ok(Math.abs(scaledByQtyBase.qtyPct - 0.05) < 1e-12);
  assert.strictEqual(scaledByQtyBase.mode, "SCALED_QTY_BASE");

  const noScale = fn({
    intent: { qty_pct: 0.25 },
    tradeNotional: null,
    execQtyBase: null,
  });
  assert.strictEqual(noScale.qtyPct, null);
  assert.strictEqual(noScale.mode, "UNSCALED_INTENT");

  const noIntentQty = fn({
    intent: { qty_pct: null, notional: 10000 },
    tradeNotional: 1000,
    execQtyBase: 1,
  });
  assert.strictEqual(noIntentQty.qtyPct, null);
  assert.strictEqual(noIntentQty.mode, "NO_INTENT_QTY");

  const noBudgetOnlyScale = fn({
    intent: { qty_pct: 0.5, budget_used_krw: 7.5 },
    tradeNotional: 3547.095,
    execQtyBase: 2657,
  });
  assert.strictEqual(noBudgetOnlyScale.qtyPct, null);
  assert.strictEqual(noBudgetOnlyScale.mode, "UNSCALED_INTENT");

  const fallbackCloseRatio = resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_1.65P",
    intent: null,
    qtyScale: { qtyPct: null, ratio: null },
    execQtyBase: 737,
    positionCtx: { qtyBase: 1474 },
  });
  assert.strictEqual(fallbackCloseRatio, null, "tp1 alerts must not infer 100% from generic position ratio fallback");

  const nativeTp1CloseRatio = resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_1.65P",
    intent: null,
    qtyScale: { qtyPct: 0.5, ratio: 1 },
    execQtyBase: 737,
    positionCtx: { qtyBase: 737, nativeProtectionTpQtyBase: 1500, nativeProtectionTpQtyRatio: 0.49 },
  });
  assert.ok(Math.abs(nativeTp1CloseRatio - ((737 / 1500) * 0.49)) < 1e-12, "tp1 alerts should prefer native tp sizing over stale position size");

  const consumedTp0CloseRatio = resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P0_0.8P",
    intent: null,
    qtyScale: { qtyPct: null, ratio: null },
    execQtyBase: 0.01,
    positionCtx: {
      qtyBase: 0.339,
      nativeProtectionConsumedTp0QtyBase: 0.225,
      nativeProtectionConsumedTp0QtyRatio: 0.25,
    },
  });
  assert.ok(
    Math.abs(consumedTp0CloseRatio - ((0.01 / 0.225) * 0.25)) < 1e-12,
    "tp0 alerts must prefer consumed native tp0 sizing over current remaining position qty"
  );

  const consumedTp1CloseRatio = resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_1.65P",
    intent: null,
    qtyScale: { qtyPct: null, ratio: null },
    execQtyBase: 0.337,
    positionCtx: {
      qtyBase: 0.339,
      nativeProtectionConsumedTpQtyBase: 0.337,
      nativeProtectionConsumedTpQtyRatio: 0.5,
    },
  });
  assert.ok(
    Math.abs(consumedTp1CloseRatio - 0.5) < 1e-12,
    "tp1 alerts must use consumed native tp sizing after protection ids are cleared"
  );

  const flatTrailIssues = __test.buildImmediateProjectionIssues({
    event: "EXIT_TRAIL_1P",
    position: {
      state: "FLAT",
      qty_base: 0,
      meta: { trail_active: false, tp_p0_done: false, tp_p1_done: false },
    },
  });
  assert.deepStrictEqual(flatTrailIssues, [], "settled flat position must not raise trail projection mismatch");

  const immediateAlertGate = __test && __test.shouldSendImmediateProjectionMismatchAlert;
  assert.strictEqual(typeof immediateAlertGate, "function", "shouldSendImmediateProjectionMismatchAlert export missing");
  const reconcileExternalFillPositionSync = __test && __test.reconcileExternalFillPositionSync;
  assert.strictEqual(typeof reconcileExternalFillPositionSync, "function", "reconcileExternalFillPositionSync export missing");
  const immediateAlertFirst = immediateAlertGate({
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_3P",
    issues: ["TP1_FILL_PROJECTION_MISSING"],
    nowMs: 1000,
  });
  assert.strictEqual(immediateAlertFirst.send, true);
  assert.strictEqual(immediateAlertFirst.repeatCount, 1);
  const immediateAlertSecond = immediateAlertGate({
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_3P",
    issues: ["TP1_FILL_PROJECTION_MISSING"],
    nowMs: 2000,
  });
  assert.strictEqual(immediateAlertSecond.send, false);
  assert.strictEqual(immediateAlertSecond.repeatCount, 2);
  const immediateAlertThird = immediateAlertGate({
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_3P",
    issues: ["TP1_FILL_PROJECTION_MISSING"],
    nowMs: 3000,
  });
  assert.strictEqual(immediateAlertThird.send, true);
  assert.strictEqual(immediateAlertThird.repeatCount, 3);

  {
    const requests = [];
    let attempts = 0;
    const reconciled = await reconcileExternalFillPositionSync({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      maxAttempts: 2,
      retryDelayMs: 0,
      buildSyncRequest: (payload) => payload,
      syncPosition: async (payload) => {
        attempts += 1;
        requests.push(payload);
        if (attempts === 1) {
          const err = new Error("POSITION_WRITE_TOKEN_MISMATCH expected=a actual=b");
          err.code = "POSITION_WRITE_TOKEN_MISMATCH";
          throw err;
        }
        return { ok: true, attempt: attempts };
      },
    });
    assert.strictEqual(attempts, 2);
    assert.strictEqual(requests[0].source, "FILL_SYNC_RECONCILE");
    assert.ok(String(requests[0].runId).includes("__A1__"));
    assert.ok(String(requests[1].runId).includes("__A2__"));
    assert.deepStrictEqual(reconciled, { ok: true, attempt: 2 });
  }

  const pickIntentForTrade = __test && __test.pickIntentForTrade;
  assert.strictEqual(typeof pickIntentForTrade, "function", "pickIntentForTrade export missing");
  const trade = {
    symbol: "SOLUSDT",
    side: "SELL",
    time: Date.parse("2026-03-04T01:42:26.074Z"),
  };
  const intents = [
    {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "SOLUSDT",
      side: "SELL",
      scheduled_exec_bar_close_time_utc_ms: Date.parse("2026-03-04T01:42:30.906Z"),
      created_at: "2026-03-04T01:42:31.448Z", // trade 이후 생성 → 매칭 제외되어야 함
      intent_id: "late_intent",
    },
    {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "SOLUSDT",
      side: "SELL",
      scheduled_exec_bar_close_time_utc_ms: Date.parse("2026-03-04T01:42:00.000Z"),
      created_at: "2026-03-04T01:41:59.000Z",
      intent_id: "valid_intent",
    },
  ];
  const picked = pickIntentForTrade(trade, intents, 2 * 60 * 60 * 1000, 3000);
  assert.ok(picked, "intent should be matched");
  assert.strictEqual(picked.intent_id, "valid_intent");

  const staleFilledIntentIgnored = pickIntentForTrade(
    {
      symbol: "DOGEUSDT",
      side: "BUY",
      time: Date.parse("2026-04-11T06:36:48.252Z"),
    },
    [{
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "DOGEUSDT",
      side: "BUY",
      event: "EXIT_TP_P1_1.65P",
      status: "FILLED",
      signal_bar_close_time_utc_ms: Date.parse("2026-04-11T06:15:00.000Z"),
      created_at: "2026-04-11T06:15:00.000Z",
      filled_at: "2026-04-11T06:15:34.810Z",
      intent_id: "stale_tp1",
    }],
    2 * 60 * 60 * 1000,
    3000
  );
  assert.strictEqual(staleFilledIntentIgnored, null);

  const freshFilledIntentAllowed = pickIntentForTrade(
    {
      symbol: "DOGEUSDT",
      side: "BUY",
      time: Date.parse("2026-04-11T06:15:36.000Z"),
    },
    [{
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "DOGEUSDT",
      side: "BUY",
      event: "EXIT_TP_P1_1.65P",
      status: "FILLED",
      signal_bar_close_time_utc_ms: Date.parse("2026-04-11T06:15:00.000Z"),
      created_at: "2026-04-11T06:15:00.000Z",
      filled_at: "2026-04-11T06:15:34.810Z",
      intent_id: "fresh_tp1",
    }],
    2 * 60 * 60 * 1000,
    3000
  );
  assert.ok(freshFilledIntentAllowed);
  assert.strictEqual(freshFilledIntentAllowed.intent_id, "fresh_tp1");

  const resolveExternalExitEvent = __test && __test.resolveExternalExitEvent;
  const inferStageConstrainedTakeProfitKind = __test && __test.inferStageConstrainedTakeProfitKind;
  const applyExternalExitQtyAuthority = __test && __test.applyExternalExitQtyAuthority;
  const applyActiveExitStageBackstopOverride = __test && __test.applyActiveExitStageBackstopOverride;
  const buildFillSyncNativeProtectionRefreshArgs = __test && __test.buildFillSyncNativeProtectionRefreshArgs;
  const buildExitLedgerMetaPatch = __test && __test.buildExitLedgerMetaPatch;
  const buildExitLedgerPayload = __test && __test.buildExitLedgerPayload;
  assert.strictEqual(typeof resolveExternalExitEvent, "function", "resolveExternalExitEvent export missing");
  assert.strictEqual(typeof inferStageConstrainedTakeProfitKind, "function", "inferStageConstrainedTakeProfitKind export missing");
  assert.strictEqual(typeof applyExternalExitQtyAuthority, "function", "applyExternalExitQtyAuthority export missing");
  assert.strictEqual(typeof applyActiveExitStageBackstopOverride, "function", "applyActiveExitStageBackstopOverride export missing");
  assert.strictEqual(typeof buildFillSyncNativeProtectionRefreshArgs, "function", "buildFillSyncNativeProtectionRefreshArgs export missing");
  assert.strictEqual(typeof buildExitLedgerMetaPatch, "function", "buildExitLedgerMetaPatch export missing");
  assert.strictEqual(typeof buildExitLedgerPayload, "function", "buildExitLedgerPayload export missing");
  const rules = { SL: -0.015, TP_P1: 0.03, TRAIL_PCT: 0.01 };

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  assert.strictEqual(
    inferStageConstrainedTakeProfitKind({ tpP0Done: false, tpP1Done: false, trailActive: false }, null),
    "TP0"
  );
  assert.strictEqual(
    inferStageConstrainedTakeProfitKind({ tpP0Done: true, tpP1Done: false, trailActive: false }, null),
    "TP1"
  );
  assert.strictEqual(
    inferStageConstrainedTakeProfitKind({ tpP0Done: true, tpP1Done: true, trailActive: true }, "TP1"),
    null
  );
  assert.strictEqual(
    inferStageConstrainedTakeProfitKind({
      simplifiedExitV2Enabled: true,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
    }, "TP0"),
    "TP1"
  );

  assert.strictEqual(
    applyActiveExitStageBackstopOverride({
      event: "EXIT_TP_P0_0.8P",
      intentEvent: "EXIT_TP_P0_0.8P",
      trade: { qty: 5 },
      orderMeta: { orderType: "TAKE_PROFIT_MARKET", closePosition: false },
      positionCtx: {
        simplifiedExitV2Enabled: true,
        tpP0Done: false,
        tpP1Done: false,
        trailActive: false,
        qtyBase: 5,
      },
      recentTp0: null,
      recentTp1: null,
      recentTrail: null,
      rules,
      qtyPct: 0.5,
    }),
    "EXIT_TP_P1_3P"
  );

  const overridden = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P1_3P" },
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 123, orderType: "MARKET", closePosition: true, reduceOnly: true },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(overridden, "EXIT_EXTERNAL_SYNC");

  {
    const authorityMap = new Map();
    const tp0 = applyExternalExitQtyAuthority({
      authorityMap,
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P0_0.8P",
      entryEventId: "ENTRY__DOGE",
      orderMeta: { orderId: 0 },
      qtyPct: 0.25,
      rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    });
    const first = applyExternalExitQtyAuthority({
      authorityMap,
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P1_1.65P",
      entryEventId: "ENTRY__DOGE",
      orderMeta: { orderId: 1 },
      qtyPct: 0.5,
      rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    });
    const duplicate = applyExternalExitQtyAuthority({
      authorityMap,
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P1_1.65P",
      entryEventId: "ENTRY__DOGE",
      orderMeta: { orderId: 2 },
      qtyPct: 0.5,
      rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    });
    const trail = applyExternalExitQtyAuthority({
      authorityMap,
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TRAIL",
      entryEventId: "ENTRY__DOGE",
      orderMeta: { orderId: 3 },
      qtyPct: 1,
      rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    });
    assert.strictEqual(tp0.acceptedQtyPct, 0.25);
    assert.strictEqual(first.acceptedQtyPct, 0.125);
    assert.strictEqual(duplicate.acceptedQtyPct, null);
    assert.strictEqual(duplicate.duplicateSuspected, true);
    assert.strictEqual(trail.acceptedQtyPct, 0.625);
  }

  {
    const authorityMap = new Map();
    const v2Tp0Remapped = applyExternalExitQtyAuthority({
      authorityMap,
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P0_0.8P",
      positionCtx: {
        simplifiedExitV2Enabled: true,
      },
      entryEventId: "ENTRY__ETH",
      orderMeta: { orderId: 10 },
      qtyPct: 0.5,
      rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    });
    assert.strictEqual(v2Tp0Remapped.stage, "TP1");
    assert.strictEqual(v2Tp0Remapped.acceptedQtyPct, 0.375);
  }

  {
    const refreshArgs = buildFillSyncNativeProtectionRefreshArgs({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      syncedPosition: {
        avg_price: 74987.2,
        leverage: 2,
        position_side: "LONG",
      },
      hintedMeta: {
        position_side: "LONG",
        external_leverage: 2,
        exit_rules_override: { TP_P1_QTY: 0.5, TP_P1: 0.025 },
      },
    });
    assert.strictEqual(refreshArgs.executeImmediately, false, "fill sync must not perform immediate native stop writes");
    assert.strictEqual(refreshArgs.dispatchExitWorker, true);
    assert.strictEqual(refreshArgs.source, "BINANCE_FUTURES_FILLS_SYNC");
    assert.strictEqual(refreshArgs.reason, "NON_AUTHORITY_LAYER_REQUEST");
    assert.strictEqual(refreshArgs.symbol, "BTCUSDT");
  }

  {
    const ledgerMetaPatch = buildExitLedgerMetaPatch({
      position: {
        qty_base: 0.5,
        meta: {
          simplified_exit_v2_enabled: true,
          entry_qty_abs: 1,
          tp_p1_done: false,
          trail_active: false,
        },
      },
      nextMeta: {
        simplified_exit_v2_enabled: true,
        entry_qty_abs: 1,
        tp_p1_done: false,
        trail_active: false,
      },
      rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    });
    assert.strictEqual(ledgerMetaPatch.tp_p0_allowed_qty_abs, null);
    assert.strictEqual(ledgerMetaPatch.tp_p0_consumed_qty_abs, null);
    assert.strictEqual(ledgerMetaPatch.tp_p0_allowed_qty_ratio, null);
    assert.strictEqual(ledgerMetaPatch.tp_p0_consumed_qty_ratio, null);

    const ledgerPayload = buildExitLedgerPayload({
      entry_qty_abs: 1,
      tp0_allowed_abs: 0.25,
      tp0_consumed_abs: 0.25,
      tp1_allowed_abs: 0.5,
      tp1_consumed_abs: 0.25,
      runner_allowed_abs: 0.5,
      runner_remaining_abs: 0.5,
      trail_consumed_abs: 0,
    }, 0.25, {
      simplifiedExitV2Enabled: true,
    });
    assert.strictEqual(ledgerPayload.contractTp0AllowedAbs, null);
    assert.strictEqual(ledgerPayload.contractTp0ConsumedAbs, null);
    assert.strictEqual(ledgerPayload.contractTp1AllowedAbs, 0.5);
  }

  const nativeSl = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: -10 },
    orderMeta: { orderId: 126, orderType: "STOP_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_stop" },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(nativeSl, "EXIT_SL_1.5P");

  const nativeTrail = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 127, orderType: "TAKE_PROFIT_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_tp" },
    positionCtx: { trailActive: true, tpP1Done: true },
    rules,
  });
  assert.strictEqual(nativeTrail, "EXIT_TRAIL_1P");

  const trailViaRecentTp1 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 12701, orderType: "TAKE_PROFIT_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "native_trail_recent" },
    positionCtx: { trailActive: false, tpP1Done: false },
    recentTp1: { event: "EXIT_TP_P1_3P", orderId: 555 },
    rules,
  });
  assert.strictEqual(trailViaRecentTp1, "EXIT_TRAIL_1P");

  const noTp1NoTrail = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1271, orderType: "TAKE_PROFIT_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_tp" },
    positionCtx: { trailActive: true, tpP1Done: false },
    rules,
  });
  assert.strictEqual(noTp1NoTrail, "EXIT_TP_P1_3P");

  const inferredTp0 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1272, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_x" },
    positionCtx: { trailActive: false, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: 0.25,
  });
  assert.strictEqual(inferredTp0, "EXIT_TP_P1_3P");

  const inferredTp1 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1273, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_y" },
    positionCtx: { trailActive: false, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: 0.375,
  });
  assert.strictEqual(inferredTp1, "EXIT_TP_P1_3P");

  const stageFallbackTp0 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1274, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_z" },
    positionCtx: { trailActive: false, tpP0Done: false, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: null,
  });
  assert.strictEqual(stageFallbackTp0, "EXIT_TP_P1_3P");

  const stageFallbackTp1 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1275, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_k" },
    positionCtx: { trailActive: false, tpP0Done: true, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: null,
  });
  assert.strictEqual(stageFallbackTp1, "EXIT_TP_P1_3P");

  const consumedTp0Order = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "ETHUSDT", realizedPnl: 0.09 },
    orderMeta: { orderId: 111, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true },
    positionCtx: {
      tpP0Done: true,
      tpP1Done: false,
      trailActive: false,
      nativeProtectionConsumedTp0OrderId: 111,
    },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6 },
  });
  assert.strictEqual(consumedTp0Order, "EXIT_TP_P1_1.65P");

  const consumedTp1Order = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "ETHUSDT", realizedPnl: 1.924 },
    orderMeta: { orderId: 222, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true },
    positionCtx: {
      tpP0Done: true,
      tpP1Done: true,
      trailActive: true,
      nativeProtectionConsumedTpOrderId: 222,
    },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6 },
  });
  assert.strictEqual(consumedTp1Order, "EXIT_TP_P1_1.65P");

  process.env.BINANCE_NATIVE_TP_ENABLED = "0";
  const nativeTrackedMarketStop = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "BTCUSDT", realizedPnl: -11.014 },
    orderMeta: { orderId: 128, orderType: "MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_native_stop" },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(nativeTrackedMarketStop, "EXIT_SL_1.5P");

  const v2InitialProtectionSlMarket = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "AXSUSDT", realizedPnl: -0.688 },
    orderMeta: {
      orderId: 14854300798,
      orderType: "MARKET",
      closePosition: true,
      reduceOnly: true,
      clientOrderId: "SL__PRATTV2__ec458ab3cc",
    },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(
    v2InitialProtectionSlMarket,
    "EXIT_SL_1.5P",
    "filled V2 SL protection orders can come back from Binance as MARKET and must still be canonical SL"
  );
  assert.notStrictEqual(
    resolveExternalSyncHintStage({
      event: "EXIT_EXTERNAL_SYNC",
      orderMeta: {
        orderType: "MARKET",
        closePosition: true,
        reduceOnly: true,
        clientOrderId: "SL__PRATTV2__ec458ab3cc",
      },
    }),
    "UNTRACKED_CLOSE_POSITION",
    "V2 protection orders must not be described as untracked external close alerts"
  );

  const v2RepairProtectionSlMarket = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "AXSUSDT", realizedPnl: -0.688 },
    orderMeta: {
      orderId: 14854300799,
      orderType: "MARKET",
      closePosition: true,
      reduceOnly: true,
      clientOrderId: "RSL__PRATTV2__ec458ab3cc",
    },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(v2RepairProtectionSlMarket, "EXIT_SL_1.5P");

  const v2ProtectionTp1Market = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "AXSUSDT", realizedPnl: 1.25 },
    orderMeta: {
      orderId: 14854300800,
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
      clientOrderId: "TP1__PRATTV2__ec458ab3cc",
    },
    positionCtx: { trailActive: false, tpP1Done: false },
    rules,
  });
  assert.strictEqual(
    v2ProtectionTp1Market,
    "EXIT_TP_P1_3P",
    "filled V2 TP1 protection orders must not degrade to EXIT_EXTERNAL_SYNC when order type is MARKET"
  );

  const addRefreshSl = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "BNBUSDT", realizedPnl: -4.25, time: Date.parse("2026-03-11T00:01:10Z") },
    orderMeta: { orderId: 129, orderType: "MARKET", closePosition: true, reduceOnly: true, clientOrderId: null },
    positionCtx: {
      trailActive: false,
      nativeProtectionStale: true,
      nativeProtectionRefreshStatus: "FAILED",
      nativeProtectionRefreshContext: "ADD",
      nativeProtectionRefreshAtMs: Date.parse("2026-03-11T00:00:30Z"),
    },
    rules,
  });
  assert.strictEqual(addRefreshSl, "EXIT_SL_1.5P");

  const addRefreshOkShouldNotReclassify = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "BNBUSDT", realizedPnl: -4.25, time: Date.parse("2026-03-11T00:01:10Z") },
    orderMeta: { orderId: 130, orderType: "MARKET", closePosition: true, reduceOnly: true, clientOrderId: null },
    positionCtx: {
      trailActive: false,
      nativeProtectionStale: false,
      nativeProtectionRefreshStatus: "OK",
      nativeProtectionRefreshContext: "ADD",
      nativeProtectionRefreshAtMs: Date.parse("2026-03-11T00:00:30Z"),
    },
    rules,
  });
  assert.strictEqual(addRefreshOkShouldNotReclassify, "EXIT_EXTERNAL_SYNC");

  const tp1ByIntent = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P1_3P" },
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 124, orderType: "MARKET", closePosition: false, reduceOnly: true },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(tp1ByIntent, "EXIT_TP_P1_3P");

  const staleTp0IntentMustYieldTp1 = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P0_0.8P" },
    trade: { symbol: "XRPUSDT", realizedPnl: 8.181, time: Date.parse("2026-04-10T08:00:00Z") },
    orderMeta: { orderId: 777001, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "dbj_tp1_live" },
    positionCtx: {
      trailActive: false,
      tpP0Done: true,
      tpP1Done: false,
      nativeProtectionTpOrderId: 777001,
      nativeProtectionTp0OrderId: 777000,
    },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.75, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
    qtyPct: 0.75,
  });
  assert.strictEqual(staleTp0IntentMustYieldTp1, "EXIT_TP_P1_1.65P");

  const staleTp0IntentMustYieldTp1ByStage = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P0_0.8P" },
    trade: { symbol: "XRPUSDT", realizedPnl: 8.181, time: Date.parse("2026-04-10T08:00:00Z") },
    orderMeta: { orderId: 777101, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "dbj_tp1_stage" },
    positionCtx: {
      trailActive: false,
      tpP0Done: true,
      tpP1Done: false,
    },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.75, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
    qtyPct: 0.75,
  });
  assert.strictEqual(staleTp0IntentMustYieldTp1ByStage, "EXIT_TP_P1_1.65P");

  const staleTp0IntentMustYieldTp1ByObservedQty = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P0_0.8P" },
    trade: { symbol: "XRPUSDT", realizedPnl: 8.181, time: Date.parse("2026-04-10T08:00:00Z"), qty: 737 },
    orderMeta: { orderId: 777102, orderType: "MARKET", closePosition: false, reduceOnly: true, clientOrderId: "dbj_tp1_observed_qty" },
    positionCtx: {
      trailActive: false,
      tpP0Done: true,
      tpP1Done: false,
      qtyBase: 1474,
    },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.5, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
    qtyPct: null,
  });
  assert.strictEqual(staleTp0IntentMustYieldTp1ByObservedQty, "EXIT_TP_P1_1.65P");

  const syntheticTimeStop = await resolveExternalExitEvent({
    intent: { event: "EXIT_TIME_STOP_18B" },
    trade: { symbol: "SOLUSDT", realizedPnl: -0.018 },
    orderMeta: { orderId: 125, orderType: "MARKET", closePosition: false, reduceOnly: true },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(syntheticTimeStop, "EXIT_EXTERNAL_SYNC");

  const forcedExitAllMustBeatTrailFallback = await resolveExternalExitEvent({
    intent: { event: "FORCE_EXIT_ALL", intent_id: "force-doge" },
    trade: { symbol: "DOGEUSDT", realizedPnl: 0.115, qty: 112, time: Date.parse("2026-04-11T07:09:24.598Z") },
    orderMeta: {
      orderId: 96035243539,
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
      clientOrderId: "dbj_force_exit",
      status: "FILLED",
    },
    positionCtx: {
      qtyBase: 112,
      tpP0Done: true,
      tpP1Done: true,
      trailActive: true,
    },
    recentTp1: {
      event: "EXIT_TP_P1_1.65P",
      tradeMs: Date.parse("2026-04-11T07:05:00.000Z"),
    },
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5, TP_P1: 0.0165, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
    qtyPct: 1,
  });
  assert.strictEqual(
    forcedExitAllMustBeatTrailFallback,
    "FORCE_EXIT_ALL",
    "matched forced exit intent must override trail fallback classification"
  );

  assert.strictEqual(
    resolvePostCanonicalPersistedExitEvent({
      canonicalStageDecision: { event: null, entryLineageMissing: true },
      rawEvidenceEvent: "EXIT_TP_P1_1.65P",
      event: null,
    }),
    "EXIT_TP_P1_1.65P",
    "missing canonical lineage must not erase raw native TP1 evidence"
  );
  assert.strictEqual(
    shouldRunExternalExitSideEffects({
      upserted: { ok: true, inserted: false, previous_event: null, event: "EXIT_TP_P1_1.65P", event_changed: true },
      looksLikeExit: true,
      event: "EXIT_TP_P1_1.65P",
    }),
    true,
    "reclassifying an existing null/OTHER fill into TP1 must replay TP1 side effects"
  );
  assert.strictEqual(
    shouldRunExternalExitSideEffects({
      upserted: { ok: true, inserted: false, previous_event: "EXIT_TP_P1_1.65P", event: "EXIT_TP_P1_1.65P", event_changed: false },
      looksLikeExit: true,
      event: "EXIT_TP_P1_1.65P",
    }),
    false,
    "unchanged existing TP1 fills must not replay side effects repeatedly"
  );

  console.log("BINANCE_FILLS_QTY_PCT_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => {
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
});
