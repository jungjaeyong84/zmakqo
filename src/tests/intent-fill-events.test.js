"use strict";

const assert = require("assert");
const { __test: intentEventsTest } = require("../storage/orderIntentEvents");
const { __test: fillEventsTest } = require("../storage/fillEvents");

function run() {
  const intentA = intentEventsTest.buildOrderIntentEventId({
    intentId: "intent-1",
    mutationType: "UPSERT_CREATE",
    deterministicKey: "intent-1|UPSERT_CREATE|1",
  });
  const intentB = intentEventsTest.buildOrderIntentEventId({
    intentId: "intent-1",
    mutationType: "UPSERT_CREATE",
    deterministicKey: "intent-1|UPSERT_CREATE|1",
  });
  assert.strictEqual(intentA, intentB);
  const intentDoc = intentEventsTest.buildOrderIntentEventDoc({
    intentId: "intent-1",
    mutationType: "UPSERT_CREATE",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    createdAt: "2026-04-11T00:00:00.000Z",
    after: { status: "PENDING" },
    deterministicKey: "intent-doc",
  });
  const intentUnified = intentEventsTest.buildOrderIntentEventUnifiedDoc(intentDoc);
  assert.strictEqual(intentUnified.event_kind, "INTENT_MUTATION");

  const fillA = fillEventsTest.buildFillEventId({
    fillId: "fill-1",
    mutationType: "MARK_UNVERIFIED",
    deterministicKey: "fill-1|MARK_UNVERIFIED|1",
  });
  const fillB = fillEventsTest.buildFillEventId({
    fillId: "fill-1",
    mutationType: "MARK_UNVERIFIED",
    deterministicKey: "fill-1|MARK_UNVERIFIED|1",
  });
  assert.strictEqual(fillA, fillB);
  assert.strictEqual(fillEventsTest.resolveUnifiedFillEventKind("EXTERNAL_INSERT"), "EXCHANGE_ACK");
  assert.strictEqual(fillEventsTest.resolveUnifiedFillEventKind("MARK_UNVERIFIED"), "FILL_AUDIT");
  assert.strictEqual(fillEventsTest.resolveUnifiedFillEventKind("INTERNAL_INSERT"), "FILL_MUTATION");

  const fillRandomA = fillEventsTest.buildFillEventId({
    fillId: "fill-2",
    mutationType: "EXTERNAL_INSERT",
    tsMs: 1775865600000,
  });
  const fillRandomB = fillEventsTest.buildFillEventId({
    fillId: "fill-2",
    mutationType: "EXTERNAL_INSERT",
    tsMs: 1775865600000,
  });
  assert.notStrictEqual(fillRandomA, fillRandomB);
  const fillDoc = fillEventsTest.buildFillEventDoc({
    fillId: "fill-3",
    mutationType: "EXTERNAL_INSERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    createdAt: "2026-04-11T00:00:00.000Z",
    after: { classification_verified: false },
    deterministicKey: "fill-doc",
  });
  const fillUnified = fillEventsTest.buildFillEventUnifiedDoc(fillDoc);
  assert.strictEqual(fillUnified.event_kind, "EXCHANGE_ACK");
  assert.strictEqual(fillUnified.payload.classification_verified, false);

  console.log("INTENT_FILL_EVENTS_TEST_OK");
}

run();
