"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-trade-execution-alert-cross-audit");

(async () => {
  assert.strictEqual(__test.normalizeComparableEvent("EXIT_TP_P0_0.8P_UNVERIFIED"), "EXIT_TP_P0_0.8P");
  assert.strictEqual(__test.normalizeComparableEvent("LONG"), "LONG");

  const matched = __test.pickMatchingAlert(
    {
      fill_id: "EXT__1",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P0_0.8P_UNVERIFIED",
      created_ms: Date.parse("2026-04-15T17:45:13.228Z"),
    },
    [{
      ts: "2026-04-15T17:45:49.140Z",
      symbol: "ETHUSDT",
      event: "EXIT_TP_P0_0.8P",
      source_fill_id: null,
      title: "ETHUSDT TP0_0.8 25% 청산",
    }]
  );
  assert.ok(matched, "unverified exit must match canonical alert event within window");

  const groupedMatch = __test.pickMatchingAlert(
    {
      fill_id: "EXT__GROUP_2",
      symbol: "AXSUSDT",
      event: "FORCE_EXIT_ALL",
      created_at: "2026-04-16T01:57:11.214Z",
      created_ms: Date.parse("2026-04-16T01:57:11.214Z"),
    },
    [{
      ts: "2026-04-16T02:14:50.303Z",
      symbol: "AXSUSDT",
      event: "FORCE_EXIT_ALL",
      source_fill_id: "EXT__GROUP_1",
      dedupe_key: "AXSUSDT|FORCE_EXIT_ALL|2026-04-16T01:57:11.214Z",
      title: "AXS force exit",
    }]
  );
  assert.ok(groupedMatch, "split exit fills must match grouped alert evidence via dedupe key");

  const report = __test.buildReport({
    coverageReady: true,
    fills: [
      {
        fill_id: "ENTRY_1",
        symbol: "BTCUSDT",
        event: "LONG",
        stage: "LONG",
        created_at: "2026-04-15T20:30:10.797Z",
        created_ms: Date.parse("2026-04-15T20:30:10.797Z"),
      },
      {
        fill_id: "EXIT_1",
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_1.65P",
        stage: "TP1",
        canonicalTransitionEvents: ["TP1_REACHED"],
        created_at: "2026-04-15T19:30:13.408Z",
        created_ms: Date.parse("2026-04-15T19:30:13.408Z"),
      },
      {
        fill_id: "EXIT_2",
        symbol: "ETHUSDT",
        event: "EXIT_TRAIL_UNVERIFIED",
        stage: "TRAIL",
        created_at: "2026-04-15T19:30:13.408Z",
        created_ms: Date.parse("2026-04-15T19:30:13.408Z"),
      },
    ],
    alertAuditRows: [],
    telegramTradeRows: [],
    auditWindowStartIso: "2026-04-15T17:45:00.000Z",
  });

  assert.strictEqual(report.missing_alert_fill_n, 3);
  assert.strictEqual(report.missing_verified_exit_alert_fill_n, 1);
  assert.strictEqual(report.missing_non_actionable_alert_fill_n, 2);
  assert.strictEqual(report.missing_entry_alert_fill_n, 1);
  assert.strictEqual(report.missing_unverified_alert_fill_n, 1);
  assert.strictEqual(report.actionable_issues.length, 1);

  assert.strictEqual(
    __test.isActionableVerifiedExitFill({
      event: "EXIT_TP_P0_0.8P",
      stage: "TP0",
      canonicalTransitionEvents: [],
    }),
    false,
    "verified raw TP fills without canonical transitions must not be actionable"
  );

  const deduped = __test.dedupeAlertAuditRows([
    {
      ts: "2026-04-16T01:57:20.000Z",
      symbol: "AXSUSDT",
      event: "FORCE_EXIT_ALL",
      source_fill_id: "EXT__1",
      title: "AXS force exit",
      source: "trade_execution_alert_audit",
    },
    {
      ts: "2026-04-16T01:57:20.000Z",
      symbol: "AXSUSDT",
      event: "FORCE_EXIT_ALL",
      source_fill_id: "EXT__1",
      title: "AXS force exit",
      source: "trade_execution_alert_audit",
    },
  ]);
  assert.strictEqual(deduped.length, 1);

  console.log("TRADE_EXECUTION_ALERT_CROSS_AUDIT_TEST_OK");
})().catch((err) => {
  console.error("TRADE_EXECUTION_ALERT_CROSS_AUDIT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
