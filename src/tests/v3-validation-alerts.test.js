"use strict";

const assert = require("assert");

const { __test } = require("../../scripts/report-v3-paper-validation.js");

(() => {
  const previous = {
    readiness: "WAIT_PAPER_SAMPLE_ACCUMULATION",
    paper_gate: {
      sample_ok: false,
      ok: false,
      closed_trade_n: 29,
      min_required_n: 30,
      win_rate_pct: 53.2,
      expectancy_r: 0.12,
      min_win_rate_pct: 52,
      min_expectancy_r: 0,
    },
    bootstrap_gate: {
      retained_sample_n: 50,
      min_required_n: 50,
      win_rate_pct: 55.4,
      expectancy_usdt: 0.21,
    },
    summary_lines: [],
  };
  const next = {
    readiness: "READY_FOR_RUNTIME_LANE_REVIEW",
    paper_gate: {
      sample_ok: true,
      ok: true,
      closed_trade_n: 30,
      min_required_n: 30,
      win_rate_pct: 54.1,
      expectancy_r: 0.18,
      min_win_rate_pct: 52,
      min_expectancy_r: 0,
    },
    bootstrap_gate: {
      retained_sample_n: 52,
      min_required_n: 50,
      win_rate_pct: 55.9,
      expectancy_usdt: 0.24,
    },
    summary_lines: ["ready"],
  };

  assert.strictEqual(__test.isPaperSampleReady(previous), false);
  assert.strictEqual(__test.isPaperSampleReady(next), true);
  assert.strictEqual(__test.isPaperQualityReady(previous), false);
  assert.strictEqual(__test.isPaperQualityReady(next), true);
  assert.strictEqual(__test.validationReadinessLabel(next.readiness), "runtime lane 검토 가능");

  const sampleSections = __test.buildAlertSections(next, previous, "sample");
  assert.ok(sampleSections[0].lines.some((line) => line.includes("30건")));

  const qualitySections = __test.buildAlertSections(next, previous, "quality");
  assert.ok(qualitySections[0].lines.some((line) => line.includes("승률 기준")));
  assert.ok(qualitySections[0].lines.some((line) => line.includes("expectancy 기준")));
})();

console.log("v3-validation-alerts.test.js PASS");
