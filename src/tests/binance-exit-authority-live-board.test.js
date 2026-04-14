"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-binance-exit-authority-live-board");

function run() {
  const buildLiveAuthorityBoard = __test && __test.buildLiveAuthorityBoard;
  assert.strictEqual(typeof buildLiveAuthorityBoard, "function", "buildLiveAuthorityBoard export missing");

  const report = buildLiveAuthorityBoard({
    positions: [
      {
        exchange: "BINANCEFUT",
        symbol: "AXSUSDT",
        position_state: "ACTIVE",
        position_side: "SHORT",
        qty_base: 1399,
        avg_price: 1.065,
        updated_at: "2026-04-13T08:15:43.685Z",
        meta: {
          tp_p0_done: true,
          tp_p1_done: false,
          trail_active: false,
          native_protection_tp_qty_base: 300,
          native_protection_tp_qty_ratio: 0.2144,
          native_protection_refresh_status: "OK",
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        position_state: "ACTIVE",
        position_side: "LONG",
        qty_base: 0.9,
        avg_price: 2200,
        updated_at: "2026-04-13T08:15:43.685Z",
        meta: {
          tp_p0_done: false,
          tp_p1_done: true,
          trail_active: true,
          native_protection_stop_price: null,
          native_protection_stop_order_id: null,
          native_protection_refresh_status: "FAILED",
        },
      },
    ],
    artifacts: {
      nativeGapRows: [{ symbol: "ETHUSDT" }],
      exitQtyLiveRows: [{ symbol: "AXSUSDT" }],
      trailFloorLiveRows: [{ symbol: "ETHUSDT" }],
      duplicationLiveRows: [{ symbol: "AXSUSDT" }],
    },
  });

  assert.strictEqual(report.active_position_n, 2);
  assert.strictEqual(report.live_issue_position_n, 2);
  assert.strictEqual(report.actionable_live_issue_position_n, 2);
  assert.strictEqual(report.artifact_only_live_issue_position_n, 0);
  assert.deepStrictEqual(report.live_issue_symbols, ["AXSUSDT", "ETHUSDT"]);
  assert.ok(report.live_issue_rows.find((row) => row.symbol === "AXSUSDT").issues.some((issue) => issue.code === "TP1_REMAINING_RATIO_MISMATCH"));
  assert.ok(report.live_issue_rows.find((row) => row.symbol === "ETHUSDT").issues.some((issue) => issue.code === "TRAIL_STOP_MISSING"));
  assert.ok(report.live_issue_rows.find((row) => row.symbol === "ETHUSDT").issues.some((issue) => issue.code === "TP1_DONE_WITHOUT_TP0_DONE"));

  const artifactOnly = buildLiveAuthorityBoard({
    positions: [
      {
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        position_state: "ACTIVE",
        position_side: "SHORT",
        qty_base: 0.028,
        avg_price: 73600,
        meta: {
          tp_p0_done: false,
          tp_p1_done: false,
          trail_active: false,
          native_protection_refresh_status: "OK",
        },
      },
    ],
    artifacts: {
      duplicationLiveRows: [{ symbol: "BTCUSDT" }],
    },
  });
  assert.strictEqual(artifactOnly.live_issue_position_n, 1);
  assert.strictEqual(artifactOnly.actionable_live_issue_position_n, 1);
  assert.strictEqual(artifactOnly.artifact_only_live_issue_position_n, 0);
  assert.strictEqual(artifactOnly.live_issue_rows[0].actionable_issue, true);
  assert.ok(artifactOnly.live_issue_rows[0].issues.some((issue) => issue.code === "FILL_SYNC_DUPLICATION_LIVE_ISSUE"));

  const observationPreferred = buildLiveAuthorityBoard({
    positions: [
      {
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
          native_protection_stop_price: null,
          native_protection_stop_order_id: null,
          native_protection_refresh_status: "FAILED",
        },
      },
    ],
    artifacts: {
      observationsBySymbol: {
        ETHUSDT: {
          trail_observation: {
            native_stop_price: 2276.70916,
            native_stop_order_id: "4000001083283507",
            native_refresh_status: "OK",
            runtime_eval_at_ms: 123,
            source: "LIVE_STAGE_REPAIR",
          },
        },
      },
    },
  });
  assert.strictEqual(observationPreferred.live_issue_position_n, 0);
  assert.strictEqual(observationPreferred.actionable_live_issue_position_n, 0);
  assert.strictEqual(observationPreferred.rows[0].native_stop_order_id, "4000001083283507");
  assert.ok(!observationPreferred.rows[0].issues.some((issue) => issue.code === "TRAIL_STOP_MISSING"));

  console.log("BINANCE_EXIT_AUTHORITY_LIVE_BOARD_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BINANCE_EXIT_AUTHORITY_LIVE_BOARD_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
