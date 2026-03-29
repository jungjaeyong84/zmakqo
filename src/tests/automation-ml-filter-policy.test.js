"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-ml-filter-policy");

function run() {
  const executed = { source: "EXECUTED", eventMs: 1000, label: 1 };
  const qualityDrop = { source: "DROP_COUNTERFACTUAL", dropStageKey: "QUALITY", eventMs: 2000, label: 0 };
  const aiDrop = { source: "DROP_COUNTERFACTUAL", dropStageKey: "AI", eventMs: 3000, label: 0 };
  const marketDrop = { source: "DROP_COUNTERFACTUAL", dropStageKey: "MARKET", eventMs: 4000, label: 1 };
  const evDrop = { source: "DROP_COUNTERFACTUAL", dropStageKey: "EV", eventMs: 5000, label: 1 };

  const marketScoped = __test.selectStageExamples([executed, qualityDrop, aiDrop, marketDrop, evDrop], "MARKET");
  assert.strictEqual(marketScoped.includes(qualityDrop), false);
  assert.strictEqual(marketScoped.includes(aiDrop), false);
  assert.strictEqual(marketScoped.includes(marketDrop), true);
  assert.strictEqual(marketScoped.includes(evDrop), true);
  assert.strictEqual(marketScoped.includes(executed), true);

  const evScoped = __test.selectStageExamples([executed, marketDrop, evDrop], "EV");
  assert.strictEqual(evScoped.includes(marketDrop), false);
  assert.strictEqual(evScoped.includes(evDrop), true);
  assert.strictEqual(evScoped.includes(executed), true);

  const split = __test.splitExamplesChronologically(
    Array.from({ length: 260 }, (_, i) => ({ eventMs: i + 1, label: i % 2 })),
    { evalRatio: 0.2, minEval: 40, minTrain: 160 },
  );
  assert.strictEqual(split.mode, "HOLDOUT");
  assert.strictEqual(split.train.length, 208);
  assert.strictEqual(split.eval.length, 52);

  const selfValidationWarn = __test.buildMlSelfValidation({
    validation: { mode: "HOLDOUT" },
    metrics: { ok: true },
    recommendations: {
      QUALITY: [],
      AI: { action: "KEEP" },
      MARKET: { action: "REVIEW_SOFTEN" },
      EV: { action: "KEEP" },
    },
    stageSamples: { quality_n: 100, ai_n: 50, market_n: 12, ev_n: 30 },
    coverage: { ai_bias_rate: 0.03 },
  });
  assert.strictEqual(selfValidationWarn.ok, false);

  const selfValidationOk = __test.buildMlSelfValidation({
    validation: { mode: "HOLDOUT" },
    metrics: { ok: true },
    recommendations: {
      QUALITY: [{ action: "REVIEW_TIGHTEN" }],
      AI: { action: "KEEP" },
      MARKET: { action: "KEEP" },
      EV: { action: "KEEP" },
    },
    stageSamples: { quality_n: 120, ai_n: 50, market_n: 50, ev_n: 30 },
    coverage: { ai_bias_rate: 0.10 },
  });
  assert.strictEqual(selfValidationOk.ok, true);

  const guarded = __test.applySharedObjectiveGuard({
    QUALITY: [{ action: "REVIEW_LOOSEN", key: "gate_conf_min", current: 0.55, next: 0.53, reason: "loosen" }],
    AI: { action: "KEEP", reason: "ok" },
    MARKET: { action: "REVIEW_SOFTEN", key: "ai_bias_gate_neutral_mult", current: 0.5, next: 0.55, reason: "soften" },
    EV: {
      action: "REVIEW_UPDATE",
      reason: "soften ev",
      next: {
        ev_gate_tp1_prob_min: 0.53,
        ev_gate_qty_scale_low: 0.45,
        ev_gate_qty_scale_mid: 0.75,
      },
    },
  }, {
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_qty_scale_low: 0.40,
    ev_gate_qty_scale_mid: 0.70,
  }, {
    objectiveConfig: { min_monthly_net_krw: 1500000 },
    currentObjective: { monthly_pass: false, net_pass: true, ev_pass: true, win_pass: true },
  });
  assert.strictEqual(guarded.QUALITY[0].action, "HOLD");
  assert.strictEqual(guarded.MARKET.action, "HOLD");
  assert.strictEqual(guarded.EV.action, "HOLD");

  console.log("AUTOMATION_ML_FILTER_POLICY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("AUTOMATION_ML_FILTER_POLICY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
