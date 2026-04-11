"use strict";

const assert = require("assert");
const { __test: backfillTest } = require("../services/unifiedEventBackfill");

function testMapActionHookToUnifiedDoc() {
  const doc = backfillTest.mapActionHookToUnifiedDoc("ledger-1", {
    exchange: "binancefut",
    symbol: "xrpusdt",
    event: "action_pre_ok",
    created_at: "2026-04-11T00:00:00.000Z",
    qty_pct_final: 0.25,
  });
  assert.strictEqual(doc.event_kind, "DECISION");
  assert.strictEqual(doc.event_source, "ACTION_HOOK_LEDGER");
  assert.strictEqual(doc.source_document_id, "ledger-1");
  assert.strictEqual(doc.symbol, "XRPUSDT");
}

function testMapIntentToUnifiedDocDeterministic() {
  const a = backfillTest.mapIntentToUnifiedDoc("intent-doc-1", {
    intent_id: "INTENT__1",
    exchange: "binancefut",
    symbol_or_pair_id: "ethusdt",
    event: "entry",
    created_at: "2026-04-11T00:00:01.000Z",
  });
  const b = backfillTest.mapIntentToUnifiedDoc("intent-doc-1", {
    intent_id: "INTENT__1",
    exchange: "binancefut",
    symbol_or_pair_id: "ethusdt",
    event: "entry",
    created_at: "2026-04-11T00:00:01.000Z",
  });
  assert.strictEqual(a.unified_event_id, b.unified_event_id);
}

function testMapPositionEventToUnifiedDoc() {
  const doc = backfillTest.mapPositionEventToUnifiedDoc("evt-1", {
    event_id: "evt-1",
    exchange: "binancefut",
    symbol: "btcusdt",
    mutation_kind: "POSITION_UPSERT",
    sequence_ms: 1775865600000,
    created_at: "2026-04-11T00:00:02.000Z",
    after_summary: { state: "ACTIVE" },
  });
  assert.strictEqual(doc.event_kind, "POSITION_MUTATION");
  assert.strictEqual(doc.position_event_id, "evt-1");
  assert.strictEqual(doc.ts_ms, 1775865600000);
}

function testMapOrderIntentEventToUnifiedDoc() {
  const doc = backfillTest.mapOrderIntentEventToUnifiedDoc("intent-evt-1", {
    intent_event_id: "intent-evt-1",
    exchange: "binancefut",
    symbol: "xrpusdt",
    mutation_type: "PATCH",
    ts_ms: 1775865601000,
    after: { status: "PENDING" },
  });
  assert.strictEqual(doc.event_kind, "INTENT_MUTATION");
  assert.strictEqual(doc.event_source, "ORDER_INTENT_EVENTS");
  assert.strictEqual(doc.payload.after_status, "PENDING");
}

function testMapFillEventToUnifiedDoc() {
  const doc = backfillTest.mapFillEventToUnifiedDoc("fill-evt-1", {
    fill_event_id: "fill-evt-1",
    exchange: "binancefut",
    symbol: "ethusdt",
    mutation_type: "EXTERNAL_INSERT",
    ts_ms: 1775865602000,
    after: { classification_verified: true },
  });
  assert.strictEqual(doc.event_kind, "EXCHANGE_ACK");
  assert.strictEqual(doc.event_source, "FILL_EVENTS");
}

testMapActionHookToUnifiedDoc();
testMapIntentToUnifiedDocDeterministic();
testMapPositionEventToUnifiedDoc();
testMapOrderIntentEventToUnifiedDoc();
testMapFillEventToUnifiedDoc();

console.log("UNIFIED_EVENT_BACKFILL_TEST_OK");
