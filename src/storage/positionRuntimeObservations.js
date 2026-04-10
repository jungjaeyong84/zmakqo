"use strict";

const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function normalizeOptionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function observationId({ exchange, symbol } = {}) {
  return `OBS__${String(exchange || "").toUpperCase().trim()}__${String(symbol || "").toUpperCase().trim()}`;
}

async function getPositionRuntimeObservation({ exchange, symbol } = {}) {
  const db = getFirestore();
  const id = observationId({ exchange, symbol });
  const ref = db.collection("position_runtime_observations").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return {
      observation_id: id,
      exchange,
      symbol_or_pair_id: symbol,
      updated_at: null,
      same_direction_trail_profit: null,
    };
  }
  return snap.data();
}

async function upsertSameDirectionTrailProfitObservation({
  exchange,
  symbol,
  exitDir,
  exitWallMs,
  exitEvent,
  realizedPnl,
  source,
} = {}) {
  const db = getFirestore();
  const id = observationId({ exchange, symbol });
  const ref = db.collection("position_runtime_observations").doc(id);
  const payload = {
    observation_id: id,
    exchange,
    symbol_or_pair_id: symbol,
    same_direction_trail_profit: {
      exit_dir: exitDir || null,
      exit_wall_ms: Number.isFinite(Number(exitWallMs)) ? Number(exitWallMs) : null,
      exit_event: exitEvent || null,
      realized_pnl: Number.isFinite(Number(realizedPnl)) ? Number(realizedPnl) : null,
      source: source || null,
    },
    updated_at: nowIso(),
  };
  await ref.set(payload, { merge: true });
  return payload;
}

function buildTrailObservationPayload({
  exchange,
  symbol,
  side = null,
  trailHigh = null,
  trailHighAtMs = null,
  trailLow = null,
  trailLowAtMs = null,
  source = null,
} = {}) {
  const id = observationId({ exchange, symbol });
  return {
    observation_id: id,
    exchange,
    symbol_or_pair_id: symbol,
    trail_observation: {
      side: side || null,
      trail_high: normalizeOptionalFiniteNumber(trailHigh),
      trail_high_at_ms: normalizeOptionalFiniteNumber(trailHighAtMs),
      trail_low: normalizeOptionalFiniteNumber(trailLow),
      trail_low_at_ms: normalizeOptionalFiniteNumber(trailLowAtMs),
      source: source || null,
    },
    updated_at: nowIso(),
  };
}

function resolveTrailObservationSnapshot({
  meta = null,
  observation = null,
} = {}) {
  const metaSafe = (meta && typeof meta === "object") ? meta : {};
  const observed = (observation && typeof observation === "object" && observation.trail_observation && typeof observation.trail_observation === "object")
    ? observation.trail_observation
    : {};
  const metaHighAtMs = normalizeOptionalFiniteNumber(metaSafe.trail_high_at_ms);
  const metaLowAtMs = normalizeOptionalFiniteNumber(metaSafe.trail_low_at_ms);
  const obsHighAtMs = normalizeOptionalFiniteNumber(observed.trail_high_at_ms);
  const obsLowAtMs = normalizeOptionalFiniteNumber(observed.trail_low_at_ms);
  const useObservedHigh = Number.isFinite(obsHighAtMs)
    && (!Number.isFinite(metaHighAtMs) || obsHighAtMs > metaHighAtMs);
  const useObservedLow = Number.isFinite(obsLowAtMs)
    && (!Number.isFinite(metaLowAtMs) || obsLowAtMs > metaLowAtMs);
  return {
    trail_high: useObservedHigh
      ? normalizeOptionalFiniteNumber(observed.trail_high)
      : normalizeOptionalFiniteNumber(metaSafe.trail_high),
    trail_high_at_ms: useObservedHigh ? obsHighAtMs : metaHighAtMs,
    trail_low: useObservedLow
      ? normalizeOptionalFiniteNumber(observed.trail_low)
      : normalizeOptionalFiniteNumber(metaSafe.trail_low),
    trail_low_at_ms: useObservedLow ? obsLowAtMs : metaLowAtMs,
    trail_source: useObservedHigh || useObservedLow
      ? (String(observed.source || "").trim().toUpperCase() || null)
      : null,
  };
}

async function upsertTrailObservation({
  exchange,
  symbol,
  side = null,
  trailHigh = null,
  trailHighAtMs = null,
  trailLow = null,
  trailLowAtMs = null,
  source = null,
} = {}) {
  const db = getFirestore();
  const payload = buildTrailObservationPayload({
    exchange,
    symbol,
    side,
    trailHigh,
    trailHighAtMs,
    trailLow,
    trailLowAtMs,
    source,
  });
  const ref = db.collection("position_runtime_observations").doc(payload.observation_id);
  await ref.set(payload, { merge: true });
  return payload;
}

async function upsertSelfHealFailureObservation({
  exchange,
  symbol,
  reason,
  error,
  atMs,
} = {}) {
  const db = getFirestore();
  const id = observationId({ exchange, symbol });
  const ref = db.collection("position_runtime_observations").doc(id);
  const payload = {
    observation_id: id,
    exchange,
    symbol_or_pair_id: symbol,
    self_heal_failure: {
      reason: String(reason || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
      error: error ? String(error).slice(0, 240) : null,
      at_ms: Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now(),
    },
    updated_at: nowIso(),
  };
  await ref.set(payload, { merge: true });
  return payload;
}

module.exports = {
  getPositionRuntimeObservation,
  upsertSameDirectionTrailProfitObservation,
  upsertTrailObservation,
  upsertSelfHealFailureObservation,
  resolveTrailObservationSnapshot,
  __test: {
    observationId,
    buildTrailObservationPayload,
    resolveTrailObservationSnapshot,
  },
};
