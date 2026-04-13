"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-regime-lineage-gap");

function run() {
  const summarizeMissing = __test && __test.summarizeMissing;
  const buildReport = __test && __test.buildReport;
  const isRegimeApplicable = __test && __test.isRegimeApplicable;
  assert.strictEqual(typeof summarizeMissing, "function", "summarizeMissing export missing");
  assert.strictEqual(typeof buildReport, "function", "buildReport export missing");
  assert.strictEqual(typeof isRegimeApplicable, "function", "isRegimeApplicable export missing");

  assert.strictEqual(isRegimeApplicable("signals", { event: "LONG" }), true);
  assert.strictEqual(isRegimeApplicable("signals", { event: "EXIT_TRAIL" }), false);
  assert.strictEqual(isRegimeApplicable("order_intents_paper", { event: "FORCE_EXIT_ALL", event_intent: "EXIT" }), false);
  assert.strictEqual(isRegimeApplicable("order_intents_paper", { event: "LONG", event_intent: "ENTRY" }), true);

  const summary = summarizeMissing([
    { id: "SIG1", symbol: "BTCUSDT", event: "LONG", regime: "trend", created_at: "2026-04-13T00:00:00.000Z" },
    { id: "SIG2", symbol: "ETHUSDT", event: "SHORT", features_json: { pro_regime_state: "range" }, created_at: "2026-04-13T00:01:00.000Z" },
    { id: "SIG3", symbol: "ETHUSDT", event: "LONG", features_json: {}, created_at: "2026-04-13T00:02:00.000Z" },
    { id: "SIG4", symbol: "ETHUSDT", event: "EXIT_TRAIL", features_json: {}, created_at: "2026-04-13T00:03:00.000Z" },
  ], "signals");
  assert.strictEqual(summary.scoped_n, 3);
  assert.strictEqual(summary.missing_n, 1);
  assert.strictEqual(summary.top_symbols[0].symbol, "ETHUSDT");

  const report = buildReport({
    signals: [{ id: "SIG3", symbol: "ETHUSDT", event: "LONG", features_json: {} }],
    intents: [{ id: "I1", symbol: "ETHUSDT", event: "FORCE_EXIT_ALL", event_intent: "EXIT", features_json: {} }],
    fills: [{ id: "F1", symbol: "ETHUSDT", event: "EXIT_TRAIL", features_json: {} }],
  });
  assert.strictEqual(report.signals.missing_n, 1);
  assert.strictEqual(report.intents.missing_n, 0);
  assert.strictEqual(report.fills.missing_n, 0);

  console.log("REGIME_LINEAGE_GAP_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("REGIME_LINEAGE_GAP_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
