"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-binance-exit-qty-contract-audit");

function run() {
  assert.strictEqual(__test.classifyExitEvent("EXIT_TP_P0_0.8P"), "TP0");
  assert.strictEqual(__test.classifyExitEvent("EXIT_TP_P1_1.65P"), "TP1");
  assert.strictEqual(__test.classifyExitEvent("EXIT_TRAIL"), "TRAIL");
  assert.strictEqual(__test.classifyExitEvent("FORCE_EXIT_ALL"), "FORCE_EXIT_ALL");
  assert.strictEqual(__test.classifyExitEvent("EXIT_SL_1.65P"), "SL");

  const rows = [
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entry_event_id: "ENTRY_A",
      fill_id: "F1",
      event: "EXIT_TP_P0_0.8P",
      qty_pct: 0.25,
      created_at: "2026-04-12T00:00:00.000Z",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entry_event_id: "ENTRY_A",
      fill_id: "F2",
      event: "EXIT_TP_P1_1.65P",
      qty_pct: 0.375,
      created_at: "2026-04-12T00:01:00.000Z",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entry_event_id: "ENTRY_A",
      fill_id: "F3",
      event: "EXIT_TRAIL",
      qty_pct: 0.375,
      created_at: "2026-04-12T00:02:00.000Z",
    },
  ];
  const okReport = __test.buildReport(rows);
  assert.strictEqual(okReport.chain_count, 1);
  assert.strictEqual(okReport.issue_chain_count, 0);

  const badRows = [
    ...rows,
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entry_event_id: "ENTRY_B",
      fill_id: "F4",
      event: "EXIT_TP_P0_0.8P",
      qty_pct: 0.25,
      created_at: "2026-04-12T00:03:00.000Z",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entry_event_id: "ENTRY_B",
      fill_id: "F5",
      event: "EXIT_TP_P1_1.65P",
      qty_pct: 1.0,
      created_at: "2026-04-12T00:04:00.000Z",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entry_event_id: "ENTRY_C",
      fill_id: "F6",
      event: "FORCE_EXIT_ALL",
      qty_pct: 1.0,
      created_at: "2026-04-12T00:05:00.000Z",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entry_event_id: "ENTRY_C",
      fill_id: "F7",
      event: "EXIT_TRAIL",
      qty_pct: 1.0,
      created_at: "2026-04-12T00:06:00.000Z",
    },
  ];
  const report = __test.buildReport(badRows);
  assert.strictEqual(report.issue_chain_count, 2);
  const codes = new Set(report.issue_code_counts.map((row) => row.code));
  assert.ok(codes.has("TP1_ABS_OVER"));
  assert.ok(codes.has("TP_CHAIN_ABS_OVER"));
  assert.ok(codes.has("TOTAL_EXIT_OVER_100"));
  assert.ok(codes.has("FORCE_EXIT_WITH_STAGE_EXIT"));

  const authoritative = __test.buildAuthoritativeFillSet([
    {
      fill_id: "INT_1",
      stage: "TRAIL",
      live_order_id: "ORDER_1",
      exec_price: 100,
      created_at: "2026-04-12T00:00:00.000Z",
      source_kind: "INTERNAL",
      qty_pct: 1,
    },
    {
      fill_id: "EXT__1",
      stage: "TRAIL",
      live_order_id: "ORDER_1",
      exec_price: 100,
      created_at: "2026-04-12T00:00:01.000Z",
      source_kind: "EXTERNAL",
      qty_pct: 1,
    },
  ]);
  assert.strictEqual(authoritative.length, 1);
  assert.strictEqual(authoritative[0].fill_id, "EXT__1");
}

try {
  run();
  console.log("BINANCE_EXIT_QTY_CONTRACT_AUDIT_TEST_OK");
} catch (err) {
  console.error("BINANCE_EXIT_QTY_CONTRACT_AUDIT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
