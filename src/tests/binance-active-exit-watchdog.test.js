"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceActiveExitWatchdog");

const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;

function run() {
  assert.strictEqual(typeof __test.inspectExitProtection, "function");
  assert.strictEqual(typeof __test.isWatchdogTarget, "function");
  assert.strictEqual(typeof __test.shouldAllowWatchdogMutation, "function");
  assert.strictEqual(typeof __test.resolveReadOnlyWatchdogRepairReason, "function");
  assert.strictEqual(__test.shouldAllowWatchdogMutation(), false);
  assert.strictEqual(__test.resolveReadOnlyWatchdogRepairReason(), "REPAIR_REQUESTED_NON_AUTHORITY_LAYER");
  assert.strictEqual(
    __test.isWatchdogTarget({
      position_state: "ACTIVE",
      qty_base: 1,
      meta: { simplified_exit_v2_enabled: true },
    }),
    true
  );

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const preTp1 = __test.inspectExitProtection({
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
  assert.strictEqual(preTp1.stage, "PRE_TP1");
  assert.ok(preTp1.actionable_issue_codes.includes("TP1_ORDER_MISSING"));

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const simplifiedPreTp1 = __test.inspectExitProtection({
    symbol: "ADAUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "ADAUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 1200,
      avg_price: 1.2,
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p0_done: false,
        tp_p1_done: false,
        trail_active: false,
        native_protection_refresh_status: "MISSING",
        exit_rules_override: {
          TP_P1_QTY: 0.5,
          TP_P1: 0.025,
          SL: -0.0165,
        },
      },
    },
    externalPosition: { symbol: "ADAUSDT", positionAmt: "1200" },
    openOrders: [],
    algoOrders: [],
  });
  assert.strictEqual(simplifiedPreTp1.stage, "PRE_TP1");
  assert.strictEqual(simplifiedPreTp1.simplified_exit_v2_enabled, true);
  assert.ok(simplifiedPreTp1.actionable_issue_codes.includes("TP1_ORDER_MISSING"));
  assert.ok(simplifiedPreTp1.actionable_issue_codes.includes("NATIVE_REFRESH_UNHEALTHY"));
  const simplifiedRunnerMetaGap = __test.inspectExitProtection({
    symbol: "BTCUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.013,
      entry_qty_base: 0.026,
      avg_price: 74987.2,
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p0_done: false,
        tp_p1_done: false,
        trail_active: false,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P1_QTY: 0.5,
          TP_P1: 0.025,
          RUNNER_MIN_PROFIT_PCT: 0.0025,
          TRAIL_PCT: 0.01,
          SL: -0.0165,
        },
      },
    },
    externalPosition: { symbol: "BTCUSDT", positionAmt: "0.013", markPrice: "75647.3" },
    openOrders: [],
    algoOrders: [],
  });
  assert.strictEqual(simplifiedRunnerMetaGap.stage, "TP1");
  assert.strictEqual(simplifiedRunnerMetaGap.canonical_stage, "TP1");
  assert.ok(simplifiedRunnerMetaGap.actionable_issue_codes.includes("TP1_META_SYNC_GAP"));
  assert.ok(!simplifiedRunnerMetaGap.actionable_issue_codes.includes("TP1_ORDER_MISSING"));

  const simplifiedLegacyTp0Artifact = __test.inspectExitProtection({
    symbol: "AVAXUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "AVAXUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 20,
      avg_price: 25,
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p0_done: true,
        tp_p1_done: false,
        trail_active: false,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P1_QTY: 0.5,
          TP_P1: 0.025,
          SL: -0.0165,
        },
      },
    },
    externalPosition: { symbol: "AVAXUSDT", positionAmt: "20" },
    openOrders: [],
    algoOrders: [],
  });
  assert.strictEqual(simplifiedLegacyTp0Artifact.stage, "PRE_TP1");
  assert.ok(simplifiedLegacyTp0Artifact.actionable_issue_codes.includes("TP1_ORDER_MISSING"));

  const simplifiedRunner = __test.inspectExitProtection({
    symbol: "SOLUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      position_state: "SCALE_OUT",
      position_side: "LONG",
      qty_base: 12,
      avg_price: 150,
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p0_done: false,
        tp_p1_done: true,
        trail_active: false,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P1_QTY: 1,
          TP_P1: 0.025,
          RUNNER_MIN_PROFIT_PCT: 0.025,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    externalPosition: { symbol: "SOLUSDT", positionAmt: "12" },
    openOrders: [],
    algoOrders: [],
  });
  assert.strictEqual(simplifiedRunner.stage, "PRE_TP1");
  assert.strictEqual(simplifiedRunner.canonical_stage, null);
  assert.ok(!simplifiedRunner.actionable_issue_codes.includes("TRAIL_STOP_MISSING"));
  assert.ok(!simplifiedRunner.actionable_issue_codes.includes("TRAIL_STOP_BELOW_RUNNER_FLOOR_LONG"));
  const trailing = __test.inspectExitProtection({
    symbol: "DOGEUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      position_state: "SCALE_OUT",
      position_side: "LONG",
      qty_base: 8182,
      avg_price: 0.09206,
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
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
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
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
  assert.ok(
    trailingFromObservation.actionable_issue_codes.includes("TRAIL_STOP_CHOSEN_SOURCE_MISMATCH"),
    "fresh trail observation must still flag a floor-only stop when R-stop is stronger"
  );

  const chosenSourceMismatch = __test.inspectExitProtection({
    symbol: "ETHUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.167,
      avg_price: 2258.08,
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
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
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
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
  assert.ok(
    guaranteeMiss.actionable_issue_codes.includes("TRAIL_STOP_CHOSEN_SOURCE_MISMATCH"),
    "stronger trail stop must not be masked by floor-only chosen source normalization"
  );

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
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
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
  assert.ok(materialGuaranteeMiss.actionable_issue_codes.includes("TRAIL_STOP_CHOSEN_SOURCE_MISMATCH"));

  const hardExitMissed = __test.inspectExitProtection({
    symbol: "ETHUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 0.167,
      avg_price: 2258.08,
      leverage: 2,
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: true,
        trail_high: 2387.46,
        entry_r_distance: 12.342241553682925,
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
        side: "LONG",
        runner_floor_stop: 2276.70916,
        computed_trail_stop: 2276.70916,
        trail_stop_by_r: 2380.0546550677905,
        chosen_stop_source: "RUNNER_FLOOR",
        chosen_stop_price: 2276.70916,
        native_stop_price: 2276.7,
        native_stop_order_id: "4000001083283507",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 300,
        source: "TICK_EXIT",
      },
    },
    externalPosition: {
      symbol: "ETHUSDT",
      positionAmt: "0.167",
      notional: "395.33556",
      markPrice: "2366.68",
    },
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
  assert.ok(hardExitMissed.actionable_issue_codes.includes("TRAIL_HARD_EXIT_MISSED"));

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
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
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
      simplified_exit_v2_enabled: false,
      meta: {
        simplified_exit_v2_enabled: false,
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

  const simplifiedTrail = __test.inspectExitProtection({
    symbol: "LINKUSDT",
    internalPosition: {
      exchange: "BINANCEFUT",
      symbol: "LINKUSDT",
      position_state: "ACTIVE",
      position_side: "LONG",
      qty_base: 50,
      avg_price: 20,
      leverage: 2,
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p0_done: false,
        tp_p1_done: true,
        trail_active: true,
        runner_remaining_qty_abs: 50,
        native_protection_refresh_status: "OK",
        exit_rules_override: {
          TP_P1_QTY: 0.5,
          TP_P1: 0.025,
          RUNNER_MIN_PROFIT_PCT: 0.025,
          TRAIL_R_MULTIPLE: 0.6,
          SL: -0.0165,
        },
      },
    },
    observation: {
      trail_observation: {
        runner_floor_stop: 20.5,
        computed_trail_stop: 20.5,
        trail_stop_by_r: 21.0,
        chosen_stop_source: "RUNNER_FLOOR",
        chosen_stop_price: 20.5,
        native_stop_price: 20.5,
        native_stop_order_id: "9001",
        native_refresh_status: "OK",
        runtime_eval_at_ms: 300,
        source: "TICK_EXIT",
      },
    },
    externalPosition: { symbol: "LINKUSDT", positionAmt: "50" },
    openOrders: [],
    algoOrders: [
      {
        symbol: "LINKUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        closePosition: true,
        stopPrice: "20.5",
        orderId: "9001",
      },
    ],
  });
  assert.strictEqual(simplifiedTrail.stage, "TP1");
  assert.ok(!simplifiedTrail.actionable_issue_codes.includes("TP1_DONE_WITHOUT_TP0_DONE"));

  console.log("BINANCE_ACTIVE_EXIT_WATCHDOG_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BINANCE_ACTIVE_EXIT_WATCHDOG_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
} finally {
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
}
