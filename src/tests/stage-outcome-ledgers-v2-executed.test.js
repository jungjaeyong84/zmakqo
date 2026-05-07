"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/lib/stage-outcome-ledgers");

function run() {
  const decisionEvidenceRows = [
    {
      id: "bundle-1",
      signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__TIAUSDT__LONG__abc",
      openclaw_decision_id: "OCDV2__abc",
      bundle_payload: {
        signalIntent: {
          signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__TIAUSDT__LONG__abc",
          symbol: "TIAUSDT",
          side: "LONG",
          timing_tier: "EARLY",
        },
        signalCriteria: {
          entry_grade: "EARLY",
          expected_edge_model: {
            tp1_reach_probability: 0.6421,
          },
        },
      },
    },
  ];

  const fillsByEntryEventId = new Map([
    ["ENTRYV2__TIA__1", [
      {
        id: "fill-entry-1",
        exchange: "BINANCEFUT",
        symbol: "TIAUSDT",
        tf: "15m",
        side: "BUY",
        event: "SYNC_FILL",
        entry_event_id: "ENTRYV2__TIA__1",
        signal_bar_close_time_utc_ms: 1_000,
        signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__TIAUSDT__LONG__abc",
      },
      {
        id: "fill-exit-1",
        exchange: "BINANCEFUT",
        symbol: "TIAUSDT",
        tf: "15m",
        side: "SELL",
        event: "EXIT_TP_P1_2.5P",
        entry_event_id: "ENTRYV2__TIA__1",
        signal_bar_close_time_utc_ms: 1_000,
      },
    ]],
    ["ENTRYV2__ETH__1", [
      {
        id: "fill-entry-2",
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        tf: "15m",
        side: "SELL",
        event: "SYNC_FILL",
        entry_event_id: "ENTRYV2__ETH__1",
        signal_bar_close_time_utc_ms: 2_000,
        signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__ETHUSDT__SHORT__abc",
      },
      {
        id: "fill-exit-2",
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        tf: "15m",
        side: "BUY",
        event: "EXIT_TP_FULL_2.5P",
        entry_event_id: "ENTRYV2__ETH__1",
        signal_bar_close_time_utc_ms: 2_000,
      },
    ]],
  ]);

  const tradeMap = new Map([
    ["ENTRYV2__TIA__1", {
      entry_event_id: "ENTRYV2__TIA__1",
      pnl_krw: 1210,
      pnl_pct: 0.025,
    }],
  ]);

  const rows = __test.buildExecutedEntryRowsFromV2Fills({
    provider: "BINANCEFUT",
    tf: "15m",
    fillsByEntryEventId,
    tradeMap,
    decisionEvidenceRows,
    nowMs: 1_000 + (13 * 60 * 60 * 1000),
    maturityMs: 12 * 60 * 60 * 1000,
    existingEntryEventIds: new Set(),
  });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].stage4_source, "EXECUTED_ENTRY_V2");
  assert.strictEqual(rows[0].entry_event_id, "ENTRYV2__TIA__1");
  assert.strictEqual(rows[0].signal_intent_id, "SIGINTV2__SERVER_NATIVE_ML_AI__TIAUSDT__LONG__abc");
  assert.strictEqual(rows[0].predicted, 0.6421);
  assert.strictEqual(rows[0].probability, 0.6421);
  assert.strictEqual(rows[0].lower_bound, 0.6421);
  assert.strictEqual(rows[0].outcome, "TP1_HIT");
  assert.strictEqual(rows[0].resolved_for_tune, true);
  assert.strictEqual(rows[0].realized_pnl_quote, 1210);
  assert.strictEqual(rows[0].realized_ret_net, 0.025);

  const explicitOutcome = __test.classifyEntryOutcome({
    entry_event_id: "ENTRYV2__TIA__1",
    signal_bar_close_time_utc_ms: 1_000,
  }, fillsByEntryEventId, 1_000 + (13 * 60 * 60 * 1000), 12 * 60 * 60 * 1000);
  assert.strictEqual(explicitOutcome.status, "TP1_HIT");

  const fullTpOutcome = __test.classifyEntryOutcome({
    entry_event_id: "ENTRYV2__ETH__1",
    signal_bar_close_time_utc_ms: 2_000,
  }, fillsByEntryEventId, 2_000 + (13 * 60 * 60 * 1000), 12 * 60 * 60 * 1000);
  assert.strictEqual(fullTpOutcome.status, "TP1_HIT");

  console.log("STAGE_OUTCOME_LEDGERS_V2_EXECUTED_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("STAGE_OUTCOME_LEDGERS_V2_EXECUTED_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
