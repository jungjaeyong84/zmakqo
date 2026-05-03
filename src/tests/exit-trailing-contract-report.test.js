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
  assert.strictEqual(summary.status, "EXIT_FULL_TP_CONTRACT_ACTIVE");
  assert.strictEqual(summary.canonical_mode, "TP_FULL_ONLY");
  assert.strictEqual(summary.r_basis, "STRUCTURE_STOP");
  assert.strictEqual(summary.leverage_invariant_r, true);
  assert.strictEqual(summary.generic_trail_event_when_r_enabled, false);
  assert.ok(Array.isArray(summary.exchange_contracts) && summary.exchange_contracts.length >= 3);
  const binance = summary.exchange_contracts.find((row) => row.exchange === "BINANCEFUT");
  assert(binance, "binance contract must exist");
  assert.strictEqual(binance.profile_mode, "BASE");
  assert.strictEqual(binance.trail_r_multiple, null);
  assert.strictEqual(binance.event_name_mode, "EXIT_TP_FULL_GENERIC");
  assert.strictEqual(binance.entry_exit_contract.sl_pct_abs, 1.65);
  assert.strictEqual(binance.entry_exit_contract.tp1_pct, 2.5);
  assert.strictEqual(binance.entry_exit_contract.tp1_qty_pct, 100);
  assert.strictEqual(binance.entry_exit_contract.be_pct, null);
  assert.strictEqual(binance.entry_exit_contract.runner_min_profit_pct, null);
  assert.strictEqual(summary.active_binance_profile_mode, "BASE");
  assert(summary.active_binance_entry_exit_contract, "active binance contract must exist");
})();

console.log("EXIT_TRAILING_CONTRACT_REPORT_TEST_OK");
