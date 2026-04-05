"use strict";

const assert = require("assert");
const { summarizeExecutionStageLatency } = require("../utils/executionStageLatency");

(() => {
  const report = summarizeExecutionStageLatency({
    rows: [
      {
        context: { source: "TV_WEBHOOK", event: "EARLY_SHORT", market: "XRPUSDT", is_exit_event: false },
        execution: { webhook_decision: "SAVED" },
        labels: {
          signal_to_intent_ms: 900000,
          webhook_to_outcome_ms: 1200,
          webhook_to_intent_ms: 890000,
          created_to_fill_ms: 45000,
          created_to_fill_measured: true,
        },
      },
      {
        context: { source: "TV_WEBHOOK", event: "EARLY_SHORT", market: "XRPUSDT", is_exit_event: false },
        execution: { webhook_decision: "SAVED" },
        labels: {
          signal_to_intent_ms: 600000,
          webhook_to_outcome_ms: 1300,
          webhook_to_intent_ms: 590000,
          created_to_fill_ms: 47000,
          created_to_fill_measured: false,
        },
      },
      {
        context: { source: "LIVE_RUNTIME", event: "REAL_SHORT", market: "SOLUSDT", is_exit_event: false },
        execution: { webhook_decision: null },
        labels: {
          signal_to_intent_ms: 30000,
          created_to_fill_ms: 20000,
          created_to_fill_measured: true,
        },
      },
    ],
  });

  assert.strictEqual(report.status, "EXECUTION_STAGE_LATENCY_READY");
  assert.strictEqual(report.entry_rows_n, 3);
  assert.strictEqual(report.signal_to_intent_p95_ms, 900000);
  assert.strictEqual(report.webhook_saved_to_intent_p95_ms, 890000);
  assert.strictEqual(report.webhook_to_outcome_p95_ms, 1300);
  assert.strictEqual(report.intent_to_fill_measured_p95_ms, 45000);
  assert.strictEqual(report.intent_to_fill_fallback_p95_ms, 47000);
  assert.strictEqual(report.top_webhook_saved_to_intent_groups[0].key, "TV_WEBHOOK|EARLY_SHORT|XRPUSDT");
  assert.strictEqual(report.top_intent_to_fill_measured_groups[0].key, "TV_WEBHOOK|EARLY_SHORT|XRPUSDT");

  console.log("EXECUTION_STAGE_LATENCY_TEST_OK");
})();
