"use strict";

const assert = require("assert");
const {
  buildUnifiedLearningRows,
  summarizeBestSelfEvolutionDataset,
  __test,
} = require("../utils/bestSelfEvolutionDataset");

function run() {
  const execEntryEventId = "ENTRY__BINANCEFUT__DOGEUSDT__15m__1000__CORE_SHORT";
  const tradeOnlySignalId = "SIG__BINANCEFUT__BNBUSDT__15m__5000__EARLY_LONG";
  const tradeOnlyEntryEventId = "ENTRY__BINANCEFUT__BNBUSDT__15m__5000__EARLY_LONG";
  const legacyEntryEventId = "BINANCEFUT|SOLUSDT|15m|6000|EARLY_SHORT|EARLY_SHORT";
  const legacySignalDocId = "SIG__BINANCEFUT__SOLUSDT__15m__6000__EARLY_SHORT";
  const chainOnlySignalId = "SIG__BINANCEFUT__XRPUSDT__15m__8000__CORE_LONG";
  const chainOnlyEntryEventId = "ENTRY__BINANCEFUT__XRPUSDT__15m__8000__CORE_LONG";
  const tp0SignalId = "SIG__BINANCEFUT__ETHUSDT__15m__9000__CORE_SHORT";
  const tp0EntryEventId = "ENTRY__BINANCEFUT__ETHUSDT__15m__9000__CORE_SHORT";
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
        symbol_or_pair_id: "BNBUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: tradeOnlySignalId,
        bar_close_time_utc_ms: 5000,
        features_json: {
          signal_id: tradeOnlySignalId,
          febt_phase: "ARMED",
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "SOLUSDT",
        tf: "15m",
        event: "EARLY_SHORT",
        side: "SELL",
        signal_id: legacySignalDocId,
        bar_close_time_utc_ms: 6000,
        features_json: {
          signal_id: legacySignalDocId,
          febt_phase: "FIRE",
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
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "XRPUSDT",
        tf: "15m",
        event: "CORE_LONG",
        side: "BUY",
        signal_id: chainOnlySignalId,
        bar_close_time_utc_ms: 8000,
        features_json: {
          signal_id: chainOnlySignalId,
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "CORE_SHORT",
        side: "SELL",
        signal_id: tp0SignalId,
        bar_close_time_utc_ms: 9000,
        features_json: {
          signal_id: tp0SignalId,
          febt_phase: "FIRE",
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
        symbol: "SOLUSDT",
        tf: "15m",
        side: "SELL",
        event: "EARLY_SHORT",
        signal_id: "SOLUSDT.P|15|EARLY_SHORT|6000|-1|DROP|BAR_CLOSE",
        signal_doc_id: legacySignalDocId,
        entry_event_id: legacyEntryEventId,
        entry_signal_type: "EARLY_SHORT",
        signal_bar_close_time_utc_ms: 6000,
        exec_bar_close_time_utc_ms: 6000,
        created_at: "2026-03-29T00:25:00.000Z",
      },
      {
        exchange: "BINANCEFUT",
        symbol: "SOLUSDT",
        tf: "15m",
        side: "BUY",
        event: "EXIT_TP_P1_2.5P",
        signal_id: "SOLUSDT.P|15|EARLY_SHORT|6000|-1|DROP|BAR_CLOSE",
        signal_doc_id: legacySignalDocId,
        entry_event_id: legacyEntryEventId,
        entry_signal_type: "EARLY_SHORT",
        signal_bar_close_time_utc_ms: 6000,
        exec_bar_close_time_utc_ms: 6300,
        notional_krw: 1000,
        external_realized_pnl: 110,
        created_at: "2026-03-29T00:30:00.000Z",
      },
      {
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        tf: "15m",
        side: "BUY",
        event: "EXIT_EXTERNAL_SYNC",
        entry_event_id: null,
        signal_bar_close_time_utc_ms: 7000,
        exec_bar_close_time_utc_ms: 7000,
        created_at: "2026-03-29T00:35:00.000Z",
      },
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
      {
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        tf: "15m",
        side: "SELL",
        event: "CORE_SHORT",
        signal_id: tp0SignalId,
        entry_event_id: tp0EntryEventId,
        entry_signal_type: "CORE_SHORT",
        signal_bar_close_time_utc_ms: 9000,
        exec_bar_close_time_utc_ms: 9000,
        created_at: "2026-03-29T00:55:00.000Z",
      },
      {
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        tf: "15m",
        side: "BUY",
        event: "EXIT_TP_P0_0.8P",
        signal_id: tp0SignalId,
        entry_event_id: tp0EntryEventId,
        entry_signal_type: "CORE_SHORT",
        signal_bar_close_time_utc_ms: 9000,
        exec_bar_close_time_utc_ms: 9200,
        created_at: "2026-03-29T00:58:00.000Z",
      },
      {
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        tf: "15m",
        side: "BUY",
        event: "EXIT_TIME_STOP_4B",
        signal_id: tp0SignalId,
        entry_event_id: tp0EntryEventId,
        entry_signal_type: "CORE_SHORT",
        signal_bar_close_time_utc_ms: 9000,
        exec_bar_close_time_utc_ms: 9500,
        created_at: "2026-03-29T01:01:00.000Z",
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
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "BNBUSDT",
        tf: "15m",
        event: "EXIT_TP_P1_2.5P",
        side: "BUY",
        entry_event_id: tradeOnlyEntryEventId,
        exec_bar_close_time_utc_ms: 5300,
        open_ms: 5050,
        close_ms: 5300,
        close_type: "FULL_CLOSE",
        pnl: 120,
        pnl_pct: 0.12,
        notional_krw: 1000,
        exit_event: "EXIT_TP_P1_2.5P",
        features_json: {
          signal_id: tradeOnlySignalId,
          febt_phase: "ARMED",
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
          mfe: 0.06,
          mae: -0.02,
          sl_before_tp1: false,
          trail_after_tp1: false,
        },
        {
          entry_event_id: chainOnlyEntryEventId,
          realized: false,
          febt_phase: "ARMED",
          febt_edge: 0.42,
          febt_lock_score: 0.77,
          febt_timing_action: "ALLOW",
          febt_authority: "SHADOW",
        },
      ],
    },
    evTunerReport: {
      recent_resolved_examples: [
        {
          signalId: "DOGEUSDT__15m__2000__CORE_LONG",
          symbol: "DOGEUSDT",
          event: "CORE_LONG",
          realizedPnlQuote: 30,
          realizedRetNet: 0.03,
          stage4Source: "EV_DROP",
          resolvedForTune: true,
        },
      ],
    },
  });

  const byId = new Map(rows.map((row) => [row.signal_id || row.signal_key, row]));
  const executed = byId.get("SIG_EXEC");
  const dropped = byId.get("SIG_DROP");
  const missed = byId.get("SIG_MISS");
  const rejected = byId.get("SIG_REJECT");
  const tradeOnly = byId.get(tradeOnlySignalId);
  const legacyLinked = byId.get(legacySignalDocId);
  const chainOnly = byId.get(chainOnlySignalId);
  const tp0Timed = byId.get(tp0SignalId);
  const exitOnlySync = rows.find((row) => row.event === "EXIT_EXTERNAL_SYNC");

  assert.strictEqual(executed.source_row_type, "EXECUTED");
  assert.strictEqual(executed.tp1_first, true);
  assert.strictEqual(executed.tp0_to_tp1_converted, false);
  assert.strictEqual(executed.mfe_pct, 0.06);
  assert.strictEqual(executed.mae_pct, -0.02);
  assert.strictEqual(executed.realized_ret_net, 0.05);
  assert.strictEqual(executed.outcome_state, "REALIZED");
  assert.strictEqual(executed.wait_verdict, "ALLOW");

  assert.strictEqual(dropped.source_row_type, "DROP");
  assert.strictEqual(dropped.drop_stage_key, "TIMING");
  assert.strictEqual(dropped.wait_verdict, "DROP");
  assert.strictEqual(dropped.realized_ret_net, 0.03);
  assert.strictEqual(dropped.realized_source, "EV_TUNER_COUNTERFACTUAL");

  assert.strictEqual(missed.source_row_type, "MISSED");
  assert.strictEqual(rejected.source_row_type, "REJECTED");
  assert.strictEqual(rejected.drop_stage_key, "OPS");
  assert.strictEqual(tradeOnly.source_row_type, "EXECUTED");
  assert.strictEqual(tradeOnly.tp1_first, true);
  assert.strictEqual(tradeOnly.realized_ret_net, 0.12);
  assert.strictEqual(tradeOnly.outcome_state, "REALIZED");
  assert.strictEqual(legacyLinked.source_row_type, "EXECUTED");
  assert.strictEqual(legacyLinked.entry_event_id, "ENTRY__BINANCEFUT__SOLUSDT__15m__6000__EARLY_SHORT");
  assert.strictEqual(legacyLinked.tp1_first, true);
  assert.strictEqual(legacyLinked.realized_ret_net, 0.11);
  assert.strictEqual(legacyLinked.outcome_state, "REALIZED");
  assert.strictEqual(legacyLinked.features_json.entry_event_id, "ENTRY__BINANCEFUT__SOLUSDT__15m__6000__EARLY_SHORT");
  assert.strictEqual(legacyLinked.features_json.entry_signal_type, "EARLY_SHORT");
  assert.strictEqual(chainOnly.source_row_type, "MISSED");
  assert.strictEqual(chainOnly.febt_phase, "ARMED");
  assert.strictEqual(chainOnly.febt_edge, 0.42);
  assert.strictEqual(chainOnly.febt_lock_score, 0.77);
  assert.strictEqual(tp0Timed.source_row_type, "EXECUTED");
  assert.strictEqual(tp0Timed.tp0_hit, true);
  assert.strictEqual(tp0Timed.tp0_first, true);
  assert.strictEqual(tp0Timed.tp0_to_tp1_converted, false);
  assert.strictEqual(tp0Timed.time_stop_hit, true);
  assert.strictEqual(tp0Timed.time_stop_first, false);
  assert.strictEqual(tp0Timed.pre_tp1_time_stop, true);
  assert.ok(tp0Timed.time_to_tp0_minutes > 0);
  assert.strictEqual(tp0Timed.outcome_state, "EXIT_PRESENT_UNLABELED");
  assert.strictEqual(exitOnlySync.source_row_type, "EXIT_ONLY");
  assert.strictEqual(exitOnlySync.outcome_state, "EXIT_PRESENT_UNLABELED");

  const summary = summarizeBestSelfEvolutionDataset(rows);
  assert.strictEqual(summary.rows_n, 9);
  assert.strictEqual(summary.executed_n, 4);
  assert.strictEqual(summary.drop_n, 1);
  assert.strictEqual(summary.missed_n, 2);
  assert.strictEqual(summary.rejected_n, 1);
  assert.strictEqual(summary.exit_only_n, 1);
  assert.strictEqual(summary.realized_n, 3);
  assert.strictEqual(summary.all_realized_n, 4);
  assert.strictEqual(summary.ev_counterfactual_n, 1);
  assert.strictEqual(summary.entry_pending_total_n, 1);
  assert.strictEqual(summary.entry_executed_null_realized_n, 1);
  assert.strictEqual(summary.entry_fallback_pending_n, 0);
  assert.strictEqual(summary.entry_exit_present_unlabeled_n, 1);
  assert.strictEqual(summary.entry_open_pending_n, 0);
  assert.strictEqual(summary.entry_link_missing_n, 0);
  assert.ok(Array.isArray(summary.entry_fallback_pending_by_reason));
  assert.ok(Array.isArray(summary.febt_eligible_by_market));
  assert.ok(Array.isArray(summary.febt_eligible_by_event));
  assert.strictEqual(summary.active_entry_n, 8);
  assert.strictEqual(summary.legacy_entry_n, 0);
  assert.ok(summary.active_entry_family_counts.some((item) => item.key === "CORE_LONG" && item.count === 3));
  assert.ok(summary.active_entry_family_counts.some((item) => item.key === "EARLY_LONG" && item.count === 2));
  assert.strictEqual(summary.entry_fallback_pending_active_n, 0);
  assert.strictEqual(summary.entry_fallback_pending_legacy_n, 0);
  assert.strictEqual(summary.entry_fallback_payload_missing_n, 0);
  assert.strictEqual(summary.entry_fallback_payload_missing_linked_n, 0);
  assert.deepStrictEqual(summary.entry_fallback_payload_missing_by_cause, []);
  assert.deepStrictEqual(summary.entry_fallback_payload_missing_by_market, []);
  assert.deepStrictEqual(summary.entry_fallback_payload_missing_by_event, []);
  assert.deepStrictEqual(summary.entry_fallback_payload_missing_by_family, []);
  assert.deepStrictEqual(summary.entry_fallback_pending_active_by_event, []);
  assert.strictEqual(summary.febt_active_eligible_n, 7);
  assert.strictEqual(summary.febt_active_missing_n, 0);
  assert.strictEqual(summary.febt_coverage_rate_active_eligible, 1);
  assert.ok(summary.febt_active_eligible_by_family.some((item) => item.key === "CORE_LONG" && item.eligible_n === 2));
  assert.ok(summary.febt_eligible_by_canonical_event.some((item) => item.key === "LONG"));
  assert.ok(summary.febt_active_eligible_by_event.some((item) => item.key === "LONG"));
  assert.strictEqual(summary.febt_active_low_coverage_events.length, 0);
  assert.strictEqual(summary.febt_active_coverage_gap_by_event, null);
  assert.strictEqual(summary.executed_exit_only_n, 1);
  assert.ok(summary.febt_coverage_rate > 0.5);
  assert.ok(summary.febt_coverage_rate_eligible >= summary.febt_coverage_rate);
  assert.ok(summary.febt_coverage_rate_active_eligible >= summary.febt_coverage_rate);
  assert.ok(summary.febt_eligible_n >= summary.executed_n);
  assert.strictEqual(summary.by_source_row_type[0].key, "EXECUTED");
  assert.ok(summary.all_realized_source_counts.some((item) => item.key === "EV_TUNER_COUNTERFACTUAL" && item.count === 1));

  assert.strictEqual(__test.resolveSourceSignalKeyFromEntryEventId(execEntryEventId), "DOGEUSDT__15m__1000__CORE_SHORT");
  assert.strictEqual(__test.resolveSourceSignalKeyFromEntryEventId(legacyEntryEventId), "SOLUSDT__15m__6000__EARLY_SHORT");
  assert.strictEqual(__test.resolveSourceSignalKeyFromSignalId(tradeOnlySignalId), "BNBUSDT__15m__5000__EARLY_LONG");
  assert.strictEqual(__test.normalizeEntryEventId(legacyEntryEventId), "ENTRY__BINANCEFUT__SOLUSDT__15m__6000__EARLY_SHORT");
  assert.strictEqual(__test.resolveSyntheticEntryEventId({
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "BNBUSDT",
    tf: "15m",
    event: "EARLY_LONG",
    signal_id: tradeOnlySignalId,
    bar_close_time_utc_ms: 5000,
  }), tradeOnlyEntryEventId);
  assert.strictEqual(__test.buildDropStageKey("DROP_EV_GATE_TP1_PROB"), "EV");
  assert.strictEqual(__test.classifyExitEvent("EXIT_TP_P0_0.8P"), "TP0");
  assert.strictEqual(__test.classifyExitEvent("EXIT_TP_P1"), "TP1");
  assert.strictEqual(__test.classifyExitEvent("EXIT_TIME_STOP_4B"), "TIME_STOP");

  const priceOnlyRows = buildUnifiedLearningRows({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "LTCUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: "SIG__BINANCEFUT__LTCUSDT__15m__9000__EARLY_LONG",
        bar_close_time_utc_ms: 9000,
      },
    ],
    fills: [
      {
        exchange: "BINANCEFUT",
        symbol: "LTCUSDT",
        tf: "15m",
        side: "BUY",
        event: "EARLY_LONG",
        signal_id: "SIG__BINANCEFUT__LTCUSDT__15m__9000__EARLY_LONG",
        signal_doc_id: "SIG__BINANCEFUT__LTCUSDT__15m__9000__EARLY_LONG",
        entry_event_id: "BINANCEFUT|LTCUSDT|15m|9000|EARLY_LONG|EARLY_LONG",
        entry_signal_type: "EARLY_LONG",
        signal_bar_close_time_utc_ms: 9000,
        exec_bar_close_time_utc_ms: 9000,
        exec_price: 100,
        notional_krw: 1000,
        created_at: "2026-03-29T00:40:00.000Z",
      },
      {
        exchange: "BINANCEFUT",
        symbol: "LTCUSDT",
        tf: "15m",
        side: "SELL",
        event: "EXIT_TRAIL_1P",
        entry_event_id: "BINANCEFUT|LTCUSDT|15m|9000|EARLY_LONG|EARLY_LONG",
        entry_signal_type: "EARLY_LONG",
        signal_bar_close_time_utc_ms: 9000,
        exec_bar_close_time_utc_ms: 9300,
        exec_price: 110,
        notional_krw: 1000,
        created_at: "2026-03-29T00:45:00.000Z",
      },
    ],
    provider: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 10000,
  });
  assert.strictEqual(priceOnlyRows.length, 1);
  assert.strictEqual(priceOnlyRows[0].realized_source, "PRICE_MOVE_ESTIMATE");
  assert.strictEqual(Number(priceOnlyRows[0].realized_ret_net.toFixed(4)), 0.1);
  assert.strictEqual(priceOnlyRows[0].outcome_state, "REALIZED");

  const openPendingRows = buildUnifiedLearningRows({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__9100__EARLY_LONG",
        bar_close_time_utc_ms: 9100,
        features_json: {
          action: "ENTRY",
        },
      },
    ],
    intents: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__9100__EARLY_LONG",
        signal_bar_close_time_utc_ms: 9100,
        created_at: "2026-03-29T00:50:00.000Z",
        status: "FILLED",
        features_json: {
          action: "ENTRY",
        },
      },
    ],
    fills: [
      {
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        tf: "15m",
        side: "BUY",
        event: "EARLY_LONG",
        signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__9100__EARLY_LONG",
        signal_doc_id: "SIG__BINANCEFUT__ETHUSDT__15m__9100__EARLY_LONG",
        entry_event_id: "BINANCEFUT|ETHUSDT|15m|9100|EARLY_LONG|EARLY_LONG",
        entry_signal_type: "EARLY_LONG",
        signal_bar_close_time_utc_ms: 9100,
        exec_bar_close_time_utc_ms: 9100,
        exec_price: 2000,
        notional_krw: 1000,
        created_at: "2026-03-29T00:51:00.000Z",
      },
    ],
    provider: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 10000,
  });
  assert.strictEqual(openPendingRows.length, 1);
  assert.strictEqual(openPendingRows[0].realized_ret_net, null);
  assert.strictEqual(openPendingRows[0].trade_closed_at_ms, null);
  assert.strictEqual(openPendingRows[0].outcome_state, "OPEN_PENDING");

  const featureFallbackRows = buildUnifiedLearningRows({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "XRPUSDT",
        tf: "15m",
        event: "EARLY_SHORT",
        side: "SELL",
        signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__9200__EARLY_SHORT",
        bar_close_time_utc_ms: 9200,
        features_json: {
          pnl_pct: 0.021,
        },
      },
    ],
    fills: [
      {
        exchange: "BINANCEFUT",
        symbol: "XRPUSDT",
        tf: "15m",
        side: "SELL",
        event: "EARLY_SHORT",
        signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__9200__EARLY_SHORT",
        signal_doc_id: "SIG__BINANCEFUT__XRPUSDT__15m__9200__EARLY_SHORT",
        entry_event_id: "BINANCEFUT|XRPUSDT|15m|9200|EARLY_SHORT|EARLY_SHORT",
        entry_signal_type: "EARLY_SHORT",
        signal_bar_close_time_utc_ms: 9200,
        exec_bar_close_time_utc_ms: 9200,
        created_at: "2026-03-29T00:55:00.000Z",
      },
    ],
    qualitySummary: {
      chain_rows: [
        {
          entry_event_id: "ENTRY__BINANCEFUT__XRPUSDT__15m__9200__EARLY_SHORT",
          realized: false,
          first_exit_kind: "TP1",
          tp1_hit: true,
          sl_before_tp1: false,
          trail_after_tp1: false,
        },
      ],
    },
    provider: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 10000,
  });
  assert.strictEqual(featureFallbackRows.length, 1);
  assert.strictEqual(featureFallbackRows[0].realized_source, "ENTRY_FEATURE_RET");
  assert.strictEqual(featureFallbackRows[0].realized_ret_net, 0.021);
  assert.strictEqual(featureFallbackRows[0].outcome_state, "REALIZED");

  const exitOnlyRows = buildUnifiedLearningRows({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "AXSUSDT",
        tf: "15m",
        event: "EXIT_TRAIL_1P",
        side: "BUY",
        signal_id: "SIG__BINANCEFUT__AXSUSDT__15m__9300__EXIT_TRAIL_1P",
        bar_close_time_utc_ms: 9300,
      },
    ],
    fills: [
      {
        exchange: "BINANCEFUT",
        symbol: "AXSUSDT",
        tf: "15m",
        side: "BUY",
        event: "EXIT_TRAIL_1P",
        signal_id: "SIG__BINANCEFUT__AXSUSDT__15m__9300__EXIT_TRAIL_1P",
        signal_bar_close_time_utc_ms: 9300,
        exec_bar_close_time_utc_ms: 9300,
        features_json: {
          pnl_pct: 0.01,
        },
        created_at: "2026-03-29T01:00:00.000Z",
      },
    ],
    provider: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 10000,
  });
  assert.strictEqual(exitOnlyRows.length, 1);
  assert.strictEqual(exitOnlyRows[0].source_row_type, "EXIT_ONLY");
  assert.strictEqual(exitOnlyRows[0].outcome_state, "REALIZED");
  assert.strictEqual(exitOnlyRows[0].realized_source, "EXIT_FILL_RET");

  console.log("BEST_SELF_EVOLUTION_DATASET_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_DATASET_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
