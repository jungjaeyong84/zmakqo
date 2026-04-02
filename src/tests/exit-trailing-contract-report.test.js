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
  assert.strictEqual(summary.r_basis, "STRUCTURE_STOP");
  assert.strictEqual(summary.leverage_invariant_r, true);
  assert.strictEqual(summary.generic_trail_event_when_r_enabled, true);
  assert.ok(Array.isArray(summary.exchange_contracts) && summary.exchange_contracts.length >= 3);
  const binance = summary.exchange_contracts.find((row) => row.exchange === "BINANCEFUT");
  assert(binance, "binance contract must exist");
  assert.strictEqual(binance.profile_mode, "BASE");
  assert.strictEqual(binance.trail_r_multiple, 0.9);
  assert.strictEqual(binance.event_name_mode, "EXIT_TRAIL_GENERIC");
  assert.strictEqual(binance.entry_exit_contract.sl_pct_abs, 1.65);
  assert.strictEqual(binance.entry_exit_contract.tp1_pct, 3.25);
  assert.strictEqual(binance.entry_exit_contract.tp1_qty_pct, 50);
  assert.strictEqual(binance.entry_exit_contract.be_pct, 0.25);
  assert.strictEqual(binance.entry_exit_contract.runner_min_profit_pct, 2);
  assert.strictEqual(summary.active_binance_profile_mode, "BASE");
  assert(summary.active_binance_entry_exit_contract, "active binance contract must exist");
})();

console.log("EXIT_TRAILING_CONTRACT_REPORT_TEST_OK");
