"use strict";

const assert = require("assert");
const { summarizeReversePolicy } = require("../utils/reversePolicy");

(() => {
  const report = summarizeReversePolicy({
    droppedSignals: [
      { exchange: "BINANCEFUT", symbol_or_pair_id: "SOLUSDT", drop_reason_code: "REVERSE_BLOCKED" },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "SOLUSDT", drop_reason_code: "REVERSE_BLOCKED" },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "SOLUSDT", drop_reason_code: "REVERSE_COOLDOWN" },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "BTCUSDT", drop_reason_code: "REVERSE_BLOCKED" },
      { exchange: "UPBIT", symbol_or_pair_id: "KRW-BTC", drop_reason_code: "REVERSE_BLOCKED" },
    ],
    signals: [
      { exchange: "BINANCEFUT", symbol_or_pair_id: "SOLUSDT", features_json: { _reverse_exception_applied: true } },
    ],
    currentSys: {
      reverse_exception_enabled: true,
      reverse_exception_drop_count_min: 2,
      reverse_exception_max_profit_pct: 1.5,
      reverse_exception_core_enabled: true,
      reverse_exception_early_enabled: false,
    },
  });

  assert.strictEqual(report.summary.reverse_drop_n, 4);
  assert.strictEqual(report.summary.reverse_revive_n, 1);
  assert.strictEqual(report.by_market[0].market, "SOLUSDT");
  assert.strictEqual(report.by_market[0].reverse_revive_n, 1);
  assert.strictEqual(report.by_market[0].dominant_reverse_reason, "REVERSE_BLOCKED");
})();

console.log("REVERSE_POLICY_TEST_OK");
