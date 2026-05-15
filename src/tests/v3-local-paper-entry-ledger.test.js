"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildV3PaperEntryLedgerReport, __test } = require("../v3/localPaperEntryLedger");

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "v3-entry-ledger-")), name);
}

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const rows = [
    {
      signal_id: "sig-1",
      created_at: "2026-05-12T00:00:00.000Z",
      symbol: "SUIUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "BUILDABLE_EDGE",
      cohort_key: "LONG | MOMENTUM_CONTINUATION | TREND | BUILDABLE_EDGE | CORE",
      profile_id: "LONG_MC_TREND_BUILDABLE_CORE",
      entry_grade: "CORE",
      market_state: "BULL",
      htf_bias: "BULL",
      opportunity_score: 0.8,
      confidence: 0.8,
      setup_quality_score: 0.9,
      structure_alignment: 1,
      htf_alignment_score: 1,
      market_quality_score: 0.84,
      spread_bps: 1.2,
      funding_rate: -0.00012,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
      rr: 1.5,
      signal_price: 1.3385,
      stop_price: 1.2863,
      target_price: 1.4197,
    },
  ];
  const first = buildV3PaperEntryLedgerReport(rows, {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(first.appended_entry_n, 1);
  assert.strictEqual(first.open_position_n, 1);
  assert.strictEqual(first.new_entries[0].structural_regime, "TREND");
  assert.strictEqual(first.new_entries[0].edge_cohort, "BUILDABLE_EDGE");
  assert.strictEqual(first.new_entries[0].signal_price, 1.3385);
  assert.strictEqual(first.new_entries[0].stop_price, 1.2863);
  assert.strictEqual(first.new_entries[0].target_price, 1.4197);
  assert.strictEqual(first.new_entries[0].market_quality_score, 0.84);
  assert.strictEqual(first.new_entries[0].spread_bps, 1.2);
  assert.strictEqual(first.new_entries[0].funding_rate, -0.00012);
  assert.strictEqual(first.new_entries[0].btc_1h_trend, "LONG");
  assert.strictEqual(first.new_entries[0].mtf_1h_direction, "LONG");

  const second = buildV3PaperEntryLedgerReport(rows, {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(second.appended_entry_n, 0);
  assert.strictEqual(second.blocked_reason_counts.V3_LEDGER_SIGNAL_ALREADY_RECORDED, 1);
})();

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const first = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-closed",
      created_at: "2026-05-12T00:00:00.000Z",
      symbol: "BTCUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_BR_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.8,
      spread_bps: 1.1,
      funding_rate: -0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      signal_price: 100,
      stop_price: 97,
      target_price: 104.65,
    },
  ], {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(first.appended_entry_n, 1);

  const afterExit = buildV3PaperEntryLedgerReport([], {
    ledgerPath,
    closedSignalIds: new Set(["sig-closed"]),
  });
  assert.strictEqual(afterExit.open_position_n, 0);
})();

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const first = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-1",
      created_at: "2026-05-12T00:00:00.000Z",
      symbol: "SUIUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_MC_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.8,
      spread_bps: 1.1,
      funding_rate: -0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      signal_price: 100,
      stop_price: 97,
      target_price: 104.65,
    },
  ], {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(first.appended_entry_n, 1);

  const second = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-2",
      created_at: "2026-05-12T00:01:00.000Z",
      symbol: "SUIUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_BR_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.8,
      spread_bps: 1.1,
      funding_rate: -0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      signal_price: 100,
      stop_price: 97,
      target_price: 104.65,
    },
  ], {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(second.appended_entry_n, 0);
  assert.strictEqual(second.blocked_reason_counts.V3_LEDGER_SYMBOL_ALREADY_OPEN, 1);
})();

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const first = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-long",
      created_at: "2026-05-12T00:00:00.000Z",
      symbol: "SUIUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_MC_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.8,
      spread_bps: 1.1,
      funding_rate: -0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      signal_price: 100,
      stop_price: 97,
      target_price: 104.65,
    },
  ], {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(first.appended_entry_n, 1);

  const second = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-short",
      created_at: "2026-05-12T00:01:00.000Z",
      symbol: "SUIUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "SHORT",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "SHORT | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE",
      profile_id: "SHORT_MC_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.8,
      spread_bps: 1.1,
      funding_rate: -0.0001,
      btc_1h_trend: "SHORT",
      mtf_1h_direction: "SHORT",
      signal_price: 100,
      stop_price: 103,
      target_price: 95.35,
    },
  ], {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(second.appended_entry_n, 1);
})();

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const report = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-incomplete",
      created_at: "2026-05-12T00:00:00.000Z",
      symbol: "ETHUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_BR_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.81,
      signal_price: 100,
      stop_price: 97,
      target_price: 104.65,
    },
  ], {
    ledgerPath,
    nowMs: Date.parse("2026-05-12T00:05:00.000Z"),
  });
  assert.strictEqual(report.appended_entry_n, 0);
  assert.strictEqual(report.blocked_reason_counts.V3_LEDGER_LEARNING_CONTEXT_REQUIRED, 1);
})();

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const nowMs = Date.parse("2026-05-12T00:00:00.000Z");
  const report = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-stale",
      created_at: "2026-05-11T23:34:59.999Z",
      symbol: "BNBUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_MC_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.8,
      spread_bps: 1.1,
      funding_rate: -0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      signal_price: 100,
      stop_price: 97,
      target_price: 104.65,
    },
  ], { ledgerPath, nowMs });
  assert.strictEqual(report.appended_entry_n, 0);
  assert.strictEqual(report.blocked_reason_counts.V3_LEDGER_SIGNAL_STALE, 1);
})();

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const nowMs = Date.parse("2026-05-12T00:29:22.000Z");
  const report = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-fresh-closed-bar",
      created_at: "2026-05-12T00:14:59.999Z",
      symbol: "BTCUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_BR_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.8,
      spread_bps: 1.1,
      funding_rate: -0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      signal_price: 100,
      stop_price: 97,
      target_price: 104.65,
    },
  ], { ledgerPath, nowMs });
  assert.strictEqual(report.appended_entry_n, 1);
  assert.strictEqual(report.blocked_reason_counts.V3_LEDGER_SIGNAL_STALE, undefined);
  assert.strictEqual(report.signal_age_policy, "TF_PLUS_GRACE");
})();

