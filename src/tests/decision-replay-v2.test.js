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

  const withTrailRuntime = replayed.timeline.slice();
  withTrailRuntime.splice(6, 0, {
    kind: "TRAIL_RUNTIME",
    ts_ms: 1775865603600,
    created_at: "2026-04-11T00:00:03.600Z",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "TRAIL_AUTHORITY_STATUS",
    payload: { status: "WARN" },
  });
  const sortedKinds = __test.sortTimeline(withTrailRuntime).map((row) => row.kind);
  assert.deepStrictEqual(sortedKinds, [
    "DECISION",
    "INTENT",
    "INTENT_MUTATION",
    "FILL",
    "FILL_MUTATION",
    "EXCHANGE_ACK",
    "TRAIL_RUNTIME",
    "POSITION_MUTATION",
  ]);
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
  assert.strictEqual(replayed.counts.trail_runtime_n || 0, 0);
  assert.strictEqual(replayed.latest_exchange_ack.classification_verified, true);
  assert.strictEqual(replayed.latest_position_summary.position_state, "COMMIT");

  const eventOnly = __test.replayUnifiedEventTimelineAuthoritative([
    {
      created_at: "2026-04-11T00:00:03.000Z",
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event_kind: "FILL",
      event_name: "ENTRY",
      payload: { fill_id: "FILL__1" },
      source_document_id: "fills/FILL__1",
      unified_event_id: "UNIFIED__1",
    },
    {
      created_at: "2026-04-11T00:00:04.000Z",
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      event_kind: "POSITION_MUTATION",
      event_name: "POSITION_UPSERT",
      payload: { after_summary: { position_state: "COMMIT", size_pct: 1 } },
      source_document_id: "positions/POS__1",
      unified_event_id: "UNIFIED__2",
    },
  ], {
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
  });
  assert.strictEqual(eventOnly.event_only, true);
  assert.strictEqual(eventOnly.legacy_fallback_used, false);
  assert.strictEqual(eventOnly.authoritative_source, "UNIFIED_EVENT_TIMELINE");
  assert.strictEqual(eventOnly.authoritative_ready, false);
  assert.strictEqual(eventOnly.authoritative_verdict, "BLOCK");
  assert.strictEqual(eventOnly.timeline_n, 2);
  assert.ok(/^[0-9a-f]{64}$/.test(eventOnly.timeline_hash));
  assert.ok(/^[0-9a-f]{64}$/.test(eventOnly.latest_position_hash));
  assert.deepStrictEqual(eventOnly.source_event_ids, ["UNIFIED__1", "UNIFIED__2"]);
  assert.ok(eventOnly.residual_issues.includes("INTENT_MUTATION_MISSING"));
  assert.ok(eventOnly.residual_issues.includes("FILL_MUTATION_MISSING"));

  console.log("DECISION_REPLAY_V2_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("DECISION_REPLAY_V2_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
