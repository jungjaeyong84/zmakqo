"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-simplified-exit-v2-live-flow");

(async () => {
  assert.strictEqual(__test.isSimplifiedExitV2Position({ meta: { simplified_exit_v2_enabled: true } }), true);
  assert.strictEqual(__test.isSimplifiedExitV2Position({ meta: { simplified_exit_v2_enabled: false } }), false);

  assert.strictEqual(__test.normalizeFillStage("EXIT_TP_P1_1.68P"), "TP1");
  assert.strictEqual(__test.normalizeFillStage("EXIT_TRAIL"), "TRAIL");
  assert.deepStrictEqual(
    __test.parseTransitionEvents({
      canonical_transition_events: ["TP1_REACHED", "TRAIL_ACTIVE"],
      canonical_primary_transition_event: "TRAIL_ACTIVE",
    }),
    ["TP1_REACHED", "TRAIL_ACTIVATED"]
  );

  const dedupedAlerts = __test.dedupeAlertRows([
    {
      ts: "2026-04-17T00:00:00.000Z",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P1_1.68P",
      source_fill_id: "fill-1",
      title: "eth tp1",
    },
    {
      ts: "2026-04-17T00:00:00.000Z",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P1_1.68P",
      source_fill_id: "fill-1",
      title: "eth tp1",
    },
  ]);
  assert.strictEqual(dedupedAlerts.length, 1);

  const missingNativeTp = __test.collectSymbolFlow({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: false,
      trail_active: false,
      native_tp_order_id: null,
      native_tp_status: null,
      native_tp_price: null,
      native_tp_qty_ratio: null,
      tp0_meta_leak: false,
    },
    fills: [],
    alertAuditRows: [],
  });
  assert.ok(missingNativeTp.issues.some((issue) => issue.code === "V2_NATIVE_TP_MISSING_PRE_TP1"));

  const trailWithoutTp1 = __test.collectSymbolFlow({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: false,
      trail_active: true,
      native_tp_order_id: "tp-order-1",
      native_tp_status: "OK",
      native_tp_price: 2361.84,
      native_tp_qty_ratio: 0.5,
      tp0_meta_leak: true,
    },
    fills: [
      {
        symbol: "ETHUSDT",
        event: "EXIT_TRAIL",
        created_at: "2026-04-17T00:00:10.000Z",
        canonical_transition_events: ["TRAIL_ACTIVE"],
      },
    ],
    alertAuditRows: [],
  });
  assert.ok(trailWithoutTp1.issues.some((issue) => issue.code === "V2_TRAIL_WITHOUT_TP1_TRANSITION"));
  assert.ok(trailWithoutTp1.issues.some((issue) => issue.code === "V2_TP0_NATIVE_META_LEAK"));

  const healthyReport = __test.buildReport({
    positions: [
      {
        symbol: "ETHUSDT",
        exchange: "BINANCEFUT",
        state: "OPEN",
        qty_base: 0.646,
        avg_price: 2320,
        updated_at: "2026-04-17T00:01:00.000Z",
        meta: {
          simplified_exit_v2_enabled: true,
          tp_p1_done: true,
          trail_active: true,
          native_protection_tp_order_id: "tp-order-2",
          native_protection_tp_status: "OK",
          native_protection_tp_price: 2358.98,
          native_protection_tp_qty_ratio: 0.5,
          native_protection_refresh_status: "OK",
          canonical_exit_stage: "TRAIL",
        },
      },
    ],
    fills: [
      {
        symbol: "ETHUSDT",
        exchange: "BINANCEFUT",
        event: "EXIT_TP_P1_1.68P",
        created_at: "2026-04-17T00:00:20.000Z",
        canonical_transition_events: ["TP1_REACHED"],
      },
      {
        symbol: "ETHUSDT",
        exchange: "BINANCEFUT",
        event: "EXIT_TRAIL",
        created_at: "2026-04-17T00:00:40.000Z",
        canonical_transition_events: ["TRAIL_ACTIVATED"],
      },
    ],
    alertAuditRows: [
      {
        ts: "2026-04-17T00:00:21.000Z",
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_1.68P",
        canonical_transition_events: ["TP1_REACHED"],
        title: "ETH TP1",
      },
    ],
  });

  assert.strictEqual(healthyReport.simplified_exit_v2_symbol_n, 1);
  assert.strictEqual(healthyReport.actionable_symbol_n, 0);
  assert.deepStrictEqual(healthyReport.issue_code_counts, {});
  assert.strictEqual(healthyReport.symbols[0].flow.tp1_fill_seen, true);
  assert.strictEqual(healthyReport.symbols[0].flow.trail_transition_seen, true);

  console.log("SIMPLIFIED_EXIT_V2_LIVE_FLOW_TEST_OK");
})().catch((err) => {
  console.error("SIMPLIFIED_EXIT_V2_LIVE_FLOW_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
