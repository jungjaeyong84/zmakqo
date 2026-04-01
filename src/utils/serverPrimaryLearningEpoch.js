"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  const raw = value.raw && typeof value.raw === "object" ? value.raw : value;
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function parseDateMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function resolveEpochStartMs({ epochState = null, nowMs = Date.now() } = {}) {
  const envOverride = parseDateMs(process.env.OPENCLAW_SERVER_PRIMARY_EPOCH_START_AT);
  if (Number.isFinite(envOverride)) {
    return { startMs: envOverride, source: "ENV_OVERRIDE" };
  }

  const stateStartMs = parseDateMs(epochState && epochState.started_at);
  if (Number.isFinite(stateStartMs)) {
    return { startMs: stateStartMs, source: "STATE" };
  }

  return { startMs: nowMs, source: "BOOTSTRAP_NOW" };
}

function deriveServerPrimaryLearningEpoch({
  epochState = null,
  runtime = null,
  serverPrimaryAcceptanceWatch = null,
  nowMs = Date.now(),
} = {}) {
  const runtimeSummary = readSummary(runtime);
  const acceptanceSummary = readSummary(serverPrimaryAcceptanceWatch);
  const learningWindowDays = Math.max(3, Math.min(60, Math.round(toNum(process.env.OPENCLAW_SERVER_PRIMARY_EPOCH_WINDOW_DAYS) || 14)));
  const { startMs, source } = resolveEpochStartMs({ epochState, nowMs });
  const ageHoursRaw = (nowMs - startMs) / (60 * 60 * 1000);
  const ageHours = Number(Math.max(0, ageHoursRaw).toFixed(2));
  const ageDays = Number((ageHours / 24).toFixed(2));
  const active = ageDays < learningWindowDays;
  const maturityProgress = Number(clamp(ageDays / learningWindowDays, 0, 1).toFixed(4));
  const penaltyWeight = Number((active ? clamp(0.25 + (0.75 * maturityProgress), 0.25, 1) : 1).toFixed(4));
  const sampleWeight = Number((active ? clamp(0.5 + (0.5 * maturityProgress), 0.5, 1) : 1).toFixed(4));
  const explorationBoost = Number((active ? clamp(1.35 - (0.35 * maturityProgress), 1, 1.35) : 1).toFixed(4));
  const realizedSampleFloorScale = Number((active ? clamp(0.65 + (0.35 * maturityProgress), 0.65, 1) : 1).toFixed(4));
  const sourceMode = String(runtimeSummary.source_mode || runtimeSummary.canonical_engine_source_mode || "").trim().toUpperCase() || null;
  const acceptanceReady = acceptanceSummary.acceptance_ready === true;

  return {
    status: active ? "SERVER_PRIMARY_EPOCH_ACTIVE" : "SERVER_PRIMARY_EPOCH_MATURED",
    learning_focus: "SERVER_SIGNAL_ONLY",
    started_at: new Date(startMs).toISOString(),
    start_source: source,
    age_hours: ageHours,
    age_days: ageDays,
    learning_window_days: learningWindowDays,
    maturity_progress: maturityProgress,
    active,
    penalty_weight: penaltyWeight,
    sample_weight: sampleWeight,
    exploration_boost: explorationBoost,
    realized_sample_floor_scale: realizedSampleFloorScale,
    penalty_mode: active ? "EPOCH_RELAXED" : "NORMAL",
    source_mode: sourceMode,
    server_primary_acceptance_ready: acceptanceReady,
    configured_server_primary_markets_n: toNum(acceptanceSummary.configured_server_primary_markets_n) || 0,
    server_primary_executed_n: toNum(acceptanceSummary.server_primary_executed_n) || 0,
  };
}

module.exports = {
  deriveServerPrimaryLearningEpoch,
  __test: {
    resolveEpochStartMs,
    parseDateMs,
  },
};
