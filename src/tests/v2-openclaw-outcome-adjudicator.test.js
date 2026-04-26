"use strict";

const assert = require("assert");
const { adjudicateOpenClawOutcome } = require("../v2/openclawOutcomeAdjudicator");
const { buildPassSignalCriteriaSeed } = require("./helpers/passSignalCriteriaSeed");

(function adjudicatorEnrichesEvidenceFromBundle() {
  const adjudication = adjudicateOpenClawOutcome({
    bundle: {
      signalIntent: {
        signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__BTCUSDT__LONG__abc123",
        symbol: "BTCUSDT",
        side: "LONG",
      },
      openclawDecision: {
        openclaw_decision_id: "OCDV2__CANARY__APPROVE_ENTRY__abc123",
      },
      signalCriteria: {
        ...buildPassSignalCriteriaSeed("LONG"),
        regime_profile: {
          present: true,
          structural_regime: "TREND",
          regime_cohort: "TREND__NORMAL_VOL__ADEQUATE",
          regime_score: 0.91,
        },
        expected_edge_model: {
          present: true,
          edge_cohort: "BUILDABLE_EDGE",
          edge_score: 0.68,
          net_r_multiple: 0.5,
        },
      },
      openclawDecisionBundleHash: "bundle_hash_123",
    },
    positionCycle: {
      position_cycle_id: "PCY__BINANCEFUT__BTCUSDT__LONG__abc123",
    },
    realizedExitEvent: "TP1_REACHED",
    realizedPnl: 12,
    adjudicatedAt: "2026-04-23T00:00:00.000Z",
  });

  assert.strictEqual(adjudication.evidence.symbol, "BTCUSDT");
  assert.strictEqual(adjudication.evidence.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(adjudication.evidence.signal_regime_profile.regime_cohort, "TREND__NORMAL_VOL__ADEQUATE");
  assert.strictEqual(adjudication.evidence.expected_edge_model.edge_cohort, "BUILDABLE_EDGE");
  assert.strictEqual(adjudication.evidence.openclaw_decision_bundle_hash, "bundle_hash_123");
})();

console.log("V2_OPENCLAW_OUTCOME_ADJUDICATOR_TEST_OK");
