"use strict";

const assert = require("assert");
const { buildExecutionModelRows, summarizeExecutionModelRows, splitExecutionModelRows } = require("../utils/executionModelDataset");

const intents = {
  rows: [
    {
      id: 'I1', intent_id: 'I1', signal_id: 'S1', entry_event_id: 'E1', exchange: 'BINANCEFUT', symbol: 'ETHUSDT', tf: '15m', event: 'SHORT', side: 'SELL',
      created_at: '2026-04-05T00:00:00.000Z', live_exec_policy_quality_latency_ms: 1200, live_exec_policy_quality_slippage_bps: 4, live_exec_policy_quality_partial_pct: 0,
      features_json: { score_abs: 70.1 }, status: 'FILLED'
    },
    {
      id: 'I2', intent_id: 'I2', signal_id: 'S2', entry_event_id: 'E2', exchange: 'BINANCEFUT', symbol: 'SOLUSDT', tf: '15m', event: 'SHORT', side: 'SELL',
      created_at: '2026-04-05T01:00:00.000Z', terminal_failure_status: 'REJECTED', status_reason: 'MARGIN', features_json: { score_abs: 80.2 }, status: 'FAILED'
    }
  ]
};
const fills = {
  rows: [
    { fill_id: 'F1', intent_id: 'I1', exchange: 'BINANCEFUT', symbol: 'ETHUSDT', tf: '15m', event: 'SHORT', created_at: '2026-04-05T00:00:02.000Z', exec_price: 100, slippage_bps: 3, live_exec_policy_quality_partial_pct: 25 },
    { fill_id: 'F2', intent_id: 'I1', exchange: 'BINANCEFUT', symbol: 'ETHUSDT', tf: '15m', event: 'SHORT', created_at: '2026-04-05T00:00:03.000Z', exec_price: 101, slippage_bps: 5, live_exec_policy_quality_partial_pct: 25 },
  ]
};

const rows = buildExecutionModelRows({ intents, fills });
assert.equal(rows.length, 2);
assert.equal(rows[0].labels.was_filled, true);
assert.equal(rows[0].labels.was_partial, true);
assert.equal(rows[0].labels.was_rejected, false);
assert.equal(rows[0].execution.created_to_fill_ms, 2000);
assert.equal(rows[0].execution.created_to_fill_source, 'FILL_CHAIN');
assert.equal(rows[0].labels.created_to_fill_measured, true);
assert.equal(rows[0].execution.slippage_bps, 4);
assert.equal(rows[1].labels.was_rejected, true);
const summary = summarizeExecutionModelRows(rows);
assert.equal(summary.rows_n, 2);
assert.equal(summary.entry_rows_n, 2);
assert.equal(summary.exit_rows_n, 0);
assert.equal(summary.filled_n, 1);
assert.equal(summary.partial_n, 1);
assert.equal(summary.rejected_n, 1);
assert.equal(summary.created_to_fill_measured_p95_ms, 2000);
assert.equal(summary.by_primary_fill_source[0].key, 'NO_FILL');
assert.equal(summary.by_primary_fill_source[0].slippage_missing_n, 1);
assert.equal(summary.by_primary_fill_source[1].key, 'UNKNOWN');
assert.equal(summary.by_primary_fill_source[1].slippage_measured_n, 1);
const split = splitExecutionModelRows(rows);
assert.equal(split.entry_rows.length, 2);
assert.equal(split.exit_rows.length, 0);

const recomputedRows = buildExecutionModelRows({
  intents: {
    rows: [
      {
        id: 'I3', intent_id: 'I3', signal_id: 'S3', exchange: 'BINANCEFUT', symbol: 'BNBUSDT', tf: '15m', event: 'LONG', side: 'BUY',
        created_at: '2026-04-05T02:00:00.000Z', signal_price: 100, status: 'FILLED'
      }
    ]
  },
  fills: {
    rows: [
      { fill_id: 'F3', intent_id: 'I3', exchange: 'BINANCEFUT', symbol: 'BNBUSDT', tf: '15m', event: 'LONG', side: 'BUY', created_at: '2026-04-05T02:00:01.000Z', exec_price: 101, slippage_bps: 0 }
    ]
  }
});
assert.ok(recomputedRows[0].execution.slippage_bps > 0, 'signal-price fallback must recompute positive adverse slippage');
console.log('EXECUTION_MODEL_DATASET_TEST_OK');
