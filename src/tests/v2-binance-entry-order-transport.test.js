"use strict";

const assert = require("assert");
const {
  buildBinanceEntryOrderTransport,
  normalizeEntryOrderReceipt,
  sideToEntryOrderSide,
} = require("../v2/binanceEntryOrderTransport");

function liveCfg(extra = {}) {
  return {
    apiKey: "key",
    apiSecret: "secret",
    liveEnabled: true,
    liveDryRun: false,
    ...extra,
  };
}

function entryIntent(extra = {}) {
  return {
    entry_intent_id: "EINTV2__ENTRY_TRANSPORT",
    signal_intent_id: "SIGINTV2__ENTRY_TRANSPORT",
    openclaw_decision_id: "OCDV2__ENTRY_TRANSPORT",
    signal_source_mode: "SERVER_NATIVE_ML_AI",
    decision_mode: "CANARY",
    policy_scope: "ETH_15M",
    symbol: "ethusdt",
    side: "LONG",
    ...extra,
  };
}

function sideMappingIsExplicit() {
  assert.strictEqual(sideToEntryOrderSide("LONG"), "BUY");
  assert.strictEqual(sideToEntryOrderSide("SHORT"), "SELL");
  let err = null;
  try {
    sideToEntryOrderSide("BUY");
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_ENTRY_SIDE_INVALID");
}

async function liveLongEntryUsesMarketBuyReduceOnlyFalse() {
  const calls = [];
  const transport = buildBinanceEntryOrderTransport({
    liveCfg: liveCfg(),
    quantityResolver: () => 0.8,
    now: () => "2026-04-21T06:00:01.000Z",
    placeMarketOrder: async (payload) => {
      calls.push(payload);
      return {
        orderId: "ENTRY_ORDER__1",
        status: "FILLED",
        symbol: payload.symbol,
        avgPrice: "2500.5",
        executedQty: "0.8",
        clientOrderId: payload.clientOrderId,
      };
    },
  });
  const receipt = await transport.submitEntryOrder({
    entryIntent: entryIntent(),
    submittedAt: "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].symbol, "ETHUSDT");
  assert.strictEqual(calls[0].side, "BUY");
  assert.strictEqual(calls[0].quantity, 0.8);
  assert.strictEqual(calls[0].reduceOnly, false);
  assert.strictEqual(calls[0].newOrderRespType, "RESULT");
  assert.ok(String(calls[0].clientOrderId).startsWith("EV2_"));
  assert.strictEqual(receipt.status, "FILLED");
  assert.strictEqual(receipt.entry_order_id, "ENTRY_ORDER__1");
  assert.strictEqual(receipt.avg_price, 2500.5);
  assert.strictEqual(receipt.executed_qty_abs, 0.8);
  assert.strictEqual(receipt.entry_event_id, "ENTRYV2__ETHUSDT__LONG__ENTRY_ORDER__1");
}

async function liveShortEntryUsesMarketSell() {
  const calls = [];
  const transport = buildBinanceEntryOrderTransport({
    liveCfg: liveCfg(),
    quantityResolver: () => 1.25,
    placeMarketOrder: async (payload) => {
      calls.push(payload);
      return {
        orderId: "ENTRY_ORDER__SHORT",
        status: "FILLED",
        symbol: payload.symbol,
        avgPrice: "99.5",
        executedQty: "1.25",
      };
    },
  });
  const receipt = await transport.submitEntryOrder({
    entryIntent: entryIntent({ side: "SHORT", symbol: "xrpusdt" }),
  });
  assert.strictEqual(calls[0].symbol, "XRPUSDT");
  assert.strictEqual(calls[0].side, "SELL");
  assert.strictEqual(receipt.side, "SHORT");
}

async function dryRunDoesNotCallExchangeAndSubmitterWillNotTreatItAsFilled() {
  let called = false;
  const transport = buildBinanceEntryOrderTransport({
    liveCfg: liveCfg({ liveEnabled: false, liveDryRun: true }),
    quantityResolver: () => 0.8,
    placeMarketOrder: async () => {
      called = true;
      return {};
    },
  });
  const receipt = await transport.submitEntryOrder({ entryIntent: entryIntent() });
  assert.strictEqual(called, false);
  assert.strictEqual(receipt.status, "DRY_RUN");
  assert.strictEqual(receipt.error_code, "BINANCE_ENTRY_DRY_RUN");
}

async function missingQuantityBlocksBeforeExchangeCall() {
  let called = false;
  const transport = buildBinanceEntryOrderTransport({
    liveCfg: liveCfg(),
    quantityResolver: () => null,
    placeMarketOrder: async () => {
      called = true;
      return {};
    },
  });
  let err = null;
  try {
    await transport.submitEntryOrder({ entryIntent: entryIntent() });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_ENTRY_QTY_ABS_REQUIRED");
  assert.strictEqual(called, false);
}

function normalizeFilledOrderRequiresOrderIdAvgPriceAndQty() {
  for (const badOrder of [
    { status: "FILLED", avgPrice: "2500", executedQty: "0.8" },
    { status: "FILLED", orderId: "1", executedQty: "0.8" },
    { status: "FILLED", orderId: "1", avgPrice: "2500", executedQty: "0" },
  ]) {
    let err = null;
    try {
      normalizeEntryOrderReceipt({
        order: badOrder,
        entryIntent: entryIntent(),
        quantityAbs: 0.8,
      });
    } catch (error) {
      err = error;
    }
    assert.ok(err);
  }
}

function nonFilledOrderReturnsReceiptThatSubmitterRejects() {
  const receipt = normalizeEntryOrderReceipt({
    order: {
      status: "NEW",
      orderId: "ENTRY_ORDER__NEW",
      avgPrice: "0",
      executedQty: "0",
    },
    entryIntent: entryIntent(),
    quantityAbs: 0.8,
  });
  assert.strictEqual(receipt.status, "NEW");
  assert.strictEqual(receipt.entry_event_id, null);
  assert.strictEqual(receipt.error_code, "BINANCE_ENTRY_NEW");
}

function factoryFailsClosedWithoutKeysOrLiveMode() {
  let err = null;
  try {
    buildBinanceEntryOrderTransport({
      liveCfg: { apiKey: "key", apiSecret: "", liveEnabled: true },
      quantityResolver: () => 1,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_ENTRY_KEYS_MISSING");

  err = null;
  try {
    buildBinanceEntryOrderTransport({
      liveCfg: { apiKey: "key", apiSecret: "secret", liveEnabled: false, liveDryRun: false },
      quantityResolver: () => 1,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_ENTRY_LIVE_CFG_NOT_ENABLED");
}

async function main() {
  sideMappingIsExplicit();
  await liveLongEntryUsesMarketBuyReduceOnlyFalse();
  await liveShortEntryUsesMarketSell();
  await dryRunDoesNotCallExchangeAndSubmitterWillNotTreatItAsFilled();
  await missingQuantityBlocksBeforeExchangeCall();
  normalizeFilledOrderRequiresOrderIdAvgPriceAndQty();
  nonFilledOrderReturnsReceiptThatSubmitterRejects();
  factoryFailsClosedWithoutKeysOrLiveMode();
}

main()
  .then(() => {
    console.log("V2_BINANCE_ENTRY_ORDER_TRANSPORT_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
