"use strict";

const assert = require("assert");
const { deriveServerSignalRuntime } = require("../../src/utils/serverSignalRuntime");

(() => {
  const report = deriveServerSignalRuntime({
    provider: "BINANCEFUT",
    systemSettings: {
      scheduler_enabled: true,
      scheduler_interval_sec: 900,
      canonical_engine_source_mode: "SERVER_PRIMARY",
      canonical_engine_shadow_enabled: true,
      ev_gate_tp1_prob_min_by_market: { BTCUSDT: 0.515 },
      ev_gate_tp1_prob_min_by_market_report_only_enabled: true,
      ev_gate_tp1_prob_min_by_market_report_only: { SOLUSDT: 0.501, ETHUSDT: 0.501 },
    },
    exchangeSettings: {
      exec_tf: "15m",
      tf_allowlist: ["15m", "60m"],
      markets: ["BTCUSDT", "ETHUSDT", "AXSUSDT"],
    },
    watchdog: { summary: { verdict: "PASS" } },
  });

  assert.strictEqual(report.summary.runtime_status, "READY");
  assert.strictEqual(report.summary.exec_tf, "15m");
  assert.strictEqual(report.summary.market_count, 3);
  assert.strictEqual(report.summary.ev_gate_tp1_prob_min_by_market_n, 1);
  assert.strictEqual(report.summary.ev_gate_tp1_prob_min_by_market_report_only_enabled, true);
  assert.strictEqual(report.summary.ev_gate_tp1_prob_min_by_market_report_only_n, 2);
  assert.strictEqual(report.summary.pine_shadow_transition_progress_pct, 100);
  assert.strictEqual(report.current_status.execution_shadow_policy, "EXCLUDE_FROM_EXECUTION_DEFAULT");
  console.log("SERVER_SIGNAL_RUNTIME_TEST_OK");
})();
