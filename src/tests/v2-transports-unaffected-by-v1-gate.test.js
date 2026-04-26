"use strict";

const assert = require("assert");
const { __test: runnerTest } = require("../engine/paperBinanceRunner");
const { buildBinanceInitialProtectionTransports } = require("../v2/binanceInitialProtectionTransport");
const { buildBinancePlaceOrReplaceFullProtectionTransport } = require("../v2/binanceProtectionTransport");

function v2DiscoveryBlockedLegacyWriterCfg() {
  return Object.freeze({
    executionMode: "LIVE",
    liveEnabled: true,
    liveDryRun: false,
    v2DiscoveryCanaryBridge: true,
    v2DiscoveryCanaryConfigured: true,
    legacyV1ExchangeWriterEnabled: false,
    legacy_runtime_disabled: true,
    apiKey: "key",
    apiSecret: "secret",
  });
}

function assertLegacyWriterDenied() {
  const liveCfg = v2DiscoveryBlockedLegacyWriterCfg();
  assert.strictEqual(
    runnerTest.isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent: "ENTRY" }),
    true,
  );
  assert.strictEqual(
    runnerTest.isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent: "EXIT" }),
    true,
  );
}

async function initialProtectionTransportStillWritesWhenV1WriterDenied() {
  const calls = [];
  const transports = buildBinanceInitialProtectionTransports({
    liveCfg: v2DiscoveryBlockedLegacyWriterCfg(),
    now: () => "2026-04-26T00:00:00.000Z",
    placeStopMarketOrder: async (payload) => {
      calls.push({ kind: "SL", payload });
      return { orderId: "SL__V2__OK", stopPrice: payload.stopPrice };
    },
    placeTakeProfitMarketOrder: async (payload) => {
      calls.push({ kind: "TP1", payload });
      return { orderId: "TP1__V2__OK", stopPrice: payload.stopPrice };
    },
  });

  const slAck = await transports.placeInitialSl({
    command: {
      command_type: "PLACE_INITIAL_SL",
      symbol: "BNBUSDT",
      close_side: "SELL",
      trigger_price: 600,
      client_order_key: "V2_INIT_SL__1",
    },
  });
  const tp1Ack = await transports.placeInitialTp1({
    command: {
      command_type: "PLACE_INITIAL_TP1",
      symbol: "BNBUSDT",
      close_side: "SELL",
      trigger_price: 630,
      quantity_abs: 0.01,
      client_order_key: "V2_INIT_TP1__1",
    },
  });

  assert.strictEqual(slAck.status, "PLACED");
  assert.strictEqual(tp1Ack.status, "PLACED");
  assert.strictEqual(slAck.order_id, "SL__V2__OK");
  assert.strictEqual(tp1Ack.order_id, "TP1__V2__OK");
  assert.deepStrictEqual(calls.map((row) => row.kind), ["SL", "TP1"]);
  assert.strictEqual(calls[0].payload.closePosition, true);
  assert.strictEqual(calls[1].payload.reduceOnly, true);
  assert.strictEqual(calls[1].payload.closePosition, false);
}

async function repairProtectionTransportStillWritesWhenV1WriterDenied() {
  const calls = [];
  const transport = buildBinancePlaceOrReplaceFullProtectionTransport({
    now: () => "2026-04-26T00:01:00.000Z",
    resolveContext: async () => ({
      liveCfg: v2DiscoveryBlockedLegacyWriterCfg(),
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 1.5,
      fallbackLeverage: 2,
    }),
    placeStopMarketOrder: async (payload) => {
      calls.push({ kind: "SL", payload });
      return { orderId: "RSL__V2__OK", stopPrice: payload.stopPrice };
    },
    placeTakeProfitMarketOrder: async (payload) => {
      calls.push({ kind: "TP1", payload });
      return { orderId: "RTP1__V2__OK", stopPrice: payload.stopPrice };
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
          symbol: "XRPUSDT",
          close_side: "SELL",
          trigger_price: 1.45,
          client_order_key: "V2_REPAIR_SL__1",
        },
        tp1: {
          command_type: "PLACE_OR_REPLACE_TP1",
          symbol: "XRPUSDT",
          close_side: "SELL",
          trigger_price: 1.55,
          quantity_abs: 10,
          client_order_key: "V2_REPAIR_TP1__1",
        },
      },
    },
    delegatedRepair: {
      position_cycle_id: "PCY__XRPUSDT__LONG__TEST",
    },
  });

  assert.strictEqual(ack.slAck.status, "PLACED");
  assert.strictEqual(ack.tp1Ack.status, "PLACED");
  assert.strictEqual(ack.slAck.order_id, "RSL__V2__OK");
  assert.strictEqual(ack.tp1Ack.order_id, "RTP1__V2__OK");
  assert.deepStrictEqual(calls.map((row) => row.kind), ["SL", "TP1"]);
  assert.strictEqual(calls[0].payload.closePosition, true);
  assert.strictEqual(calls[1].payload.reduceOnly, true);
  assert.strictEqual(calls[1].payload.closePosition, false);
}

async function main() {
  assertLegacyWriterDenied();
  await initialProtectionTransportStillWritesWhenV1WriterDenied();
  await repairProtectionTransportStillWritesWhenV1WriterDenied();
}

main()
  .then(() => {
    console.log("V2_TRANSPORTS_UNAFFECTED_BY_V1_GATE_TEST_OK");
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
