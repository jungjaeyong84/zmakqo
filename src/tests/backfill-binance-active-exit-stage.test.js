"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/backfill-binance-active-exit-stage");

function buildPosition() {
  return {
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    state: "ACTIVE",
    qty_base: 699,
    meta: {
      entry_event_id: "ENTRY_EVT_AXS",
      entry_exec_bar_ms: 1776052840793,
      tp_p0_done: true,
      tp_p1_done: false,
      trail_active: false,
      exit_rules_override: {
        TP_P0_QTY: 0.25,
        TP_P1_QTY: 0.5,
        TP_P0: 0.008,
        TP_P1: 0.0165,
      },
    },
  };
}

function buildFill(fillId, event, qty, orderId, createdAt) {
  return {
    id: fillId,
    fill_id: fillId,
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    event,
    exec_qty_base: qty,
    external_order_id: orderId,
    created_at: createdAt,
    entry_event_id: "ENTRY_EVT_AXS",
    entry_exec_bar_ms: 1776052840793,
  };
}

async function main() {
  const fills = [
    buildFill("tp0-fill", "EXIT_TP_P0_0.8P", 465, 14728611403, "2026-04-13T04:51:07.067Z"),
    buildFill("tp1-fill-1", "EXIT_TP_P0_0.8P", 251, 14728630395, "2026-04-13T05:00:56.063Z"),
    buildFill("tp1-fill-2", "EXIT_TP_P0_0.8P", 111, 14728630395, "2026-04-13T05:00:56.063Z"),
    buildFill("tp1-fill-3", "EXIT_TP_P0_0.8P", 118, 14728630395, "2026-04-13T05:00:56.063Z"),
    buildFill("tp1-fill-4", "EXIT_TP_P0_0.8P", 218, 14728630395, "2026-04-13T05:00:56.063Z"),
  ];

  const summary = __test.buildStageSummary(buildPosition(), fills);
  assert(summary.issues.includes("LATEST_TP0_SHOULD_BE_TP1"));
  assert(summary.issues.includes("TP1_DONE_MISSING_BY_QTY"));
  assert(summary.issues.includes("TRAIL_ACTIVE_MISSING_BY_QTY"));

  const targets = __test.buildStageReclassificationTargets(summary);
  assert.deepStrictEqual(targets.map((row) => row.fill_id), ["tp1-fill-1", "tp1-fill-2", "tp1-fill-3", "tp1-fill-4"]);

  const btcLikePosition = {
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    state: "ACTIVE",
    position_side: "LONG",
    qty_base: 0.011,
    meta: {
      entry_event_id: "ENTRY_EVT_BTC",
      entry_exec_bar_ms: 1776075627000,
      tp_p0_done: false,
      tp_p1_done: true,
      trail_active: true,
      exit_rules_override: {
        TP_P0_QTY: 0.25,
        TP_P1_QTY: 0.5,
        TP_P0: 0.008,
        TP_P1: 0.0165,
      },
    },
  };
  const btcFills = [
    {
      id: "btc-tp1-mislabel",
      fill_id: "btc-tp1-mislabel",
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_TP_P1_1.65P",
      exec_qty_base: 0.007,
      external_order_id: "btc-order-tp1",
      created_at: "2026-04-13T13:49:25.045Z",
      entry_event_id: "ENTRY_EVT_BTC",
      entry_exec_bar_ms: 1776075627000,
      exec_price: 73745.6,
    },
    {
      id: "btc-trail",
      fill_id: "btc-trail",
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_TRAIL",
      exec_qty_base: 0.01,
      external_order_id: "btc-order-trail",
      created_at: "2026-04-13T13:50:07.038Z",
      entry_event_id: "ENTRY_EVT_BTC",
      entry_exec_bar_ms: 1776075627000,
      exec_price: 73623,
    },
  ];
  const btcSummary = __test.buildStageSummary(btcLikePosition, btcFills);
  assert.ok(btcSummary.issues.includes("TP1_DONE_WITHOUT_TP0_DONE"));
  const btcPlan = __test.buildStageReclassificationPlan(btcSummary);
  assert.deepStrictEqual(btcPlan.map((row) => ({ fill_id: row.fill_id, to_event: row.to_event })), [
    { fill_id: "btc-tp1-mislabel", to_event: "EXIT_TP_P0_0.8P" },
  ]);
  const repairedMeta = __test.buildReconciledMetaFromSummary(
    btcLikePosition,
    __test.buildStageSummary(btcLikePosition, __test.applyReclassificationPlanToFills(btcFills, btcPlan))
  );
  assert.strictEqual(repairedMeta.tp_p0_done, true);
  assert.strictEqual(repairedMeta.tp_p1_done, true);
  assert.strictEqual(repairedMeta.trail_active, true);
  assert.strictEqual(repairedMeta.canonical_exit_stage, "TRAIL");
  assert.strictEqual(repairedMeta.canonical_runner_remaining_abs, 0.011);

  const simplifiedV2Position = {
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    state: "ACTIVE",
    qty_base: 0.5,
    simplified_exit_v2_enabled: true,
    meta: {
      simplified_exit_v2_enabled: true,
      entry_event_id: "ENTRY_EVT_ETH",
      entry_exec_bar_ms: 1776075627000,
      tp_p0_done: false,
      tp_p1_done: true,
      trail_active: false,
      exit_rules_override: {
        TP_P1_QTY: 0.5,
        TP_P1: 0.0168,
      },
    },
  };
  const simplifiedV2Fills = [
    {
      id: "eth-v2-mislabel",
      fill_id: "eth-v2-mislabel",
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P0_0.8P",
      exec_qty_base: 0.5,
      external_order_id: "eth-v2-order",
      created_at: "2026-04-13T13:49:25.045Z",
      entry_event_id: "ENTRY_EVT_ETH",
      entry_exec_bar_ms: 1776075627000,
      exec_price: 2376.1,
    },
  ];
  const simplifiedV2Summary = __test.buildStageSummary(simplifiedV2Position, simplifiedV2Fills);
  assert.strictEqual(simplifiedV2Summary.simplified_exit_v2_enabled, true);
  assert.ok(!simplifiedV2Summary.issues.includes("TP1_DONE_WITHOUT_TP0_DONE"));
  assert.ok(simplifiedV2Summary.issues.includes("LATEST_TP0_SHOULD_BE_TP1"));
  const simplifiedV2Plan = __test.buildStageReclassificationPlan(simplifiedV2Summary);
  assert.deepStrictEqual(simplifiedV2Plan.map((row) => ({ fill_id: row.fill_id, to_event: row.to_event })), [
    { fill_id: "eth-v2-mislabel", to_event: "EXIT_TP_P1_1.68P" },
  ]);
  const simplifiedV2RepairedMeta = __test.buildReconciledMetaFromSummary(
    simplifiedV2Position,
    __test.buildStageSummary(simplifiedV2Position, __test.applyReclassificationPlanToFills(simplifiedV2Fills, simplifiedV2Plan))
  );
  assert.strictEqual(simplifiedV2RepairedMeta.tp_p0_done, false);
  assert.strictEqual(simplifiedV2RepairedMeta.tp_p1_done, true);
  assert.strictEqual(simplifiedV2RepairedMeta.trail_active, false);
  assert.strictEqual(simplifiedV2RepairedMeta.canonical_exit_stage, "TP1");
  assert.strictEqual(simplifiedV2RepairedMeta.canonical_runner_remaining_abs, 0.5);

  console.log("BACKFILL_BINANCE_ACTIVE_EXIT_STAGE_TEST_OK");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
