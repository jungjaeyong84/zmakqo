"use strict";

const assert = require("assert");
const { buildBestSelfEvolutionDataset, __test } = require("../utils/bestSelfEvolutionDataset");

async function run() {
  const legacySignalId = "SIG__BINANCEFUT__SOLUSDT__15m__1000__EARLY_LONG";
  const v2SignalId = "SIG__BINANCEFUT__XRPUSDT__15m__2000__CORE_SHORT";

  const report = await buildBestSelfEvolutionDataset({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "SOLUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: legacySignalId,
        bar_close_time_utc_ms: 1000,
        features_json: {
          signal_id: legacySignalId,
          _event_mapping_version: "v1",
          strategy_id: "donbeolja_v6.0.3.0",
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "XRPUSDT",
        tf: "15m",
        event: "CORE_SHORT",
        side: "SELL",
        signal_id: v2SignalId,
        bar_close_time_utc_ms: 2000,
        features_json: {
          signal_id: v2SignalId,
          runtime: "V2 DISCOVERY_CANARY",
          openclaw_decision_id: "OCD__XRPUSDT__2000__SHORT",
          openclaw_decision_bundle_id: "ODB__XRPUSDT__2000__SHORT",
          openclaw_execution_permit_id: "OEP__XRPUSDT__2000__SHORT",
          position_cycle_id: "PCY__XRPUSDT__2000__SHORT",
        },
      },
    ],
    drops: [],
    intents: [],
    fills: [],
    trades: [],
    provider: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 3000,
    loadPathMetrics: false,
  });

  assert.strictEqual(report.summary.learning_scope, "V2_ONLY_OPENCLAW");
  assert.strictEqual(report.summary.v1_learning_blocked, true);
  assert.strictEqual(report.summary.filtered_out_v1_or_unscoped_n, 1);
  assert.strictEqual(report.rows.length, 1);
  assert.strictEqual(report.rows[0].signal_id, v2SignalId);
  assert.strictEqual(report.rows[0].openclaw_learning_evidence.openclaw_decision_id, "OCD__XRPUSDT__2000__SHORT");
  assert.strictEqual(report.rows[0].openclaw_learning_evidence.has_v2_openclaw_learning_evidence, true);
  assert.strictEqual(report.filtered_out_v1_or_unscoped_rows[0].signal_id, legacySignalId);

  const legacyMixed = await buildBestSelfEvolutionDataset({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "SOLUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: legacySignalId,
        bar_close_time_utc_ms: 1000,
      },
    ],
    provider: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 3000,
    loadPathMetrics: false,
    learningScope: "LEGACY_MIXED",
    env: {
      DONBEOLJA_OPENCLAW_LEARNING_SCOPE: "LEGACY_MIXED",
      DONBEOLJA_V2_ALLOW_LEGACY_OPENCLAW_LEARNING: "1",
    },
  });
  assert.strictEqual(legacyMixed.summary.learning_scope, "LEGACY_MIXED");
  assert.strictEqual(legacyMixed.summary.v1_learning_blocked, false);
  assert.strictEqual(legacyMixed.summary.filtered_out_v1_or_unscoped_n, 0);
  assert.strictEqual(legacyMixed.rows.length, 1);

  const unsafeLegacyRequest = __test.resolveLearningScope({
    learningScope: "LEGACY_MIXED",
    env: { DONBEOLJA_OPENCLAW_LEARNING_SCOPE: "LEGACY_MIXED" },
  });
  assert.strictEqual(unsafeLegacyRequest.mode, "V2_ONLY_OPENCLAW");
  assert.strictEqual(unsafeLegacyRequest.v2_only, true);

  console.log("BEST_SELF_EVOLUTION_V2_LEARNING_SCOPE_TEST_OK");
}

run().catch((err) => {
  console.error("BEST_SELF_EVOLUTION_V2_LEARNING_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
