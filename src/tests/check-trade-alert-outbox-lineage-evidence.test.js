"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/check-trade-alert-outbox-lineage-evidence");

(function passesWhenTopLevelMirrorsPayload() {
  const row = {
    id: "OUTBOX__OK",
    type: "TRADE_EXECUTION_ALERT",
    status: "SENT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    created_at: "2026-05-01T02:10:00.000Z",
    source_fill_id: "FILL__1",
    dedupe_key: "ETHUSDT|EXIT_TP_P1_2.5P|2026-05-01T02:10:00.000Z",
    entry_event_id: "ENTRY__1",
    order_id: "12345",
    client_order_id: "cid-12345",
    raw_evidence_event: "EXIT_TP_P0_0.8P",
    canonical_event: "EXIT_TP_P1_2.5P",
    canonical_stage: "TP1",
    canonical_transition_events: ["TP1_REACHED"],
    canonical_primary_transition_event: "TP1_REACHED",
    simplified_exit_v2_enabled: true,
    payload: {
      symbol: "ETHUSDT",
      event: "EXIT_TP_P0_0.8P",
      sourceFillId: "FILL__1",
      tradeAlertDedupeKey: "ETHUSDT|EXIT_TP_P1_2.5P|2026-05-01T02:10:00.000Z",
      entryEventId: "ENTRY__1",
      orderId: 12345,
      clientOrderId: "cid-12345",
      canonicalExitEvent: "EXIT_TP_P1_2.5P",
      canonicalExitStage: "TP1",
      canonicalTransitionEvents: ["TP1_REACHED"],
      simplifiedExitV2Enabled: true,
    },
  };
  const evaluated = __test.evaluateRow(row);
  assert.strictEqual(evaluated.ok, true);
  assert.strictEqual(evaluated.exit_like, true);
})();

(function blocksPayloadOnlyRegression() {
  const row = {
    id: "OUTBOX__PAYLOAD_ONLY",
    type: "TRADE_EXECUTION_ALERT",
    status: "SENT",
    symbol: "LINKUSDT",
    event: "EXIT_TP_P0_0.8P",
    created_at: "2026-05-01T02:10:00.000Z",
    payload: {
      symbol: "LINKUSDT",
      event: "EXIT_TP_P0_0.8P",
      sourceFillId: "FILL__PAYLOAD_ONLY",
      canonicalExitEvent: "EXIT_TP_P1_2.5P",
      canonicalExitStage: "TP1",
      canonicalTransitionEvents: ["TP1_REACHED"],
      simplifiedExitV2Enabled: true,
    },
  };
  const evaluated = __test.evaluateRow(row);
  assert.strictEqual(evaluated.ok, false);
  assert.ok(evaluated.issues.includes("MIRROR_MISMATCH:source_fill_id"));
  assert.ok(evaluated.issues.includes("MIRROR_MISMATCH:canonical_event"));
  assert.ok(evaluated.issues.includes("MIRROR_MISMATCH:canonical_transition_events"));
  assert.ok(evaluated.issues.includes("MIRROR_MISMATCH:simplified_exit_v2_enabled"));
  assert.ok(evaluated.issues.includes("TOP_LEVEL_MISSING:canonical_transition_events"));
})();

(function buildReportBlocksAnyIssueRows() {
  const report = __test.buildReport({
    sinceIso: "2026-05-01T02:00:00.000Z",
    generatedAtIso: "2026-05-01T03:00:00.000Z",
    rows: [
      {
        id: "OUTBOX__BAD",
        type: "TRADE_EXECUTION_ALERT",
        status: "SENT",
        symbol: "XRPUSDT",
        event: "EXIT_SL_1.65P",
        created_at: "2026-05-01T02:20:00.000Z",
        payload: {
          symbol: "XRPUSDT",
          event: "EXIT_SL_1.65P",
          sourceFillId: "FILL__SL__1",
          canonicalExitEvent: "EXIT_SL_1.65P",
          canonicalExitStage: "SL",
          canonicalTransitionEvents: ["SL_HIT"],
          simplifiedExitV2Enabled: true,
        },
      },
    ],
  });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.reason, "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BLOCKED");
  assert.strictEqual(report.issue_row_n, 1);
  assert.ok(report.blockers.includes("TRADE_ALERT_OUTBOX_LINEAGE:TOP_LEVEL_EVIDENCE_MISMATCH"));
})();

(function ignoresNonExitEntryAlerts() {
  const row = {
    id: "OUTBOX__ENTRY",
    type: "TRADE_EXECUTION_ALERT",
    status: "SENT",
    symbol: "BNBUSDT",
    event: "LONG",
    created_at: "2026-05-01T02:10:00.000Z",
    payload: { symbol: "BNBUSDT", event: "LONG" },
  };
  const evaluated = __test.evaluateRow(row);
  assert.strictEqual(evaluated.ok, true);
  assert.strictEqual(evaluated.exit_like, false);
})();

(function selectFieldsIncludeTopLevelAndPayload() {
  for (const field of [
    "source_fill_id",
    "canonical_event",
    "canonical_stage",
    "canonical_transition_events",
    "canonical_primary_transition_event",
    "simplified_exit_v2_enabled",
    "payload",
  ]) {
    assert.ok(__test.SELECT_FIELDS.includes(field), `${field} must be queryable`);
  }
})();

console.log("CHECK_TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_TEST_OK");
