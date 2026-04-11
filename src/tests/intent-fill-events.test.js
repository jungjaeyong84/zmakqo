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

  console.log("INTENT_FILL_EVENTS_TEST_OK");
}

run();
