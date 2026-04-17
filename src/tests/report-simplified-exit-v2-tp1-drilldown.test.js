"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-simplified-exit-v2-tp1-drilldown");

(async () => {
  assert.strictEqual(__test.isTp1Event("EXIT_TP_P1_1.68P"), true);
  assert.strictEqual(__test.isTp1Event("EXIT_TRAIL"), false);
  assert.deepStrictEqual(
    __test.parseTransitionEvents({
      canonical_transition_events: ["TP1_REACHED", "TRAIL_ACTIVE"],
      canonical_primary_transition_event: "TP1_REACHED",
    }),
    ["TP1_REACHED", "TRAIL_ACTIVATED"]
  );

  const armedWithoutFill = __test.collectTp1Drilldown({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: true,
      tp_p1_pending: false,
      trail_active: false,
      canonical_exit_stage: "TP1",
      native_tp_order_id: "tp1-order-1",
      native_tp_status: "OK",
      native_tp_price: 2360,
      native_tp_qty_ratio: 0.5,
    },
    intents: [],
    fills: [],
    alertRows: [],
  });
  assert.ok(armedWithoutFill.issues.some((issue) => issue.code === "V2_TP1_STATE_WITHOUT_FILL"));

  const fillWithoutTransition = __test.collectTp1Drilldown({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: true,
      tp_p1_pending: false,
      trail_active: false,
      canonical_exit_stage: "TP1",
      native_tp_order_id: "tp1-order-1",
      native_tp_status: "OK",
      native_tp_price: 2360,
      native_tp_qty_ratio: 0.5,
    },
    intents: [],
    fills: [
      {
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_1.68P",
        created_at: "2026-04-17T00:00:00.000Z",
      },
    ],
    alertRows: [],
  });
  assert.ok(fillWithoutTransition.issues.some((issue) => issue.code === "V2_TP1_FILL_WITHOUT_TRANSITION"));

  const transitionWithoutAlert = __test.collectTp1Drilldown({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: true,
      tp_p1_pending: false,
      trail_active: true,
      canonical_exit_stage: "TRAIL",
      native_tp_order_id: "tp1-order-1",
      native_tp_status: "OK",
      native_tp_price: 2360,
      native_tp_qty_ratio: 0.5,
    },
    intents: [],
    fills: [
      {
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_1.68P",
        created_at: "2026-04-17T00:00:00.000Z",
        canonical_transition_events: ["TP1_REACHED"],
      },
    ],
    alertRows: [],
  });
  assert.ok(transitionWithoutAlert.issues.some((issue) => issue.code === "V2_TP1_TRANSITION_WITHOUT_ALERT"));

  const terminalIntentFailure = __test.collectTp1Drilldown({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: false,
      tp_p1_pending: true,
      trail_active: false,
      canonical_exit_stage: null,
      native_tp_order_id: null,
      native_tp_status: null,
      native_tp_price: null,
      native_tp_qty_ratio: null,
      native_refresh_status: "FAILED",
      native_tp_gap_age_ms: 20_000,
      native_tp_gap_escalated: true,
    },
    intents: [
      {
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_1.68P",
        status: "CANCELED",
        status_reason: "LIVE_EXCEPTION",
        created_at: "2026-04-17T00:01:00.000Z",
        live_submit_state: "FAILED",
      },
    ],
    fills: [],
    alertRows: [],
  });
  assert.ok(terminalIntentFailure.issues.some((issue) => issue.code === "V2_TP1_TERMINAL_INTENT_FAILURE"));
  assert.ok(terminalIntentFailure.issues.some((issue) => issue.code === "V2_TP1_NATIVE_GAP_ESCALATED"));

  const ackWithoutMetaSync = __test.collectTp1Drilldown({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: false,
      tp_p1_pending: true,
      trail_active: false,
      canonical_exit_stage: null,
      native_tp_order_id: null,
      native_tp_status: null,
      native_tp_price: null,
      native_tp_qty_ratio: null,
    },
    intents: [
      {
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_1.68P",
        status: "PENDING",
        created_at: "2026-04-17T00:02:00.000Z",
        live_submit_state: "ACKED",
        live_submit_ack_at_ms: Date.parse("2026-04-17T00:02:01.000Z"),
        live_submit_order_id: "tp1-order-3",
      },
    ],
    fills: [],
    alertRows: [],
  });
  assert.ok(ackWithoutMetaSync.issues.some((issue) => issue.code === "V2_TP1_ACK_WITHOUT_META_SYNC"));

  const healthy = __test.buildReport({
    positions: [
      {
        symbol: "ETHUSDT",
        exchange: "BINANCEFUT",
        state: "OPEN",
        updated_at: "2026-04-17T00:05:00.000Z",
        meta: {
          simplified_exit_v2_enabled: true,
          tp_p1_done: true,
          tp_p1_pending: false,
          trail_active: true,
          canonical_exit_stage: "TRAIL",
          native_protection_tp_order_id: "tp1-order-2",
          native_protection_tp_status: "OK",
          native_protection_tp_price: 2361.84,
          native_protection_tp_qty_ratio: 0.5,
          native_protection_refresh_status: "OK",
          native_protection_refresh_at_ms: Date.now(),
        },
      },
    ],
    intents: [
      {
        symbol: "ETHUSDT",
        exchange: "BINANCEFUT",
        event: "EXIT_TP_P1_1.68P",
        intent_id: "INTENT__ETH__TP1",
        status: "PENDING",
        created_at: "2026-04-17T00:00:10.000Z",
        live_submit_state: "ACKED",
        live_submit_ack_at_ms: Date.parse("2026-04-17T00:00:11.000Z"),
        live_submit_order_id: "tp1-order-2",
      },
    ],
    fills: [
      {
        symbol: "ETHUSDT",
        exchange: "BINANCEFUT",
        event: "EXIT_TP_P1_1.68P",
        fill_id: "fill-1",
        created_at: "2026-04-17T00:00:20.000Z",
        canonical_transition_events: ["TP1_REACHED"],
      },
    ],
    alertRows: [
      {
        ts: "2026-04-17T00:00:22.000Z",
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_1.68P",
        canonical_transition_events: ["TP1_REACHED"],
        title: "ETHUSDT TP1",
      },
    ],
  });

  assert.strictEqual(healthy.simplified_exit_v2_symbol_n, 1);
  assert.strictEqual(healthy.actionable_symbol_n, 0);
  assert.deepStrictEqual(healthy.issue_code_counts, {});
  assert.strictEqual(healthy.symbols[0].tp1.tp1_fill_n, 1);
  assert.strictEqual(healthy.symbols[0].tp1.tp1_alert_n, 1);
  assert.strictEqual(healthy.symbols[0].tp1.native_tp_gap_age_ms, null);
  assert.ok(__test.INTENT_SELECT_FIELDS.includes("live_submit_order_id"));
  assert.ok(__test.OUTBOX_SELECT_FIELDS.includes("created_at"));

  console.log("SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_TEST_OK");
})().catch((err) => {
  console.error("SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
