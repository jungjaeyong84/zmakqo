"use strict";

const assert = require("assert");
const {
  buildAiRecommendation,
  buildEvRecommendation,
  buildMarketRecommendation,
  buildQualityRecommendations,
  evaluateBinaryModel,
  predictProbability,
  trainBinaryLogisticModel,
  __test,
} = require("../../scripts/lib/filter-policy-ml");

function makeExample(overrides = {}) {
  return {
    source: "EXECUTED",
    label: 1,
    side: "LONG",
    tier: "CORE",
    regime: "trend",
    scoreAbs: 42,
    confidence: 0.62,
    waveConf: 0.68,
    postProbDir: 0.76,
    lateByBars: 0,
    conflict: false,
    aiBiasDir: "LONG",
    aiBiasRelation: "SAME",
    aiUsable: true,
    aiMissing: false,
    barLowerBound: 0.58,
    chaseRatio: 0.9,
    sameDirStreak: 1,
    counterDirBars: 1,
    avgCloseControl: 0.62,
    avgOppWick: 0.12,
    avgDirBody: 0.18,
    expectedRetNet: 0.02,
    predicted: 0.6,
    ...overrides,
  };
}

function run() {
  const examples = [];
  for (let i = 0; i < 50; i += 1) {
    examples.push(makeExample({ label: 1, scoreAbs: 45 + (i % 6), confidence: 0.6, waveConf: 0.66, barLowerBound: 0.62, expectedRetNet: 0.025 }));
  }
  for (let i = 0; i < 50; i += 1) {
    examples.push(makeExample({
      label: 0,
      side: "SHORT",
      tier: "CORE",
      regime: "transition",
      scoreAbs: 36 + (i % 3),
      confidence: 0.49,
      waveConf: 0.58,
      postProbDir: 0.64,
      barLowerBound: 0.48,
      chaseRatio: 2.1,
      sameDirStreak: 3,
      counterDirBars: 0,
      avgCloseControl: 0.54,
      avgOppWick: 0.28,
      avgDirBody: 0.31,
      expectedRetNet: -0.015,
      predicted: 0.45,
      aiBiasDir: "NEUTRAL",
      aiBiasRelation: "NEUTRAL",
    }));
  }

  const model = trainBinaryLogisticModel(examples, { iterations: 200, learningRate: 0.06 });
  assert.strictEqual(model.ok, true);
  const pGood = predictProbability(model, makeExample({ scoreAbs: 48, confidence: 0.63, barLowerBound: 0.64 }));
  const pBad = predictProbability(model, makeExample({ label: 0, scoreAbs: 34, confidence: 0.47, barLowerBound: 0.46, regime: "transition", chaseRatio: 2.3, sameDirStreak: 4 }));
  assert.ok(pGood > pBad);

  const metrics = evaluateBinaryModel(model, examples);
  assert.strictEqual(metrics.ok, true);
  assert.ok(metrics.sampleN >= 100);

  const qualityRecs = buildQualityRecommendations(examples, metrics, {
    gate_core_score_abs: 35,
    gate_pre_real_score_abs: 40,
    gate_conf_min: 0.5,
    gate_wave_conf_min: 0.6,
  });
  assert.ok(Array.isArray(qualityRecs));
  assert.ok(qualityRecs.length >= 1);

  const aiRec = buildAiRecommendation(examples);
  assert.ok(["KEEP", "HOLD", "REVIEW_DATA"].includes(aiRec.action));

  const marketExamples = examples.concat(
    Array.from({ length: 16 }, () => makeExample({ aiBiasDir: "NEUTRAL", aiBiasRelation: "NEUTRAL", label: 1, expectedRetNet: 0.018 })),
    Array.from({ length: 12 }, () => makeExample({ aiBiasDir: "SHORT", aiBiasRelation: "OPPOSITE_WEAK", label: 0, expectedRetNet: -0.02 }))
  );
  const marketRec = buildMarketRecommendation(marketExamples, { ai_bias_gate_neutral_mult: 0.5, ai_bias_gate_opposite_mult: 0.35 });
  assert.ok(["REVIEW_SOFTEN", "REVIEW_TIGHTEN", "KEEP", "HOLD"].includes(marketRec.action));

  const evExamples = [];
  for (let i = 0; i < 24; i += 1) {
    evExamples.push(makeExample({ label: 1, barLowerBound: 0.58 + ((i % 4) * 0.01), expectedRetNet: 0.02, predicted: 0.6 }));
  }
  for (let i = 0; i < 16; i += 1) {
    evExamples.push(makeExample({ label: 0, barLowerBound: 0.50 + ((i % 3) * 0.01), expectedRetNet: -0.015, predicted: 0.5 }));
  }
  for (let i = 0; i < 12; i += 1) {
    evExamples.push(makeExample({ label: 0, barLowerBound: 0.47 + ((i % 2) * 0.01), expectedRetNet: -0.02, predicted: 0.46 }));
  }
  const evRec = buildEvRecommendation(evExamples, {
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_full: 0.60,
    ev_gate_qty_scale_low: 0.40,
    ev_gate_qty_scale_mid: 0.70,
  });
  assert.ok(["REVIEW_UPDATE", "KEEP"].includes(evRec.action));
  assert.ok(evRec.next);
  assert.ok(evRec.buckets.low.n >= 8);

  const thresholdEval = __test.evaluateEvThresholdCandidates(evExamples, { targetHitRate: 0.60, minSample: 20, thresholdMin: 0.45, thresholdMax: 0.65 });
  assert.ok(Array.isArray(thresholdEval.candidates));
  assert.ok(thresholdEval.candidates.length > 0);

  const expectancyFirst = __test.evaluateEvThresholdCandidates([
    ...Array.from({ length: 30 }, () => makeExample({ label: 1, barLowerBound: 0.55, expectedRetNet: 0.010 })),
    ...Array.from({ length: 20 }, () => makeExample({ label: 0, barLowerBound: 0.55, expectedRetNet: -0.002 })),
    ...Array.from({ length: 12 }, () => makeExample({ label: 1, barLowerBound: 0.60, expectedRetNet: 0.030 })),
    ...Array.from({ length: 8 }, () => makeExample({ label: 0, barLowerBound: 0.60, expectedRetNet: -0.001 })),
  ], { targetHitRate: 0.60, minSample: 20, thresholdMin: 0.55, thresholdMax: 0.60 });
  const loose = expectancyFirst.candidates.find((row) => row.threshold === 0.55);
  assert.ok(expectancyFirst.best);
  assert.ok(loose);
  assert.ok(expectancyFirst.best.avgRetNet > loose.avgRetNet);
  assert.ok(expectancyFirst.best.n < loose.n);

  const lowSupportEval = __test.evaluateEvThresholdCandidates([
    ...Array.from({ length: 18 }, () => makeExample({ label: 1, barLowerBound: 0.38, expectedRetNet: 0.012 })),
    ...Array.from({ length: 12 }, () => makeExample({ label: 0, barLowerBound: 0.34, expectedRetNet: -0.006 })),
    ...Array.from({ length: 10 }, () => makeExample({ label: 1, barLowerBound: 0.41, expectedRetNet: 0.015 })),
  ], { targetHitRate: 0.60, minSample: 20, thresholdMin: 0.45, thresholdMax: 0.75, currentThreshold: 0.55, fullThreshold: 0.60 });
  assert.ok(lowSupportEval.support);
  assert.ok(lowSupportEval.support.searchMin < 0.45);
  assert.ok(lowSupportEval.candidates.some((row) => row.n >= 20));

  console.log("FILTER_POLICY_ML_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FILTER_POLICY_ML_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
