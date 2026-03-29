"use strict";

const assert = require("assert");
const {
  buildUnifiedLearningRows,
  summarizeBestSelfEvolutionDataset,
  __test,
} = require("../utils/bestSelfEvolutionDataset");

function run() {
  const execEntryEventId = "ENTRY__BINANCEFUT__DOGEUSDT__15m__1000__CORE_SHORT";
  const rows = buildUnifiedLearningRows({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "DOGEUSDT",
        tf: "15m",
        event: "CORE_SHORT",
        side: "SELL",
        signal_id: "SIG_EXEC",
        bar_close_time_utc_ms: 1000,
        features_json: {
          signal_id: "SIG_EXEC",
          febt_phase: "FIRE",
          market_state_summary_action: "ALLOW",
          ev_gate_action: "ALLOW",
          wait_one_bar_action: "ALLOW",
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "BTCUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: "SIG_MISS",
        bar_close_time_utc_ms: 3000,
        features_json: {
          signal_id: "SIG_MISS",
          febt_phase: "PREPARE",
        },
      },
    ],
    drops: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "DOGEUSDT",
        tf: "15m",
        event: "CORE_LONG",
        side: "BUY",
        signal_id: "SIG_DROP",
        bar_close_time_utc_ms: 2000,
        drop_reason_code: "DROP_WAIT_ONE_BAR_TIMING",
        features_json: {
          signal_id: "SIG_DROP",
          wait_one_bar_action: "WAIT_ONE_BAR",
          febt_phase: "LATE",
        },
      },
    ],
    intents: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "DOGEUSDT",
        tf: "15m",
        event: "CORE_SHORT",
        side: "SELL",
        signal_id: "SIG_EXEC",
        signal_bar_close_time_utc_ms: 1000,
        created_at: "2026-03-29T00:15:10.000Z",
        status: "FILLED",
        features_json: {
          signal_id: "SIG_EXEC",
          febt_phase: "FIRE",
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "CORE_LONG",
        side: "BUY",
        signal_id: "SIG_REJECT",
        signal_bar_close_time_utc_ms: 4000,
        created_at: "2026-03-29T00:16:00.000Z",
        status: "CANCELED",
        status_reason: "DROP_ACTION_FILTER",
      },
    ],
    fills: [
      {
        exchange: "BINANCEFUT",
        symbol: "DOGEUSDT",
        tf: "15m",
        side: "SELL",
        event: "CORE_SHORT",
        signal_id: "SIG_EXEC",
        entry_event_id: execEntryEventId,
        entry_signal_type: "CORE_SHORT",
        signal_bar_close_time_utc_ms: 1000,
        exec_bar_close_time_utc_ms: 1000,
        created_at: "2026-03-29T00:15:20.000Z",
        features_json: {
          signal_id: "SIG_EXEC",
          febt_phase: "FIRE",
          wait_one_bar_action: "ALLOW",
          ev_gate_action: "ALLOW",
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol: "DOGEUSDT",
        tf: "15m",
        side: "BUY",
        event: "EXIT_TP_P1",
        signal_id: "SIG_EXEC",
        entry_event_id: execEntryEventId,
        entry_signal_type: "CORE_SHORT",
        signal_bar_close_time_utc_ms: 1000,
        exec_bar_close_time_utc_ms: 1300,
        created_at: "2026-03-29T00:20:00.000Z",
        features_json: {
          signal_id: "SIG_EXEC",
          febt_phase: "FIRE",
        },
      },
    ],
    trades: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "DOGEUSDT",
        tf: "15m",
        entry_event_id: execEntryEventId,
        entry_signal_type: "CORE_SHORT",
        exec_bar_close_time_utc_ms: 1300,
        close_ms: 1300,
        close_type: "FULL_CLOSE",
        pnl_krw: 50,
        notional_krw: 1000,
        features_json: {
          signal_id: "SIG_EXEC",
          febt_phase: "FIRE",
        },
      },
    ],
    provider: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 10000,
    qualitySummary: {
      chain_rows: [
        {
          entry_event_id: execEntryEventId,
          realized: true,
          realized_ret_net: 0.05,
          first_exit_kind: "TP1",
          tp1_hit: true,
          sl_before_tp1: false,
          trail_after_tp1: false,
        },
      ],
    },
  });

  const byId = new Map(rows.map((row) => [row.signal_id || row.signal_key, row]));
  const executed = byId.get("SIG_EXEC");
  const dropped = byId.get("SIG_DROP");
  const missed = byId.get("SIG_MISS");
  const rejected = byId.get("SIG_REJECT");

  assert.strictEqual(executed.source_row_type, "EXECUTED");
  assert.strictEqual(executed.tp1_first, true);
  assert.strictEqual(executed.realized_ret_net, 0.05);
  assert.strictEqual(executed.wait_verdict, "ALLOW");

  assert.strictEqual(dropped.source_row_type, "DROP");
  assert.strictEqual(dropped.drop_stage_key, "TIMING");
  assert.strictEqual(dropped.wait_verdict, "DROP");

  assert.strictEqual(missed.source_row_type, "MISSED");
  assert.strictEqual(rejected.source_row_type, "REJECTED");
  assert.strictEqual(rejected.drop_stage_key, "OPS");

  const summary = summarizeBestSelfEvolutionDataset(rows);
  assert.strictEqual(summary.rows_n, 4);
  assert.strictEqual(summary.executed_n, 1);
  assert.strictEqual(summary.drop_n, 1);
  assert.strictEqual(summary.missed_n, 1);
  assert.strictEqual(summary.rejected_n, 1);
  assert.strictEqual(summary.realized_n, 1);
  assert.strictEqual(summary.by_source_row_type[0].key, "DROP");

  assert.strictEqual(__test.resolveSourceSignalKeyFromEntryEventId(execEntryEventId), "DOGEUSDT__15m__1000__CORE_SHORT");
  assert.strictEqual(__test.buildDropStageKey("DROP_EV_GATE_TP1_PROB"), "EV");
  assert.strictEqual(__test.classifyExitEvent("EXIT_TP_P1"), "TP1");

  console.log("BEST_SELF_EVOLUTION_DATASET_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_DATASET_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
