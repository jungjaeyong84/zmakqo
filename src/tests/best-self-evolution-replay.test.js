"use strict";

const assert = require("assert");
const { deriveCandidateObjectiveDelta, buildReplayValidationReport } = require("../../src/utils/bestSelfEvolutionReplay");

function run() {
  const candidate = {
    candidate_id: "WAIT_ONE_BAR_TUNE",
    display_candidate_id: "WAIT_ONE_BAR_TUNE",
    scope: "WAIT",
    direction: "LOOSEN",
    markets: ["DOGEUSDT"],
    risk_flags: [],
    count_guard_effect: { projected_count_ratio_global: 1.02, tightening_allowed: true },
    replacement_effect: { projected_replacement_ratio: 0.9, recovery_priority: false },
    evidence: { support_n: 18, support_rate: 0.62, rationale: "late loss recovery" },
  };
  const objective = {
    objective_score: 1.2,
    count_floor_pass: true,
    replacement_floor_pass: true,
    latency_budget_pass: true,
  };
  const attribution = {
    late_loss_top_market: { key: "DOGEUSDT", count: 5 },
    false_fire_top_market: { key: "ETHUSDT", count: 2 },
  };
  const dataset = {
    rows: [
      {
        market: "DOGEUSDT",
        event: "CORE_SHORT",
        source_row_type: "DROP",
        drop_stage_key: "TIMING",
        wait_verdict: "DROP",
        realized_ret_net: 0.03,
        tp1_first: true,
        febt_phase: "ARMED",
      },
      {
        market: "DOGEUSDT",
        event: "CORE_SHORT",
        source_row_type: "EXECUTED",
        wait_verdict: "ALLOW",
        realized_ret_net: -0.02,
        tp1_first: false,
        febt_phase: "LATE",
      },
    ],
  };
  const result = deriveCandidateObjectiveDelta(candidate, { objective, attribution, dataset });
  assert.strictEqual(result.validation_verdict, "PASS");
  assert.strictEqual(result.projected_objective_score > result.current_objective_score, true);
  assert.strictEqual(result.historical_applied_n, 1);
  assert.strictEqual(result.validation_mode, "HISTORICAL_ENTRY_COHORT_V1");

  const report = buildReplayValidationReport({
    candidateChangeSet: {
      rows: [
        candidate,
        {
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          scope: "PINE",
          direction: "TIGHTEN",
          markets: ["ALL"],
          risk_flags: ["COUNT_GUARD_ACTIVE"],
          count_guard_effect: { projected_count_ratio_global: 0.95, tightening_allowed: false },
          replacement_effect: { projected_replacement_ratio: 0.6, recovery_priority: true },
          evidence: { priority_score: 0.5, avg_dropped_ret_net: -0.01, rationale: "tighten pine" },
        },
      ],
    },
    objective,
    attribution,
    dataset,
  });
  assert.strictEqual(report.summary.total_n, 2);
  assert.strictEqual(report.summary.pass_n, 1);
  assert.strictEqual(report.summary.block_n, 1);
  assert.strictEqual(report.summary.best_candidate_id, "WAIT_ONE_BAR_TUNE");

  const blockedSourceAction = deriveCandidateObjectiveDelta({
    candidate_id: "ML_EV_SOFTENING",
    display_candidate_id: "ML_EV_SOFTENING",
    scope: "ML",
    direction: "SHIFT",
    markets: ["BTCUSDT"],
    changes: [{ key: "ml.market_gate_core_score_abs", next: 0.2 }],
    risk_flags: ["BLOCKED_SOURCE_ACTION"],
    evidence: { rationale: "blocked loosening" },
  }, {
    objective,
    attribution,
    dataset: {
      rows: [
        { market: "BTCUSDT", event: "CORE_LONG", source_row_type: "EXECUTED", drop_reason: "DROP_SHORT_GATE_SCORE", realized_ret_net: -0.03, entry_grade: "CORE" },
      ],
    },
  });
  assert.strictEqual(blockedSourceAction.validation_verdict, "BLOCK");
  assert.ok(blockedSourceAction.blockers.includes("BLOCKED_SOURCE_ACTION"));
  assert.strictEqual(blockedSourceAction.historical_applied_n, 0);

  const mlShiftNoEffect = deriveCandidateObjectiveDelta({
    candidate_id: "ML_GATE_CORE_SCORE_ABS",
    display_candidate_id: "ML_GATE_CORE_SCORE_ABS",
    scope: "ML",
    direction: "SHIFT",
    markets: ["BTCUSDT"],
    changes: [{ key: "ml.gate_core_score_abs", next: 0.48 }],
    risk_flags: [],
    evidence: { rationale: "shift score gate" },
  }, {
    objective,
    attribution,
    dataset: {
      rows: [
        { market: "BTCUSDT", event: "CORE_LONG", source_row_type: "EXECUTED", drop_reason: "DROP_SHORT_GATE_SCORE", realized_ret_net: -0.03, entry_grade: "CORE" },
      ],
    },
  });
  assert.ok(mlShiftNoEffect.blockers.includes("NO_EFFECT_CHANGESET"));

  const mlTightenNoMatch = deriveCandidateObjectiveDelta({
    candidate_id: "ML_MARKET",
    display_candidate_id: "ML_MARKET",
    scope: "ML",
    direction: "TIGHTEN",
    markets: ["BTCUSDT"],
    changes: [{ key: "ml.market_regime_score", next: 0.71 }],
    risk_flags: [],
    evidence: { rationale: "tighten market regime" },
  }, {
    objective,
    attribution,
    dataset: {
      rows: [
        { market: "BTCUSDT", event: "CORE_LONG", source_row_type: "EXECUTED", drop_reason: "DROP_REGIME", realized_ret_net: 0.04, entry_grade: "CORE" },
      ],
    },
  });
  assert.ok(mlTightenNoMatch.blockers.includes("NO_HISTORICAL_TIGHTEN_MATCH"));

  const loosenNoCounterfactual = deriveCandidateObjectiveDelta({
    candidate_id: "EV_TP1_THRESHOLD_TUNE",
    display_candidate_id: "EV_TP1_THRESHOLD_TUNE",
    scope: "EV",
    direction: "LOOSEN",
    markets: ["BTCUSDT"],
    risk_flags: [],
    evidence: { rationale: "loosen ev threshold" },
  }, {
    objective,
    attribution,
    dataset: {
      rows: [
        { market: "BTCUSDT", event: "CORE_LONG", source_row_type: "EXECUTED", ev_verdict: "ALLOW", realized_ret_net: 0.01, entry_grade: "CORE" },
      ],
    },
  });
  assert.ok(loosenNoCounterfactual.blockers.includes("NO_REALIZED_COUNTERFACTUAL"));

  const shadowFallbackNoCounterfactual = deriveCandidateObjectiveDelta({
    candidate_id: "EV_TP1_THRESHOLD_TUNE",
    display_candidate_id: "EV_TP1_THRESHOLD_TUNE",
    scope: "EV",
    direction: "LOOSEN",
    markets: ["ALL"],
    risk_flags: ["NOT_READY", "EV_SHADOW_FALLBACK", "EV_TUNER_STALE", "EV_TUNER_INSUFFICIENT_SAMPLE"],
    evidence: { rationale: "STALE_ARTIFACT / missed_recovery=6" },
  }, {
    objective,
    attribution,
    dataset: {
      rows: [
        { market: "BTCUSDT", event: "CORE_LONG", source_row_type: "DROP", drop_stage_key: "EV", ev_verdict: "DROP", realized_ret_net: null, entry_grade: "CORE" },
      ],
    },
  });
  assert.strictEqual(shadowFallbackNoCounterfactual.validation_verdict, "WARN");
  assert.deepStrictEqual(shadowFallbackNoCounterfactual.blockers, ["SHADOW_COUNTERFACTUAL_MISSING"]);

  const mixedEvShift = deriveCandidateObjectiveDelta({
    candidate_id: "EV_TP1_THRESHOLD_TUNE",
    display_candidate_id: "EV_TP1_THRESHOLD_TUNE",
    scope: "EV",
    direction: "SHIFT",
    markets: ["BTCUSDT"],
    changes: [
      { key: "ev_gate_tp1_prob_full", current: 0.6, next: 0.58, direction: "LOOSEN" },
      { key: "ev_gate_tp1_prob_kill", current: 0.5, next: 0.45, direction: "TIGHTEN" },
      { key: "ev_gate_qty_scale_mid", current: 0.7, next: 0.6, direction: "LOOSEN" },
      { key: "ev_gate_qty_scale_low", current: 0.35, next: 0.5, direction: "TIGHTEN" },
    ],
    risk_flags: ["EV_TUNER_INSUFFICIENT_SAMPLE"],
    evidence: { rationale: "mixed EV threshold shift" },
  }, {
    objective,
    attribution,
    dataset: {
      rows: [
        { signal_id: "drop-1", market: "BTCUSDT", event: "CORE_LONG", source_row_type: "DROP", drop_stage_key: "EV", ev_verdict: "DROP", realized_ret_net: 0.04, entry_grade: "CORE" },
        { signal_id: "exec-1", market: "BTCUSDT", event: "CORE_LONG", source_row_type: "EXECUTED", ev_verdict: "ALLOW", realized_ret_net: -0.03, entry_grade: "CORE" },
      ],
    },
  });
  assert.strictEqual(mixedEvShift.validation_verdict, "PASS");
  assert.strictEqual(mixedEvShift.historical_applied_n, 2);
  assert.strictEqual(mixedEvShift.candidate_objective_delta > 0, true);
  assert.deepStrictEqual(mixedEvShift.blockers, []);

  console.log("BEST_SELF_EVOLUTION_REPLAY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_REPLAY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
