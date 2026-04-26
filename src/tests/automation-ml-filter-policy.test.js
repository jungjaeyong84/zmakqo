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

  const bestFebtGuarded = __test.applySharedObjectiveGuard({
    QUALITY: [{ action: "REVIEW_TIGHTEN", key: "gate_core_score_abs", current: 0.55, next: 0.57, reason: "tighten" }],
    AI: { action: "REVIEW_UPDATE", key: "ai_missing_policy", current: "ALLOW", next: "REDUCE", reason: "tighten ai" },
    MARKET: { action: "REVIEW_TIGHTEN", key: "ai_bias_gate_opposite_mult", current: 0.35, next: 0.30, reason: "tighten market" },
    EV: {
      action: "REVIEW_UPDATE",
      reason: "tighten ev",
      next: {
        ev_gate_tp1_prob_min: 0.58,
        ev_gate_qty_scale_low: 0.35,
        ev_gate_qty_scale_mid: 0.65,
      },
    },
  }, {
    ai_missing_policy: "ALLOW",
    ai_missing_reduce_pct: 0.5,
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_qty_scale_low: 0.40,
    ev_gate_qty_scale_mid: 0.70,
  }, null, {
    tightening_allowed: false,
    recovery_priority: true,
  });
  assert.strictEqual(bestFebtGuarded.QUALITY[0].action, "HOLD");
  assert.strictEqual(bestFebtGuarded.AI.action, "HOLD");
  assert.strictEqual(bestFebtGuarded.MARKET.action, "HOLD");
  assert.strictEqual(bestFebtGuarded.EV.action, "HOLD");
  assert.strictEqual(__test.bestFebtGuardReason({ tightening_allowed: false }), "V2 Discovery 계약의 체결 기회 보존 기준(count_ratio_global < 1.00)에서는 강화 자동 권고를 차단합니다.");
  assert.strictEqual(__test.bestFebtGuardReason({ market: "DOGEUSDT", tightening_allowed: false }), "[DOGEUSDT] V2 Discovery 계약의 체결 기회 보존 기준(count_ratio_global < 1.00)에서는 강화 자동 권고를 차단합니다.");
  assert.strictEqual(__test.isAiHardeningRecommendation("ALLOW", 0.5, { action: "REVIEW_UPDATE", next: "REDUCE" }), true);
  assert.strictEqual(__test.isEvHardeningRecommendation({
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_qty_scale_low: 0.40,
    ev_gate_qty_scale_mid: 0.70,
  }, {
    action: "REVIEW_UPDATE",
    next: {
      ev_gate_tp1_prob_min: 0.58,
      ev_gate_qty_scale_low: 0.35,
      ev_gate_qty_scale_mid: 0.65,
    },
  }), true);

  const telegramPayload = __test.buildV2MlFilterTelegramSummary({
    provider: "BINANCEFUT",
    examples: Array.from({ length: 10 }, () => ({})),
    executedExamples: Array.from({ length: 2 }, () => ({})),
    dropExamples: Array.from({ length: 8 }, () => ({})),
    split: { mode: "HOLDOUT", eval: Array.from({ length: 3 }, () => ({})) },
    trainingRows: Array.from({ length: 7 }, () => ({})),
    metrics: { ok: true, accuracy: 0.66, brier: 0.23, logloss: 0.65 },
    selfValidation: { ok: false, result: "WARN", checks: ["holdout validation available"] },
    sharedObjective: {
      objectiveConfig: { min_monthly_net_krw: 1500000 },
      currentObjective: { verdict: "FAIL", monthly_run_rate_krw: -1234 },
    },
    bestFebtContract: { mode: "NORMAL", projected_replacement_ratio: null, projected_count_ratio_global: 1 },
    latePenalty: {
      late_1_plus: { labelRate: 0.52 },
      on_time: { labelRate: 0.39 },
      penalty_1_plus: 0.13,
    },
    recommendations: {
      QUALITY: [{ action: "REVIEW_TIGHTEN", key: "gate_core_score_abs", current: 35, next: 37, reason: "CORE score above boundary underperformed" }],
      AI: { action: "KEEP", reason: "current evidence weak" },
      MARKET: { action: "KEEP", reason: "current evidence weak" },
      EV: { action: "KEEP", reason: "formal live gate blocks loosening" },
    },
    mdPath: "/tmp/report.md",
    jsonPath: "/tmp/report.json",
  });
  const telegramText = JSON.stringify(telegramPayload);
  assert.strictEqual(telegramPayload.title, "[V2 OpenClaw 학습 점검] BINANCEFUT");
  assert(telegramText.includes("V2 OpenClaw 학습 상태"));
  assert(telegramText.includes("V2 Discovery 계약"));
  assert(telegramText.includes("V2 신호 기준/서버 정본"));
  for (const legacyTerm of [
    "학습 기반 필터 점검",
    "BEST/FEBT",
    "공통 목표",
    "1차 상태/무결성",
    "2차 진입 품질",
    "3차 상태 기반 Soft Sizing",
    "4차 EV/시간가치층",
    "LONG/SHORT 확장 진입",
  ]) {
    assert(!telegramText.includes(legacyTerm), `legacy telegram term leaked: ${legacyTerm}`);
  }

  console.log("AUTOMATION_ML_FILTER_POLICY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("AUTOMATION_ML_FILTER_POLICY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
