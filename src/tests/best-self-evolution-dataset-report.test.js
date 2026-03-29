"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-dataset");

function run() {
  assert.strictEqual(typeof __test.renderMarkdown, "function");

  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 20:00:00 KST",
    provider: "BINANCEFUT",
    tf: "15m",
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
      realized_n: 8,
      features_coverage_rate: 0.91,
      febt_coverage_rate: 0.83,
      avg_realized_ret_net: 0.014,
      avg_realized_pnl_quote: 1320,
      avg_hold_minutes: 47.5,
      by_source_row_type: [{ key: "EXECUTED", count: 10 }],
      by_market: [{ key: "BTCUSDT", count: 12 }],
      by_side: [{ key: "LONG", count: 13 }],
      by_event: [{ key: "CORE_LONG", count: 8 }],
      by_drop_stage: [{ key: "TIMING", count: 4 }],
      by_drop_reason: [{ key: "DROP_WAIT_ONE_BAR_TIMING", count: 4 }],
      by_fallback_reason: [{ key: "LEGACY_WAIT", count: 2 }],
    },
    rows: [
      {
        market: "BTCUSDT",
        tf: "15m",
        event: "CORE_LONG",
        source_row_type: "EXECUTED",
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
  assert.ok(markdown.includes("features 91.00% / FEBT 83.00%"));
  assert.ok(markdown.includes("BTCUSDT 15m CORE_LONG EXECUTED"));

  console.log("BEST_SELF_EVOLUTION_DATASET_REPORT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_DATASET_REPORT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
