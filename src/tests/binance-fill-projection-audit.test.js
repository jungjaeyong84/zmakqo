"use strict";

const assert = require("assert");
const { buildBinanceFillProjectionAudit, __test } = require("../services/binanceFillProjectionAudit");

(() => {
  assert.strictEqual(typeof buildBinanceFillProjectionAudit, "function", "buildBinanceFillProjectionAudit export missing");
  assert.strictEqual(typeof __test.isActivePosition, "function", "isActivePosition export missing");
  assert.strictEqual(typeof __test.fillMatchesCurrentEntry, "function", "fillMatchesCurrentEntry export missing");
  assert.strictEqual(__test.isActivePosition({ exchange: "BINANCEFUT", state: "ACTIVE", qty_base: 1 }), true);
  assert.strictEqual(__test.fillMatchesCurrentEntry(
    { entry_event_id: "CURR" },
    { entry_event_id: "CURR" }
  ), true);
  assert.strictEqual(__test.fillMatchesCurrentEntry(
    { entry_event_id: "OLD" },
    { entry_event_id: "CURR" }
  ), false);

  const nowMs = Date.parse("2026-04-10T03:00:00.000Z");
  const positions = [
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      state: "ACTIVE",
      qty_base: 100,
      meta: {
        tp_p0_done: false,
        tp_p1_done: false,
        trail_active: false,
        exchange_projection_in_sync: true,
        native_protection_refresh_status: "OK",
      },
    },
    {
      exchange: "BINANCEFUT",
      symbol: "AXSUSDT",
      state: "ACTIVE",
      qty_base: 10,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: false,
        exchange_projection_in_sync: false,
        native_protection_refresh_status: "MISSING",
      },
    },
  ];
  const fills = [
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P0_0.8P",
      created_at: "2026-04-10T02:58:00.000Z",
      entry_event_id: "DOGE_CURR",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "AXSUSDT",
      event: "EXIT_TP_P1_1.65P",
      created_at: "2026-04-10T02:40:00.000Z",
      entry_event_id: "AXS_CURR",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P1_1.65P",
      created_at: "2026-04-10T02:59:00.000Z",
      entry_event_id: "DOGE_OLD",
    },
  ];

  positions[0].meta.entry_event_id = "DOGE_CURR";
  positions[1].meta.entry_event_id = "AXS_CURR";

  const audit = buildBinanceFillProjectionAudit({ positions, fills, nowMs, tp1TrailGraceMs: 60 * 1000 });
  assert.strictEqual(audit.active_position_n, 2);
  assert.strictEqual(audit.recent_fill_n, 3);
  assert.strictEqual(audit.tp0_fill_projection_missing_n, 1);
  assert.strictEqual(audit.legacy_partial_tp_fill_projection_missing_n, 1);
  assert.strictEqual(audit.tp1_fill_projection_missing_n, 0);
  assert.strictEqual(audit.tp1_fill_trail_inactive_n, 1);
  assert.strictEqual(audit.projection_out_of_sync_n, 1);
  assert.strictEqual(audit.native_protection_not_ok_n, 1);
  assert.strictEqual(audit.issue_by_code.LEGACY_PARTIAL_TP_FILL_PROJECTION_MISSING, 1);
  assert.strictEqual(audit.issue_by_code.TP1_FILL_TRAIL_INACTIVE, 1);

  const freshFullTpAudit = buildBinanceFillProjectionAudit({
    positions: [{
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      state: "ACTIVE",
      qty_base: 1.42,
      meta: {
        entry_event_id: "SOL_CURR",
        tp_p1_done: false,
        trail_active: false,
        native_protection_refresh_status: "MISSING",
      },
    }],
    fills: [{
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      event: "EXIT_TP_P1_2.5P",
      created_at: "2026-04-10T02:59:30.000Z",
      entry_event_id: "SOL_CURR",
      canonical_transition_events: ["TP1_FULL_EXIT"],
    }],
    nowMs,
    tp1TrailGraceMs: 60 * 1000,
  });
  assert.strictEqual(freshFullTpAudit.issue_n, 0);
  assert.strictEqual(freshFullTpAudit.native_protection_not_ok_n, 0);
  assert.strictEqual(freshFullTpAudit.tp1_fill_projection_missing_n, 0);
  assert.strictEqual(freshFullTpAudit.tp1_fill_trail_inactive_n, 0);
  assert.strictEqual(
    freshFullTpAudit.tp_full_fill_projection_still_active_n,
    0,
    "fresh TP_FULL terminal fill must not be treated as stale projection before grace expires"
  );

  const staleFullTpAudit = buildBinanceFillProjectionAudit({
    positions: [{
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      state: "ACTIVE",
      qty_base: 1.42,
      meta: {
        entry_event_id: "SOL_CURR",
        tp_p1_done: false,
        trail_active: false,
        native_protection_refresh_status: "OK",
      },
    }],
    fills: [{
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      event: "EXIT_TP_P1_2.5P",
      created_at: "2026-04-10T02:50:00.000Z",
      entry_event_id: "SOL_CURR",
      extra: {
        canonical_transition_events: ["TP1_FULL_EXIT"],
      },
    }],
    nowMs,
    tp1TrailGraceMs: 60 * 1000,
  });
  assert.strictEqual(staleFullTpAudit.tp1_fill_projection_missing_n, 0);
  assert.strictEqual(staleFullTpAudit.tp1_fill_trail_inactive_n, 0);
  assert.strictEqual(staleFullTpAudit.tp_full_fill_projection_still_active_n, 1);
  assert.strictEqual(
    __test.isTerminalFullTpFill({
      event: "EXIT_TP_P1_2.5P",
      extra: { canonical_transition_events: ["TP1_FULL_EXIT"] },
    }),
    true
  );
  console.log("BINANCE_FILL_PROJECTION_AUDIT_TEST_OK");
})();
