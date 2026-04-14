"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceActiveExitWatchdog");

function run() {
  assert.strictEqual(typeof __test.inspectExitProtection, "function");
  assert.strictEqual(typeof __test.isWatchdogTarget, "function");

  const betweenTp = __test.inspectExitProtection({
    symbol: "XRPUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 1000,
      avg_price: 2.1,
      meta: {
        tp_p0_done: true,
        tp_p1_done: false,
        trail_active: false,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          TP_P1: 0.0165,
          SL: -0.0165,
        },
      },
    },
    externalPosition: { symbol: "XRPUSDT", positionAmt: "1000" },
    openOrders: [],
    algoOrders: [],
  });
  assert.strictEqual(betweenTp.stage, "BETWEEN_TP0_TP1");
  assert.ok(betweenTp.actionable_issue_codes.includes("TP1_ORDER_MISSING"));

  const trailing = __test.inspectExitProtection({
    symbol: "DOGEUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      position_state: "SCALE_OUT",
      position_side: "LONG",
      qty_base: 8182,
      avg_price: 0.09206,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        native_protection_refresh_status: "OK",
        trail_high: 0.09305,
        entry_r_distance: 0.001519,
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0165,
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          RUNNER_MIN_PROFIT_PCT: 0.0165,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    externalPosition: { symbol: "DOGEUSDT", positionAmt: "8182" },
    openOrders: [
      {
        symbol: "DOGEUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        reduceOnly: true,
        stopPrice: "0.0913",
        orderId: "123",
      },
    ],
    algoOrders: [],
  });
  assert.strictEqual(trailing.stage, "TRAIL");
  assert.ok(trailing.actionable_issue_codes.includes("TRAIL_STOP_BELOW_RUNNER_FLOOR_LONG"));
  assert.strictEqual(__test.shouldRepairIssue(trailing), true);

  const trailingFromObservation = __test.inspectExitProtection({
    symbol: "ETHUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.334,
      avg_price: 2258.08,
      leverage: 2,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        native_protection_refresh_status: "OK",
        trail_high: 2267.51,
        trail_high_at_ms: 100,
        entry_r_distance: 26.58,
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0165,
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          RUNNER_MIN_PROFIT_PCT: 0.0165,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    observation: {
      trail_observation: {
        side: "LONG",
        trail_high: 2276.84,
        trail_high_at_ms: 200,
        entry_r_distance: 26.58,
        runner_floor_stop: 2276.70916,
        computed_trail_stop: 2276.70916,
        trail_stop_by_r: 2323.53468,
        chosen_stop_source: "RUNNER_FLOOR",
        chosen_stop_price: 2276.70916,
        native_stop_price: 2276.7,
        native_stop_order_id: "4000001083240691",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 200,
        source: "TICK_EXIT",
      },
    },
    externalPosition: { symbol: "ETHUSDT", positionAmt: "0.334" },
    openOrders: [],
    algoOrders: [
      {
        symbol: "ETHUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        closePosition: true,
        stopPrice: "2276.70916",
        orderId: "4000001083240691",
      },
    ],
  });
  assert.strictEqual(trailingFromObservation.stage, "TRAIL");
  assert.strictEqual(trailingFromObservation.actual_stop_price, 2276.70916);
  assert.strictEqual(trailingFromObservation.actionable_issue_n, 0, "fresh trail observation snapshot should suppress stale-meta false positives");

  const chosenSourceMismatch = __test.inspectExitProtection({
    symbol: "ETHUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.167,
      avg_price: 2258.08,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0165,
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          RUNNER_MIN_PROFIT_PCT: 0.0165,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    observation: {
      trail_observation: {
        runner_floor_stop: 2276.70916,
        computed_trail_stop: 2276.70916,
        trail_stop_by_r: 2323.53468,
        chosen_stop_source: "TRAIL",
        chosen_stop_price: 2323.53468,
        native_stop_price: 2276.7,
        native_stop_order_id: "4000001083283507",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 300,
        source: "TICK_EXIT",
      },
    },
    externalPosition: { symbol: "ETHUSDT", positionAmt: "0.167" },
    openOrders: [],
    algoOrders: [
      {
        symbol: "ETHUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        closePosition: true,
        stopPrice: "2276.7",
        orderId: "4000001083283507",
      },
    ],
  });
  assert.ok(chosenSourceMismatch.actionable_issue_codes.includes("TRAIL_STOP_CHOSEN_SOURCE_MISMATCH"));

  const guaranteeMiss = __test.inspectExitProtection({
    symbol: "ETHUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.167,
      avg_price: 2258.08,
      leverage: 2,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0165,
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          RUNNER_MIN_PROFIT_PCT: 0.0165,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    observation: {
      trail_observation: {
        runner_floor_stop: 2276.70916,
        computed_trail_stop: 2276.70916,
        trail_stop_by_r: 2335.9146550677906,
        chosen_stop_source: "TRAIL",
        chosen_stop_price: 2276.70916,
        native_stop_price: 2276.7,
        native_stop_order_id: "4000001083283507",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 300,
        source: "TICK_EXIT",
      },
    },
    externalPosition: { symbol: "ETHUSDT", positionAmt: "0.167" },
    openOrders: [],
    algoOrders: [
      {
        symbol: "ETHUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        closePosition: true,
        stopPrice: "2276.7",
        orderId: "4000001083283507",
      },
    ],
  });
  assert.strictEqual(guaranteeMiss.actionable_issue_n, 0, "one-tick rounding and normalized floor source should not trigger live blocker");

  const materialGuaranteeMiss = __test.inspectExitProtection({
    symbol: "ETHUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.167,
      avg_price: 2258.08,
      leverage: 2,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0165,
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          RUNNER_MIN_PROFIT_PCT: 0.0165,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    observation: {
      trail_observation: {
        runner_floor_stop: 2276.70916,
        computed_trail_stop: 2276.70916,
        trail_stop_by_r: 2335.9146550677906,
        chosen_stop_source: "TRAIL",
        chosen_stop_price: 2276.70916,
        native_stop_price: 2276.0,
        native_stop_order_id: "4000001083283507",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 300,
        source: "TICK_EXIT",
      },
    },
    externalPosition: { symbol: "ETHUSDT", positionAmt: "0.167" },
    openOrders: [],
    algoOrders: [
      {
        symbol: "ETHUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        closePosition: true,
        stopPrice: "2276.0",
        orderId: "4000001083283507",
      },
    ],
  });
  assert.ok(materialGuaranteeMiss.actionable_issue_codes.includes("RUNNER_MIN_GUARANTEE_MISSED"));

  const missingTrailRStop = __test.inspectExitProtection({
    symbol: "BNBUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.167,
      avg_price: 600,
      leverage: 2,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        runner_remaining_qty_abs: 0.167,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0165,
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          RUNNER_MIN_PROFIT_PCT: 0.0165,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    observation: {
      trail_observation: {
        runner_floor_stop: 605,
        computed_trail_stop: 605,
        chosen_stop_source: "RUNNER_FLOOR",
        chosen_stop_price: 605,
        native_stop_price: 605,
        native_stop_order_id: "5001",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 300,
        source: "TICK_EXIT",
      },
    },
    externalPosition: { symbol: "BNBUSDT", positionAmt: "0.167" },
    openOrders: [],
    algoOrders: [
      {
        symbol: "BNBUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        closePosition: true,
        stopPrice: "605",
        orderId: "5001",
      },
    ],
  });
  assert.ok(missingTrailRStop.actionable_issue_codes.includes("TRAIL_R_STOP_MISSING"));

  const runnerQtyMismatch = __test.inspectExitProtection({
    symbol: "SOLUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.167,
      avg_price: 150,
      leverage: 2,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        runner_remaining_qty_abs: 0.29,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P1: 0.0165,
          TP_P0_QTY: 0.25,
          TP_P1_QTY: 0.5,
          RUNNER_MIN_PROFIT_PCT: 0.0165,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    observation: {
      trail_observation: {
        runner_floor_stop: 151.5,
        computed_trail_stop: 151.5,
        trail_stop_by_r: 153.0,
        chosen_stop_source: "RUNNER_FLOOR",
        chosen_stop_price: 151.5,
        native_stop_price: 151.5,
        native_stop_order_id: "5002",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 300,
        source: "TICK_EXIT",
      },
    },
    externalPosition: { symbol: "SOLUSDT", positionAmt: "0.167" },
    openOrders: [],
    algoOrders: [
      {
        symbol: "SOLUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        closePosition: true,
        stopPrice: "151.5",
        orderId: "5002",
      },
    ],
  });
  assert.ok(runnerQtyMismatch.actionable_issue_codes.includes("RUNNER_REMAINING_QTY_MISMATCH"));

  console.log("BINANCE_ACTIVE_EXIT_WATCHDOG_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BINANCE_ACTIVE_EXIT_WATCHDOG_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
