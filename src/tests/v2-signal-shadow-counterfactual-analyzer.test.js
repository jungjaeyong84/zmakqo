"use strict";

const assert = require("assert");
const analyzer = require("../v2/signalShadowCounterfactualAnalyzer");

function rec({
  status = "CLOSED",
  bar_n_observed = 24,
  mfe_pct = 0.01,
  mae_pct = 0.005,
  exit_close_pct = -0.002,
  would_block = [],
  would_pass = [],
  insufficient = [],
} = {}) {
  return {
    status,
    bar_n_observed,
    mfe_pct,
    mae_pct,
    exit_close_pct,
    would_block_filter_set: would_block,
    would_pass_filter_set: would_pass,
    insufficient_evidence_filter_set: insufficient,
  };
}

(function exportsPresent() {
  for (const key of [
    "REQUIRED_FILTER_IDS",
    "STATUS_CLOSED",
    "isClosedWithKlines",
    "summarizeNumericArray",
    "buildPerFilterSummary",
    "buildLeaveOneOutSummary",
    "buildFilterCombinationSummary",
    "buildAnalyzerReport",
    "loadCounterfactualRecords",
  ]) {
    assert.ok(analyzer[key] !== undefined, `MISSING_EXPORT:${key}`);
  }
})();

(function isClosedWithKlinesGuard() {
  assert.strictEqual(analyzer.isClosedWithKlines(rec()), true);
  assert.strictEqual(analyzer.isClosedWithKlines(rec({ status: "PENDING" })), false);
  assert.strictEqual(analyzer.isClosedWithKlines(rec({ status: "EXPIRED" })), false);
  assert.strictEqual(analyzer.isClosedWithKlines(rec({ bar_n_observed: 0 })), false);
  assert.strictEqual(analyzer.isClosedWithKlines(rec({ mfe_pct: null })), false);
  assert.strictEqual(analyzer.isClosedWithKlines(null), false);
})();

(function summarizeNumericArrayBasics() {
  const empty = analyzer.summarizeNumericArray([]);
  assert.strictEqual(empty.n, 0);
  assert.strictEqual(empty.mean, null);
  const single = analyzer.summarizeNumericArray([0.1]);
  assert.strictEqual(single.n, 1);
  assert.strictEqual(single.mean, 0.1);
  assert.strictEqual(single.median, 0.1);
  const arr = analyzer.summarizeNumericArray([1, 2, 3, 4, 5]);
  assert.strictEqual(arr.n, 5);
  assert.strictEqual(arr.mean, 3);
  assert.strictEqual(arr.median, 3);
  assert.strictEqual(arr.min, 1);
  assert.strictEqual(arr.max, 5);
})();

(function perFilterSummaryComputesPnlDrag() {
  const records = [
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: -0.02 }),
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: -0.01 }),
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: 0.005 }),
    rec({ would_pass: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: 0.015 }),
  ];
  const summary = analyzer.buildPerFilterSummary({
    filterId: "BTC_1H_TREND_ALT_LONG",
    records,
  });
  assert.strictEqual(summary.would_block_n, 3);
  assert.strictEqual(summary.would_pass_n, 1);
  assert.strictEqual(summary.blocked_closed_n, 3);
  assert.strictEqual(summary.true_negative_n, 2, "NEGATIVE_OR_ZERO_EXIT_COUNTS");
  assert.strictEqual(summary.false_block_n, 1);
  assert.ok(Math.abs(summary.precision_proxy - (2 / 3)) < 1e-9);
  const expectedMean = (-0.02 + -0.01 + 0.005) / 3;
  assert.ok(Math.abs(summary.blocked_exit_close_pct.mean - expectedMean) < 1e-9);
  assert.ok(Math.abs(summary.pnl_drag_proxy_r - (-expectedMean)) < 1e-9, "DRAG_IS_NEG_MEAN");
})();

