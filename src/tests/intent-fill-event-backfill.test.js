"use strict";

const assert = require("assert");
const { __test } = require("../services/intentFillEventBackfill");

function run() {
  const intentEvent = __test.mapIntentDocToEvent({
    intent_id: "INTENT__BINANCEFUT__XRPUSDT__15m__1__BUY",
    exchange: "binancefut",
    symbol_or_pair_id: "xrpusdt",
    updated_at: "2026-04-11T02:00:00.000Z",
    request_id: "req-1",
    run_id: "run-1",
  });
  assert.strictEqual(intentEvent.mutation_type, "BOOTSTRAP_SNAPSHOT");
  assert.strictEqual(intentEvent.exchange, "BINANCEFUT");
  assert.strictEqual(intentEvent.symbol, "XRPUSDT");
  assert.strictEqual(intentEvent.after.intent_id, "INTENT__BINANCEFUT__XRPUSDT__15m__1__BUY");

  const fillEvent = __test.mapFillDocToEvent({
    fill_id: "fill-1",
    exchange: "binancefut",
    symbol: "ethusdt",
    updated_at: "2026-04-11T02:10:00.000Z",
    idempotency_key: "trace-fill",
  });
  assert.strictEqual(fillEvent.mutation_type, "BOOTSTRAP_SNAPSHOT");
  assert.strictEqual(fillEvent.exchange, "BINANCEFUT");
  assert.strictEqual(fillEvent.symbol, "ETHUSDT");
  assert.strictEqual(fillEvent.trace_id, "trace-fill");

  const stableIntentIdA = __test.mapIntentDocToEvent({ intent_id: "intent-1", updated_at: "2026-04-11T02:00:00.000Z" }).intent_event_id;
  const stableIntentIdB = __test.mapIntentDocToEvent({ intent_id: "intent-1", updated_at: "2026-04-11T03:00:00.000Z" }).intent_event_id;
  assert.strictEqual(stableIntentIdA, stableIntentIdB);

  const stableFillIdA = __test.mapFillDocToEvent({ fill_id: "fill-1", updated_at: "2026-04-11T02:00:00.000Z" }).fill_event_id;
  const stableFillIdB = __test.mapFillDocToEvent({ fill_id: "fill-1", updated_at: "2026-04-11T03:00:00.000Z" }).fill_event_id;
  assert.strictEqual(stableFillIdA, stableFillIdB);

  console.log("INTENT_FILL_EVENT_BACKFILL_TEST_OK");
}

run();
