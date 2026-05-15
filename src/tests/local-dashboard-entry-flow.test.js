"use strict";

const assert = require("assert");

const { __test } = require("../server/localDashboardApp");

(() => {
  const recentEntries = __test.buildRecentEntryFlow([
    {
      signal_id: "sig-open",
      symbol: "BNBUSDT",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      entry_grade: "EARLY",
      status: "OPEN",
      created_at: "2026-05-12T00:10:00.000Z",
      signal_price: 660.06,
    },
    {
      signal_id: "sig-closed",
      symbol: "INJUSDT",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      entry_grade: "CORE",
      status: "OPEN",
      created_at: "2026-05-12T00:05:00.000Z",
      signal_price: 4.444,
    },
  ], [
    {
      signal_id: "sig-closed",
      symbol: "INJUSDT",
      status: "CLOSED",
      exit_event: "TP_HIT",
      closed_at: "2026-05-12T00:08:00.000Z",
    },
  ], 6);

  assert.strictEqual(recentEntries.length, 2);
  assert.strictEqual(recentEntries[0].signal_id, "sig-closed");
  assert.strictEqual(recentEntries[0].current_status, "CLOSED");
  assert.strictEqual(recentEntries[0].status_detail, "CLOSED · TP_HIT");
  assert.strictEqual(recentEntries[1].signal_id, "sig-open");
  assert.strictEqual(recentEntries[1].current_status, "OPEN");
})();

console.log("local-dashboard-entry-flow.test.js PASS");
