"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-exit-trailing-contract");

(() => {
  const summary = __test.deriveSummary({
    runtime: {
      summary: {
        source_mode: "SERVER_PRIMARY",
      },
    },
  });
  assert.strictEqual(summary.status, "EXIT_TRAILING_CONTRACT_ACTIVE");
  assert.strictEqual(summary.canonical_mode, "TRAIL_R_MULTIPLE");
  assert.strictEqual(summary.generic_trail_event_when_r_enabled, true);
  assert.ok(Array.isArray(summary.exchange_contracts) && summary.exchange_contracts.length >= 3);
  const binance = summary.exchange_contracts.find((row) => row.exchange === "BINANCEFUT");
  assert(binance, "binance contract must exist");
  assert.strictEqual(binance.trail_r_multiple, 0.9);
  assert.strictEqual(binance.event_name_mode, "EXIT_TRAIL_GENERIC");
})();

console.log("EXIT_TRAILING_CONTRACT_REPORT_TEST_OK");
