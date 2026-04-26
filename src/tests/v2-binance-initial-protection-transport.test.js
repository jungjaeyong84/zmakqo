"use strict";

const assert = require("assert");
const { buildBinanceInitialProtectionTransports, normalizeOrderAck } = require("../v2/binanceInitialProtectionTransport");

function liveCfg(extra = {}) {
  return {
    apiKey: "key",
    apiSecret: "secret",
    liveEnabled: true,
    liveDryRun: false,
    ...extra,
  };
}

(function normalizeOrderAckRequiresRealOrderId() {
  const ack = normalizeOrderAck({
    name: "SL",
    command: {
      trigger_price: 2500,
    },
    order: {
      skipped: true,
      reason: "EXISTING_CLOSE_PROTECTION_ORDER",
    },
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "EXISTING_CLOSE_PROTECTION_ORDER");
  assert.strictEqual(ack.trigger_price, 2500);
})();

(async function placeInitialSlUsesClosePositionStopMarketContract() {
  const calls = [];
  const transports = buildBinanceInitialProtectionTransports({
    liveCfg: liveCfg(),
    now: () => "2026-04-21T05:00:00.000Z",
    placeStopMarketOrder: async (payload) => {
      calls.push(payload);
      return {
        orderId: "STOP__V2__1",
        stopPrice: payload.stopPrice,
      };
    },
    placeTakeProfitMarketOrder: async () => {
      throw new Error("TP1 should not be called");
    },
  });
  const ack = await transports.placeInitialSl({
    command: {
      command_type: "PLACE_INITIAL_SL",
      placement_attempt_id: "PRATTV2__1",
      symbol: "ethusdt",
      close_side: "sell",
      trigger_price: 2445,
      client_order_key: "SL__PRATTV2__1",
    },
  });
  assert.strictEqual(ack.status, "PLACED");
  assert.strictEqual(ack.order_id, "STOP__V2__1");
  assert.strictEqual(ack.ack_at, "2026-04-21T05:00:00.000Z");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].symbol, "ETHUSDT");
  assert.strictEqual(calls[0].side, "SELL");
  assert.strictEqual(calls[0].closePosition, true);
  assert.strictEqual(calls[0].workingType, "MARK_PRICE");
  assert.strictEqual(calls[0].priceProtect, true);
  assert.strictEqual(calls[0].clientOrderId, "SL__PRATTV2__1");
  assert.ok(calls[0].signal, "initial SL write must receive an abort signal");
  assert.strictEqual(typeof calls[0].signal.aborted, "boolean");
})();

(async function placeInitialTp1UsesReduceOnlyPartialTakeProfitContract() {
  const calls = [];
  const transports = buildBinanceInitialProtectionTransports({
    liveCfg: liveCfg(),
    now: () => "2026-04-21T05:01:00.000Z",
    placeStopMarketOrder: async () => {
      throw new Error("SL should not be called");
    },
    placeTakeProfitMarketOrder: async (payload) => {
      calls.push(payload);
      return {
        orderId: "TP1__V2__1",
        stopPrice: payload.stopPrice,
      };
    },
  });
  const ack = await transports.placeInitialTp1({
    command: {
      command_type: "PLACE_INITIAL_TP1",
      placement_attempt_id: "PRATTV2__2",
      symbol: "ethusdt",
      close_side: "sell",
      trigger_price: 2542,
      quantity_abs: 0.4,
      client_order_key: "TP1__PRATTV2__2",
    },
  });
  assert.strictEqual(ack.status, "PLACED");
  assert.strictEqual(ack.order_id, "TP1__V2__1");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].symbol, "ETHUSDT");
  assert.strictEqual(calls[0].side, "SELL");
  assert.strictEqual(calls[0].closePosition, false);
  assert.strictEqual(calls[0].quantity, 0.4);
  assert.strictEqual(calls[0].reduceOnly, true);
  assert.strictEqual(calls[0].workingType, "MARK_PRICE");
  assert.strictEqual(calls[0].priceProtect, true);
  assert.strictEqual(calls[0].clientOrderId, "TP1__PRATTV2__2");
  assert.ok(calls[0].signal, "initial TP1 write must receive an abort signal");
  assert.strictEqual(typeof calls[0].signal.aborted, "boolean");
})();

(async function dryRunReturnsFailedAckWithoutExchangeWrite() {
  let called = false;
  const transports = buildBinanceInitialProtectionTransports({
    liveCfg: liveCfg({ liveEnabled: false, liveDryRun: true }),
    placeStopMarketOrder: async () => {
      called = true;
      return {};
    },
    placeTakeProfitMarketOrder: async () => {
      called = true;
      return {};
    },
  });
  const ack = await transports.placeInitialSl({
    command: {
      command_type: "PLACE_INITIAL_SL",
      trigger_price: 2445,
      symbol: "ETHUSDT",
      close_side: "SELL",
    },
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "BINANCE_INITIAL_SL_DRY_RUN");
  assert.strictEqual(called, false);
})();

(async function tp1RejectsMissingQtyAsFailedAckWithoutExchangeWrite() {
  let called = false;
  const transports = buildBinanceInitialProtectionTransports({
    liveCfg: liveCfg(),
    placeStopMarketOrder: async () => ({}),
    placeTakeProfitMarketOrder: async () => {
      called = true;
      return {};
    },
  });
  const ack = await transports.placeInitialTp1({
    command: {
      command_type: "PLACE_INITIAL_TP1",
      trigger_price: 2542,
      symbol: "ETHUSDT",
      close_side: "SELL",
      quantity_abs: 0,
    },
  });
  assert.strictEqual(ack.status, "FAILED");
  assert.strictEqual(ack.error_code, "BINANCE_INITIAL_TP1_QTY_REQUIRED");
  assert.strictEqual(called, false);
})();

(function factoryRejectsMissingKeysBeforeRunnerCanWritePending() {
  let err = null;
  try {
    buildBinanceInitialProtectionTransports({
      liveCfg: {
        apiKey: "key",
        apiSecret: "",
        liveEnabled: true,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_INITIAL_PROTECTION_KEYS_MISSING");
})();

(async function commandTypeMismatchFailsClosed() {
  const transports = buildBinanceInitialProtectionTransports({
    liveCfg: liveCfg(),
    placeStopMarketOrder: async () => ({}),
    placeTakeProfitMarketOrder: async () => ({}),
  });
  let err = null;
  try {
    await transports.placeInitialSl({
      command: {
        command_type: "PLACE_INITIAL_TP1",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "PLACE_INITIAL_SL_COMMAND_TYPE_INVALID");
})();

console.log("V2_BINANCE_INITIAL_PROTECTION_TRANSPORT_TEST_OK");
