"use strict";

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function unwrapShadowCanaryGatePayload(input = null) {
  if (!input || typeof input !== "object") return null;
  if (input.gate && typeof input.gate === "object") return safeClone(input);
  if (input.data && typeof input.data === "object" && input.data.gate && typeof input.data.gate === "object") {
    return safeClone(input.data);
  }
  return null;
}

function buildShadowCanaryGateContext(input = null) {
  const payload = unwrapShadowCanaryGatePayload(input);
  const gate = payload && payload.gate && typeof payload.gate === "object" ? payload.gate : {};
  const summary = payload && payload.summary && typeof payload.summary === "object" ? payload.summary : {};
  return {
    available: !!payload,
    generated_at: payload ? (payload.generated_at || payload.created_at || null) : null,
    status: String(gate.status || "").trim().toUpperCase() || null,
    reason: String(gate.reason || "").trim().toUpperCase() || null,
    promotion_blocked: gate.promotion_blocked === true,
    enough_samples: gate.enough_samples === true,
    compared_n: toNum(summary.compared_n ?? gate.compared_n),
    disagreement_rate: toNum(summary.disagreement_rate ?? gate.disagreement_rate),
    payload,
  };
}

function resolveShadowCanaryGatePass(input = null) {
  const ctx = input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "promotion_blocked")
    ? input
    : buildShadowCanaryGateContext(input);
  if (!ctx || ctx.available !== true) return true;
  return ctx.promotion_blocked !== true;
}

module.exports = {
  buildShadowCanaryGateContext,
  resolveShadowCanaryGatePass,
  __test: {
    unwrapShadowCanaryGatePayload,
  },
};
