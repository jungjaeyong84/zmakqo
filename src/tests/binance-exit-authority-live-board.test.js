"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-binance-exit-authority-live-board");

function run() {
  const buildLiveAuthorityBoard = __test && __test.buildLiveAuthorityBoard;
  const resolveAuthorityNativeProtection = __test && __test.resolveAuthorityNativeProtection;
  assert.strictEqual(typeof buildLiveAuthorityBoard, "function", "buildLiveAuthorityBoard export missing");
  assert.strictEqual(typeof resolveAuthorityNativeProtection, "function", "resolveAuthorityNativeProtection export missing");

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
          exit_rules_override: {
            TP_P1_QTY: 0.5,
            TRAIL_R_MULTIPLE: 0.6,
            RUNNER_MIN_PROFIT_PCT: 0.0165,
          },
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
  assert.ok(report.live_issue_rows.find((row) => row.symbol === "ETHUSDT").issues.some((issue) => issue.code === "NATIVE_REFRESH_UNHEALTHY"));

  const simplifiedV2Runner = buildLiveAuthorityBoard({
    positions: [
      {
        exchange: "BINANCEFUT",
        symbol: "SOLUSDT",
        position_state: "ACTIVE",
        position_side: "LONG",
        qty_base: 12,
        avg_price: 140,
        simplified_exit_v2_enabled: true,
        meta: {
          simplified_exit_v2_enabled: true,
          tp_p0_done: false,
          tp_p1_done: true,
          trail_active: false,
          native_protection_refresh_status: "FAILED",
        },
      },
    ],
  });
  assert.strictEqual(simplifiedV2Runner.rows[0].stage, "EXITED_TP1");
  assert.strictEqual(simplifiedV2Runner.rows[0].simplified_exit_v2_enabled, true);
  assert.ok(!simplifiedV2Runner.rows[0].issues.some((issue) => issue.code === "TP1_DONE_WITHOUT_TP0_DONE"));
  assert.ok(simplifiedV2Runner.rows[0].issues.some((issue) => issue.code === "TP1_FULL_EXIT_DONE_BUT_POSITION_ACTIVE"));

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
          native_protection_tp_order_id: "tp-order-1",
          native_protection_tp_qty_ratio: 1,
          native_protection_tp_qty_base: 0.028,
          native_protection_refresh_status: "OK",
        },
      },
    ],
    artifacts: {
      duplicationLiveRows: [{ symbol: "BTCUSDT" }],
    },
  });
  assert.strictEqual(artifactOnly.live_issue_position_n, 1);
  assert.strictEqual(artifactOnly.actionable_live_issue_position_n, 0);
  assert.strictEqual(artifactOnly.artifact_only_live_issue_position_n, 1);
  assert.strictEqual(artifactOnly.live_issue_rows[0].actionable_issue, false);
  assert.ok(artifactOnly.live_issue_rows[0].issues.some((issue) => issue.code === "FILL_SYNC_DUPLICATION_LIVE_ISSUE_ARTIFACT"));

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
          exit_rules_override: {
            TP_P1_QTY: 0.5,
            TRAIL_R_MULTIPLE: 0.6,
            RUNNER_MIN_PROFIT_PCT: 0.0165,
          },
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

  const metaPreferred = buildLiveAuthorityBoard({
    positions: [
      {
        exchange: "BINANCEFUT",
        symbol: "BNBUSDT",
        position_state: "ACTIVE",
        position_side: "LONG",
        qty_base: 1.57,
        avg_price: 632.53,
        leverage: 2,
        meta: {
          tp_p0_done: false,
          tp_p1_done: true,
          trail_active: true,
          exit_rules_override: {
            TP_P1_QTY: 0.5,
            TRAIL_R_MULTIPLE: 0.6,
            RUNNER_MIN_PROFIT_PCT: 0.0165,
          },
          native_protection_stop_price: 637.75,
          native_protection_stop_order_id: "4000001106791779",
          native_protection_refresh_status: "OK",
          chosen_stop_source: "RUNNER_FLOOR",
          chosen_stop_price: 637.7483725,
          trail_stop_by_r: 627.1659481104867,
        },
      },
    ],
    artifacts: {
      observationsBySymbol: {
        BNBUSDT: {
          trail_observation: {
            native_stop_price: 637.74,
            native_stop_order_id: "4000001106637302",
            native_refresh_status: "OK",
            runtime_eval_at_ms: 999999,
            source: "STALE_RUNTIME_OBSERVATION",
          },
        },
      },
    },
  });
  assert.strictEqual(metaPreferred.live_issue_position_n, 0);
  assert.strictEqual(metaPreferred.rows[0].native_stop_order_id, "4000001106791779");
  assert.strictEqual(metaPreferred.rows[0].native_stop_price, 637.75);
  assert.strictEqual(metaPreferred.rows[0].native_protection_state_source, "POSITION_META_NATIVE_PROTECTION");
  assert.ok(!metaPreferred.rows[0].issues.some((issue) => issue.code === "RUNNER_MIN_GUARANTEE_MISSED"));

  console.log("BINANCE_EXIT_AUTHORITY_LIVE_BOARD_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BINANCE_EXIT_AUTHORITY_LIVE_BOARD_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
