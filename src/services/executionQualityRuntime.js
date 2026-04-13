"use strict";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeReviewReasons(summary = null) {
  const row = summary && typeof summary === "object" ? summary : {};
  if (!Array.isArray(row.review_reasons)) return [];
  return row.review_reasons
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean);
}

function resolveExecutionQualityLatencyMs(summary = null) {
  const row = summary && typeof summary === "object" ? summary : {};
  return toNum(row.guard_created_to_fill_p95_ms ?? row.created_to_fill_p95_ms);
}

function isLegacyOutcomeOnlyLatencyFallback(summary = null) {
  const row = summary && typeof summary === "object" ? summary : {};
  const webhookDelayCause = String(row.top_operational_webhook_delay_cause || "").trim().toUpperCase();
  const immediateDelayGroup = String(row.top_operational_immediate_intent_delay_group || "").trim();
  const reasons = normalizeReviewReasons(row);
  return (
    webhookDelayCause === "LEGACY_WEBHOOK_OUTCOME_ONLY"
    && reasons.includes("LEGACY_LATENCY_GUARD_FALLBACK_ACTIVE")
    && !immediateDelayGroup
  );
}

function resolveExecutionQualityLatencyBudgetMs(summary = null, {
  standardBudgetMs = 3000,
  legacyFallbackBudgetMs = 5000,
} = {}) {
  return isLegacyOutcomeOnlyLatencyFallback(summary)
    ? Number(legacyFallbackBudgetMs)
    : Number(standardBudgetMs);
}

function isExecutionQualityLatencyHigh(summary = null, {
  standardBudgetMs = 3000,
  legacyFallbackBudgetMs = 5000,
} = {}) {
  const latencyMs = resolveExecutionQualityLatencyMs(summary);
  if (!Number.isFinite(latencyMs)) return false;
  return latencyMs >= resolveExecutionQualityLatencyBudgetMs(summary, {
    standardBudgetMs,
    legacyFallbackBudgetMs,
  });
}

module.exports = {
  normalizeReviewReasons,
  resolveExecutionQualityLatencyMs,
  isLegacyOutcomeOnlyLatencyFallback,
  resolveExecutionQualityLatencyBudgetMs,
  isExecutionQualityLatencyHigh,
};
