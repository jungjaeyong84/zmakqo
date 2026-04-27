"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/backfill-canonical-exit-transitions");

function run() {
  const payload = __test.buildCanonicalTransitionPayload({
    fill_id: "fill-eth-1",
    exchange: "binancefut",
    symbol: "ethusdt",
    event: "EXIT_TP_P1_1.65P",
    created_at: "2026-04-14T01:00:00.000Z",
    canonical_exit_chain_key: "BINANCEFUT__ETHUSDT__ENTRY__ENTRY_EVT_ETH",
    entry_event_id: "ENTRY_EVT_ETH",
    signal_doc_id: "SIG__ETH",
    extra: {
      canonical_transition_events: ["TP1_REACHED", "TRAIL_ACTIVE"],
      contract_entry_qty_abs: 0.887,
      contract_tp0_allowed_abs: 0.22175,
      contract_tp1_allowed_abs: 0.332625,
      contract_runner_remaining_abs: 0.167,
      external_order_id: 12345,
      external_client_order_id: "cli_eth_1",
    },
  });
  assert(payload, "payload should exist");
  assert.strictEqual(payload.exchange, "BINANCEFUT");
  assert.strictEqual(payload.symbol, "ETHUSDT");
  assert.strictEqual(payload.fillId, "fill-eth-1");
  assert.strictEqual(payload.canonicalEvent, "EXIT_TP_P1_1.65P");
  assert.deepStrictEqual(payload.transitionEvents, ["TP1_REACHED", "TRAIL_ACTIVE"]);
  assert.strictEqual(payload.chainKey, "BINANCEFUT__ETHUSDT__ENTRY__ENTRY_EVT_ETH");
  assert.strictEqual(payload.entryEventId, "ENTRY_EVT_ETH");
  assert.strictEqual(payload.signalDocId, "SIG__ETH");
  assert.strictEqual(payload.orderMeta.orderId, 12345);
  assert.strictEqual(payload.orderMeta.clientOrderId, "cli_eth_1");
  assert.strictEqual(payload.ledger.entry_qty_abs, 0.887);
  assert.strictEqual(payload.ledger.runner_remaining_abs, 0.167);

  const simplifiedPayload = __test.buildCanonicalTransitionPayload({
    fill_id: "fill-eth-v2",
    exchange: "binancefut",
    symbol: "ethusdt",
    event: "EXIT_TP_P1_2.5P",
    created_at: "2026-04-14T01:00:00.000Z",
    simplified_exit_v2_enabled: true,
  });
  assert(simplifiedPayload, "simplified payload should exist");
  assert.deepStrictEqual(simplifiedPayload.transitionEvents, ["TP1_REACHED", "TRAIL_ACTIVATED"]);

  const trailPayload = __test.buildCanonicalTransitionPayload({
    fill_id: "fill-btc-trail",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "EXIT_TRAIL",
    qty_fraction: 1,
  });
  assert.deepStrictEqual(trailPayload.transitionEvents, ["TRAIL_FINAL_EXIT"]);
  assert.ok(Array.isArray(__test.FILL_SELECT_FIELDS));
  assert.ok(__test.FILL_SELECT_FIELDS.includes("extra"));

  assert.strictEqual(__test.buildCanonicalTransitionPayload({
    fill_id: "fill-btc-tp0-v2",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "EXIT_TP_P0_0.8P",
    simplified_exit_v2_enabled: true,
  }), null);

  console.log("BACKFILL_CANONICAL_EXIT_TRANSITIONS_TEST_OK");
}

run();
