"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function resolvePolicyPromotionThresholds(env = process.env) {
  return Object.freeze({
    live_apply_enabled: parseBool(env.DONBEOLJA_V2_POLICY_PROMOTION_LIVE_APPLY_ENABLED, false),
    min_shadow_sample_n: Math.floor(toNumberOrNull(env.DONBEOLJA_V2_POLICY_PROMOTION_MIN_SHADOW_SAMPLE_N) || 30),
    min_challenger_sample_n: Math.floor(toNumberOrNull(env.DONBEOLJA_V2_POLICY_PROMOTION_MIN_CHALLENGER_SAMPLE_N) || 30),
    min_expectancy_delta_r: toNumberOrNull(env.DONBEOLJA_V2_POLICY_PROMOTION_MIN_EXPECTANCY_DELTA_R) ?? 0.05,
    min_profit_factor_delta: toNumberOrNull(env.DONBEOLJA_V2_POLICY_PROMOTION_MIN_PROFIT_FACTOR_DELTA) ?? 0.05,
    max_drawdown_regression_pct: toNumberOrNull(env.DONBEOLJA_V2_POLICY_PROMOTION_MAX_DRAWDOWN_REGRESSION_PCT) ?? 0,
    max_model_error_rate: toNumberOrNull(env.DONBEOLJA_V2_POLICY_PROMOTION_MAX_MODEL_ERROR_RATE) ?? 0.2,
  });
}

function evaluateOpenClawPolicyPromotionGate({
  env = process.env,
  thresholds = resolvePolicyPromotionThresholds(env),
  champion = {},
  challenger = {},
  learner = {},
} = {}) {
  const c = asObject(champion) || {};
  const n = asObject(challenger) || {};
  const l = asObject(learner) || {};
  const blockers = [];
  const warnings = [];
  const championId = trimOrNull(c.policy_id || c.policyId || c.id);
  const challengerId = trimOrNull(n.policy_id || n.policyId || n.id);
  const championSampleN = toNumberOrNull(c.sample_n ?? c.sampleN) || 0;
  const challengerSampleN = toNumberOrNull(n.sample_n ?? n.sampleN) || 0;
  const championExpectancy = toNumberOrNull(c.expectancy_r ?? c.expectancyR) || 0;
  const challengerExpectancy = toNumberOrNull(n.expectancy_r ?? n.expectancyR) || 0;
  const championPf = toNumberOrNull(c.profit_factor ?? c.profitFactor) || 0;
  const challengerPf = toNumberOrNull(n.profit_factor ?? n.profitFactor) || 0;
  const championDd = toNumberOrNull(c.max_drawdown_pct ?? c.maxDrawdownPct) || 0;
  const challengerDd = toNumberOrNull(n.max_drawdown_pct ?? n.maxDrawdownPct) || 0;
  const modelErrorRate = toNumberOrNull(l.model_error_rate ?? l.modelErrorRate) ?? 0;
  const liveAppliedN = toNumberOrNull(l.live_applied_n ?? l.liveAppliedN) ?? 0;
  const staleN = toNumberOrNull(l.stale_evaluation_n ?? l.staleEvaluationN) ?? 0;
  const expectancyDelta = challengerExpectancy - championExpectancy;
  const profitFactorDelta = challengerPf - championPf;
  const drawdownRegression = challengerDd - championDd;

  if (!championId) blockers.push("POLICY_PROMOTION:CHAMPION_POLICY_ID_REQUIRED");
  if (!challengerId) blockers.push("POLICY_PROMOTION:CHALLENGER_POLICY_ID_REQUIRED");
  if (championId && challengerId && championId === challengerId) blockers.push("POLICY_PROMOTION:CHALLENGER_MUST_DIFFER");
  if (championSampleN < thresholds.min_shadow_sample_n) blockers.push("POLICY_PROMOTION:CHAMPION_SAMPLE_INSUFFICIENT");
  if (challengerSampleN < thresholds.min_challenger_sample_n) blockers.push("POLICY_PROMOTION:CHALLENGER_SAMPLE_INSUFFICIENT");
  if (expectancyDelta < thresholds.min_expectancy_delta_r) blockers.push("POLICY_PROMOTION:EXPECTANCY_DELTA_INSUFFICIENT");
  if (profitFactorDelta < thresholds.min_profit_factor_delta) blockers.push("POLICY_PROMOTION:PROFIT_FACTOR_DELTA_INSUFFICIENT");
  if (drawdownRegression > thresholds.max_drawdown_regression_pct) blockers.push("POLICY_PROMOTION:DRAWDOWN_REGRESSION_BLOCKED");
  if (modelErrorRate > thresholds.max_model_error_rate) blockers.push("POLICY_PROMOTION:MODEL_ERROR_DRIFT_BLOCKED");
  if (liveAppliedN !== 0) blockers.push("POLICY_PROMOTION:LEARNER_LIVE_APPLICATION_FORBIDDEN");
  if (staleN !== 0) blockers.push("POLICY_PROMOTION:STALE_LEARNER_EVALUATION_BLOCKED");
  if (thresholds.live_apply_enabled === true) warnings.push("POLICY_PROMOTION:LIVE_APPLY_ENV_ARMED");

  const ok = blockers.length === 0;
  return Object.freeze({
    ok,
    reason: ok ? "OPENCLAW_POLICY_PROMOTION_GATE_PASS" : "OPENCLAW_POLICY_PROMOTION_GATE_BLOCKED",
    decision: ok && thresholds.live_apply_enabled === true ? "READY_FOR_MANUAL_REVIEW_NOT_AUTO_APPLY" : "HOLD_SHADOW",
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(Array.from(new Set(warnings))),
    thresholds,
    metrics: Object.freeze({
      champion_policy_id: championId,
      challenger_policy_id: challengerId,
      champion_sample_n: championSampleN,
      challenger_sample_n: challengerSampleN,
      expectancy_delta_r: expectancyDelta,
      profit_factor_delta: profitFactorDelta,
      drawdown_regression_pct: drawdownRegression,
      model_error_rate: modelErrorRate,
      live_applied_n: liveAppliedN,
      stale_evaluation_n: staleN,
    }),
  });
}

module.exports = {
  resolvePolicyPromotionThresholds,
  evaluateOpenClawPolicyPromotionGate,
  __test: { trimOrNull, toNumberOrNull, parseBool },
};
