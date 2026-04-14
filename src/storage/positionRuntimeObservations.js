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

function normalizeOptionalString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function maxFinite(values = []) {
  let current = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const n = normalizeOptionalFiniteNumber(value);
    if (Number.isFinite(n) && n > current) current = n;
  }
  return Number.isFinite(current) ? current : null;
}

function stopTolerance(value) {
  const n = normalizeOptionalFiniteNumber(value);
  if (!Number.isFinite(n)) return 1e-8;
  return Math.max(Math.abs(n) * 0.0001, 1e-8);
}

function normalizeChosenStopAuthority({
  runnerFloorStop = null,
  trailStopByR = null,
  trailStopByPct = null,
  chosenStopSource = null,
  chosenStopPrice = null,
} = {}) {
  const floor = normalizeOptionalFiniteNumber(runnerFloorStop);
  const trailByR = normalizeOptionalFiniteNumber(trailStopByR);
  const trailByPct = normalizeOptionalFiniteNumber(trailStopByPct);
  const trail = Number.isFinite(trailByR) ? trailByR : trailByPct;
  const rawSource = normalizeOptionalString(chosenStopSource);
  const rawPrice = normalizeOptionalFiniteNumber(chosenStopPrice);
  if (!Number.isFinite(rawPrice)) {
    if (rawSource === "RUNNER_FLOOR" && Number.isFinite(floor)) return { chosenStopSource: "RUNNER_FLOOR", chosenStopPrice: floor };
    if (rawSource === "TRAIL" && Number.isFinite(trail)) return { chosenStopSource: "TRAIL", chosenStopPrice: trail };
    return { chosenStopSource: rawSource, chosenStopPrice: rawPrice };
  }
  const floorGap = Number.isFinite(floor) ? Math.abs(rawPrice - floor) : Number.POSITIVE_INFINITY;
  const trailGap = Number.isFinite(trail) ? Math.abs(rawPrice - trail) : Number.POSITIVE_INFINITY;
  const nearFloor = Number.isFinite(floor) && floorGap <= stopTolerance(floor);
  const nearTrail = Number.isFinite(trail) && trailGap <= stopTolerance(trail);
  if (nearFloor || nearTrail) {
    if (nearFloor && !nearTrail) return { chosenStopSource: "RUNNER_FLOOR", chosenStopPrice: floor };
    if (nearTrail && !nearFloor) return { chosenStopSource: "TRAIL", chosenStopPrice: trail };
    if (floorGap <= trailGap && Number.isFinite(floor)) return { chosenStopSource: "RUNNER_FLOOR", chosenStopPrice: floor };
    if (Number.isFinite(trail)) return { chosenStopSource: "TRAIL", chosenStopPrice: trail };
  }
  return { chosenStopSource: rawSource, chosenStopPrice: rawPrice };
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
  entryEventId = null,
  entryExecBarMs = null,
  entryPrice = null,
  entryRDistance = null,
  trailRMultiple = null,
  trailHigh = null,
  trailHighAtMs = null,
  trailLow = null,
  trailLowAtMs = null,
  runnerFloorStop = null,
  computedTrailStop = null,
  trailStopRaw = null,
  trailStopByR = null,
  trailStopByPct = null,
  chosenStopSource = null,
  chosenStopPrice = null,
  finalEffectiveStop = null,
  nativeStopPrice = null,
  nativeStopOrderId = null,
  nativeRefreshStatus = null,
  lastRepriceAtMs = null,
  runtimeEvalAtMs = null,
  source = null,
} = {}) {
  const id = observationId({ exchange, symbol });
  const normalizedChosen = normalizeChosenStopAuthority({
    runnerFloorStop,
    trailStopByR,
    trailStopByPct,
    chosenStopSource,
    chosenStopPrice,
  });
  return {
    observation_id: id,
    exchange,
    symbol_or_pair_id: symbol,
    trail_observation: {
      side: side || null,
      entry_event_id: String(entryEventId || "").trim() || null,
      entry_exec_bar_ms: normalizeOptionalFiniteNumber(entryExecBarMs),
      entry_price: normalizeOptionalFiniteNumber(entryPrice),
      entry_r_distance: normalizeOptionalFiniteNumber(entryRDistance),
      trail_r_multiple: normalizeOptionalFiniteNumber(trailRMultiple),
      trail_high: normalizeOptionalFiniteNumber(trailHigh),
      trail_high_at_ms: normalizeOptionalFiniteNumber(trailHighAtMs),
      trail_low: normalizeOptionalFiniteNumber(trailLow),
      trail_low_at_ms: normalizeOptionalFiniteNumber(trailLowAtMs),
      runner_floor_stop: normalizeOptionalFiniteNumber(runnerFloorStop),
      computed_trail_stop: normalizeOptionalFiniteNumber(computedTrailStop),
      trail_stop_raw: normalizeOptionalFiniteNumber(trailStopRaw),
      trail_stop_by_r: normalizeOptionalFiniteNumber(trailStopByR),
      r_based_trail_stop: normalizeOptionalFiniteNumber(trailStopByR),
      trail_stop_by_pct: normalizeOptionalFiniteNumber(trailStopByPct),
      chosen_stop_source: normalizeOptionalString(normalizedChosen.chosenStopSource),
      chosen_stop_price: normalizeOptionalFiniteNumber(normalizedChosen.chosenStopPrice),
      final_effective_stop: normalizeOptionalFiniteNumber(
        finalEffectiveStop !== null && finalEffectiveStop !== undefined
          ? finalEffectiveStop
          : normalizedChosen.chosenStopPrice
      ),
      native_stop_price: normalizeOptionalFiniteNumber(nativeStopPrice),
      native_stop_order_id: normalizeOptionalString(nativeStopOrderId),
      native_refresh_status: normalizeOptionalString(nativeRefreshStatus),
      last_reprice_at_ms: normalizeOptionalFiniteNumber(lastRepriceAtMs),
      runtime_eval_at_ms: normalizeOptionalFiniteNumber(runtimeEvalAtMs),
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
  const obsRuntimeEvalAtMs = normalizeOptionalFiniteNumber(observed.runtime_eval_at_ms);
  const metaRuntimeAtMs = normalizeOptionalFiniteNumber(metaSafe.native_protection_refresh_at_ms);
  const useObservedHigh = Number.isFinite(obsHighAtMs)
    && (!Number.isFinite(metaHighAtMs) || obsHighAtMs > metaHighAtMs);
  const useObservedLow = Number.isFinite(obsLowAtMs)
    && (!Number.isFinite(metaLowAtMs) || obsLowAtMs > metaLowAtMs);
  const useObservedRuntime = Number.isFinite(obsRuntimeEvalAtMs)
    && (!Number.isFinite(metaRuntimeAtMs) || obsRuntimeEvalAtMs >= metaRuntimeAtMs);
  const normalizedChosen = normalizeChosenStopAuthority({
    runnerFloorStop: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.runner_floor_stop)
      : null,
    trailStopByR: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.trail_stop_by_r ?? observed.r_based_trail_stop)
      : null,
    trailStopByPct: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.trail_stop_by_pct)
      : null,
    chosenStopSource: useObservedRuntime
      ? normalizeOptionalString(observed.chosen_stop_source)
      : null,
    chosenStopPrice: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.chosen_stop_price)
      : null,
  });
  return {
    trail_high: useObservedHigh
      ? normalizeOptionalFiniteNumber(observed.trail_high)
      : normalizeOptionalFiniteNumber(metaSafe.trail_high),
    trail_high_at_ms: useObservedHigh ? obsHighAtMs : metaHighAtMs,
    trail_low: useObservedLow
      ? normalizeOptionalFiniteNumber(observed.trail_low)
      : normalizeOptionalFiniteNumber(metaSafe.trail_low),
    trail_low_at_ms: useObservedLow ? obsLowAtMs : metaLowAtMs,
    trail_source: useObservedHigh || useObservedLow || useObservedRuntime
      ? (String(observed.source || "").trim().toUpperCase() || null)
      : null,
    entry_price: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.entry_price)
      : normalizeOptionalFiniteNumber(metaSafe.native_protection_entry_price ?? metaSafe.external_entry_price ?? metaSafe.entry_price),
    entry_r_distance: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.entry_r_distance)
      : normalizeOptionalFiniteNumber(metaSafe.entry_r_distance),
    trail_r_multiple: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.trail_r_multiple)
      : normalizeOptionalFiniteNumber(metaSafe.trail_r_multiple),
    runner_floor_stop: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.runner_floor_stop)
      : null,
    computed_trail_stop: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.computed_trail_stop)
      : null,
    trail_stop_raw: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.trail_stop_raw)
      : null,
    trail_stop_by_r: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.trail_stop_by_r ?? observed.r_based_trail_stop)
      : null,
    r_based_trail_stop: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.r_based_trail_stop ?? observed.trail_stop_by_r)
      : null,
    trail_stop_by_pct: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.trail_stop_by_pct)
      : null,
    chosen_stop_source: normalizeOptionalString(normalizedChosen.chosenStopSource),
    chosen_stop_price: normalizeOptionalFiniteNumber(normalizedChosen.chosenStopPrice),
    final_effective_stop: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.final_effective_stop ?? normalizedChosen.chosenStopPrice)
      : normalizeOptionalFiniteNumber(metaSafe.final_effective_stop ?? metaSafe.native_protection_stop_price),
    native_stop_price: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.native_stop_price)
      : normalizeOptionalFiniteNumber(metaSafe.native_protection_stop_price),
    native_stop_order_id: useObservedRuntime
      ? normalizeOptionalString(observed.native_stop_order_id)
      : normalizeOptionalString(metaSafe.native_protection_stop_order_id),
    native_refresh_status: useObservedRuntime
      ? normalizeOptionalString(observed.native_refresh_status)
      : normalizeOptionalString(metaSafe.native_protection_refresh_status),
    last_reprice_at_ms: useObservedRuntime
      ? normalizeOptionalFiniteNumber(observed.last_reprice_at_ms)
      : normalizeOptionalFiniteNumber(metaSafe.native_protection_refresh_at_ms),
    runtime_eval_at_ms: useObservedRuntime ? obsRuntimeEvalAtMs : metaRuntimeAtMs,
  };
}

