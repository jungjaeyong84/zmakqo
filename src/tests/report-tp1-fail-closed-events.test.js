"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-tp1-fail-closed-events");

(async () => {
  const nowMs = Date.parse("2026-04-17T03:00:00.000Z");
  const report = __test.summarizeTp1FailClosedRows([
    {
      ts: "2026-04-17T02:59:00.000Z",
      event: "tick_exit_tp1_native_gap_fail_closed",
      symbol: "ETHUSDT",
      tf: "15m",
      issue_codes: ["NATIVE_TP_MISSING", "TP1_NATIVE_GAP_STALE"],
      dispatch_ok: true,
    },
    {
      ts: "2026-04-17T02:58:00.000Z",
      event: "tick_exit_tp1_meta_sync_fail_closed",
      symbol: "ETHUSDT",
      tf: "15m",
      issue_codes: ["TP1_META_SYNC_MISSING"],
      dispatch_ok: false,
    },
    {
      ts: "2026-04-16T00:00:00.000Z",
      event: "tick_exit_tp1_meta_sync_fail_closed",
      symbol: "BTCUSDT",
      tf: "15m",
      issue_codes: ["TP1_META_SYNC_MISSING"],
      dispatch_ok: true,
    },
    {
      ts: "2026-04-17T02:57:00.000Z",
      event: "tick_exit_native_protection_refresh",
      symbol: "SOLUSDT",
      dispatch_ok: true,
    },
  ], { nowMs, lookbackHours: 24 });

  assert.strictEqual(report.total_fail_closed_n, 2);
  assert.strictEqual(report.tp1_native_gap_fail_closed_n, 1);
  assert.strictEqual(report.tp1_meta_sync_fail_closed_n, 1);
  assert.strictEqual(report.dispatch_fail_n, 1);
  assert.strictEqual(report.repeat_symbol_threshold, 2);
  assert.strictEqual(report.repeat_symbol_n, 1);
  assert.strictEqual(report.max_symbol_fail_closed_n, 2);
  assert.strictEqual(report.quarantine_candidate_n, 1);
  assert.strictEqual(report.top_symbols[0].symbol, "ETHUSDT");
  assert.strictEqual(report.top_symbols[0].count, 2);
  assert.strictEqual(report.repeat_symbols[0].symbol, "ETHUSDT");
  assert.strictEqual(report.repeat_symbols[0].count, 2);
  assert.strictEqual(report.quarantine_candidates[0].symbol, "ETHUSDT");
  assert.strictEqual(report.quarantine_candidates[0].severity, "MEDIUM");
  assert.strictEqual(report.recent_rows.length, 2);

  const noOverride = __test.buildLivePolicyQuarantineOverride(report, {});
  assert.strictEqual(noOverride.quarantine_market_n, 0);

  const markdown = __test.buildMarkdown(report);
  assert.ok(markdown.includes("total_fail_closed_n: 2"));
  assert.ok(markdown.includes("repeat_symbol_n: 1"));
  assert.ok(markdown.includes("quarantine_candidate_n: 1"));
  assert.ok(markdown.includes("Quarantine Candidates"));
  assert.ok(markdown.includes("ETHUSDT: 2"));

  const escalated = __test.summarizeTp1FailClosedRows([
    {
      ts: "2026-04-17T02:59:00.000Z",
      event: "tick_exit_tp1_native_gap_fail_closed",
      symbol: "XRPUSDT",
      dispatch_ok: true,
    },
    {
      ts: "2026-04-17T02:58:00.000Z",
      event: "tick_exit_tp1_meta_sync_fail_closed",
      symbol: "XRPUSDT",
      dispatch_ok: true,
    },
    {
      ts: "2026-04-17T02:57:00.000Z",
      event: "tick_exit_tp1_native_gap_fail_closed",
      symbol: "XRPUSDT",
      dispatch_ok: true,
    },
    {
      ts: "2026-04-17T02:56:00.000Z",
      event: "tick_exit_tp1_meta_sync_fail_closed",
      symbol: "XRPUSDT",
      dispatch_ok: true,
    },
  ], { nowMs, lookbackHours: 24 });
  const override = __test.buildLivePolicyQuarantineOverride(escalated);
  assert.strictEqual(override.quarantine_market_n, 1);
  assert.strictEqual(override.top_quarantine_market, "XRPUSDT");
  assert.strictEqual(override.by_market[0].quarantine_reason, "REPEATED_TP1_FAIL_CLOSED_ESCALATED");
  assert.strictEqual(override.by_market[0].source, "TP1_FAIL_CLOSED");
  assert.ok(String(override.by_market[0].tp1_fail_closed_report_path || "").endsWith("ops/daily/tp1_fail_closed_events_latest.json"));
  assert.ok(String(override.by_market[0].exit_integrity_report_path || "").endsWith("ops/daily/binance_exit_integrity_cycle_latest.json"));
  assert.strictEqual(override.by_market[0].release_ready, false);
  assert.ok(Array.isArray(override.by_market[0].release_blockers));

  const released = __test.buildLivePolicyQuarantineOverride({
    ...report,
    top_symbols: [],
    quarantine_candidates: [],
    quarantine_candidate_n: 0,
  }, {
    previousOverride: {
      summary: {
        by_market: [
          {
            market: "XRPUSDT",
            quarantine_reason: "REPEATED_TP1_FAIL_CLOSED_ESCALATED",
            quarantine_severity: "HIGH",
            source: "TP1_FAIL_CLOSED",
            trigger_count: 4,
            trigger_threshold: 2,
          },
        ],
      },
    },
    exitIntegritySummary: { summary: { tp1_meta_sync_gap_n: 0 } },
    tp1DrilldownReport: { symbols: [{ symbol: "XRPUSDT", tp1: { issues: [] } }] },
    liveFlowReport: { symbols: [{ symbol: "XRPUSDT", flow: { issues: [] } }] },
  });
  assert.strictEqual(released.quarantine_market_n, 0);
  assert.strictEqual(released.released_market_n, 1);
  assert.strictEqual(released.released_markets[0], "XRPUSDT");

  const held = __test.buildLivePolicyQuarantineOverride({
    ...report,
    top_symbols: [],
    quarantine_candidates: [],
    quarantine_candidate_n: 0,
  }, {
    previousOverride: {
      summary: {
        by_market: [
          {
            market: "XRPUSDT",
            quarantine_reason: "REPEATED_TP1_FAIL_CLOSED_ESCALATED",
            quarantine_severity: "HIGH",
            source: "TP1_FAIL_CLOSED",
            trigger_count: 4,
            trigger_threshold: 2,
          },
        ],
      },
    },
    exitIntegritySummary: { summary: { tp1_meta_sync_gap_n: 1 } },
    tp1DrilldownReport: { symbols: [{ symbol: "XRPUSDT", tp1: { issues: [{ code: "V2_TP1_ACK_WITHOUT_META_SYNC" }] } }] },
    liveFlowReport: { symbols: [{ symbol: "XRPUSDT", flow: { issues: [] } }] },
  });
  assert.strictEqual(held.quarantine_market_n, 1);
  assert.strictEqual(held.release_blocked_market_n, 1);
  assert.ok(held.by_market[0].release_blockers.includes("TP1_META_SYNC_GAP_ACTIVE"));
  assert.ok(held.by_market[0].release_blockers.includes("TP1_DRILLDOWN_ACTIONABLE"));
  const overrideMd = __test.buildOverrideMarkdown(held);
  assert.ok(overrideMd.includes("Active Quarantine Markets"));
  assert.ok(overrideMd.includes("Evidence Paths"));
  assert.ok(overrideMd.includes("XRPUSDT"));

  console.log("REPORT_TP1_FAIL_CLOSED_EVENTS_TEST_OK");
})().catch((err) => {
  console.error("REPORT_TP1_FAIL_CLOSED_EVENTS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
