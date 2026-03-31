"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-canonical-engine-provenance");

(() => {
  const report = __test.deriveProvenanceReport({
    signals: [
      {
        signal_id: "SIG__BTC",
        event: "LONG",
        symbol_or_pair_id: "BTCUSDT",
        created_at: "2026-03-31T05:00:00.000Z",
        features_json: {
          canonical_engine_bundle_version: "bundle-v1",
          canonical_engine_threshold_bundle_version: "threshold-v1",
          canonical_engine_source_mode_effective: "PINE_PRIMARY",
          canonical_engine_execution_source_effective: "PINE_ALERT",
          canonical_engine_actual_source_decision: "PASS",
          canonical_engine_decision_id: "dec-1",
          canonical_engine_policy_origin: "GLOBAL_DEFAULT",
          pine_overlay_runtime_role: "PRIMARY_ALERT",
          pine_shadow_decision: "PASS",
          pine_shadow_parity_match: true,
        },
      },
    ],
    drops: [
      {
        signal_id: "DROP__ETH",
        event: "SHORT",
        symbol_or_pair_id: "ETHUSDT",
        created_at: "2026-03-31T05:05:00.000Z",
        features_json: {
          canonical_engine_bundle_version: "bundle-v1",
          canonical_engine_source_mode_effective: "PINE_PRIMARY",
          canonical_engine_execution_source_effective: "PINE_ALERT",
          canonical_engine_decision_id: "dec-2",
        },
      },
    ],
    intents: [
      {
        intent_id: "INTENT__XRP",
        event: "LONG",
        symbol_or_pair_id: "XRPUSDT",
        created_at: "2026-03-31T05:10:00.000Z",
        features_json: {
          canonical_engine_bundle_version: "bundle-v1",
          canonical_engine_threshold_bundle_version: "threshold-v1",
          canonical_engine_source_mode_effective: "PINE_PRIMARY",
          canonical_engine_execution_source_effective: "PINE_ALERT",
          canonical_engine_actual_source_decision: "PASS",
          canonical_engine_decision_id: "dec-3",
          canonical_engine_policy_origin: "MARKET_OVERRIDE",
          pine_overlay_runtime_role: "PRIMARY_ALERT",
          pine_shadow_decision: "PASS",
          pine_shadow_parity_match: false,
        },
      },
    ],
  });

  assert.strictEqual(report.summary.rows_n, 3);
  assert.strictEqual(report.summary.raw_signal_n, 1);
  assert.strictEqual(report.summary.engine_eligible_n, 2);
  assert.strictEqual(report.summary.eligible_n, 2);
  assert.strictEqual(report.summary.with_bundle_version_n, 3);
    assert.strictEqual(report.summary.with_threshold_bundle_version_n, 2);
    assert.strictEqual(report.summary.with_actual_source_decision_n, 2);
    assert.strictEqual(report.summary.with_execution_source_n, 3);
    assert.strictEqual(report.summary.with_decision_id_n, 3);
    assert.strictEqual(report.summary.with_policy_origin_n, 2);
    assert.strictEqual(report.summary.with_pine_overlay_role_n, 2);
    assert.strictEqual(report.summary.with_pine_shadow_decision_n, 2);
    assert.strictEqual(report.summary.with_pine_shadow_parity_n, 2);
    assert.strictEqual(report.summary.complete_n, 1);
  assert.strictEqual(report.summary.by_collection.find((row) => row.collection === "signals").complete_n, 0);
  assert.strictEqual(report.summary.by_collection.find((row) => row.collection === "signals_dropped").complete_n, 0);
  assert.strictEqual(report.rows.length, 1);
  assert.strictEqual(report.rows[0].signal_id, "DROP__ETH");

  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-31 15:00:00 KST",
    cycle_id: "cycle-1",
    summary: report.summary,
    rows: report.rows,
  });
  assert.ok(md.includes("rows / raw webhook / engine eligible: 3 / 1 / 2"));
  assert.ok(md.includes("complete: effective 1/2"));
  assert.ok(md.includes("bundle / threshold / source_mode / execution_source / source_decision: 3 / 2 / 3 / 3 / 2"));
  assert.ok(md.includes("decision_id / policy_origin / pine_overlay_role / pine_shadow / pine_shadow_parity: 3 / 2 / 2 / 2 / 2"));
  assert.ok(md.includes("signals_dropped / ETHUSDT / SHORT / DROP__ETH"));

  const cutoverReference = __test.deriveCutoverReference({
    sourceModeSnapshot: { generated_at: "2026-03-31T06:00:00.000Z" },
    canonicalPolicySnapshot: { generated_at: "2026-03-31T05:59:00.000Z" },
  });
  const cutoverReport = __test.deriveProvenanceReport({
    signals: [
      {
        signal_id: "SIG__OLD",
        event: "LONG",
        symbol_or_pair_id: "BTCUSDT",
        created_at: "2026-03-31T05:00:00.000Z",
        features_json: {},
      },
    ],
    drops: [
      {
        signal_id: "DROP__OLD",
        event: "SHORT",
        symbol_or_pair_id: "ETHUSDT",
        created_at: "2026-03-31T05:05:00.000Z",
        features_json: {},
      },
    ],
    intents: [],
    cutoverReference,
  });
  assert.strictEqual(cutoverReport.summary.cutover_reference_source, "SOURCE_MODE");
  assert.strictEqual(cutoverReport.summary.post_cutover_engine_eligible_n, 0);
  assert.strictEqual(cutoverReport.summary.post_cutover_status, "NO_ENGINE_ROWS_AFTER_CUTOVER");
  assert.strictEqual(cutoverReport.summary.effective_eligible_n, 0);
  console.log("CANONICAL_ENGINE_PROVENANCE_REPORT_TEST_OK");
})();
