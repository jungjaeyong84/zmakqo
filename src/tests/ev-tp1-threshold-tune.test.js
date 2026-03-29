"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-ev-tp1-threshold-tune");

function run() {
  assert.strictEqual(typeof __test.pickThresholdPlan, "function");
  assert.strictEqual(typeof __test.evaluateSizingBand, "function");
  assert.strictEqual(typeof __test.pickBandPlan, "function");
  assert.strictEqual(typeof __test.classifyEntryOutcome, "function");
  assert.strictEqual(typeof __test.applyMlEvGuidance, "function");
  assert.strictEqual(typeof __test.compareThresholdPlans, "function");
  assert.strictEqual(typeof __test.buildTierThresholdRows, "function");
  assert.strictEqual(typeof __test.buildMlTierPlanRows, "function");
  assert.strictEqual(typeof __test.describeEvDecisionReasonForUser, "function");

  const resolvedEntries = [
    { predicted: 0.54, outcome: "NO_TP1_EXITED" },
    { predicted: 0.55, outcome: "TP1_HIT" },
    { predicted: 0.57, outcome: "NO_TP1_EXITED" },
    { predicted: 0.59, outcome: "TP1_HIT" },
    { predicted: 0.61, outcome: "TP1_HIT" },
    { predicted: 0.62, outcome: "TP1_HIT" },
    { predicted: 0.64, outcome: "TP1_HIT" },
    { predicted: 0.66, outcome: "TP1_HIT" },
    { predicted: 0.68, outcome: "TP1_HIT" },
    { predicted: 0.70, outcome: "TP1_HIT" },
  ];
  const plan = __test.pickThresholdPlan({
    resolvedEntries,
    currentThreshold: 0.55,
    targetHitRate: 0.60,
    minSample: 6,
    thresholdMin: 0.50,
    thresholdMax: 0.80,
    maxStep: 0.03,
  });
  assert.strictEqual(plan.reason, "TARGET_NUDGE");
  assert.strictEqual(plan.best, null);
  assert.ok(plan.next >= 0.52 && plan.next <= 0.55);

  const betterExp = { avgRetNet: 0.020, hitRate: 0.61, negPnlAbs: 5, n: 12 };
  const biggerSample = { avgRetNet: 0.010, hitRate: 0.70, negPnlAbs: 3, n: 30 };
  assert.ok(__test.compareThresholdPlans(biggerSample, betterExp, 0.60) > 0);
  assert.ok(__test.compareThresholdPlans(betterExp, biggerSample, 0.60) < 0);

  const monthlyTargetHit = { avgRetNet: 0.010, hitRate: 0.60, monthlyTargetPass: true, monthlyRunRateKrw: 1600000, negPnlAbs: 4, n: 12 };
  const monthlyTargetMiss = { avgRetNet: 0.010, hitRate: 0.60, monthlyTargetPass: false, monthlyRunRateKrw: 900000, negPnlAbs: 4, n: 12 };
  assert.ok(__test.compareThresholdPlans(monthlyTargetMiss, monthlyTargetHit, 0.60) > 0);
  assert.ok(__test.compareThresholdPlans(monthlyTargetHit, monthlyTargetMiss, 0.60) < 0);

  assert.strictEqual(__test.describeEvDecisionReasonForUser("INSUFFICIENT_SAMPLE"), "판단에 필요한 표본이 아직 부족합니다");

  const thresholdRows = __test.buildTierThresholdRows({
    EARLY: {
      current: { n: 1, hitRate: 0, wilsonLower: 0 },
      best: null,
      reason: "INSUFFICIENT_SAMPLE",
    },
  }, { EARLY: 0.55, CORE: 0.55, PRE_REAL: 0.55, REAL: 0.55 }, { EARLY: 0.55, CORE: 0.55, PRE_REAL: 0.55, REAL: 0.55 });
  assert.strictEqual(thresholdRows[0].display_tier, "LONG/SHORT 기본 진입");
  assert.strictEqual(thresholdRows[0].display_reason, "판단에 필요한 표본이 아직 부족합니다");

  const tierPlanRows = __test.buildMlTierPlanRows({
    EARLY: {
      currentThreshold: 0.55,
      next: 0.55,
      changed: false,
      reason: "INSUFFICIENT_SAMPLE",
      current: { n: 1, hitRate: 0, wilsonLower: 0, monthlyRunRateKrw: -1000 },
      best: null,
    },
  });
  assert.strictEqual(tierPlanRows[0].display_tier, "LONG/SHORT 기본 진입");
  assert.strictEqual(tierPlanRows[0].display_reason, "판단에 필요한 표본이 아직 부족합니다");

  const resolvedForBand = [
    { predicted: 0.48, outcome: "NO_TP1_EXITED", realizedRetNet: -0.02, realizedPnlQuote: -20 },
    { predicted: 0.52, outcome: "NO_TP1_EXITED", realizedRetNet: -0.01, realizedPnlQuote: -10 },
    { predicted: 0.56, outcome: "TP1_HIT", realizedRetNet: 0.02, realizedPnlQuote: 20 },
    { predicted: 0.58, outcome: "TP1_HIT", realizedRetNet: 0.025, realizedPnlQuote: 25 },
    { predicted: 0.61, outcome: "TP1_HIT", realizedRetNet: 0.03, realizedPnlQuote: 30 },
    { predicted: 0.64, outcome: "TP1_HIT", realizedRetNet: 0.035, realizedPnlQuote: 35 },
  ];
  const bandStats = __test.evaluateSizingBand(resolvedForBand, {
    minThreshold: 0.55,
    fullThreshold: 0.60,
    killThreshold: 0.50,
    midScale: 0.70,
    lowScale: 0.40,
  });
  assert.strictEqual(bandStats.n, 5);
  assert.strictEqual(bandStats.hits, 4);
  assert.ok(bandStats.netPnlQuote > 0);
  assert.ok(bandStats.avgRetNet > 0);
  assert.ok(Number.isFinite(bandStats.monthlyRunRateKrw));

  const bandPlan = __test.pickBandPlan({
    resolvedEntries: resolvedForBand,
    currentThreshold: 0.55,
    currentFullThreshold: 0.60,
    currentKillThreshold: 0.50,
    currentMidScale: 0.70,
    currentLowScale: 0.40,
    targetHitRate: 0.60,
    minSample: 4,
  });
  assert.strictEqual(typeof bandPlan.reason, "string");
  assert.ok(bandPlan.best);
  assert.ok(bandPlan.best.n >= 4);
  assert.ok(bandPlan.next.fullThreshold >= 0.55);
  assert.ok(bandPlan.next.killThreshold < 0.55);

  const insufficientBandPlan = __test.pickBandPlan({
    resolvedEntries: [],
    currentThreshold: 0.55,
    currentFullThreshold: 0.60,
    currentKillThreshold: 0.50,
    currentMidScale: 0.70,
    currentLowScale: 0.40,
    targetHitRate: 0.60,
    minSample: 4,
  });
  assert.strictEqual(insufficientBandPlan.reason, "INSUFFICIENT_BAND_SAMPLE");
  assert.strictEqual(insufficientBandPlan.changed, false);
  assert.strictEqual(insufficientBandPlan.next.fullThreshold, 0.60);
  assert.strictEqual(insufficientBandPlan.next.killThreshold, 0.50);
  assert.strictEqual(insufficientBandPlan.next.midScale, 0.70);
  assert.strictEqual(insufficientBandPlan.next.lowScale, 0.40);

  const mlGuided = __test.applyMlEvGuidance({
    plan: {
      current: { n: 2, hitRate: 0.5, wilsonLower: 0.2 },
      next: 0.55,
      changed: false,
      reason: "INSUFFICIENT_SAMPLE",
      best: null,
      candidates: [],
    },
    bandPlan: {
      current: { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40, n: 0 },
      next: { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40 },
      changed: false,
      reason: "INSUFFICIENT_BAND_SAMPLE",
      best: { avgRetNet: null, hitRate: null, netPnlQuote: null, negPnlAbs: null },
      candidates: [],
    },
    currentThreshold: 0.55,
    currentBand: { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40 },
    mlPolicyReport: {
      filePath: "/tmp/ml.json",
      age_ms: 60_000,
      data: {
        model: { sample_n: 240 },
        validation: { mode: "HOLDOUT" },
        metrics: { ok: true },
        coverage: { bar_context_rate: 1 },
        recommendations: {
          EV: {
            action: "REVIEW_UPDATE",
            next: {
              ev_gate_tp1_prob_min: 0.58,
              ev_gate_qty_scale_low: 0.35,
              ev_gate_qty_scale_mid: 0.65,
            },
            buckets: {
              low: { n: 12 },
              mid: { n: 10 },
            },
          },
        },
      },
    },
  });
  assert.strictEqual(mlGuided.applied, true);
  assert.strictEqual(mlGuided.plan.reason, "INSUFFICIENT_SAMPLE_ML_HINT");
  assert.strictEqual(mlGuided.plan.next, 0.58);
  assert.strictEqual(mlGuided.bandPlan.reason, "INSUFFICIENT_BAND_SAMPLE_ML_HINT");
  assert.strictEqual(mlGuided.bandPlan.next.lowScale, 0.35);
  assert.strictEqual(mlGuided.bandPlan.next.midScale, 0.65);

  const mlRejectedNoHoldout = __test.applyMlEvGuidance({
    plan: {
      current: { n: 2, hitRate: 0.5, wilsonLower: 0.2 },
      next: 0.55,
      changed: false,
      reason: "INSUFFICIENT_SAMPLE",
      best: null,
      candidates: [],
    },
    bandPlan: {
      current: { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40, n: 0 },
      next: { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40 },
      changed: false,
      reason: "INSUFFICIENT_BAND_SAMPLE",
      best: { avgRetNet: null, hitRate: null, netPnlQuote: null, negPnlAbs: null },
      candidates: [],
    },
    currentThreshold: 0.55,
    currentBand: { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40 },
    mlPolicyReport: {
      filePath: "/tmp/ml.json",
      age_ms: 60_000,
      data: {
        model: { sample_n: 240 },
        validation: { mode: "INSUFFICIENT_HOLDOUT" },
        metrics: { ok: false },
        coverage: { bar_context_rate: 1 },
        recommendations: {
          EV: {
            action: "REVIEW_UPDATE",
            next: {
              ev_gate_tp1_prob_min: 0.58,
              ev_gate_qty_scale_low: 0.35,
              ev_gate_qty_scale_mid: 0.65,
            },
            buckets: {
              low: { n: 12 },
              mid: { n: 10 },
            },
          },
        },
      },
    },
  });
  assert.strictEqual(mlRejectedNoHoldout.applied, false);

  assert.strictEqual(__test.isEvThresholdHardening(0.55, 0.58), true);
  assert.strictEqual(__test.isEvBandHardening(
    { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40 },
    { fullThreshold: 0.62, killThreshold: 0.52, midScale: 0.65, lowScale: 0.35 }
  ), true);
  const bestFebtBlocked = __test.applyBestFebtEvGuard({
    plan: { changed: true, next: 0.58, reason: "TARGET_THRESHOLD_SEARCH" },
    bandPlan: {
      changed: true,
      next: { fullThreshold: 0.62, killThreshold: 0.52, midScale: 0.65, lowScale: 0.35 },
      reason: "BAND_OBJECTIVE_SEARCH",
    },
    currentThreshold: 0.55,
    currentBand: { fullThreshold: 0.60, killThreshold: 0.50, midScale: 0.70, lowScale: 0.40 },
    bestFebtContract: { tightening_allowed: false, recovery_priority: true },
  });
  assert.strictEqual(bestFebtBlocked.plan.changed, false);
  assert.strictEqual(bestFebtBlocked.plan.next, 0.55);
  assert.strictEqual(bestFebtBlocked.bandPlan.changed, false);
  assert.strictEqual(bestFebtBlocked.bandPlan.next.fullThreshold, 0.60);
  assert.strictEqual(bestFebtBlocked.reason, "BEST_FEBT_COUNT_GUARD_BLOCK");

  const fillsByEntryEventId = new Map([
    ["BINANCEFUT|BTCUSDT|15m|1000|CORE_LONG|CORE_LONG", [
      { event: "EXIT_TP_P1_3.25P" },
      { event: "EXIT_TRAIL_1P" },
    ]],
    ["BINANCEFUT|ETHUSDT|15m|2000|CORE_LONG|CORE_LONG", [
      { event: "EXIT_SL_1.65P" },
    ]],
  ]);
  const hit = __test.classifyEntryOutcome({
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "BTCUSDT",
    tf: "15m",
    signal_bar_close_time_utc_ms: 1000,
    event: "CORE_LONG",
  }, fillsByEntryEventId, 10_000, 1000);
  assert.strictEqual(hit.status, "TP1_HIT");

  const fail = __test.classifyEntryOutcome({
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "ETHUSDT",
    tf: "15m",
    signal_bar_close_time_utc_ms: 2000,
    event: "CORE_LONG",
  }, fillsByEntryEventId, 10_000, 1000);
  assert.strictEqual(fail.status, "NO_TP1_EXITED");

  console.log("EV_TP1_THRESHOLD_TUNE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("EV_TP1_THRESHOLD_TUNE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
