"use strict";

const assert = require("assert");
const {
  buildBinanceRefreshNativeStopTransport,
  buildBinancePlaceOrReplaceTp1Transport,
  buildBinancePlaceOrReplaceFullProtectionTransport,
  normalizeRefreshNativeStopAck,
  normalizePlaceOrReplaceTp1Ack,
  normalizePlaceOrReplaceSlAck,
  resolveTransportContext,
  __test,
} = require("../v2/binanceProtectionTransport");

(function normalizeAckMapsSuccessfulRefreshToPlacedStopAck() {
  const ack = normalizeRefreshNativeStopAck({
    command: {
      trigger_price: 101.5,
    },
    refreshResult: {
      ok: true,
      stop_order_id: "STOP__1",
      stop_price: 101.75,
      stop_ack_ms: Date.parse("2026-04-21T06:00:01.000Z"),
    },
  });
  assert.strictEqual(ack.status, "PLACED");
  assert.strictEqual(ack.order_id, "STOP__1");
  assert.strictEqual(ack.trigger_price, 101.75);
  assert.strictEqual(ack.ack_at, "2026-04-21T06:00:01.000Z");
})();

(function normalizeAckFailsWhenRefreshDoesNotReturnStopOrderId() {
  const ack = normalizeRefreshNativeStopAck({
    command: {
      trigger_price: 101.5,
    },
    refreshResult: {
      ok: true,
      reason: "native refresh missing stop",
    },
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "NATIVE_REFRESH_MISSING_STOP");
  assert.strictEqual(ack.trigger_price, 101.5);
})();

(function normalizeTp1RepairAckRequiresRealOrderId() {
  const ack = normalizePlaceOrReplaceTp1Ack({
    command: {
      trigger_price: 101.5,
    },
    order: {
      skipped: true,
      reason: "EXISTING_TP_ORDER_NOT_REPLACED",
    },
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "EXISTING_TP_ORDER_NOT_REPLACED");
  assert.strictEqual(ack.trigger_price, 101.5);
})();

(function normalizeSlRepairAckRequiresRealOrderId() {
  const ack = normalizePlaceOrReplaceSlAck({
    command: {
      trigger_price: 98.35,
    },
    order: {
      skipped: true,
      reason: "STOP_ORDER_NOT_REPLACED",
    },
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "STOP_ORDER_NOT_REPLACED");
  assert.strictEqual(ack.trigger_price, 98.35);
})();

(async function contextResolverIsRequiredAndDoesNotInferFromCycleId() {
  let err = null;
  try {
    await resolveTransportContext({
      delegatedRepair: {
        position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__abc",
      },
      command: {
        command_type: "REFRESH_NATIVE_STOP",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_TRANSPORT_CONTEXT_RESOLVER_REQUIRED");
})();

(async function transportCallsInjectedRefreshWithAuthorityWriterSource() {
  const calls = [];
  const transport = buildBinanceRefreshNativeStopTransport({
    now: () => "2026-04-21T06:00:02.000Z",
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
      },
      exchange: "BINANCEFUT",
      symbol: "ethusdt",
      fallbackSide: "sell",
      fallbackEntryPrice: 2500,
      fallbackLeverage: 2,
      exitRulesOverride: {
        TP_P1: 0.025,
      },
      posMeta: {
        position_side: "LONG",
      },
    }),
    refreshNativeProtectionWithRetry: async (payload) => {
      calls.push(payload);
      return {
        ok: true,
        stop_order_id: "STOP__AUTH",
        stop_price: 2445,
      };
    },
  });
  const ack = await transport({
    command: {
      command_type: "REFRESH_NATIVE_STOP",
      trigger_price: 2445,
    },
    delegatedRepair: {
      position_cycle_id: "PCY__ETH",
    },
  });
  assert.strictEqual(ack.status, "PLACED");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].writerSource, "BINANCE_TICK_EXIT");
  assert.strictEqual(calls[0].symbol, "ETHUSDT");
  assert.strictEqual(calls[0].fallbackSide, "SELL");
  assert.strictEqual(calls[0].fallbackEntryPrice, 2500);
  assert.strictEqual(calls[0].fallbackLeverage, 2);
  assert.ok(calls[0].signal);
  assert.strictEqual(typeof calls[0].signal.addEventListener, "function");
})();

(async function transportRejectsMissingContextFieldsBeforeCallingRefresh() {
  let called = false;
  const transport = buildBinanceRefreshNativeStopTransport({
    resolveContext: async () => ({
      liveCfg: {},
      symbol: "ETHUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: null,
      fallbackLeverage: 2,
    }),
    refreshNativeProtectionWithRetry: async () => {
      called = true;
      return { ok: true };
    },
  });
  let err = null;
  try {
    await transport({
      command: {
        command_type: "REFRESH_NATIVE_STOP",
        trigger_price: 2445,
      },
      delegatedRepair: {},
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_TRANSPORT_FALLBACK_ENTRY_PRICE_REQUIRED");
  assert.strictEqual(called, false);
})();

(async function refreshTransportFailsClosedOnProtectionWriteDeadline() {
  const transport = buildBinanceRefreshNativeStopTransport({
    deadlineMs: 5,
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
      },
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 2500,
      fallbackLeverage: 2,
    }),
    refreshNativeProtectionWithRetry: async () => new Promise(() => {}),
  });
  const ack = await transport({
    command: {
      command_type: "REFRESH_NATIVE_STOP",
      trigger_price: 2445,
    },
    delegatedRepair: {},
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "BINANCE_NATIVE_STOP_REFRESH_DEADLINE_EXCEEDED");
  assert.strictEqual(ack.trigger_price, 2445);
})();

(async function tp1RepairTransportUsesReduceOnlyTakeProfitContract() {
  const calls = [];
  const transport = buildBinancePlaceOrReplaceTp1Transport({
    now: () => "2026-04-21T06:10:02.000Z",
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: false,
      },
      exchange: "BINANCEFUT",
      symbol: "ethusdt",
      fallbackSide: "sell",
      fallbackEntryPrice: 2500,
      fallbackLeverage: 2,
    }),
    placeTakeProfitMarketOrder: async (payload) => {
      calls.push(payload);
      return {
        orderId: "TP1__REPAIR_AUTH",
        stopPrice: payload.stopPrice,
      };
    },
  });
  const ack = await transport({
    command: {
      command_type: "PLACE_OR_REPLACE_TP1",
      placement_attempt_id: "PRATTV2__TP1_REPAIR",
      symbol: "ethusdt",
      close_side: "sell",
      trigger_price: 2542,
      quantity_abs: 0.4,
      client_order_key: "RTP1__PRATTV2__TP1_REPAIR",
    },
    delegatedRepair: {
      position_cycle_id: "PCY__ETH",
    },
  });
  assert.strictEqual(ack.status, "PLACED");
  assert.strictEqual(ack.order_id, "TP1__REPAIR_AUTH");
  assert.strictEqual(ack.ack_at, "2026-04-21T06:10:02.000Z");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].symbol, "ETHUSDT");
  assert.strictEqual(calls[0].side, "SELL");
  assert.strictEqual(calls[0].stopPrice, 2542);
  assert.strictEqual(calls[0].quantity, 0.4);
  assert.strictEqual(calls[0].closePosition, false);
  assert.strictEqual(calls[0].reduceOnly, true);
  assert.strictEqual(calls[0].workingType, "MARK_PRICE");
  assert.strictEqual(calls[0].priceProtect, true);
  assert.strictEqual(calls[0].clientOrderId, "RTP1__PRATTV2__TP1_REPAIR");
  assert.ok(calls[0].signal);
})();

