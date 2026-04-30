"use strict";

const assert = require("assert");
const { buildBestSelfEvolutionDataset } = require("../utils/bestSelfEvolutionDataset");

async function run() {
  const report = await buildBestSelfEvolutionDataset({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "BTCUSDT",
        tf: "15m",
        event: "EARLY_LONG",
        side: "BUY",
        signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1000__EARLY_LONG",
        bar_close_time_utc_ms: 1000,
        features_json: {
          signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1000__EARLY_LONG",
          entry_grade: "EARLY",
          openclaw_decision_id: "OCD__BTCUSDT__1000__LONG",
          openclaw_execution_permit_id: "OEP__BTCUSDT__1000__LONG",
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "AXSUSDT",
        tf: "15m",
        event: "EMO_SHORT",
        side: "SELL",
        signal_id: "SIG__BINANCEFUT__AXSUSDT__15m__2000__EMO_SHORT",
        bar_close_time_utc_ms: 2000,
        features_json: {
          signal_id: "SIG__BINANCEFUT__AXSUSDT__15m__2000__EMO_SHORT",
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
    toMs: 5000,
    loadPathMetrics: false,
  });

  assert.strictEqual(report.summary.signal_scope_filter, "EARLY_CORE_ONLY");
  assert.strictEqual(report.summary.filtered_out_non_primary_signal_n, 1);
  assert.strictEqual(report.rows.length, 1);
  assert.strictEqual(report.rows[0].market, "BTCUSDT");
  assert.strictEqual(report.rows[0].entry_grade, "EARLY");
  assert.strictEqual(report.rows[0].event, "EARLY_LONG");
  console.log("BEST_SELF_EVOLUTION_SIGNAL_SCOPE_FILTER_TEST_OK");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
