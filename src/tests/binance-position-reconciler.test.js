const assert = require("assert");
const { reconcileBinancePositionMetaWithExchange, __test } = require("../services/binancePositionReconciler");

const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;

async function run() {
  assert.strictEqual(typeof reconcileBinancePositionMetaWithExchange, "function", "reconcileBinancePositionMetaWithExchange export missing");

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const classifiedLong = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "105", origQty: "5" },
      { orderId: "tp0", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "102", origQty: "2.5" },
    ],
    positionSide: "LONG",
    qtyBase: 10,
    meta: {},
  });
  assert.strictEqual(classifiedLong.tp0.orderId, "tp0");
  assert.strictEqual(classifiedLong.tp1.orderId, "tp1");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.25), "TP0");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.5), "TP1");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.3), "TP0");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.375), "TP1");

  const classifiedShort = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp1", type: "TAKE_PROFIT_MARKET", side: "BUY", reduceOnly: true, stopPrice: "95", origQty: "5" },
      { orderId: "tp0", type: "TAKE_PROFIT_MARKET", side: "BUY", reduceOnly: true, stopPrice: "98", origQty: "2.5" },
    ],
    positionSide: "SHORT",
    qtyBase: 10,
    meta: {},
  });
  assert.strictEqual(classifiedShort.tp0.orderId, "tp0");
  assert.strictEqual(classifiedShort.tp1.orderId, "tp1");

  const classifiedWithStaleMeta = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "105", origQty: "5" },
      { orderId: "tp0", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "102", origQty: "2.5" },
    ],
    positionSide: "LONG",
    qtyBase: 10,
    meta: { tp_p1_done: true, trail_active: true },
  });
  assert.strictEqual(classifiedWithStaleMeta.tp0.orderId, "tp0");
  assert.strictEqual(classifiedWithStaleMeta.tp1.orderId, "tp1");

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const classifiedSimplifiedV2 = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp1-only", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "101.68", origQty: "5" },
    ],
    positionSide: "LONG",
    qtyBase: 10,
    meta: { simplified_exit_v2_enabled: true },
  });
  assert.strictEqual(classifiedSimplifiedV2.tp0, null);
  assert.strictEqual(classifiedSimplifiedV2.tp1.orderId, "tp1-only");
  assert.deepStrictEqual(classifiedSimplifiedV2.unexpectedTpOrders, []);

  const classifiedSimplifiedV2Multiple = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp-legacy-25", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "100.8", origQty: "2.5" },
      { orderId: "tp-v2-50", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "101.68", origQty: "5" },
    ],
    positionSide: "LONG",
    qtyBase: 10,
    meta: { simplified_exit_v2_enabled: true },
  });
  assert.strictEqual(classifiedSimplifiedV2Multiple.tp0, null);
  assert.strictEqual(classifiedSimplifiedV2Multiple.tp1.orderId, "tp-v2-50");
  assert.strictEqual(classifiedSimplifiedV2Multiple.unexpectedTpOrders.length, 1);
  assert.strictEqual(classifiedSimplifiedV2Multiple.unexpectedTpOrders[0].orderId, "tp-legacy-25");

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const trailPatch = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: true,
      trail_active: false,
      trail_high: 111,
      trail_high_at_ms: 200,
      tp_p1_bar_ms: 150,
      native_protection_tp0_order_id: "old-tp0",
      native_protection_tp_order_id: "old-tp1",
    },
    positionSide: "LONG",
    qtyBase: 12,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "109" },
      { orderId: "tp0-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "102", origQty: "3" },
      { orderId: "tp1-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "105", origQty: "6" },
    ],
  });
  assert.strictEqual(trailPatch.meta.native_protection_stop_order_id, "stop-1");
  assert.strictEqual(trailPatch.meta.native_protection_tp0_order_id, "tp0-1");
  assert.strictEqual(trailPatch.meta.native_protection_tp_order_id, "tp1-1");
  assert.strictEqual(trailPatch.meta.native_protection_tp0_qty_ratio, 0.25);
  assert.strictEqual(trailPatch.meta.native_protection_tp_qty_ratio, 0.5);
  assert.strictEqual(trailPatch.meta.trail_active, true);
  assert.ok(trailPatch.invariants.includes("TP1_DONE_WITH_TP_ORDER"));

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const tp1ContractRatioPatch = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      exit_rules_override: {
        TP_P0_QTY: 0.25,
        TP_P1_QTY: 0.5,
      },
    },
    positionSide: "LONG",
    qtyBase: 7.5,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "101.5" },
      { orderId: "tp1-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "103.25", origQty: "5" },
    ],
  });
  assert.strictEqual(tp1ContractRatioPatch.meta.native_protection_tp_qty_ratio, 0.5, "reconciler must preserve TP1 contract ratio, not current remaining ratio");

  const simplifiedV2Patch = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      simplified_exit_v2_enabled: true,
      tp_p0_done: true,
      tp_p0_price: 100.8,
      tp_p0_at: "2026-04-17T00:00:00.000Z",
      tp_p0_source: "LEGACY",
      exit_rules_override: {
        TP_P1_QTY: 0.5,
      },
    },
    positionSide: "LONG",
    qtyBase: 10,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "98.35" },
      { orderId: "tp1-armed", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "101.68", origQty: "5" },
    ],
  });
  assert.strictEqual(simplifiedV2Patch.meta.native_protection_tp0_order_id, null);
  assert.strictEqual(simplifiedV2Patch.meta.native_protection_tp_order_id, "tp1-armed");
  assert.strictEqual(simplifiedV2Patch.meta.native_protection_tp_qty_ratio, 0.5);
  assert.strictEqual(simplifiedV2Patch.meta.tp_p0_done, false);
  assert.strictEqual(simplifiedV2Patch.meta.tp_p0_price, null);
  assert.strictEqual(simplifiedV2Patch.meta.tp_p0_at, null);
  assert.strictEqual(simplifiedV2Patch.meta.tp_p0_source, null);
  assert.ok(!simplifiedV2Patch.invariants.includes("SIMPLIFIED_EXIT_V2_MULTIPLE_TP_ORDERS"));

  const simplifiedV2LegacyLeakPatch = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      simplified_exit_v2_enabled: true,
      exit_rules_override: {
        TP_P1_QTY: 0.5,
      },
    },
    positionSide: "LONG",
    qtyBase: 10,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "98.35" },
      { orderId: "tp-legacy-25", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "100.8", origQty: "2.5" },
      { orderId: "tp-v2-50", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "101.68", origQty: "5" },
    ],
  });
  assert.strictEqual(simplifiedV2LegacyLeakPatch.meta.native_protection_tp0_order_id, null);
  assert.strictEqual(simplifiedV2LegacyLeakPatch.meta.native_protection_tp_order_id, "tp-v2-50");
  assert.ok(simplifiedV2LegacyLeakPatch.invariants.includes("SIMPLIFIED_EXIT_V2_MULTIPLE_TP_ORDERS"));

  const simplifiedV2RecoveredRunner = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      simplified_exit_v2_enabled: true,
      tp_p1_done: false,
      trail_active: false,
      exit_rules_override: {
        TP_P1_QTY: 0.5,
        TP_P1: 0.0165,
        SL: -0.0165,
        TRAIL_PCT: 0.01,
        RUNNER_MIN_PROFIT_PCT: 0.0165,
      },
    },
    positionSide: "LONG",
    qtyBase: 1.57,
    previousQtyBase: 3.14,
    entryPrice: 632.53,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "627.31" },
    ],
  });
  assert.strictEqual(simplifiedV2RecoveredRunner.meta.tp_p1_done, true);
  assert.strictEqual(simplifiedV2RecoveredRunner.meta.trail_active, true);
  assert.strictEqual(simplifiedV2RecoveredRunner.meta.tp_p1_source, "EXCHANGE_QTY_REDUCTION_RECOVERY");
  assert.strictEqual(simplifiedV2RecoveredRunner.meta.entry_qty_abs, 3.14);
  assert.strictEqual(simplifiedV2RecoveredRunner.meta.runner_remaining_qty_abs, 1.57);
  assert.strictEqual(simplifiedV2RecoveredRunner.meta.tp_p1_consumed_qty_abs, 1.57);
  assert.strictEqual(simplifiedV2RecoveredRunner.meta.native_protection_tp_order_id, null);

  const simplifiedV2RecoveredRunnerFromPersistedEntry = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      simplified_exit_v2_enabled: true,
      entry_qty_abs: 3.14,
      entry_exec_bar_ms: 1776420023427,
      tp_p1_done: false,
      trail_active: false,
      exit_rules_override: {
        TP_P1_QTY: 0.5,
        TP_P1: 0.0165,
        SL: -0.0165,
        TRAIL_PCT: 0.01,
        RUNNER_MIN_PROFIT_PCT: 0.0165,
      },
    },
    positionSide: "LONG",
    qtyBase: 1.57,
    previousQtyBase: null,
    entryPrice: 632.53,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "627.31" },
    ],
  });
  assert.strictEqual(simplifiedV2RecoveredRunnerFromPersistedEntry.meta.tp_p1_done, true);
  assert.strictEqual(simplifiedV2RecoveredRunnerFromPersistedEntry.meta.trail_active, true);
  assert.strictEqual(simplifiedV2RecoveredRunnerFromPersistedEntry.meta.tp_p1_entry_exec_bar_ms, 1776420023427);

  const simplifiedV2NoFalseRunnerRecovery = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      simplified_exit_v2_enabled: true,
      tp_p1_done: false,
      trail_active: false,
      exit_rules_override: {
        TP_P1_QTY: 0.5,
        TP_P1: 0.0165,
        SL: -0.0165,
        TRAIL_PCT: 0.01,
        RUNNER_MIN_PROFIT_PCT: 0.0165,
      },
    },
    positionSide: "LONG",
    qtyBase: 2.1,
    previousQtyBase: 3.14,
    entryPrice: 632.53,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "627.31" },
    ],
  });
  assert.strictEqual(simplifiedV2NoFalseRunnerRecovery.meta.tp_p1_done, false);
  assert.strictEqual(simplifiedV2NoFalseRunnerRecovery.meta.trail_active, false);

  const staleTrail = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: true,
      trail_active: false,
      trail_high: 111,
      trail_high_at_ms: 100,
      tp_p1_bar_ms: 150,
    },
    positionSide: "LONG",
    qtyBase: 12,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "109" },
    ],
  });
  assert.strictEqual(staleTrail.meta.trail_active, false);
  assert.ok(staleTrail.invariants.includes("STALE_TRAIL_OBSERVATION"));

  const invalidTrail = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: false,
      trail_active: true,
    },
    positionSide: "LONG",
    qtyBase: 10,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [],
  });
  assert.strictEqual(invalidTrail.meta.trail_active, false);
  assert.ok(invalidTrail.invariants.includes("TRAIL_WITHOUT_TP1"));

  const flatProjection = reconcileBinancePositionMetaWithExchange({
    active: false,
    meta: {
      tp_p0_done: true,
      tp_p1_done: true,
      trail_active: true,
      native_protection_stop_order_id: "stop-old",
      canonical_exit_stage: "TRAIL",
      canonical_primary_transition_event: "TRAIL_ACTIVATED",
      entry_qty_abs: 0.86,
      tp_p0_consumed_qty_abs: 0.215,
      tp_p1_consumed_qty_abs: 0.3225,
      runner_remaining_qty_abs: 0.3225,
      contract_tp1_consumed_abs: 0.3225,
      tp_p1_bar_ms: 1776281411000,
    },
  });
  assert.strictEqual(flatProjection.meta.tp_p0_done, false);
  assert.strictEqual(flatProjection.meta.tp_p1_done, false);
  assert.strictEqual(flatProjection.meta.trail_active, false);
  assert.strictEqual(flatProjection.meta.native_protection_stop_order_id, null);
  assert.strictEqual(flatProjection.meta.canonical_exit_stage, null);
  assert.strictEqual(flatProjection.meta.canonical_primary_transition_event, null);
  assert.strictEqual(flatProjection.meta.entry_qty_abs, null);
  assert.strictEqual(flatProjection.meta.tp_p0_consumed_qty_abs, null);
  assert.strictEqual(flatProjection.meta.tp_p1_consumed_qty_abs, null);
  assert.strictEqual(flatProjection.meta.runner_remaining_qty_abs, null);
  assert.strictEqual(flatProjection.meta.contract_tp1_consumed_abs, null);
  assert.strictEqual(flatProjection.meta.tp_p1_bar_ms, null);

  // ── PR #12 same-class boundary-value regression for the
  // `recoverSimplifiedExitV2RunnerMetaFromQtyReduction` trail seed path.
  //
  // Bug:   `baseMeta.trail_low === null` → `Number(null) === 0` →
  //        `Number.isFinite(0) === true` → `Math.min(0, seedPrice) === 0`
  //        → SHORT trail_low gets seeded to 0 → PR #8's trail jam
  //        condition reproduced post-recovery.
  // Fix:   양수 finite 기존값만 valid 로 인정. 그 외 (null/0/NaN) 은
  //        seedPrice 로 새로 출발.
  //
  // NOTE: recoverSimplifiedExitV2RunnerMetaFromQtyReduction requires
  // simplified-exit-v2 enabled + tp_p1 not yet flagged + tp order absent
  // + stop order present + qty reduction pattern match. We stub the
  // minimum inputs here and only verify the trail watermark outputs.
  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";

  // SHORT recovery with `trail_low=null` (Firestore null field):
  //   previous behavior: trail_low seeded to 0 (bug)
  //   fixed behavior:    trail_low seeded to seedPrice (markPrice=200)
  const shortRecoveryNullTrail = __test.recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
    meta: {
      simplified_exit_v2_enabled: true,
      trail_low: null,
      exit_rules_override: {
        SL: 0.02, RUNNER_MIN_PROFIT_PCT: 0.01, TRAIL_PCT: 0.005,
        TP_P1: 0.01, TP_P0_QTY: 0.25, TP_P1_QTY: 0.5,
      },
      entry_qty_abs: 10,
    },
    positionSide: "SHORT",
    qtyBase: 5,
    previousQtyBase: 10,
    entryPrice: 200,
    currentMarkPrice: 198,
    stopOrder: { orderId: "stop-1", stopPrice: "204" },
    tpOrder: null,
    observedAtIso: new Date().toISOString(),
  });
  assert.ok(shortRecoveryNullTrail, "SHORT recovery should return a patch when all qty invariants match");
  assert.notStrictEqual(
    shortRecoveryNullTrail.meta.trail_low,
    0,
    "PR #12: trail_low=null must NOT seed as 0 (that was the SHORT trail-jam bug)"
  );
  assert.ok(
    Number.isFinite(shortRecoveryNullTrail.meta.trail_low) && shortRecoveryNullTrail.meta.trail_low > 0,
    `PR #12: trail_low must be positive finite (got ${shortRecoveryNullTrail.meta.trail_low})`
  );

  // SHORT recovery with stale `trail_low=0` (residual from pre-PR#10 writes):
  //   must also seed fresh from seedPrice, not preserve the stale 0.
  const shortRecoveryZeroTrail = __test.recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
    meta: {
      simplified_exit_v2_enabled: true,
      trail_low: 0,
      exit_rules_override: {
        SL: 0.02, RUNNER_MIN_PROFIT_PCT: 0.01, TRAIL_PCT: 0.005,
        TP_P1: 0.01, TP_P0_QTY: 0.25, TP_P1_QTY: 0.5,
      },
      entry_qty_abs: 10,
    },
    positionSide: "SHORT",
    qtyBase: 5,
    previousQtyBase: 10,
    entryPrice: 200,
    currentMarkPrice: 198,
    stopOrder: { orderId: "stop-1", stopPrice: "204" },
    tpOrder: null,
    observedAtIso: new Date().toISOString(),
  });
  assert.ok(shortRecoveryZeroTrail, "SHORT recovery with residual trail_low=0 must still return a patch");
  assert.ok(
    Number.isFinite(shortRecoveryZeroTrail.meta.trail_low) && shortRecoveryZeroTrail.meta.trail_low > 0,
    `PR #12: stale trail_low=0 must be replaced by seedPrice, not preserved (got ${shortRecoveryZeroTrail.meta.trail_low})`
  );

  // SHORT recovery with valid existing `trail_low` below seedPrice:
  //   must preserve Math.min semantic — pick the lower (tighter) of the
  //   two since SHORT watermark is trail_low.
  const shortRecoveryValidTightTrail = __test.recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
    meta: {
      simplified_exit_v2_enabled: true,
      trail_low: 150,
      exit_rules_override: {
        SL: 0.02, RUNNER_MIN_PROFIT_PCT: 0.01, TRAIL_PCT: 0.005,
        TP_P1: 0.01, TP_P0_QTY: 0.25, TP_P1_QTY: 0.5,
      },
      entry_qty_abs: 10,
    },
    positionSide: "SHORT",
    qtyBase: 5,
    previousQtyBase: 10,
    entryPrice: 200,
    currentMarkPrice: 198,
    stopOrder: { orderId: "stop-1", stopPrice: "204" },
    tpOrder: null,
    observedAtIso: new Date().toISOString(),
  });
  assert.ok(shortRecoveryValidTightTrail);
  assert.strictEqual(
    shortRecoveryValidTightTrail.meta.trail_low,
    150,
    "valid existing trail_low must be kept when it is tighter (lower) than seedPrice"
  );

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";

  console.log("BINANCE_POSITION_RECONCILER_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => {
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
});
