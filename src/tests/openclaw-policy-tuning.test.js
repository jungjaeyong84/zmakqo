"use strict";

const assert = require("assert");

const { __test } = require("../services/openclawPolicyTuning");

(() => {
  const report = __test.buildOpenClawPolicyTuningReport({
    bootstrap: {
      recommendation: "KEEP_SHADOW_ONLY",
      retained_summary: {
        sample_n: 31,
        win_rate_pct: 54.84,
        profit_factor: 1.62,
        expectancy_usdt: 0.18,
      },
    },
    validation: {
      readiness: "WAIT_BOOTSTRAP_EXPANSION",
    },
    learning: {
      learning_scope: "V3_PAPER_ONLY",
      source_lane: "V3_LOCAL_PAPER",
      status: "HOLD",
      shadow_ready: false,
      promotion_ready: false,
    },
    performance: {
      today_closed_trade_n: 1,
      open_position_n: 0,
    },
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.learning_scope, "V3_PAPER_ONLY");
  assert.strictEqual(report.metrics.retained_sample_n, 31);
  assert.ok(report.warnings.includes("BOOTSTRAP_EXPANSION_REQUIRED"));
})();

console.log("openclaw-policy-tuning.test.js PASS");
