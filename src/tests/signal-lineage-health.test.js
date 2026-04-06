"use strict";

const assert = require("assert");
const { buildSignalLineageReport } = require("../../scripts/report-signal-lineage-health");

(() => {
  const report = buildSignalLineageReport({
    windowHours: 24,
    signals: [
      { source: "SERVER", authoritative: true, event: "LONG", signal_id: "SIG__1" },
    ],
    intents: [
      { signal_doc_id: "SIG__1", event: "LONG", reason: "ENTRY" },
    ],
    fills: [
      { event: "LONG", signal_doc_id: "SIG__1", intent_id: "INT__1", exec_price_source: "WEBHOOK" },
      { event: "EXIT_EXTERNAL_SYNC", signal_doc_id: "SIG__1", intent_id: null, exec_price_source: "BINANCE_USER_TRADES", decision_reason: "EXTERNAL_FILL_RECONCILED" },
      { event: "EXIT_TP_P1_3.25P", signal_doc_id: "SIG__1", intent_id: null, exec_price_source: "BINANCE_USER_TRADES", decision_reason: "EXTERNAL_FILL_RECONCILED" },
    ],
  });

  assert.strictEqual(report.summary.fills_24h_n, 3);
  assert.strictEqual(report.summary.fills_intent_id_null_n, 2);
  assert.strictEqual(report.summary.fills_intent_id_null_rate, 2 / 3);
  assert.strictEqual(report.summary.entry_fills_24h_n, 1);
  assert.strictEqual(report.summary.entry_fills_intent_id_null_n, 0);
  assert.strictEqual(report.summary.entry_fills_intent_id_null_rate, 0);
  assert.strictEqual(report.summary.exit_fills_24h_n, 2);
  assert.strictEqual(report.summary.exit_fills_intent_id_null_n, 2);
  assert.strictEqual(report.summary.exit_fills_intent_id_null_rate, 1);
  assert.strictEqual(report.summary.external_reconciled_fills_24h_n, 2);
  assert.strictEqual(report.summary.external_reconciled_fills_intent_id_null_n, 2);
  assert.strictEqual(report.summary.external_reconciled_fills_intent_id_null_rate, 1);
  assert.strictEqual(report.summary.verdict, "WARN");
  assert.ok(report.summary.warning_reasons.includes("EXTERNAL_RECONCILED_FILL_INTENT_NULL_PRESENT"));
  assert.ok(!report.summary.warning_reasons.includes("ENTRY_FILLS_INTENT_ID_NULL_PRESENT"));
  assert.deepStrictEqual(report.top_null_buckets.entry_fills_intent_id_null, []);
  assert.strictEqual(report.top_null_buckets.external_reconciled_fills_intent_id_null[0].key, "EXIT_EXTERNAL_SYNC|EXTERNAL_FILL_RECONCILED");
  assert.strictEqual(report.top_null_buckets.external_reconciled_fills_intent_id_null[0].n, 1);

  console.log("SIGNAL_LINEAGE_HEALTH_TEST_OK");
})();