function resolveTrailObservationFreshnessMs(trailObservation = null) {
  const observed = (trailObservation && typeof trailObservation === "object") ? trailObservation : {};
  return maxFinite([
    observed.runtime_eval_at_ms,
    observed.last_reprice_at_ms,
    observed.trail_high_at_ms,
    observed.trail_low_at_ms,
  ]);
}

function shouldRejectStaleTrailObservation({
  currentObservation = null,
  nextObservation = null,
} = {}) {
  const currentFreshnessMs = resolveTrailObservationFreshnessMs(currentObservation);
  const nextFreshnessMs = resolveTrailObservationFreshnessMs(nextObservation);
  if (!Number.isFinite(currentFreshnessMs) || !Number.isFinite(nextFreshnessMs)) return false;
  return nextFreshnessMs < currentFreshnessMs;
}

async function upsertTrailObservation({
  exchange,
  symbol,
  side = null,
  entryEventId = null,
  entryExecBarMs = null,
  entryPrice = null,
  entryRDistance = null,
  trailRMultiple = null,
  trailHigh = null,
  trailHighAtMs = null,
  trailLow = null,
  trailLowAtMs = null,
  runnerFloorStop = null,
  computedTrailStop = null,
  trailStopRaw = null,
  trailStopByR = null,
  trailStopByPct = null,
  chosenStopSource = null,
  chosenStopPrice = null,
  finalEffectiveStop = null,
  nativeStopPrice = null,
  nativeStopOrderId = null,
  nativeRefreshStatus = null,
  lastRepriceAtMs = null,
  runtimeEvalAtMs = null,
  source = null,
} = {}) {
  const db = getFirestore();
  const payload = buildTrailObservationPayload({
    exchange,
    symbol,
    side,
    entryEventId,
    entryExecBarMs,
    entryPrice,
    entryRDistance,
    trailRMultiple,
    trailHigh,
    trailHighAtMs,
    trailLow,
    trailLowAtMs,
    runnerFloorStop,
    computedTrailStop,
    trailStopRaw,
    trailStopByR,
    trailStopByPct,
    chosenStopSource,
    chosenStopPrice,
    finalEffectiveStop,
    nativeStopPrice,
    nativeStopOrderId,
    nativeRefreshStatus,
    lastRepriceAtMs,
    runtimeEvalAtMs,
    source,
  });
  const ref = db.collection("position_runtime_observations").doc(payload.observation_id);
  if (typeof db.runTransaction === "function") {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists && snap.data() && snap.data().trail_observation && typeof snap.data().trail_observation === "object"
        ? snap.data().trail_observation
        : null;
      if (shouldRejectStaleTrailObservation({
        currentObservation: current,
        nextObservation: payload.trail_observation,
      })) return;
      tx.set(ref, payload, { merge: true });
    });
  } else {
    await ref.set(payload, { merge: true });
  }
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
    normalizeChosenStopAuthority,
    resolveTrailObservationFreshnessMs,
    shouldRejectStaleTrailObservation,
  },
};
