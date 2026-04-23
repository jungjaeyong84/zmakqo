"use strict";

const { buildExitRuntimeProjectionDoc, buildTrailObservationDoc } = require("./contracts");

const EPSILON = 1e-8;

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function maxOrNull(a, b) {
  if (!(a != null || b != null)) return null;
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function minOrNull(a, b) {
  if (!(a != null || b != null)) return null;
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function resolveWatermarkPrice({ positionSide, previousWatermarkPrice, marketPrice, entryPrice } = {}) {
  const side = upper(positionSide);
  const prev = toNumber(previousWatermarkPrice);
  const mark = toNumber(marketPrice);
  const entry = toNumber(entryPrice);
  if (!(mark > 0)) throw new Error("MARKET_PRICE_REQUIRED");
  if (!(entry > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  const seed = prev != null ? prev : entry;
  if (side === "LONG") return Math.max(seed, mark);
  if (side === "SHORT") return Math.min(seed, mark);
  throw new Error("POSITION_SIDE_REQUIRED");
}

function resolveRunnerFloorStop({ positionSide, currentRunnerFloorStop, entryPrice } = {}) {
  const side = upper(positionSide);
  const current = toNumber(currentRunnerFloorStop);
  const entry = toNumber(entryPrice);
  if (!(entry > 0) && current == null) {
    return {
      ok: false,
      issueCode: "RUNNER_FLOOR_STOP_UNRESOLVABLE",
      runnerFloorStop: null,
    };
  }
  const floor = side === "LONG"
    ? maxOrNull(current, entry)
    : minOrNull(current, entry);
  return {
    ok: floor != null,
    issueCode: floor != null ? null : "RUNNER_FLOOR_STOP_UNRESOLVABLE",
    runnerFloorStop: floor,
  };
}

function computeRTrailStop({ positionSide, watermarkPrice, entryPrice, riskReferenceStopPrice, trailRMultiple } = {}) {
  const side = upper(positionSide);
  const watermark = toNumber(watermarkPrice);
  const entry = toNumber(entryPrice);
  const riskRef = toNumber(riskReferenceStopPrice);
  const multiple = toNumber(trailRMultiple);
  if (!(watermark > 0)) throw new Error("WATERMARK_PRICE_REQUIRED");
  if (!(entry > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  if (!(riskRef > 0)) throw new Error("RISK_REFERENCE_STOP_PRICE_REQUIRED");
  if (!(multiple > 0)) throw new Error("TRAIL_R_MULTIPLE_REQUIRED");
  const riskAbs = Math.abs(entry - riskRef);
  if (!(riskAbs > 0)) throw new Error("INITIAL_RISK_ABS_INVALID");
  return side === "LONG"
    ? Number((watermark - (riskAbs * multiple)).toFixed(8))
    : Number((watermark + (riskAbs * multiple)).toFixed(8));
}

function tightenOnlyStop({ positionSide, currentChosenStopPrice, candidateStopPrice } = {}) {
  const side = upper(positionSide);
  const current = toNumber(currentChosenStopPrice);
  const candidate = toNumber(candidateStopPrice);
  if (!(candidate > 0)) throw new Error("CANDIDATE_STOP_PRICE_REQUIRED");
  if (current == null) return candidate;
  return side === "LONG"
    ? Number(Math.max(current, candidate).toFixed(8))
    : Number(Math.min(current, candidate).toFixed(8));
}

function chooseStopSource({ positionSide, runnerFloorStop, trailStopByR } = {}) {
  const side = upper(positionSide);
  const floor = toNumber(runnerFloorStop);
  const trail = toNumber(trailStopByR);
  if (!(floor > 0) && !(trail > 0)) throw new Error("STOP_SOURCES_REQUIRED");
  if (!(floor > 0)) return { chosenStopSource: "TRAIL", chosenStopPrice: trail };
  if (!(trail > 0)) return { chosenStopSource: "FLOOR", chosenStopPrice: floor };
  if (side === "LONG") {
    return trail >= floor
      ? { chosenStopSource: "TRAIL", chosenStopPrice: trail }
      : { chosenStopSource: "FLOOR", chosenStopPrice: floor };
  }
  if (side === "SHORT") {
    return trail <= floor
      ? { chosenStopSource: "TRAIL", chosenStopPrice: trail }
      : { chosenStopSource: "FLOOR", chosenStopPrice: floor };
  }
  throw new Error("POSITION_SIDE_REQUIRED");
}

function evaluateTrailRefresh({
  positionCycle,
  projection,
  marketPrice,
  riskReferenceStopPrice,
  trailRMultiple = 0.6,
  observedAt = null,
} = {}) {
  const stage = upper(projection && projection.stage);
  if (stage !== "TRAIL_ACTIVE" || projection.trail_active !== true) {
    throw new Error("TRAIL_WORKER_STAGE_INVALID");
  }
  const side = upper(positionCycle && positionCycle.position_side);
  const entryPrice = toNumber(positionCycle && positionCycle.entry_price);

  const floor = resolveRunnerFloorStop({
    positionSide: side,
    currentRunnerFloorStop: projection.runner_floor_stop,
    entryPrice,
  });

  const issueCodes = [];
  if (!floor.ok) {
    issueCodes.push(floor.issueCode);
    return Object.freeze({
      ok: false,
      issueCodes,
      observation: null,
      refreshRequest: null,
      nextProjection: projection,
    });
  }

  let watermarkPrice = null;
  try {
    watermarkPrice = resolveWatermarkPrice({
      positionSide: side,
      previousWatermarkPrice: null,
      marketPrice,
      entryPrice,
    });
  } catch (error) {
    issueCodes.push("TRAIL_WATERMARK_UNRESOLVABLE");
    return Object.freeze({
      ok: false,
      issueCodes,
      observation: null,
      refreshRequest: null,
      nextProjection: projection,
    });
  }

  const trailStopByR = computeRTrailStop({
    positionSide: side,
    watermarkPrice,
    entryPrice,
    riskReferenceStopPrice,
    trailRMultiple,
  });
  const chosen = chooseStopSource({
    positionSide: side,
    runnerFloorStop: floor.runnerFloorStop,
    trailStopByR,
  });
  const tightenedStopPrice = tightenOnlyStop({
    positionSide: side,
    currentChosenStopPrice: projection.chosen_stop_price,
    candidateStopPrice: chosen.chosenStopPrice,
  });
  const tightenedSource = Math.abs(tightenedStopPrice - chosen.chosenStopPrice) <= EPSILON
    ? chosen.chosenStopSource
    : upper(projection.chosen_stop_source) || chosen.chosenStopSource;

  const nativeStopPrice = toNumber(projection.native_stop_price);
  if (!(nativeStopPrice > 0)) {
    issueCodes.push("TRAIL_STOP_MISSING");
  }

  const nextProjection = buildExitRuntimeProjectionDoc({
    positionCycleId: projection.position_cycle_id,
    stage: projection.stage,
    tp1Done: projection.tp1_done,
    trailActive: projection.trail_active,
    entryQtyAbs: projection.entry_qty_abs,
    tp1TargetPrice: projection.tp1_target_price,
    tp1TargetQtyAbs: projection.tp1_target_qty_abs,
    tp1FilledQtyAbs: projection.tp1_filled_qty_abs,
    runnerRemainingQtyAbs: projection.runner_remaining_qty_abs,
    runnerFloorStop: floor.runnerFloorStop,
    trailStopByR,
    chosenStopSource: tightenedSource,
    chosenStopPrice: tightenedStopPrice,
    finalEffectiveStop: tightenedStopPrice,
    nativeStopPrice: projection.native_stop_price,
    healthStatus: projection.health_status,
  });

  const observation = buildTrailObservationDoc({
    positionCycleId: projection.position_cycle_id,
    stage: projection.stage,
    marketPrice,
    watermarkPrice,
    runnerFloorStop: floor.runnerFloorStop,
    trailStopByR,
    chosenStopSource: tightenedSource,
    chosenStopPrice: tightenedStopPrice,
    finalEffectiveStop: tightenedStopPrice,
    nativeStopPrice: projection.native_stop_price,
    issueCodes,
    observedAt,
  });

  const refreshRequired = !(nativeStopPrice > 0) || Math.abs(nativeStopPrice - tightenedStopPrice) > EPSILON;
  const refreshRequest = refreshRequired
    ? Object.freeze({
        position_cycle_id: projection.position_cycle_id,
        requested_stop_price: tightenedStopPrice,
        requested_stop_source: tightenedSource,
        previous_native_stop_price: nativeStopPrice,
        reason: issueCodes.includes("TRAIL_STOP_MISSING") ? "TRAIL_STOP_MISSING" : "TRAIL_TIGHTEN_ONLY_REFRESH",
      })
    : null;

  return Object.freeze({
    ok: true,
    issueCodes,
    observation,
    refreshRequest,
    nextProjection,
  });
}

module.exports = {
  evaluateTrailRefresh,
  __test: {
    resolveWatermarkPrice,
    resolveRunnerFloorStop,
    computeRTrailStop,
    chooseStopSource,
    tightenOnlyStop,
  },
};
