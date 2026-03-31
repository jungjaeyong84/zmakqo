"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-pine-shadow-drift");

(() => {
  const report = __test.derivePineShadowDrift({
    dataset: {
      rows: [
        {
          source_row_type: "EXECUTED",
          event: "LONG",
          market: "AXSUSDT",
          signal_id: "SIG__1",
          created_at: "2026-03-31T08:00:00.000Z",
          features_json: {
            canonical_engine_source_mode_effective: "SERVER_PRIMARY",
            canonical_engine_actual_source_decision: "PASS",
            pine_shadow_decision: "BLOCK",
            pine_shadow_parity_match: false,
            canonical_engine_execution_source_effective: "SERVER_CANONICAL",
            pine_overlay_runtime_role: "SHADOW_AUDIT",
          },
        },
        {
          source_row_type: "DROP",
          event: "SHORT",
          market: "BTCUSDT",
          signal_id: "SIG__2",
          created_at: "2026-03-31T08:05:00.000Z",
          features_json: {
            canonical_engine_source_mode_effective: "SERVER_PRIMARY",
            canonical_engine_actual_source_decision: "BLOCK",
            pine_shadow_decision: "PASS",
            pine_shadow_parity_match: true,
            canonical_engine_execution_source_effective: "SERVER_CANONICAL",
            pine_overlay_runtime_role: "SHADOW_AUDIT",
          },
        },
        {
          source_row_type: "EXECUTED",
          event: "LONG",
          market: "ETHUSDT",
          signal_id: "SIG__3",
          created_at: "2026-03-31T08:10:00.000Z",
          features_json: {
            canonical_engine_source_mode_effective: "PINE_PRIMARY",
            pine_shadow_parity_match: false,
          },
        },
      ],
    },
  });

  assert.strictEqual(report.summary.audit_only, true);
  assert.strictEqual(report.summary.observed_n, 2);
  assert.strictEqual(report.summary.drift_n, 1);
  assert.strictEqual(report.summary.executed_drift_n, 1);
  assert.strictEqual(report.summary.drop_drift_n, 0);
  assert.strictEqual(report.summary.top_drift_market, "AXSUSDT");
  assert.strictEqual(report.summary.by_actual_source_decision[0].key, "PASS");
  assert.strictEqual(report.rows.length, 1);
  assert.strictEqual(report.rows[0].market, "AXSUSDT");

  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-31 18:00:00 KST",
    cycle_id: "cycle-drift",
    summary: report.summary,
    rows: report.rows,
  });
  assert.match(md, /cycle-drift/);
  assert.match(md, /audit_only: YES/);
  assert.match(md, /observed \/ drift: 2 \/ 1/);
  assert.match(md, /AXSUSDT/);
  console.log("PINE_SHADOW_DRIFT_REPORT_TEST_OK");
})();
