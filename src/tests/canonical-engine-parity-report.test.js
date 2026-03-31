"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-canonical-engine-parity");

(() => {
  const observed = __test.buildObservedRows(
    [
      {
        signal_id: "sig-pass",
        event: "LONG",
        side: "BUY",
        tf: "15m",
        symbol_or_pair_id: "BTCUSDT",
        bar_close_time_utc_ms: 1000,
        features_json: {
          entry_grade: "CORE",
          score: 35,
          regime: "trend",
          canonical_engine_actual_source_decision: "PASS",
          canonical_engine_actual_source_pass: true,
        },
      },
    ],
    [
      {
        signal_id: "sig-mismatch",
        event: "LONG",
        side: "BUY",
        tf: "15m",
        symbol_or_pair_id: "ETHUSDT",
        bar_close_time_utc_ms: 2000,
        reason: "DROP_EV_GATE_TP1_PROB",
        features_json: {
          entry_grade: "CORE",
          score: 35,
          regime: "trend",
          canonical_engine_actual_source_decision: "PASS",
          canonical_engine_actual_source_pass: true,
        },
      },
      {
        signal_id: "drop-pass",
        event: "LONG",
        side: "BUY",
        tf: "15m",
        symbol_or_pair_id: "XRPUSDT",
        bar_close_time_utc_ms: 3000,
        reason: "DROP_CANONICAL_ENGINE_CORE_SCORE",
        features_json: { entry_grade: "CORE", score: 20, regime: "trend" },
      },
    ]
  );
  assert.strictEqual(observed.length, 3);

  const report = __test.deriveParityReport({
    rows: observed,
    settings: {
      canonical_engine_enabled: true,
      canonical_engine_shadow_enabled: true,
      canonical_engine_source_mode: "PINE_PRIMARY",
      canonical_engine_core_score_abs: 33,
      canonical_engine_transition_core_score_abs: 29,
    },
    provider: "BINANCEFUT",
    tf: "15m",
  });

  assert.strictEqual(report.summary.rows_n, 3);
  assert.strictEqual(report.summary.shadow_applicable_n, 3);
  assert.strictEqual(report.summary.shadow_fail_n, 1);
  assert.strictEqual(report.summary.parity_mismatch_n, 1);
  assert.strictEqual(report.summary.source_parity_mismatch_n, 0);
  assert.strictEqual(report.summary.source_evidence_stored_n, 2);
  assert.strictEqual(report.summary.source_evidence_derived_n, 1);
  assert.strictEqual(report.summary.final_downstream_mismatch_n, 1);
  assert.strictEqual(report.summary.primary_long_short_parity_rate, 2 / 3);
  assert.strictEqual(report.summary.core_parity_rate, 2 / 3);
  assert.strictEqual(report.summary.by_actual_drop_reason_family[0].key, "EV_POLICY");
  assert.strictEqual(report.summary.by_market_parity[0].key, "BTCUSDT");
  assert.strictEqual(report.summary.by_tier_parity[0].key, "CORE");
  assert.strictEqual(report.rows[0].signal_id, "sig-mismatch");
  assert.strictEqual(report.rows[0].source_parity_match, true);
  assert.strictEqual(report.rows[0].mismatch_scope, "FINAL_DOWNSTREAM_MISMATCH");
  assert.strictEqual(report.rows[0].actual_source_evidence, "STORED");

  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-31 15:00:00 KST",
    cycle_id: "cycle-1",
    summary: report.summary,
    rows: report.rows,
  });
  assert.match(md, /cycle-1/);
  assert.match(md, /parity match\/mismatch: 2 \/ 1/);
  assert.match(md, /source parity match\/mismatch: 3 \/ 0/);
  assert.match(md, /source evidence stored\/derived: 2 \/ 1/);
  assert.match(md, /mismatch families: EV_POLICY=1/);
  assert.match(md, /primary\/core\/early parity:/);
  assert.match(md, /market parity:/);
  console.log("CANONICAL_ENGINE_PARITY_REPORT_TEST_OK");
})();
