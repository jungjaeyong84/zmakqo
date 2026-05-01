"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-simplified-exit-v2-live-flow");

(async () => {
  assert.strictEqual(__test.isSimplifiedExitV2Position({ meta: { simplified_exit_v2_enabled: true } }), true);
  assert.strictEqual(__test.isSimplifiedExitV2Position({ meta: { simplified_exit_v2_enabled: false } }), false);

  assert.strictEqual(__test.normalizeFillStage("EXIT_TP_P1_2.5P"), "TP1");
  assert.strictEqual(__test.normalizeFillStage("EXIT_TRAIL"), "TRAIL");
  assert.deepStrictEqual(
    __test.parseTransitionEvents({
      canonical_transition_events: ["TP1_REACHED", "TRAIL_ACTIVE"],
      canonical_primary_transition_event: "TRAIL_ACTIVE",
    }),
    ["TP1_REACHED", "TRAIL_ACTIVATED"]
  );
  assert.deepStrictEqual(
    __test.parseTransitionEvents({
      payload: {
        canonicalTransitionEvents: ["TP1_REACHED"],
        canonicalTransitionEvent: "TRAIL_ACTIVE",
      },
    }),
    ["TP1_REACHED", "TRAIL_ACTIVATED"]
  );

  const payloadOnlyAlert = __test.summarizeAlertAuditRow({
    ts: "2026-04-17T00:00:21.000Z",
    payload: {
      symbol: "ETHUSDT",
      event: "EXIT_TP_P0_0.8P",
      sourceFillId: "fill-payload-1",
      canonicalTransitionEvents: ["TP1_REACHED"],
      title: "ETH TP1 payload",
    },
  });
  assert.strictEqual(payloadOnlyAlert.symbol, "ETHUSDT");
  assert.strictEqual(payloadOnlyAlert.source_fill_id, "fill-payload-1");
  assert.deepStrictEqual(payloadOnlyAlert.transitions, ["TP1_REACHED"]);

  const dedupedAlerts = __test.dedupeAlertRows([
    {
      ts: "2026-04-17T00:00:00.000Z",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P1_2.5P",
      source_fill_id: "fill-1",
      title: "eth tp1",
    },
    {
      ts: "2026-04-17T00:00:00.000Z",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P1_2.5P",
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
      native_refresh_status: "FAILED",
      native_tp_gap_age_ms: 20_000,
      native_tp_gap_escalated: true,
      tp0_meta_leak: false,
    },
    fills: [],
    alertAuditRows: [],
  });
  assert.ok(missingNativeTp.issues.some((issue) => issue.code === "V2_NATIVE_TP_MISSING_PRE_TP1"));
  assert.ok(missingNativeTp.issues.some((issue) => issue.code === "V2_NATIVE_TP_GAP_ESCALATED"));
  assert.strictEqual(missingNativeTp.native_tp_gap_escalated, true);

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

  const forbiddenTrailPartial = __test.collectSymbolFlow({
    symbol: "ETHUSDT",
    position: {
      symbol: "ETHUSDT",
      state: "OPEN",
      tp_p1_done: true,
      trail_active: true,
      native_tp_order_id: "tp-order-1",
      native_tp_status: "OK",
      native_tp_price: 2361.84,
      native_tp_qty_ratio: 0.5,
      tp0_meta_leak: false,
    },
    fills: [
      {
        symbol: "ETHUSDT",
        event: "EXIT_TRAIL",
        created_at: "2026-04-17T00:00:10.000Z",
        canonical_transition_events: ["TRAIL_PARTIAL"],
      },
    ],
    alertAuditRows: [],
  });
  assert.ok(forbiddenTrailPartial.issues.some((issue) => issue.code === "V2_FORBIDDEN_TRAIL_PARTIAL_TRANSITION"));

  const closedHistoricalTp1WithoutCurrentNativeTp = __test.collectSymbolFlow({
    symbol: "DOGEUSDT",
    position: {
      symbol: "DOGEUSDT",
      state: "FLAT",
      tp_p1_done: false,
      trail_active: false,
      native_tp_order_id: null,
      native_tp_status: null,
      native_tp_price: null,
      native_tp_qty_ratio: null,
      tp0_meta_leak: false,
    },
    fills: [
      {
        symbol: "DOGEUSDT",
        event: "EXIT_TP_P1_2.5P",
        created_at: "2026-04-17T00:00:10.000Z",
        canonical_transition_events: ["TP1_REACHED"],
      },
      {
        symbol: "DOGEUSDT",
        event: "EXIT_TRAIL",
        created_at: "2026-04-17T00:00:20.000Z",
        canonical_transition_events: ["TRAIL_ACTIVATED"],
      },
    ],
    alertAuditRows: [],
  });
  assert.deepStrictEqual(closedHistoricalTp1WithoutCurrentNativeTp.issues, []);
  assert.ok(closedHistoricalTp1WithoutCurrentNativeTp.observations.some((row) => (
    row.code === "V2_TP1_TRANSITION_CURRENT_NATIVE_TP_ABSENT"
    && row.actionable === false
  )));

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
          native_protection_refresh_at_ms: Date.now(),
          canonical_exit_stage: "TRAIL",
        },
      },
    ],
    fills: [
      {
        symbol: "ETHUSDT",
        exchange: "BINANCEFUT",
        event: "EXIT_TP_P1_2.5P",
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
        event: "EXIT_TP_P1_2.5P",
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
  assert.strictEqual(healthyReport.symbols[0].flow.native_tp_gap_age_ms, null);
  assert.ok(__test.FILL_SELECT_FIELDS.includes("canonical_transition_events"));
  assert.ok(__test.OUTBOX_SELECT_FIELDS.includes("payload"));
  assert.ok(__test.POSITION_SELECT_FIELDS.includes("meta"));

  console.log("SIMPLIFIED_EXIT_V2_LIVE_FLOW_TEST_OK");
})().catch((err) => {
  console.error("SIMPLIFIED_EXIT_V2_LIVE_FLOW_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