(function leaveOneOutSeparatesSoleVsCoBlocker() {
  const records = [
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: -0.03 }),
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: -0.01 }),
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG", "MULTI_TF_1H_ALIGNMENT"], exit_close_pct: -0.05 }),
  ];
  const out = analyzer.buildLeaveOneOutSummary({
    filterId: "BTC_1H_TREND_ALT_LONG",
    records,
  });
  assert.strictEqual(out.sole_blocker_n, 2);
  assert.strictEqual(out.co_blocker_n, 1);
  assert.strictEqual(out.sole_blocker_closed_n, 2);
  assert.ok(Math.abs(out.sole_blocker_exit_close_pct.mean - (-0.02)) < 1e-9);
  assert.ok(Math.abs(out.co_blocker_exit_close_pct.mean - (-0.05)) < 1e-9);
  assert.ok(Math.abs(out.sole_blocker_pnl_drag_proxy_r - 0.02) < 1e-9);
})();

(function filterCombinationSummaryGroups() {
  const records = [
    rec({ would_block: ["A"], exit_close_pct: -0.01 }),
    rec({ would_block: ["A"], exit_close_pct: -0.02 }),
    rec({ would_block: ["A", "B"], exit_close_pct: -0.05 }),
    rec({ would_block: [], exit_close_pct: 0.01 }),
  ];
  const out = analyzer.buildFilterCombinationSummary({ records });
  const aOnly = out.find((r) => r.block_set.length === 1 && r.block_set[0] === "A");
  assert.ok(aOnly && aOnly.n === 2, "A_ONLY_BUCKET");
  const aAndB = out.find((r) => r.block_set.length === 2 && r.block_set.includes("A") && r.block_set.includes("B"));
  assert.ok(aAndB && aAndB.n === 1, "A_AND_B_BUCKET");
  const noneBucket = out.find((r) => r.block_set.length === 0);
  assert.ok(noneBucket && noneBucket.n === 1, "NONE_BUCKET");
})();

(function reportEmptyRecordsHasShape() {
  const report = analyzer.buildAnalyzerReport({ records: [], generated_at_ms: 1_700_000_000_000 });
  assert.strictEqual(report.report_type, "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS");
  assert.strictEqual(report.sample.total_record_n, 0);
  assert.strictEqual(report.sample.closed_with_klines_n, 0);
  assert.ok(Array.isArray(report.per_filter));
  assert.strictEqual(report.per_filter.length, 4, "DEFAULT_REQUIRED_FILTER_IDS");
  for (const row of report.per_filter) {
    assert.strictEqual(row.blocked_closed_n, 0);
    assert.strictEqual(row.precision_proxy, null);
    assert.strictEqual(row.pnl_drag_proxy_r, null);
  }
})();

(function reportCountsPendingExpired() {
  const records = [
    rec({ status: "PENDING" }),
    rec({ status: "EXPIRED" }),
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: -0.01 }),
  ];
  const report = analyzer.buildAnalyzerReport({ records });
  assert.strictEqual(report.sample.total_record_n, 3);
  assert.strictEqual(report.sample.closed_n, 1);
  assert.strictEqual(report.sample.closed_with_klines_n, 1);
  assert.strictEqual(report.sample.pending_n, 1);
  assert.strictEqual(report.sample.expired_n, 1);
})();

(function reportIncludesDiscoveredFilterIds() {
  const records = [
    rec({ would_block: ["NEW_FILTER_X"], exit_close_pct: -0.01 }),
  ];
  const report = analyzer.buildAnalyzerReport({ records });
  const ids = report.per_filter.map((r) => r.filter_id);
  assert.ok(ids.includes("NEW_FILTER_X"), "DISCOVERED_FILTER_PRESENT");
  assert.ok(ids.includes("BTC_1H_TREND_ALT_LONG"), "DEFAULT_FILTERS_PRESENT");
})();

console.log(JSON.stringify({
  ok: true,
  reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYZER_TEST_OK",
}));
