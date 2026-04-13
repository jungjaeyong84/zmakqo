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
  assert.deepStrictEqual(targets, [
    "tp1-fill-1",
    "tp1-fill-2",
    "tp1-fill-3",
    "tp1-fill-4",
  ]);

  console.log("BACKFILL_BINANCE_ACTIVE_EXIT_STAGE_TEST_OK");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
