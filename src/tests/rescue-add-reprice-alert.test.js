"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  const context = __test.buildRescueAddRepriceAlertContext({
    position: {
      avg_price: 98.75,
      meta: {
        add_chain_last_avg_before: 100,
        add_chain_last_avg_after: 98.75,
        add_chain_last_qty_pct: 0.14,
        add_chain_last_qty_base: 14,
        native_protection_refresh_status: "OK",
        native_protection_stop_price: 97.2,
      },
    },
    fallbackMeta: {
      add_chain_last_avg_before: 101,
      add_chain_last_avg_after: 99.5,
      add_chain_last_qty_pct: 0.2,
      add_chain_last_qty_base: 20,
      native_protection_refresh_status: "FAILED",
    },
    fallbackAvgBefore: 102,
    fallbackAvgAfter: 99,
    fallbackAddQtyPct: 0.22,
    fallbackAddQtyBase: 22,
  });
  assert.strictEqual(context.avgBefore, 100);
  assert.strictEqual(context.avgAfter, 98.75);
  assert.strictEqual(context.addQtyPct, 0.14);
  assert.strictEqual(context.addQtyBase, 14);
  assert.strictEqual(context.nativeProtectionMeta.native_protection_refresh_status, "OK");

  let sent = null;
  const result = await __test.sendRescueAddRepriceAlert({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "CORE_LONG",
    executionMode: "LIVE",
    position: {
      exchange: "BINANCEFUT",
      state: "ACTIVE",
      size_pct: 0.3,
      avg_price: 99.5,
      leverage: 2,
      position_side: "LONG",
      meta: {
        leverage: 2,
        exit_rules_override: {
          SL: -0.0165,
          TP_P1: 0.0325,
          BE_ENABLE: true,
          BE_PCT: 0.0025,
          TRAIL_PCT: 0.01,
        },
      },
    },
    avgBefore: 100,
    avgAfter: 99.5,
    addQtyPct: 0.15,
    addQtyBase: 0.0021,
    fillPrice: 99,
    exitRules: {
      SL: -0.0165,
      TP_P1: 0.0325,
      BE_ENABLE: true,
      BE_PCT: 0.0025,
      TRAIL_PCT: 0.01,
    },
    nativeProtectionMeta: {
      native_protection_refresh_status: "OK",
      native_protection_stop_price: 98.679125,
    },
    channelResolver: async () => "telegram:test",
    alertFn: async (payload) => {
      sent = payload;
      return { ok: true };
    },
  });

  assert.strictEqual(result.ok, true);
  assert.ok(sent, "alert payload missing");
  assert.strictEqual(sent.channel, "telegram:test");
  assert.ok(sent.title.includes("BTCUSDT"));
  assert.ok(sent.body.includes("평단: 100 -> 99.5"));
  assert.ok(sent.body.includes("내부 SL:"));
  assert.ok(sent.body.includes("TP1:"));
  assert.ok(sent.body.includes("네이티브 보호주문: OK"));
  assert.ok(sent.body.includes("SL: 98.6791"));
}

run()
  .then(() => {
    console.log("RESCUE_ADD_REPRICE_ALERT_TEST_OK");
  })
  .catch((err) => {
    console.error("RESCUE_ADD_REPRICE_ALERT_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
