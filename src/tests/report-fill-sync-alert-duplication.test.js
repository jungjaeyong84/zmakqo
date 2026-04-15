"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-fill-sync-alert-duplication");

function buildFillRow(fillId, createdAt) {
  return {
    fill_id: fillId,
    symbol: "AXSUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    side: "BUY",
    live_order_id: 14734759121,
    client_order_id: null,
    created_at: createdAt,
    notional: 100,
    realized_pnl: 0,
  };
}

function run() {
  assert.strictEqual(typeof __test.buildDuplicateGroups, "function", "buildDuplicateGroups export missing");
  assert.strictEqual(typeof __test.buildDuplicationReport, "function", "buildDuplicationReport export missing");

  const rows = [
    buildFillRow("fill-1", "2026-04-15T01:13:00.067Z"),
    buildFillRow("fill-2", "2026-04-15T01:13:00.067Z"),
  ];

  const suppressed = __test.buildDuplicateGroups(rows, [
    {
      type: "TRADE_EXECUTION_ALERT",
      ok: true,
      skipped: false,
      symbol: "AXSUSDT",
      event: "EXIT_EXTERNAL_SYNC",
      ts: "2026-04-15T01:14:33.935Z",
    },
  ]);
  assert.strictEqual(suppressed.duplicateGroups.length, 1);
  assert.strictEqual(suppressed.duplicateGroups[0].alert_send_n, 1);
  assert.strictEqual(suppressed.unresolvedDuplicateGroups.length, 0, "single sent alert must not block as duplicate");
  assert.strictEqual(suppressed.suppressedOrCollapsedGroups.length, 1, "split fills collapsed into one alert should remain informational");

  const duplicated = __test.buildDuplicateGroups(rows, [
    {
      type: "TRADE_EXECUTION_ALERT",
      ok: true,
      skipped: false,
      symbol: "AXSUSDT",
      event: "EXIT_EXTERNAL_SYNC",
      ts: "2026-04-15T01:14:00.000Z",
    },
    {
      type: "TRADE_EXECUTION_ALERT",
      ok: true,
      skipped: false,
      symbol: "AXSUSDT",
      event: "EXIT_EXTERNAL_SYNC",
      ts: "2026-04-15T01:14:10.000Z",
    },
  ]);
  assert.strictEqual(duplicated.unresolvedDuplicateGroups.length, 1, "multiple sent alerts for one duplicate fill group must stay blocking");

  const report = __test.buildDuplicationReport(rows, [
    {
      type: "TRADE_EXECUTION_ALERT",
      ok: true,
      skipped: false,
      symbol: "AXSUSDT",
      event: "EXIT_EXTERNAL_SYNC",
      ts: "2026-04-15T01:14:33.935Z",
    },
  ]);
  assert.strictEqual(report.duplicate_group_n, 0);
  assert.strictEqual(report.suppressed_or_collapsed_group_n, 1);

  console.log("REPORT_FILL_SYNC_ALERT_DUPLICATION_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("REPORT_FILL_SYNC_ALERT_DUPLICATION_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
