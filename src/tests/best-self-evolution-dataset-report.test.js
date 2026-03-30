"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-dataset");

function run() {
  assert.strictEqual(typeof __test.renderMarkdown, "function");
  assert.strictEqual(typeof __test.resolveDatasetWindow, "function");

  const rolling = __test.resolveDatasetWindow({
    nowMs: Date.parse("2026-03-29T12:00:00.000Z"),
    weeklyRange: {
      from_ms: Date.parse("2026-03-21T15:00:00.000Z"),
      to_ms: Date.parse("2026-03-28T15:00:00.000Z"),
    },
    windowDays: 7,
    staleRangeMaxAgeMs: 6 * 60 * 60 * 1000,
  });
  assert.strictEqual(rolling.source, "ROLLING_FALLBACK_STALE_WEEKLY_RANGE");
  assert.strictEqual(rolling.toMs, Date.parse("2026-03-29T12:00:00.000Z"));

  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 20:00:00 KST",
    provider: "BINANCEFUT",
    tf: "15m",
    window_source: "ROLLING_FALLBACK_STALE_WEEKLY_RANGE",
    window: {
      from_utc: "2026-03-22T00:00:00.000Z",
      to_utc: "2026-03-29T00:00:00.000Z",
    },
    summary: {
      rows_n: 24,
      executed_n: 10,
      drop_n: 7,
      missed_n: 3,
      fallback_n: 2,
      rejected_n: 1,
      partial_n: 1,
      exit_only_n: 1,
      realized_n: 8,
      all_realized_n: 9,
      entry_pending_total_n: 4,
      entry_executed_null_realized_n: 2,
      entry_fallback_pending_n: 2,
      entry_exit_present_unlabeled_n: 1,
      entry_open_pending_n: 1,
      entry_link_missing_n: 0,
      executed_exit_only_n: 1,
      features_coverage_rate: 0.91,
      febt_coverage_rate: 0.83,
      febt_eligible_n: 12,
      febt_coverage_rate_eligible: 0.92,
      entry_fallback_pending_by_reason: [{ key: "PAYLOAD_MISSING", count: 2 }],
      entry_fallback_pending_by_market: [{ key: "BTCUSDT", count: 1 }, { key: "ETHUSDT", count: 1 }],
      entry_fallback_pending_by_event: [{ key: "CORE_LONG", count: 2 }],
      febt_eligible_by_market: [{ key: "BTCUSDT", eligible_n: 10, with_febt_n: 8, coverage_rate: 0.8 }],
      febt_eligible_by_event: [{ key: "CORE_LONG", eligible_n: 8, with_febt_n: 6, coverage_rate: 0.75 }],
      avg_realized_ret_net: 0.014,
      avg_realized_pnl_quote: 1320,
      avg_hold_minutes: 47.5,
      exit_only_realized_n: 1,
      by_source_row_type: [{ key: "EXECUTED", count: 10 }],
      by_market: [{ key: "BTCUSDT", count: 12 }],
      by_side: [{ key: "LONG", count: 13 }],
      by_event: [{ key: "CORE_LONG", count: 8 }],
      by_outcome_state: [{ key: "REALIZED", count: 8 }, { key: "OPEN_PENDING", count: 2 }],
      by_drop_stage: [{ key: "TIMING", count: 4 }],
      by_drop_reason: [{ key: "DROP_WAIT_ONE_BAR_TIMING", count: 4 }],
      by_fallback_reason: [{ key: "LEGACY_WAIT", count: 2 }],
      realized_source_counts: [{ key: "EXIT_FILL_PNL", count: 6 }, { key: "TRADE_PNL", count: 2 }],
      exit_only_by_event: [{ key: "EXIT_TRAIL_1P", count: 1 }],
      exit_only_by_outcome_state: [{ key: "REALIZED", count: 1 }],
      exit_only_realized_source_counts: [{ key: "EXIT_FILL_PNL", count: 1 }],
    },
    rows: [
      {
        market: "BTCUSDT",
        tf: "15m",
        event: "CORE_LONG",
        source_row_type: "EXECUTED",
        outcome_state: "REALIZED",
        drop_stage_key: null,
        febt_phase: "FIRE",
        realized_ret_net: 0.014,
        realized_pnl_quote: 500,
      },
    ],
  });

  assert.ok(markdown.includes("BEST Self-Evolution Dataset"));
  assert.ok(markdown.includes("rows: 24"));
  assert.ok(markdown.includes("executed/drop/missed: 10 / 7 / 3"));
  assert.ok(markdown.includes("window_source: ROLLING_FALLBACK_STALE_WEEKLY_RANGE"));
  assert.ok(markdown.includes("realized_n: 8 / all_realized_n: 9 / features 91.00% / FEBT all 83.00% / eligible 92.00% (12)"));
  assert.ok(markdown.includes("entry_pending_total_n: 4 / executed_null_realized 2 / fallback_pending 2 / exit_present_unlabeled 1 / open_pending 1 / link_missing 0"));
  assert.ok(markdown.includes("executed_exit_only_n: 1 / exit_only_n: 1 / exit_only_realized_n: 1"));
  assert.ok(markdown.includes("fallback_pending_reason: PAYLOAD_MISSING 2"));
  assert.ok(markdown.includes("fallback_pending_market: BTCUSDT 1 / ETHUSDT 1 / event: CORE_LONG 2"));
  assert.ok(markdown.includes("FEBT eligible coverage by market: BTCUSDT 8/10 (80.00%)"));
  assert.ok(markdown.includes("FEBT eligible coverage by event: CORE_LONG 6/8 (75.00%)"));
  assert.ok(markdown.includes("outcome_state: REALIZED 8 / OPEN_PENDING 2"));
  assert.ok(markdown.includes("realized_source: EXIT_FILL_PNL 6 / TRADE_PNL 2"));
  assert.ok(markdown.includes("exit_only_event: EXIT_TRAIL_1P 1"));
  assert.ok(markdown.includes("BTCUSDT 15m CORE_LONG EXECUTED"));

  console.log("BEST_SELF_EVOLUTION_DATASET_REPORT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_DATASET_REPORT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
