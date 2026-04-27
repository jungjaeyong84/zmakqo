"use strict";

const assert = require("assert");
const { buildInitialProtectionPlan } = require("../v2/protectionModel");
const {
  buildV2EntryBootstrap,
  buildProtectedActivePositionCycleDoc,
} = require("../v2/entryBootstrap");

(function longProtectionPlanIsSymmetric() {
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
  });
  assert.strictEqual(plan.close_side, "SELL");
  assert.strictEqual(plan.tp1_qty_abs, 0.5);
  assert.strictEqual(plan.runner_remaining_qty_abs, 0.5);
  assert.strictEqual(plan.sl_trigger_price, 1967);
  assert.strictEqual(plan.tp1_trigger_price, 2050);
})();

(function shortProtectionPlanIsSymmetric() {
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "SHORT",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
  });
  assert.strictEqual(plan.close_side, "BUY");
  assert.strictEqual(plan.sl_trigger_price, 2033);
  assert.strictEqual(plan.tp1_trigger_price, 1950);
})();

(function entryBootstrapSeedsCycleProjectionAndProtection() {
  const bootstrap = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__1",
    entryOrderId: "ORDER__BTC__1",
    entryFillGroupId: "FILL_GROUP__BTC__1",
    entryIntentId: "EINTV2__btc",
    signalIntentId: "SIGINTV2__btc",
    openclawDecisionId: "OCDV2__btc",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.02,
  });
  assert.ok(bootstrap.positionCycle.position_cycle_id);
  assert.strictEqual(bootstrap.projection.stage, "PRE_TP1");
  assert.strictEqual(bootstrap.projection.tp1_done, false);
  assert.strictEqual(bootstrap.projection.trail_active, false);
  assert.strictEqual(bootstrap.projection.chosen_stop_source, "SL");
  assert.strictEqual(bootstrap.projection.tp1_target_price, bootstrap.protectionPlan.tp1_trigger_price);
  assert.deepStrictEqual(
    Object.keys(bootstrap.protectionPlan).sort(),
    [
      "close_side",
      "entry_price",
      "entry_qty_abs",
      "entry_r_distance",
      "exchange",
      "initial_stop_price",
      "position_side",
      "runner_remaining_qty_abs",
      "sl_trigger_price",
      "stop_loss_pct",
      "symbol",
      "tp1_qty_abs",
      "tp1_qty_ratio",
      "tp1_target_pct",
      "tp1_trigger_price",
    ].sort()
  );
  assert.strictEqual(bootstrap.positionCycle.entry_intent_id, "EINTV2__btc");
  assert.strictEqual(bootstrap.positionCycle.signal_intent_id, "SIGINTV2__btc");
  assert.strictEqual(bootstrap.positionCycle.openclaw_decision_id, "OCDV2__btc");
  assert.strictEqual(bootstrap.positionCycle.status, "PROTECTION_PENDING");
})();

(function protectedActivationRequiresHealthySlAndTp1Runtime() {
  const bootstrap = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__2",
    entryOrderId: "ORDER__BTC__2",
    entryFillGroupId: "FILL_GROUP__BTC__2",
    entryIntentId: "EINTV2__btc2",
    signalIntentId: "SIGINTV2__btc2",
    openclawDecisionId: "OCDV2__btc2",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.02,
  });
  const activated = buildProtectedActivePositionCycleDoc({
    positionCycle: bootstrap.positionCycle,
    protectionWriteResult: {
      runtimeDoc: {
        protection_runtime_id: `PRTV2__${bootstrap.positionCycle.position_cycle_id}`,
        position_cycle_id: bootstrap.positionCycle.position_cycle_id,
        health_status: "HEALTHY",
        sl_order_id: "STOP__BTC__2",
        tp1_order_id: "TP1__BTC__2",
        last_refresh_at: "2026-04-21T02:00:00.000Z",
      },
      writeDecision: {
        ok: true,
      },
    },
  });
  assert.strictEqual(activated.status, "ACTIVE_PROTECTED");
  assert.strictEqual(activated.protection_activated_at, "2026-04-21T02:00:00.000Z");
  assert.strictEqual(activated.native_protection_health_status, "HEALTHY");
})();

(function protectedActivationRejectsTp1MissingRuntime() {
  const bootstrap = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__BROKEN",
    entryOrderId: "ORDER__ETH__BROKEN",
    entryFillGroupId: "FILL_GROUP__ETH__BROKEN",
    entryIntentId: "EINTV2__eth_broken",
    signalIntentId: "SIGINTV2__eth_broken",
    openclawDecisionId: "OCDV2__eth_broken",
    positionSide: "LONG",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
  let err = null;
  try {
    buildProtectedActivePositionCycleDoc({
      positionCycle: bootstrap.positionCycle,
      protectionWriteResult: {
        runtimeDoc: {
          protection_runtime_id: `PRTV2__${bootstrap.positionCycle.position_cycle_id}`,
          position_cycle_id: bootstrap.positionCycle.position_cycle_id,
          health_status: "DEGRADED_REPAIRABLE",
          sl_order_id: "STOP__ETH__BROKEN",
          tp1_order_id: null,
        },
        writeDecision: {
          ok: false,
        },
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_PROTECTION_NOT_READY");
})();

console.log("V2_ENTRY_BOOTSTRAP_TEST_OK");
