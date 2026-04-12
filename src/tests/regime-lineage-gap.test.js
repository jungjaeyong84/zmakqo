"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-regime-lineage-gap");

function run() {
  const summarizeMissing = __test && __test.summarizeMissing;
  const buildReport = __test && __test.buildReport;
  assert.strictEqual(typeof summarizeMissing, "function", "summarizeMissing export missing");
  assert.strictEqual(typeof buildReport, "function", "buildReport export missing");

  const summary = summarizeMissing([
    { id: "SIG1", symbol: "BTCUSDT", regime: "trend", created_at: "2026-04-13T00:00:00.000Z" },
    { id: "SIG2", symbol: "ETHUSDT", features_json: { pro_regime_state: "range" }, created_at: "2026-04-13T00:01:00.000Z" },
    { id: "SIG3", symbol: "ETHUSDT", features_json: {}, created_at: "2026-04-13T00:02:00.000Z" },
  ]);
  assert.strictEqual(summary.scoped_n, 3);
  assert.strictEqual(summary.missing_n, 1);
  assert.strictEqual(summary.top_symbols[0].symbol, "ETHUSDT");

  const report = buildReport({
    signals: [{ id: "SIG3", symbol: "ETHUSDT", features_json: {} }],
    intents: [],
    fills: [],
  });
  assert.strictEqual(report.signals.missing_n, 1);
  assert.strictEqual(report.intents.missing_n, 0);

  console.log("REGIME_LINEAGE_GAP_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("REGIME_LINEAGE_GAP_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
