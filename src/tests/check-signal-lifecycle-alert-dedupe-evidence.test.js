"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/check-signal-lifecycle-alert-dedupe-evidence");

(function passesUniqueSentRows() {
  const report = __test.buildReport({
    sinceIso: "2026-05-01T00:00:00.000Z",
    generatedAtIso: "2026-05-01T01:00:00.000Z",
    rows: [
      {
        id: "OUTBOX__1",
        type: "DROPPED",
        status: "SENT",
        exchange: "BINANCEFUT",
        symbol: "LINKUSDT",
        tf: "15m",
        event: "SHORT",
        signal_id: "SIG__1",
        reason: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
        created_at: "2026-05-01T00:10:00.000Z",
        sent_at: "2026-05-01T00:10:01.000Z",
      },
    ],
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.reason, "SIGNAL_LIFECYCLE_ALERT_DEDUPE_EVIDENCE_PASS");
  assert.strictEqual(report.issue_row_n, 0);
})();

(function blocksExactDuplicateSentRows() {
  const base = {
    type: "DROPPED",
    status: "SENT",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    tf: "15m",
    event: "SHORT",
    signal_id: "SIG__DUP",
    reason: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
  };
  const report = __test.buildReport({
    rows: [
      { id: "OUTBOX__A", ...base, created_at: "2026-05-01T00:10:00.000Z", sent_at: "2026-05-01T00:10:01.000Z" },
      { id: "OUTBOX__B", ...base, created_at: "2026-05-01T00:10:02.000Z", sent_at: "2026-05-01T00:10:03.000Z" },
    ],
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("SIGNAL_LIFECYCLE_ALERT:DEDUP_OR_CONFLICT_EVIDENCE"));
  assert.strictEqual(report.issue_code_counts.SIGNAL_LIFECYCLE_ALERT_DUPLICATE_SENT, 1);
})();

(function blocksDroppedAndProgressedConflictForSameSignal() {
  const report = __test.buildReport({
    rows: [
      {
        id: "OUTBOX__PROG",
        type: "PROGRESSED",
        status: "SENT",
        exchange: "BINANCEFUT",
        symbol: "BNBUSDT",
        tf: "15m",
        event: "LONG",
        signal_id: "SIG__CONFLICT",
        reason: "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE",
      },
      {
        id: "OUTBOX__DROP",
        type: "DROPPED",
        status: "SENT",
        exchange: "BINANCEFUT",
        symbol: "BNBUSDT",
        tf: "15m",
        event: "LONG",
        signal_id: "SIG__CONFLICT",
        reason: "DROP_IN_POSITION_NO_ADD",
      },
    ],
  });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.issue_code_counts.SIGNAL_LIFECYCLE_ALERT_CONFLICT_DROPPED_AND_PROGRESSED, 1);
})();

(function ignoresPendingRowsForDuplicateSentCheck() {
  const base = {
    type: "DROPPED",
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    tf: "15m",
    event: "SHORT",
    signal_id: "SIG__PENDING",
    reason: "SIGNAL_CRITERIA_BLOCKED",
  };
  const report = __test.buildReport({
    rows: [
      { id: "OUTBOX__SENT", ...base, status: "SENT" },
      { id: "OUTBOX__PENDING", ...base, status: "PENDING" },
    ],
  });
  assert.strictEqual(report.ok, true);
})();

(function normalizesPayloadFields() {
  const row = __test.normalizeRow({
    id: "OUTBOX__PAYLOAD",
    status: "SENT",
    payload: {
      exchange: "binancefut",
      symbol: "solusdt",
      tf: "15m",
      event: "long",
      signalId: "SIG__PAYLOAD",
      decisionReason: "v2_risk_governor_blocked",
    },
  });
  assert.strictEqual(row.exchange, "BINANCEFUT");
  assert.strictEqual(row.symbol, "SOLUSDT");
  assert.strictEqual(row.event, "LONG");
  assert.strictEqual(row.signal_id, "SIG__PAYLOAD");
  assert.strictEqual(row.reason, "V2_RISK_GOVERNOR_BLOCKED");
})();

console.log("CHECK_SIGNAL_LIFECYCLE_ALERT_DEDUPE_EVIDENCE_TEST_OK");
