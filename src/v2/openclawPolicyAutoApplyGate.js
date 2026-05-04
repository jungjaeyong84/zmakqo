"use strict";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function unique(values) {
  return Object.freeze(Array.from(new Set((values || []).filter(Boolean))));
}

function blockersOf(row) {
  const obj = asObject(row) || {};
  return Array.isArray(obj.blockers) ? obj.blockers : [];
}

function warningsOf(row) {
  const obj = asObject(row) || {};
  return Array.isArray(obj.warnings) ? obj.warnings : [];
}

function evaluateOpenClawPolicyAutoApplyGate({
  env = process.env,
  formalLiveReadiness = null,
  policyPromotionGate = null,
  performanceGate = null,
  safetyStreak = null,
} = {}) {
  const formal = asObject(formalLiveReadiness) || {};
  const promotion = asObject(policyPromotionGate) || {};
  const performance = asObject(performanceGate) || {};
  const safety = asObject(safetyStreak) || {};
  const autoApplyEnabled = parseBool(env.DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED, false);
  const agentApplyEnabled = parseBool(env.OPENCLAW_AGENT_APPLY_ENABLED, false);
  const mlLiveServingArmed = parseBool(env.ML_LIVE_SERVING_ARMED, false);
  const conductorShadowOnly = parseBool(env.OPENCLAW_CONDUCTOR_SHADOW_ONLY, true);
  const narrativeShadowOnly = parseBool(env.OPENCLAW_NARRATIVE_SHADOW_ONLY, true);
  const canaryOnly = parseBool(env.DONBEOLJA_V2_CANARY_ONLY, true);
  const paidAiDisabled = parseBool(env.DONBEOLJA_PAID_AI_API_DISABLED, true);
  const providerMode = String(env.OPENCLAW_NARRATIVE_PROVIDER_MODE || "").trim().toUpperCase();
  const learningScope = String(env.DONBEOLJA_OPENCLAW_LEARNING_SCOPE || "").trim().toUpperCase();

  const blockers = [];
  const warnings = [];

  if (!autoApplyEnabled) blockers.push("POLICY_AUTO_APPLY:EXPLICIT_ENABLE_REQUIRED");
  if (!agentApplyEnabled) blockers.push("POLICY_AUTO_APPLY:AGENT_APPLY_NOT_ARMED");
  if (!mlLiveServingArmed) blockers.push("POLICY_AUTO_APPLY:ML_LIVE_SERVING_NOT_ARMED");
  if (conductorShadowOnly) blockers.push("POLICY_AUTO_APPLY:CONDUCTOR_STILL_SHADOW_ONLY");
  if (narrativeShadowOnly) blockers.push("POLICY_AUTO_APPLY:NARRATIVE_STILL_SHADOW_ONLY");
  if (canaryOnly) blockers.push("POLICY_AUTO_APPLY:CANARY_ONLY_RUNTIME");
  if (!paidAiDisabled) blockers.push("POLICY_AUTO_APPLY:PAID_AI_API_NOT_RETIRED");
  if (providerMode && providerMode !== "CODEX_CLI_ONLY") blockers.push("POLICY_AUTO_APPLY:NON_CODEX_PROVIDER_MODE");
  if (learningScope !== "V2_ONLY_OPENCLAW") blockers.push("POLICY_AUTO_APPLY:LEARNING_SCOPE_NOT_V2_ONLY");

  if (formal.ok !== true) blockers.push("POLICY_AUTO_APPLY:FORMAL_LIVE_READINESS_NOT_PASS");
  if (promotion.ok !== true) blockers.push("POLICY_AUTO_APPLY:POLICY_PROMOTION_GATE_NOT_PASS");
  if (performance.ok !== true) blockers.push("POLICY_AUTO_APPLY:PERFORMANCE_GATE_NOT_PASS");
  if (safety.ok !== true) blockers.push("POLICY_AUTO_APPLY:SAFETY_STREAK_NOT_PASS");

  blockers.push(...blockersOf(formal).map((code) => `FORMAL_LIVE:${code}`));
  blockers.push(...blockersOf(promotion).map((code) => `POLICY_PROMOTION:${code}`));
  blockers.push(...blockersOf(performance).map((code) => `PERFORMANCE:${code}`));
  blockers.push(...blockersOf(safety).map((code) => `SAFETY_STREAK:${code}`));
  warnings.push(...warningsOf(formal).map((code) => `FORMAL_LIVE:${code}`));
  warnings.push(...warningsOf(promotion).map((code) => `POLICY_PROMOTION:${code}`));

  const ok = blockers.length === 0;
  return Object.freeze({
    ok,
    reason: ok ? "OPENCLAW_POLICY_AUTO_APPLY_READY" : "OPENCLAW_POLICY_AUTO_APPLY_BLOCKED",
    decision: ok ? "AUTO_APPLY_ALLOWED" : "HOLD_SHADOW_OR_MANUAL_REVIEW",
    blockers: unique(blockers),
    warnings: unique(warnings),
    mode: Object.freeze({
      auto_apply_enabled: autoApplyEnabled,
      agent_apply_enabled: agentApplyEnabled,
      ml_live_serving_armed: mlLiveServingArmed,
      conductor_shadow_only: conductorShadowOnly,
      narrative_shadow_only: narrativeShadowOnly,
      canary_only: canaryOnly,
      paid_ai_disabled: paidAiDisabled,
      narrative_provider_mode: trimOrNull(providerMode),
      learning_scope: trimOrNull(learningScope),
    }),
    evidence: Object.freeze({
      formal_live_readiness_ok: formal.ok === true,
      formal_live_readiness_reason: trimOrNull(formal.reason),
      policy_promotion_gate_ok: promotion.ok === true,
      policy_promotion_gate_reason: trimOrNull(promotion.reason),
      policy_promotion_decision: trimOrNull(promotion.decision),
      performance_gate_ok: performance.ok === true,
      performance_gate_reason: trimOrNull(performance.reason),
      safety_streak_ok: safety.ok === true,
      safety_streak_reason: trimOrNull(safety.reason),
    }),
  });
}

module.exports = {
  evaluateOpenClawPolicyAutoApplyGate,
  __test: {
    trimOrNull,
    parseBool,
  },
};