(async function tp1RepairDryRunDoesNotWriteExchange() {
  let called = false;
  const transport = buildBinancePlaceOrReplaceTp1Transport({
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: false,
        liveDryRun: true,
      },
      symbol: "ETHUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 2500,
      fallbackLeverage: 2,
    }),
    placeTakeProfitMarketOrder: async () => {
      called = true;
      return {};
    },
  });
  const ack = await transport({
    command: {
      command_type: "PLACE_OR_REPLACE_TP1",
      trigger_price: 2542,
      quantity_abs: 0.4,
      symbol: "ETHUSDT",
      close_side: "SELL",
    },
    delegatedRepair: {},
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "BINANCE_TP1_REPAIR_DRY_RUN");
  assert.strictEqual(called, false);
})();

(async function tp1RepairRejectsMissingQtyBeforeContextLookup() {
  let contextCalled = false;
  const transport = buildBinancePlaceOrReplaceTp1Transport({
    resolveContext: async () => {
      contextCalled = true;
      return {};
    },
    placeTakeProfitMarketOrder: async () => ({}),
  });
  const ack = await transport({
    command: {
      command_type: "PLACE_OR_REPLACE_TP1",
      trigger_price: 2542,
      quantity_abs: 0,
    },
    delegatedRepair: {},
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "BINANCE_TP1_REPAIR_QTY_REQUIRED");
  assert.strictEqual(contextCalled, false);
})();

(async function tp1RepairTransportFailsClosedOnProtectionWriteDeadline() {
  const transport = buildBinancePlaceOrReplaceTp1Transport({
    deadlineMs: 5,
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: false,
      },
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 2500,
      fallbackLeverage: 2,
    }),
    placeTakeProfitMarketOrder: async () => new Promise(() => {}),
  });
  const ack = await transport({
    command: {
      command_type: "PLACE_OR_REPLACE_TP1",
      symbol: "ETHUSDT",
      close_side: "SELL",
      trigger_price: 2542,
      quantity_abs: 0.4,
    },
    delegatedRepair: {},
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "BINANCE_TP1_REPAIR_DEADLINE_EXCEEDED");
  assert.strictEqual(ack.trigger_price, 2542);
})();

