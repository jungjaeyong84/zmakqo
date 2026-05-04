"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSignalCriteria } = require("../v2/signalCriteria");

const pineV611Path = path.join(__dirname, "../../code/donbeolja_v6.1.1.0_PRODUCTION_CANDIDATE.pine.txt");

(function v611PineSurfaceStillCarriesReusableSignalFields() {
  const text = fs.readFileSync(pineV611Path, "utf8");
  assert.ok(text.includes("EARLY / CORE"), "v6.1 contract should define EARLY/CORE live grades");
  assert.ok(text.includes("thr_early"), "v6.1 contract should expose EARLY threshold");
  assert.ok(text.includes("thr_core"), "v6.1 contract should expose CORE threshold");
  assert.ok(text.includes("trigger_type_long"), "v6.1 contract should expose long trigger type");
  assert.ok(text.includes("trigger_type_short"), "v6.1 contract should expose short trigger type");
  assert.ok(text.includes('"entry_grade"'), "v6.1 payload should carry entry_grade");
  assert.ok(text.includes('"trigger_type"'), "v6.1 payload should carry trigger_type");
  assert.ok(text.includes('"opportunity_score"'), "v6.1 payload should carry opportunity_score");
})();

(function v2V6CompatProfileAcceptsV611CoreConceptsWithoutLegacyRuntime() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    criteriaProfile: "V6_COMPAT_DISCOVERY",
    featureValues: {
      market_regime: "trend",
      htf_bias: "LONG",
      htf_alignment_score: 0.72,
      setup_type: "PULLBACK_RECLAIM",
      reclaim_confirmed: true,
      hold_after_reclaim: true,
      stop_distance_sane: true,
      opportunity_score: 0.72,
      trigger_type: "RECLAIM",
      trigger_confirmed: true,
      volume_zscore: 1.05,
      rsi_entry_tf: 52,
      expected_gross_r: 1.65,
      expected_net_r_after_cost: 0.45,
      cost_estimate_bps: 8,
      cost_r_equivalent: 1.2,
      funding_penalty_bps: 1,
      market_quality_score: 0.82,
      spread_bps: 6,
      mark_index_gap_bps: 2,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 6,
        mark_index_gap_bps: 2,
      },
    },
  });
  assert.strictEqual(criteria.verdict, "PASS");
  assert.strictEqual(criteria.criteria_profile, "V6_COMPAT_DISCOVERY");
  assert.notStrictEqual(criteria.entry_grade, "NONE");
  assert.strictEqual(criteria.trigger_type, "RECLAIM");
  assert.strictEqual(criteria.setup_gate.setup_type, "PULLBACK_RECLAIM");
})();

console.log("V2_SIGNAL_CRITERIA_V6_PARITY_TEST_OK");
