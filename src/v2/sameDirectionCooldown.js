"use strict";

const DEFAULT_COOLDOWN_BARS = 8;
const DEFAULT_BAR_INTERVAL_MS = 15 * 60 * 1000;

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBool(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  const token = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(token)) return true;
  if (["0", "false", "no", "off"].includes(token)) return false;
  return fallback;
}

function resolveFeatureValue(featureValues, ...keys) {
  const features = asObject(featureValues);
  if (!features) return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(features, key)) return features[key];
  }
  return null;
}

function normalizeTriggerType(value) {
  const token = upper(value);
  if (!token) return "NONE";
  if (token === "BREAKOUT" || token === "BREAKDOWN" || token === "BREAKOUT_RETEST") return "BREAKOUT";
  if (token === "RECLAIM" || token === "LOSS" || token === "PULLBACK_RECLAIM") return "RECLAIM";
  if (token === "CONTINUATION" || token === "MOMENTUM_CONTINUATION") return "CONTINUATION";
  return "NONE";
}

function extractBarTimeMs(value) {
  const numeric = toNumberOrNull(value);
  if (numeric !== null) return numeric;
  const text = trimOrNull(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCurrentSignalContext(bundle = null) {
  const row = asObject(bundle) || {};
  const signal = asObject(row.signalIntent) || {};
  const featureSnapshot = asObject(row.featureSnapshot) || {};
  const features = asObject(featureSnapshot.feature_values) || {};
  const criteria = asObject(row.signalCriteria)
    || asObject(asObject(row.openclawDecision) && asObject(row.openclawDecision.canonical_evidence_summary).signal_criteria)
    || {};
  const setupGate = asObject(criteria.setup_gate) || {};
  const triggerGate = asObject(criteria.trigger_gate) || {};
  const proposal = asObject(row.mlAiSignalProposal)
    || asObject(asObject(row.openclawDecision) && asObject(row.openclawDecision.canonical_evidence_summary).ml_ai_signal_proposal)
    || {};
  const barTime = extractBarTimeMs(
    resolveFeatureValue(features, "bar_close_time_utc_ms", "bar_time_ms", "event_time_ms", "bar_time", "snapshot_time_ms")
    ?? featureSnapshot.snapshot_at
  );
  return Object.freeze({
    symbol: upper(signal.symbol || proposal.symbol),
    side: upper(signal.side || proposal.side),
    trigger_type: normalizeTriggerType(triggerGate.trigger_type || criteria.trigger_type || proposal.trigger_type || setupGate.setup_type),
    entry_grade: upper(criteria.entry_grade || proposal.entry_grade),
    setup_type: upper(setupGate.setup_type || proposal.setup_type),
    signal_score: toNumberOrNull(criteria.signal_score || proposal.signal_score),
    bar_time_ms: barTime,
  });
}

function extractPriorSignalContext(row = null) {
  const audit = asObject(row) || {};
  const snap = asObject(audit.audit_snapshot) || {};
  return Object.freeze({
    symbol: upper(audit.symbol || snap.symbol),
    side: upper(audit.side || snap.side),
    trigger_type: normalizeTriggerType(audit.trigger_type || snap.trigger_type || audit.setup_type || snap.setup_type),
    entry_grade: upper(audit.entry_grade || snap.entry_grade),
    setup_type: upper(audit.setup_type || snap.setup_type),
    signal_score: toNumberOrNull(audit.signal_score || snap.signal_score),
    bar_time_ms: extractBarTimeMs(audit.bar_time_ms || snap.bar_time_ms || audit.recorded_at || snap.generated_at),
    ok: audit.ok === true,
  });
}

function evaluateV2SameDirectionCooldown({
  bundle = null,
  recentExecutions = [],
  nowMs = null,
  env = process.env,
  enabled = null,
  cooldownBars = null,
  barIntervalMs = null,
} = {}) {
  const active = enabled === null
    ? parseBool(env.DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_ENABLED, true)
    : enabled === true;
  const bars = Math.max(0, toNumberOrNull(cooldownBars ?? env.DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_BARS) ?? DEFAULT_COOLDOWN_BARS);
  const intervalMs = Math.max(1, toNumberOrNull(barIntervalMs ?? env.DONBEOLJA_V2_SIGNAL_BAR_INTERVAL_MS) ?? DEFAULT_BAR_INTERVAL_MS);
  const current = extractCurrentSignalContext(bundle);
  if (!active || bars === 0) {
    return Object.freeze({ ok: true, reason: "SAME_DIRECTION_COOLDOWN_DISABLED", current, matched_execution: null, cooldown_bars: bars });
  }
  if (!current.symbol || !current.side) {
    return Object.freeze({ ok: false, reason: "SAME_DIRECTION_COOLDOWN_CONTEXT_REQUIRED", current, matched_execution: null, cooldown_bars: bars });
  }

  const currentTime = current.bar_time_ms
    ?? toNumberOrNull(nowMs)
    ?? Date.now();
  const maxAgeMs = bars * intervalMs;
  const rows = Array.isArray(recentExecutions) ? recentExecutions : [];
  let bestMatch = null;
  for (const row of rows) {
    const prior = extractPriorSignalContext(row);
    if (prior.ok !== true) continue;
    if (prior.symbol !== current.symbol || prior.side !== current.side) continue;
    if (prior.trigger_type !== current.trigger_type) continue;
    if (!prior.bar_time_ms) continue;
    const ageMs = currentTime - prior.bar_time_ms;
    if (ageMs < 0 || ageMs > maxAgeMs) continue;
    if (!bestMatch || ageMs < bestMatch.age_ms) {
      bestMatch = Object.freeze({ ...prior, age_ms: ageMs, raw: row });
    }
  }
  if (bestMatch) {
    return Object.freeze({
      ok: false,
      reason: "SAME_DIRECTION_COOLDOWN_ACTIVE",
      current,
      matched_execution: bestMatch,
      cooldown_bars: bars,
      cooldown_window_ms: maxAgeMs,
    });
  }
  return Object.freeze({
    ok: true,
    reason: "SAME_DIRECTION_COOLDOWN_CLEAR",
    current,
    matched_execution: null,
    cooldown_bars: bars,
    cooldown_window_ms: maxAgeMs,
  });
}

module.exports = {
  DEFAULT_COOLDOWN_BARS,
  DEFAULT_BAR_INTERVAL_MS,
  evaluateV2SameDirectionCooldown,
  extractCurrentSignalContext,
  extractPriorSignalContext,
  __test: {
    trimOrNull,
    upper,
    asObject,
    toNumberOrNull,
    parseBool,
    normalizeTriggerType,
    extractBarTimeMs,
  },
};
