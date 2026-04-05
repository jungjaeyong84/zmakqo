"use strict";

const assert = require("assert");
const {
  ML_DATASET_SCHEMA_VERSION,
  buildMlTrainingRow,
  validateMlTrainingRow,
  summarizeMlTrainingRows,
} = require("../utils/mlDatasetSchema");

function run() {
  const row = buildMlTrainingRow({
    signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1000__CORE_LONG",
    signal_key: "BTCUSDT__15m__1000__CORE_LONG",
    entry_event_id: "ENTRY__BINANCEFUT__BTCUSDT__15m__1000__CORE_LONG",
    provider: "BINANCEFUT",
    market: "BTCUSDT",
    tf: "15m",
    side: "LONG",
    event: "CORE_LONG",
    source_row_type: "EXECUTED",
    signal_bar_close_time_utc_ms: 1000,
    integrity_verdict: "PASS",
    quality_verdict: "PASS",
    state_soft_sizing_verdict: "ALLOW",
    ev_verdict: "ALLOW",
    wait_verdict: "ALLOW",
    partial_fill: false,
    fills_n: 1,
    trades_n: 1,
    drops_n: 0,
    fill_status: "FILLED",
    outcome_state: "REALIZED",
    tp1_first: true,
    realized_ret_net: 0.012,
    realized_pnl_quote: 1000,
    features_json: {
      febt_phase: "FIRE",
      some_feature: 7,
    },
  });

  assert.strictEqual(row.schema_version, ML_DATASET_SCHEMA_VERSION);
  assert.strictEqual(row.context.market, "BTCUSDT");
  assert.strictEqual(row.labels.is_realized, true);
  assert.strictEqual(row.features.some_feature, 7);

  const validation = validateMlTrainingRow(row);
  assert.strictEqual(validation.ok, true);

  const summary = summarizeMlTrainingRows([row]);
  assert.strictEqual(summary.rows_n, 1);
  assert.strictEqual(summary.valid_n, 1);
  assert.strictEqual(summary.realized_n, 1);

  console.log("ML_DATASET_SCHEMA_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("ML_DATASET_SCHEMA_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