(() => {
  const ledgerPath = tmpFile("ledger.jsonl");
  const nowMs = Date.parse("2026-05-12T00:20:00.000Z");
  const report = buildV3PaperEntryLedgerReport([
    {
      signal_id: "sig-cooldown",
      created_at: "2026-05-12T00:14:00.000Z",
      symbol: "BNBUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TRANSITION",
      edge_cohort: "BUILDABLE_EDGE",
      cohort_key: "LONG | BREAKOUT_RETEST | TRANSITION | BUILDABLE_EDGE | EARLY",
      profile_id: "LONG_BR_TRANSITION_BUILDABLE_EARLY",
      entry_grade: "EARLY",
      market_quality_score: 0.8,
      spread_bps: 0.9,
      funding_rate: 0,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      signal_price: 660,
      stop_price: 651,
      target_price: 672,
    },
  ], {
    ledgerPath,
    nowMs,
    exitRows: [
      {
        signal_id: "sig-old",
        symbol: "BNBUSDT",
        side: "LONG",
        tf: "15m",
        status: "CLOSED",
        closed_at: "2026-05-12T00:10:00.000Z",
      },
    ],
  });
  assert.strictEqual(report.appended_entry_n, 0);
  assert.strictEqual(report.blocked_reason_counts.V3_LEDGER_SYMBOL_COOLDOWN_ACTIVE, 1);
})();

(() => {
  const nowMs = Date.parse("2026-05-12T00:20:00.000Z");
  const report = __test.compactQueueRows([
    {
      signal_id: "sig-keep",
      created_at: "2026-05-12T00:15:00.000Z",
      symbol: "BTCUSDT",
    },
    {
      signal_id: "sig-recorded",
      created_at: "2026-05-12T00:15:00.000Z",
      symbol: "ETHUSDT",
    },
    {
      signal_id: "sig-stale",
      created_at: "2026-05-11T23:40:00.000Z",
      symbol: "BNBUSDT",
    },
    {
      signal_id: "sig-keep",
      created_at: "2026-05-12T00:15:00.000Z",
      symbol: "BTCUSDT",
    },
  ], {
    nowMs,
    recordedSignalIds: new Set(["sig-recorded"]),
  });
  assert.strictEqual(report.retained_queue_n, 1);
  assert.strictEqual(report.retained_rows[0].signal_id, "sig-keep");
  assert.strictEqual(report.pruned_reason_counts.V3_QUEUE_SIGNAL_ALREADY_RECORDED, 1);
  assert.strictEqual(report.pruned_reason_counts.V3_QUEUE_SIGNAL_STALE, 1);
  assert.strictEqual(report.pruned_reason_counts.V3_QUEUE_DUPLICATE_SIGNAL_ID, 1);
})();

console.log("v3-local-paper-entry-ledger.test.js PASS");