(async function fullProtectionTransportPlacesStopThenTp1WithExplicitContracts() {
  const calls = [];
  const transport = buildBinancePlaceOrReplaceFullProtectionTransport({
    now: () => "2026-04-21T06:20:02.000Z",
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: false,
      },
      exchange: "BINANCEFUT",
      symbol: "btcusdt",
      fallbackSide: "sell",
      fallbackEntryPrice: 100000,
      fallbackLeverage: 2,
    }),
    placeStopMarketOrder: async (payload) => {
      calls.push({ kind: "SL", payload });
      return {
        orderId: "STOP__FULL_AUTH",
        stopPrice: payload.stopPrice,
      };
    },
    placeTakeProfitMarketOrder: async (payload) => {
      calls.push({ kind: "TP1", payload });
      return {
        orderId: "TP1__FULL_AUTH",
        stopPrice: payload.stopPrice,
      };
    },
  });
  const ack = await transport({
    command: {
      command_type: "PLACE_OR_REPLACE_FULL_PROTECTION",
      include_sl_order: true,
      include_tp1_order: true,
      commands: {
        sl: {
          command_type: "PLACE_OR_REPLACE_SL",
          placement_attempt_id: "PRATTV2__FULL",
          symbol: "btcusdt",
          close_side: "sell",
          trigger_price: 98350,
          client_order_key: "RSL__PRATTV2__FULL",
        },
        tp1: {
          command_type: "PLACE_OR_REPLACE_TP1",
          placement_attempt_id: "PRATTV2__FULL",
          symbol: "btcusdt",
          close_side: "sell",
          trigger_price: 101680,
          quantity_abs: 0.005,
          client_order_key: "RTP1__PRATTV2__FULL",
        },
      },
    },
    delegatedRepair: {
      position_cycle_id: "PCY__BTC",
    },
  });
  assert.strictEqual(ack.slAck.status, "PLACED");
  assert.strictEqual(ack.tp1Ack.status, "PLACED");
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].kind, "SL");
  assert.strictEqual(calls[0].payload.closePosition, true);
  assert.strictEqual(calls[0].payload.workingType, "MARK_PRICE");
  assert.strictEqual(calls[0].payload.priceProtect, true);
  assert.strictEqual(calls[1].kind, "TP1");
  assert.strictEqual(calls[1].payload.reduceOnly, true);
  assert.strictEqual(calls[1].payload.closePosition, false);
  assert.strictEqual(calls[1].payload.quantity, 0.005);
  assert.ok(calls[0].payload.signal);
  assert.ok(calls[1].payload.signal);
})();

