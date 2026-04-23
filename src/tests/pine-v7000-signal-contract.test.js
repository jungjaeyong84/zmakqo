"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { resolveEventMapping } = require("../services/signalMapping");
const { resolveEntryTimingTier, resolveEntryQtyProfile } = require("../utils/liveEntryTaxonomy");

const redesignPath = path.join(__dirname, "../../code/donbeolja_v7.0.0.0_SIGNAL_REDESIGN.pine.txt");
const productionCandidatePath = path.join(__dirname, "../../code/donbeolja_v7.0.0.0_PRODUCTION_CANDIDATE.pine.txt");
const tvImportFinalPath = path.join(__dirname, "../../code/donbeolja_v7.0.0.0_TV_IMPORT_FINAL.pine.txt");

function assertAlertSurface(text) {
  const alertconditionCount = (text.match(/alertcondition\(/g) || []).length;
  const runtimeAlertCount = (text.match(/\balert\(/g) || []).length;
  assert.strictEqual(alertconditionCount, 4, "expected exactly 4 alertcondition declarations");
  assert.strictEqual(runtimeAlertCount, 4, "expected exactly 4 runtime alert() calls");
  assert.ok(text.includes('indicator("돈벌자 :) Ω Full v7.0.0.0", overlay = true'), "expected v7 indicator title");
  assert.ok(text.includes('string STRATEGY_ID = "donbeolja_v7.0.0.0"'), "expected v7 strategy id");
  assert.ok(text.includes('f_json_pair_s("setup_type", setupType)'), "payload should carry setup_type");
  assert.ok(text.includes('f_json_pair_s("structural_regime", structural_regime)'), "payload should carry structural_regime");
  assert.ok(text.includes('f_json_pair_s("regime_cohort", regime_cohort)'), "payload should carry regime_cohort");
  assert.ok(text.includes('f_json_pair_s("edge_cohort", edgeCohort)'), "payload should carry edge_cohort");
  assert.ok(text.includes('f_json_pair_n("signal_score", signalScore)'), "payload should carry signal_score");
  assert.ok(text.includes('f_json_pair_n("expected_net_r_after_cost", expectedNetR)'), "payload should carry expected_net_r_after_cost");
  assert.ok(text.includes('f_json_pair_n("tp1_reach_probability", tp1ReachProbability)'), "payload should carry tp1_reach_probability");
  assert.ok(text.includes('f_json_pair_n("stop_hit_probability", stopHitProbability)'), "payload should carry stop_hit_probability");
  assert.ok(text.includes('f_json_pair_b("no_trade_gate", no_trade_pass)'), "payload should carry no_trade_gate");
  assert.ok(text.includes('signal_score_long = 15.0 * market_quality_score + 25.0 * trend_alignment_local + 20.0 * setup_quality_long + 20.0 * trigger_strength_long + 20.0 * edge_score_long'), "long score formula should exist");
  assert.ok(text.includes('table.cell(diag, 1, 2, regime_cohort, text_color = color.white)'), "diagnostic panel should expose regime cohort");
  assert.ok(text.includes('momentum_continue_long'), "momentum continuation setup should exist");
  assert.ok(text.includes('setup_type_long == "MOMENTUM_CONTINUATION" ? "CONTINUATION" : "NONE"'), "momentum continuation trigger type should exist");
  assert.ok(text.includes('plotshape(show_signal_shapes and long_probe_raw, title = "V7 Long Probe"'), "long probe marker should exist");
  assert.ok(text.includes('plotshape(show_signal_shapes and short_probe_raw, title = "V7 Short Probe"'), "short probe marker should exist");
}

(function testV7PineContractSurface() {
  const redesignText = fs.readFileSync(redesignPath, "utf8");
  const productionText = fs.readFileSync(productionCandidatePath, "utf8");
  const tvImportText = fs.readFileSync(tvImportFinalPath, "utf8");

  assert.strictEqual(productionText, redesignText, "production candidate should match redesign source");
  assert.strictEqual(tvImportText, redesignText, "tv import final should match redesign source");
  assertAlertSurface(redesignText);
  assertAlertSurface(productionText);
  assertAlertSurface(tvImportText);
})();

(function testRepresentativePayloadConsumerSemantics() {
  const payload = {
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    market: "BTCUSDT",
    ticker: "BTCUSDT",
    tf: "15",
    strategy_id: "donbeolja_v7.0.0.0",
    engine_mode: "SIGNAL_CRITERIA_V7_VISUAL",
    action: "ENTRY",
    event_intent: "ENTRY",
    event: "LONG",
    side: "BUY",
    direction: "LONG",
    entry_grade: "CORE",
    qty_profile: "FIXED",
    qtyPct: 1,
    signal_score: 83.5,
    expected_net_r_after_cost: 0.42,
    features: {
      strategy_id: "donbeolja_v7.0.0.0",
      entry_grade: "CORE",
      qty_profile: "FIXED",
      _event_intent: "ENTRY",
      signal_family: "LONG",
      source_band: "CORE",
      setup_type: "PULLBACK_RECLAIM",
      regime_cohort: "TREND__NORMAL_VOL__ADEQUATE",
      edge_cohort: "BUILDABLE_EDGE",
    },
  };

  const mapping = resolveEventMapping({ event: payload.event, side: payload.side });
  assert.strictEqual(mapping.ok, true);
  assert.strictEqual(mapping.intent, "ENTRY");
  assert.strictEqual(mapping.side, "BUY");

  assert.strictEqual(resolveEntryTimingTier(payload.event, payload.features), "CORE");
  assert.strictEqual(resolveEntryQtyProfile(payload.event, payload.features), "FIXED");
})();

console.log("PINE_V7000_SIGNAL_CONTRACT_TEST_OK");
