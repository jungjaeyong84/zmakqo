#!/usr/bin/env node
"use strict";

// F2 analyzer contract gate. No I/O.

const analyzer = require("../src/v2/signalShadowCounterfactualAnalyzer");

function fail(reason, detail) {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYZER_GATE_FAILED",
    blocker: reason,
    detail: detail || null,
  }));
  process.exit(1);
}

function require_(condition, reason, detail) {
  if (!condition) fail(reason, detail);
}

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

function assertExports() {
  const expected = [
    "REQUIRED_FILTER_IDS",
    "isClosedWithKlines",
    "summarizeNumericArray",
    "buildPerFilterSummary",
    "buildLeaveOneOutSummary",
    "buildFilterCombinationSummary",
    "buildAnalyzerReport",
    "loadCounterfactualRecords",
  ];
  for (const key of expected) {
    require_(analyzer[key] !== undefined, "MISSING_EXPORT", { key });
  }
  require_(Array.isArray(analyzer.REQUIRED_FILTER_IDS), "REQUIRED_FILTER_IDS_ARRAY");
  require_(analyzer.REQUIRED_FILTER_IDS.length === 4, "REQUIRED_FILTER_IDS_LENGTH_4");
}

function assertClosedGuard() {
  require_(analyzer.isClosedWithKlines(rec()) === true, "CLOSED_OK");
  require_(analyzer.isClosedWithKlines(rec({ status: "PENDING" })) === false, "PENDING_REJECT");
  require_(analyzer.isClosedWithKlines(rec({ bar_n_observed: 0 })) === false, "ZERO_BARS_REJECT");
  require_(analyzer.isClosedWithKlines(null) === false, "NULL_REJECT");
}

function assertPnlDragSignConvention() {
  const records = [
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: -0.02 }),
    rec({ would_block: ["BTC_1H_TREND_ALT_LONG"], exit_close_pct: -0.01 }),
  ];
  const out = analyzer.buildPerFilterSummary({
    filterId: "BTC_1H_TREND_ALT_LONG",
    records,
  });
  require_(out.blocked_closed_n === 2, "BLOCKED_N_2");
  require_(out.pnl_drag_proxy_r > 0, "DRAG_POSITIVE_FOR_NEGATIVE_EXIT", {
    drag: out.pnl_drag_proxy_r,
  });
  require_(Math.abs(out.pnl_drag_proxy_r - 0.015) < 1e-9, "DRAG_VALUE", {
    drag: out.pnl_drag_proxy_r,
  });
}

function assertLeaveOneOutSeparates() {
  const records = [
    rec({ would_block: ["A"], exit_close_pct: -0.01 }),
    rec({ would_block: ["A", "B"], exit_close_pct: -0.05 }),
  ];
  const out = analyzer.buildLeaveOneOutSummary({ filterId: "A", records });
  require_(out.sole_blocker_n === 1, "SOLE_BLOCKER_1");
  require_(out.co_blocker_n === 1, "CO_BLOCKER_1");
}

function assertReportShape() {
  const report = analyzer.buildAnalyzerReport({ records: [], generated_at_ms: 1_700_000_000_000 });
  require_(report.report_type === "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS", "REPORT_TYPE");
  require_(report.per_filter.length === 4, "DEFAULT_FILTER_N_4");
  for (const row of report.per_filter) {
    require_(row.precision_proxy === null, "EMPTY_PRECISION_NULL");
    require_(row.pnl_drag_proxy_r === null, "EMPTY_DRAG_NULL");
  }
}

(async () => {
  assertExports();
  assertClosedGuard();
  assertPnlDragSignConvention();
  assertLeaveOneOutSeparates();
  assertReportShape();
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYZER_GATE_PASS",
    check_n: 5,
  }));
})().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYZER_GATE_THROWN",
    error_message: error && error.message ? error.message : String(error),
  }));
  process.exit(1);
});
