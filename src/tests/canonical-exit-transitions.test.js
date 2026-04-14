"use strict";

const assert = require("assert");
const { __test } = require("../storage/canonicalExitTransitions");

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildCanonicalExitTransitionId, "function");
  assert.strictEqual(typeof __test.buildCanonicalExitTransitionDoc, "function");

  const id = __test.buildCanonicalExitTransitionId({
    fillId: "fill_123",
    transitionEvent: "TRAIL_PARTIAL",
  });
  assert.strictEqual(id, "CET__fill_123__TRAIL_PARTIAL");

  const doc = __test.buildCanonicalExitTransitionDoc({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    fillId: "fill_123",
    tradeId: 456,
    tradeMs: 1776026600000,
    canonicalEvent: "EXIT_TP_P1_1.65P",
    transitionEvent: "TRAIL_PARTIAL",
    chainKey: "ENTRY__ETH",
    reason: "POST_TP1_STAGE_LOCK",
    entryEventId: "ENTRY__ETH",
    signalDocId: "SIG__ETH",
    orderMeta: { orderId: 789, clientOrderId: "cli_1" },
    ledger: {
      entry_qty_abs: 0.887,
      tp0_allowed_abs: 0.22175,
      tp1_allowed_abs: 0.332625,
      runner_remaining_abs: 0.167,
    },
    source: "PAPER_BINANCE_RUNNER",
  });
  assert.strictEqual(doc.canonical_exit_transition_id, "CET__fill_123__TRAIL_PARTIAL");
  assert.strictEqual(doc.exchange, "BINANCEFUT");
  assert.strictEqual(doc.symbol, "ETHUSDT");
  assert.strictEqual(doc.fill_id, "fill_123");
  assert.strictEqual(doc.trade_id, 456);
  assert.strictEqual(doc.canonical_event, "EXIT_TP_P1_1.65P");
  assert.strictEqual(doc.canonical_transition_event, "TRAIL_PARTIAL");
  assert.strictEqual(doc.canonical_exit_chain_key, "ENTRY__ETH");
  assert.strictEqual(doc.canonical_exit_reason, "POST_TP1_STAGE_LOCK");
  assert.strictEqual(doc.entry_event_id, "ENTRY__ETH");
  assert.strictEqual(doc.signal_doc_id, "SIG__ETH");
  assert.strictEqual(doc.external_order_id, 789);
  assert.strictEqual(doc.external_client_order_id, "cli_1");
  assert.strictEqual(doc.source, "PAPER_BINANCE_RUNNER");
  assert.strictEqual(doc.quantity_contract_ledger.entry_qty_abs, 0.887);

  console.log("CANONICAL_EXIT_TRANSITIONS_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("CANONICAL_EXIT_TRANSITIONS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
