"use strict";

const assert = require("assert");
const { backfillRecentEntryLineage, __test } = require("../utils/entryLineageBackfill");

function run() {
  assert.strictEqual(__test.resolvePositionSide({ event: "EXIT_TP_P0_0.8P", side: "BUY" }), "SHORT");
  assert.strictEqual(__test.resolvePositionSide({ event: "CORE_LONG", side: "BUY" }), "LONG");

  const rows = backfillRecentEntryLineage([
    {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "CORE_SHORT",
      side: "SELL",
      entry_event_id: "ENTRY__BINANCEFUT__ETHUSDT__15m__1000__CORE_SHORT",
      entry_signal_type: "CORE_SHORT",
      signal_bar_close_time_utc_ms: 1000,
      exec_bar_close_time_utc_ms: 1000,
      created_at: "2026-04-05T00:00:10.000Z",
      features_json: { entry_grade: "CORE", entry_qty_profile: "BASE" },
    },
    {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P0_0.8P",
      side: "BUY",
      entry_event_id: null,
      signal_bar_close_time_utc_ms: 1000,
      exec_bar_close_time_utc_ms: 1200,
      created_at: "2026-04-05T00:00:20.000Z",
      features_json: {},
    },
  ]);

  assert.strictEqual(rows[1].entry_event_id, "ENTRY__BINANCEFUT__ETHUSDT__15m__1000__CORE_SHORT");
  assert.strictEqual(rows[1].entry_signal_type, "CORE_SHORT");
  assert.strictEqual(rows[1].features_json.entry_event_id, "ENTRY__BINANCEFUT__ETHUSDT__15m__1000__CORE_SHORT");
}

try {
  run();
  console.log("ENTRY_LINEAGE_BACKFILL_TEST_OK");
} catch (err) {
  console.error("ENTRY_LINEAGE_BACKFILL_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
