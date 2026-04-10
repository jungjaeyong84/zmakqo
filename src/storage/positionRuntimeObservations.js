"use strict";

const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
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
  upsertSelfHealFailureObservation,
  __test: {
    observationId,
  },
};