(async function fullProtectionDryRunDoesNotWriteExchange() {
  let called = false;
  const transport = buildBinancePlaceOrReplaceFullProtectionTransport({
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: false,
        liveDryRun: true,
      },
      symbol: "BTCUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 100000,
      fallbackLeverage: 2,
    }),
    placeStopMarketOrder: async () => {
      called = true;
      return {};
    },
    placeTakeProfitMarketOrder: async () => {
      called = true;
      return {};
    },
  });
  const ack = await transport({
    command: {
      command_type: "PLACE_OR_REPLACE_FULL_PROTECTION",
      include_sl_order: true,
      include_tp1_order: false,
      commands: {
        sl: {
          command_type: "PLACE_OR_REPLACE_SL",
          trigger_price: 98350,
        },
      },
    },
    delegatedRepair: {},
  });
  assert.strictEqual(ack.slAck.status, "FAILED");
  assert.strictEqual(ack.slAck.error_code, "BINANCE_FULL_PROTECTION_DRY_RUN");
  assert.strictEqual(ack.tp1Ack, null);
  assert.strictEqual(called, false);
})();

(async function fullProtectionTransportFailsClosedPerLegOnProtectionWriteDeadline() {
  const transport = buildBinancePlaceOrReplaceFullProtectionTransport({
    deadlineMs: 5,
    resolveContext: async () => ({
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: false,
      },
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 100000,
      fallbackLeverage: 2,
    }),
    placeStopMarketOrder: async () => new Promise(() => {}),
    placeTakeProfitMarketOrder: async () => ({
      orderId: "TP1__OK_AFTER_SL_TIMEOUT",
      stopPrice: 101680,
    }),
  });
  const ack = await transport({
    command: {
      command_type: "PLACE_OR_REPLACE_FULL_PROTECTION",
      include_sl_order: true,
      include_tp1_order: true,
      commands: {
        sl: {
          command_type: "PLACE_OR_REPLACE_SL",
          symbol: "BTCUSDT",
          close_side: "SELL",
          trigger_price: 98350,
        },
        tp1: {
          command_type: "PLACE_OR_REPLACE_TP1",
          symbol: "BTCUSDT",
          close_side: "SELL",
          trigger_price: 101680,
          quantity_abs: 0.005,
        },
      },
    },
    delegatedRepair: {},
  });
  assert.strictEqual(ack.slAck.status, "FAILED");
  assert.strictEqual(ack.slAck.error_code, "BINANCE_FULL_PROTECTION_SL_DEADLINE_EXCEEDED");
  assert.strictEqual(ack.tp1Ack.status, "PLACED");
  assert.strictEqual(ack.tp1Ack.order_id, "TP1__OK_AFTER_SL_TIMEOUT");
})();

(function stableCodeNormalizesTransportErrors() {
  assert.strictEqual(__test.stableCode("native refresh missing stop"), "NATIVE_REFRESH_MISSING_STOP");
})();

(function protectionWriteDeadlineIsClampedForOperationalSafety() {
  assert.strictEqual(__test.resolveProtectionWriteDeadlineMs({ deadlineMs: 1 }), 250);
  assert.strictEqual(__test.resolveProtectionWriteDeadlineMs({ deadlineMs: 999999 }), 120000);
  assert.strictEqual(__test.resolveProtectionWriteDeadlineMs({ deadlineMs: 5000 }), 5000);
})();

(async function protectionWriteDeadlineAbortsInFlightOperationSignal() {
  let aborted = false;
  let err = null;
  try {
    await __test.withProtectionWriteDeadline(({ signal }) => new Promise(() => {
      signal.addEventListener("abort", () => {
        aborted = true;
      }, { once: true });
    }), {
      deadlineMs: 5,
      errorCode: "BINANCE_TEST_DEADLINE_EXCEEDED",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.code, "BINANCE_TEST_DEADLINE_EXCEEDED");
  assert.strictEqual(aborted, true);
})();

console.log("V2_BINANCE_PROTECTION_TRANSPORT_TEST_OK");
