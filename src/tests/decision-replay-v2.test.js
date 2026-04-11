"use strict";

const assert = require("assert");
const { __test } = require("../services/decisionReplayV2");

function run() {
  const replayed = __test.replayDecisionTimelineV2FromRows({
    decisions: [
      { created_at: "2026-04-11T00:00:01.000Z", exchange: "BINANCEFUT", symbol: "ETHUSDT", event: "action_pre_ok", intent_id: "INTENT__1" },
    ],
    intents: [
      { created_at: "2026-04-11T00:00:02.000Z", exchange: "BINANCEFUT", symbol_or_pair_id: "ETHUSDT", event: "ENTRY", intent_id: "INTENT__1", status: "PENDING" },
    ],
    intentEvents: [
      { created_at: "2026-04-11T00:00:02.500Z", ts_ms: 1775865602500, exchange: "BINANCEFUT", symbol: "ETHUSDT", mutation_type: "STATUS_PENDING", intent_id: "INTENT__1" },
    ],
    fills: [
      { created_at: "2026-04-11T00:00:03.000Z", exchange: "BINANCEFUT", symbol: "ETHUSDT", event: "ENTRY", intent_id: "INTENT__1", fill_id: "FILL__1" },
    ],
    fillEvents: [
      { created_at: "2026-04-11T00:00:03.200Z", ts_ms: 1775865603200, exchange: "BINANCEFUT", symbol: "ETHUSDT", mutation_type: "INTERNAL_INSERT", fill_id: "FILL__1" },
    ],
    exchangeAcks: [
      { created_at: "2026-04-11T00:00:03.400Z", ts_ms: 1775865603400, exchange: "BINANCEFUT", symbol: "ETHUSDT", mutation_type: "EXTERNAL_INSERT", fill_id: "FILL__1", after: { classification_verified: true } },
    ],
    positionEvents: [
      { sequence_ms: 1775865604000, created_at: "2026-04-11T00:00:04.000Z", exchange: "BINANCEFUT", symbol: "ETHUSDT", mutation_kind: "POSITION_UPSERT", after_summary: { position_state: "COMMIT", size_pct: 1 } },
    ],
  });

  assert.strictEqual(replayed.timeline_n, 7);
  assert.deepStrictEqual(replayed.timeline.map((row) => row.kind), [
    "DECISION",
    "INTENT",
    "INTENT_MUTATION",
    "FILL",
    "FILL_MUTATION",
    "EXCHANGE_ACK",
    "POSITION_MUTATION",
  ]);
  assert.strictEqual(replayed.counts.intent_mutations_n, 1);
  assert.strictEqual(replayed.counts.fill_mutations_n, 1);
  assert.strictEqual(replayed.counts.exchange_ack_n, 1);
  assert.strictEqual(replayed.latest_exchange_ack.classification_verified, true);
  assert.strictEqual(replayed.latest_position_summary.position_state, "COMMIT");

  console.log("DECISION_REPLAY_V2_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("DECISION_REPLAY_V2_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
