"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/backfill-trade-alert-outbox-lineage-evidence");

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildLineagePatch, "function", "buildLineagePatch export missing");

  const patch = __test.buildLineagePatch({
    id: "TRADE_ALERT_OUTBOX__1",
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    event: "EXIT_SL_1.65P",
    status: "SENT",
    source_fill_id: "EXT__BINANCEFUT__AXSUSDT__686081874",
    payload: {
      event: "EXIT_SL_1.65P",
      sourceFillId: "EXT__BINANCEFUT__AXSUSDT__686081874",
      entryEventId: "ENTRYV2__AXSUSDT__LONG__14857024991",
      orderId: 14857054262,
      clientOrderId: "SL__PRATTV2__f3d9bbaa92",
      rawEvidenceEvent: "EXIT_SL_1.65P",
      canonicalExitEvent: "EXIT_SL_1.65P",
      canonicalExitStage: "SL",
      canonicalTransitionEvent: "SL_HIT",
      canonicalTransitionEvents: ["SL_HIT", "SL_HIT"],
      simplifiedExitV2Enabled: true,
    },
  });
  assert.ok(patch, "missing top-level lineage evidence should produce patch");
  assert.strictEqual(patch.entry_event_id, "ENTRYV2__AXSUSDT__LONG__14857024991");
  assert.strictEqual(patch.order_id, "14857054262");
  assert.strictEqual(patch.client_order_id, "SL__PRATTV2__f3d9bbaa92");
  assert.strictEqual(patch.raw_evidence_event, "EXIT_SL_1.65P");
  assert.strictEqual(patch.canonical_event, "EXIT_SL_1.65P");
  assert.strictEqual(patch.canonical_stage, "SL");
  assert.deepStrictEqual(patch.canonical_transition_events, ["SL_HIT"]);
  assert.strictEqual(patch.canonical_primary_transition_event, "SL_HIT");
  assert.strictEqual(patch.simplified_exit_v2_enabled, true);
  assert.strictEqual(patch.lineage_evidence_backfill_source, "backfill-trade-alert-outbox-lineage-evidence");

  const unchanged = __test.buildLineagePatch({
    id: "TRADE_ALERT_OUTBOX__2",
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_SL_1.65P",
    status: "SENT",
    source_fill_id: "EXT__BINANCEFUT__ETHUSDT__8062054658",
    entry_event_id: "ENTRYV2__ETHUSDT__LONG__8389766168971643000",
    order_id: "8389766169071348000",
    raw_evidence_event: "EXIT_SL_1.65P",
    canonical_event: "EXIT_SL_1.65P",
    canonical_stage: "SL",
    canonical_transition_events: ["SL_HIT"],
    canonical_primary_transition_event: "SL_HIT",
    simplified_exit_v2_enabled: true,
    payload: {
      event: "EXIT_SL_1.65P",
      sourceFillId: "EXT__BINANCEFUT__ETHUSDT__8062054658",
      entryEventId: "ENTRYV2__ETHUSDT__LONG__8389766168971643000",
      orderId: 8389766169071348000,
      rawEvidenceEvent: "EXIT_SL_1.65P",
      canonicalExitEvent: "EXIT_SL_1.65P",
      canonicalExitStage: "SL",
      canonicalTransitionEvent: "SL_HIT",
      canonicalTransitionEvents: ["SL_HIT"],
      simplifiedExitV2Enabled: true,
    },
  });
  assert.strictEqual(unchanged, null, "already mirrored row should not be rewritten");

  const entryIgnored = __test.buildLineagePatch({
    type: "TRADE_EXECUTION_ALERT",
    event: "LONG",
    payload: { event: "LONG", signalId: "SIG__1" },
  });
  assert.strictEqual(entryIgnored, null, "entry alerts are outside exit lineage backfill");

  console.log("BACKFILL_TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BACKFILL_TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
