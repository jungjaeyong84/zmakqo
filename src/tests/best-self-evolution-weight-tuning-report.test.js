"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-weight-tuning");

(() => {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 23:20:00 KST",
    summary: {
      advisory_mode: "ADJUST",
      suggestion_n: 2,
      dominant_axis: "delay_cost_weight",
      count_guard_blocked: false,
      replacement_guard_blocked: false,
      memory_blocked: false,
      canary_blocked: false,
    },
    suggestions: [
      { axis: "delay_cost_weight", direction: "UP", delta: 0.05, reason: "LATE_LOSS_TOP_MARKET" },
    ],
  });
  assert.match(markdown, /BEST Self-Evolution Weight Tuning/);
  assert.match(markdown, /advisory_mode: ADJUST/);
  assert.match(markdown, /delay_cost_weight: UP 0.05/);
  console.log("BEST_SELF_EVOLUTION_WEIGHT_TUNING_REPORT_TEST_OK");
})();
