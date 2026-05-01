"use strict";

const assert = require("assert");
const { __test } = require("../storage/tradeAlertOutbox");

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildTradeAlertOutboxId, "function", "buildTradeAlertOutboxId export missing");

  const first = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    sourceFillId: "fill-123",
  });
  const second = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    sourceFillId: "fill-123",
    payload: { orderId: 1, ts: "2026-04-15T00:00:00.000Z" },
  });
  assert.strictEqual(first, second, "source fill id should dominate outbox id stability");

  const fallbackA = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "LONG",
    payload: {
      signalId: "SIG__1",
      intentId: "INTENT__1",
      runId: "RUN__1",
      ts: "2026-04-15T00:00:00.000Z",
    },
  });
  const fallbackB = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "LONG",
    payload: {
      signalId: "SIG__1",
      intentId: "INTENT__1",
      runId: "RUN__1",
      ts: "2026-04-15T00:00:00.000Z",
    },
  });
  assert.strictEqual(fallbackA, fallbackB, "fallback hash should be stable for identical payload identity");

  const evidence = __test.resolveOutboxEvidenceFields({
    payload: {
      event: "EXIT_TP_P0_0.8P",
      sourceFillId: "FILL__TP1__1",
      tradeAlertDedupeKey: "ETHUSDT|EXIT_TP_P1_2.5P|2026-04-16T01:57:11.214Z",
      entryEventId: "ENTRY__ETH__1",
      orderId: 12345,
      clientOrderId: "cid-12345",
      canonicalExitEvent: "EXIT_TP_P1_2.5P",
      canonicalExitStage: "TP1",
      canonicalTransitionEvents: ["TP1_REACHED", "TP1_REACHED"],
      simplifiedExitV2Enabled: true,
    },
  });
  assert.strictEqual(evidence.source_fill_id, "FILL__TP1__1");
  assert.strictEqual(evidence.dedupe_key, "ETHUSDT|EXIT_TP_P1_2.5P|2026-04-16T01:57:11.214Z");
  assert.strictEqual(evidence.entry_event_id, "ENTRY__ETH__1");
  assert.strictEqual(evidence.order_id, "12345");
  assert.strictEqual(evidence.client_order_id, "cid-12345");
  assert.strictEqual(evidence.raw_evidence_event, "EXIT_TP_P0_0.8P");
  assert.strictEqual(evidence.canonical_event, "EXIT_TP_P1_2.5P");
  assert.strictEqual(evidence.canonical_stage, "TP1");
  assert.deepStrictEqual(evidence.canonical_transition_events, ["TP1_REACHED"]);
  assert.strictEqual(evidence.canonical_primary_transition_event, "TP1_REACHED");
  assert.strictEqual(evidence.simplified_exit_v2_enabled, true);

  const preserved = __test.resolveOutboxEvidenceFields({
    payload: { event: "EXIT_TP_P0_0.8P" },
    prev: {
      source_fill_id: "FILL__PREV",
      dedupe_key: "DEDUP__PREV",
      canonical_event: "EXIT_TP_P1_2.5P",
      canonical_stage: "TP1",
      canonical_transition_events: ["TP1_REACHED"],
      canonical_primary_transition_event: "TP1_REACHED",
      simplified_exit_v2_enabled: true,
    },
  });
  assert.strictEqual(preserved.source_fill_id, "FILL__PREV");
  assert.strictEqual(preserved.dedupe_key, "DEDUP__PREV");
  assert.strictEqual(preserved.canonical_event, "EXIT_TP_P1_2.5P");
  assert.deepStrictEqual(preserved.canonical_transition_events, ["TP1_REACHED"]);
  assert.strictEqual(preserved.simplified_exit_v2_enabled, true);

  console.log("TRADE_ALERT_OUTBOX_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRADE_ALERT_OUTBOX_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
