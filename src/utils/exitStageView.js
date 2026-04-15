"use strict";

const { resolveExitRulesForPosition, computeRunnerExitStopPrice, resolveEntryRDistance, resolveTrailDelayState, resolveTpP0Pct } = require("../engine/signalEngine");
const { resolveTrailObservationSnapshot } = require("../storage/positionRuntimeObservations");
const { resolveExitStageAbsoluteContractQtyRatio } = require("./exitQtyContract");
const { buildStopDivergenceItems } = require("./exitIntegrityPolicy");
const { resolveCanonicalPositionExitStage } = require("../services/positionStateMachine");

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function upper(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function stopTolerance(value) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return 1e-8;
  return Math.max(Math.abs(n) * 0.0001, 1e-8);
}

function isWorseThanFloor({ side, chosen, floor }) {
  if (!Number.isFinite(chosen) || !Number.isFinite(floor)) return false;
  return side === "SHORT" ? chosen > floor + stopTolerance(floor) : chosen < floor - stopTolerance(floor);
}

function normalizeSide(position) {
  const meta = position && typeof position.meta === "object" ? position.meta : {};
  const raw = String(
    (position && (position.position_side || position.positionSide || position.side)) ||
    meta.position_side ||
    meta.external_side ||
    "LONG"
  ).toUpperCase();
  return raw === "SHORT" ? "SHORT" : "LONG";
}

function resolveLeverage(position, fallback = 1) {
  const meta = position && typeof position.meta === "object" ? position.meta : {};
  const n = toNum(meta.leverage) ?? toNum(position && position.leverage) ?? fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pctToPrice({ avg, pct, leverage, side, kind }) {
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(pct) || !Number.isFinite(leverage) || leverage <= 0) return null;
  const move = Math.abs(pct) / leverage;
  if (kind === "TP1") {
    return side === "SHORT" ? avg * (1 - move) : avg * (1 + move);
  }
  if (kind === "SL") {
    return side === "SHORT" ? avg * (1 + move) : avg * (1 - move);
  }
  if (kind === "BE") {
    return side === "SHORT" ? avg * (1 - move) : avg * (1 + move);
  }
  return null;
}

function buildGapPct({ currentPrice, targetPrice, side }) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(targetPrice) || targetPrice <= 0) return null;
  if (side === "SHORT") return ((currentPrice - targetPrice) / currentPrice) * 100;
  return ((targetPrice - currentPrice) / currentPrice) * 100;
}

function hasNativeProtection({ nativeStopPrice, nativeTpPrice, nativeRefreshStatus, nativeTpStatus }) {
  return Number.isFinite(nativeStopPrice)
    || Number.isFinite(nativeTpPrice)
    || Boolean(nativeRefreshStatus)
    || Boolean(nativeTpStatus);
}

function buildExitStageView({ exchange, position, closePrice, leverageFallback = 1, observation = null } = {}) {
  if (!position || typeof position !== "object") return null;
  const state = String(position.state || position.position_state || "").toUpperCase();
  const size = toNum(position.size_pct);
  if (!Number.isFinite(size) || size <= 0 || state === "FLAT") return null;

  const avg = toNum(position.avg_price);
  if (!Number.isFinite(avg) || avg <= 0) return null;

  const meta = position && typeof position.meta === "object" ? position.meta : {};
  const qtyBase = toNum(position.qty_base);
  const trailSnapshot = resolveTrailObservationSnapshot({ meta, observation });
  const side = normalizeSide(position);
  const leverage = resolveLeverage(position, leverageFallback);
  const close = toNum(closePrice);
  const rules = resolveExitRulesForPosition({ exchange, position });

  const tp0Pct = resolveTpP0Pct({ rules, meta });
  const tp0Price = pctToPrice({ avg, pct: tp0Pct, leverage, side, kind: "TP1" });
  const tp1Price = pctToPrice({ avg, pct: rules.TP_P1, leverage, side, kind: "TP1" });
  const slPrice = pctToPrice({ avg, pct: rules.SL, leverage, side, kind: "SL" });
  const bePrice = pctToPrice({ avg, pct: rules.BE_PCT, leverage, side, kind: "BE" });

  const tpP0Done = meta.tp_p0_done === true;
  const tpP1Done = meta.tp_p1_done === true;
  const tpP1Pending = meta.tp_p1_pending === true;
  const trailDelay = resolveTrailDelayState({
    meta,
    tpP1Done,
    currentBarMs: toNum(meta.last_bar_close_ms) ?? null,
    closePx: close,
    side,
    leverageEff: leverage,
    rules,
  });
  const trailActive = trailDelay.trailActive;
  const canonicalPositionStage = resolveCanonicalPositionExitStage({
    positionSnapshot: {
      ...position,
      tpP0Done,
      tpP1Done,
      trailActive,
    },
  });
  const effectiveCanonicalStage = canonicalPositionStage.stage;
  const canonicalRunnerRemainingAbs = toNum(meta.canonical_runner_remaining_abs)
    ?? toNum(meta.runner_remaining_qty_abs)
    ?? toNum(meta.runner_remaining_abs)
    ?? toNum(meta.contract_runner_remaining_abs);
  const canonicalRunnerRemainingSource = canonicalRunnerRemainingAbs != null ? "META" : null;
  const tpSkipReason = meta.tp_p1_skip_reason ? String(meta.tp_p1_skip_reason) : null;
  const trailRef = side === "SHORT" ? toNum(trailSnapshot.trail_low) : toNum(trailSnapshot.trail_high);
  const entryRDistance = resolveEntryRDistance({
    avg,
    leverageEff: leverage,
    side,
    meta,
    rules,
  });
  const runnerExit = computeRunnerExitStopPrice({
    avg,
    leverageEff: leverage,
    side,
    rules,
    tpP1Done,
    trailActive,
    trailHigh: toNum(trailSnapshot.trail_high),
    trailLow: toNum(trailSnapshot.trail_low),
    entryRDistance,
  });
  const trailStop = runnerExit.stopPrice;
  const runnerFloorStop = runnerExit.runnerFloorStop;
  const rawTrailStop = runnerExit.trailStop;
  const trailStopByR = toNum(trailSnapshot.trail_stop_by_r) ?? toNum(runnerExit.trailStopByR);
  const trailStopByPct = toNum(trailSnapshot.trail_stop_by_pct) ?? toNum(runnerExit.trailStopByPct);
  const chosenStopSource = upper(trailSnapshot.chosen_stop_source) || (runnerExit.stopSource || null);
  const finalEffectiveStop = toNum(trailSnapshot.final_effective_stop)
    ?? toNum(trailSnapshot.chosen_stop_price)
    ?? toNum(trailSnapshot.computed_trail_stop)
    ?? trailStop;
  const chosenStopPrice = toNum(trailSnapshot.chosen_stop_price)
    ?? finalEffectiveStop
    ?? toNum(trailSnapshot.computed_trail_stop)
    ?? trailStop;
  const expectedStopPrice = finalEffectiveStop
    ?? toNum(trailSnapshot.computed_trail_stop)
    ?? trailStop;
  const nativeStopPrice = toNum(trailSnapshot.native_stop_price) ?? toNum(meta.native_protection_stop_price);
  const nativeTpPrice = toNum(meta.native_protection_tp_price);
  const nativeTpQtyBase = toNum(meta.native_protection_tp_qty_base);
  const nativeTpQtyRatio = toNum(meta.native_protection_tp_qty_ratio);
  const nativeRefreshStatus = trailSnapshot.native_refresh_status
    ? String(trailSnapshot.native_refresh_status)
    : (meta.native_protection_refresh_status ? String(meta.native_protection_refresh_status) : null);
  const nativeTpStatus = meta.native_protection_tp_status ? String(meta.native_protection_tp_status) : null;
  const nativeTpReason = meta.native_protection_tp_reason ? String(meta.native_protection_tp_reason) : null;
  const nativeStopOrderId = trailSnapshot.native_stop_order_id
    ? String(trailSnapshot.native_stop_order_id)
    : (meta.native_protection_stop_order_id ? String(meta.native_protection_stop_order_id) : null);
  const nativeTpOrderId = meta.native_protection_tp_order_id ? String(meta.native_protection_tp_order_id) : null;
  const nativeProtectionStale = meta.native_protection_stale === true;
  const nativeProtectionActive = hasNativeProtection({
    nativeStopPrice,
    nativeTpPrice,
    nativeRefreshStatus,
    nativeTpStatus,
  });
  const stopDivergenceCodes = [];
  if (trailActive && !Number.isFinite(expectedStopPrice)) {
    stopDivergenceCodes.push("CHOSEN_STOP_MISSING");
  }
  if (trailActive && Number.isFinite(nativeStopPrice) && Number.isFinite(expectedStopPrice)
    && Math.abs(nativeStopPrice - expectedStopPrice) > stopTolerance(expectedStopPrice)) {
    stopDivergenceCodes.push("NATIVE_STOP_MISMATCH");
  }
  if (trailActive && isWorseThanFloor({ side, chosen: expectedStopPrice, floor: runnerFloorStop })) {
    stopDivergenceCodes.push("RUNNER_FLOOR_BROKEN");
  }
  if (trailActive && chosenStopSource === "TRAIL" && Number.isFinite(trailStopByR) && Number.isFinite(chosenStopPrice)
    && Math.abs(chosenStopPrice - trailStopByR) > stopTolerance(trailStopByR)) {
    stopDivergenceCodes.push("TRAIL_R_MISMATCH");
  }
  const stopDivergenceItems = buildStopDivergenceItems(stopDivergenceCodes);
  const nativeStopGapAbs = Number.isFinite(nativeStopPrice) && Number.isFinite(expectedStopPrice)
    ? Math.abs(nativeStopPrice - expectedStopPrice)
    : null;
  const nativeStopGapPct = Number.isFinite(nativeStopGapAbs) && Number.isFinite(expectedStopPrice) && expectedStopPrice !== 0
    ? (nativeStopGapAbs / Math.abs(expectedStopPrice))
    : null;

  const tp1GapPct = buildGapPct({ currentPrice: close, targetPrice: tp1Price, side });
  const tp1Near = !tpP1Done && !tpP1Pending && Number.isFinite(tp1GapPct) && tp1GapPct >= 0 && tp1GapPct <= 0.5;

  let label = "TP1 대기";
  let pill = "dim";
  if (tpP0Done && !tpP1Done) {
    label = "TP0 완료";
    pill = "warn";
  }
  if (tpSkipReason) {
    label = "TP1 스킵";
    pill = "bad";
  }
  if (tp1Near) {
    label = "TP1 근접";
    pill = "warn";
  }
  if (tpP1Pending) {
    label = "TP1 진행";
    pill = "warn";
  }
  if (tpP1Done) {
    label = trailActive ? "트레일링" : "TP1 후 대기";
    pill = "ok";
  }

  const displaySlPrice = Number.isFinite(nativeStopPrice) ? nativeStopPrice : slPrice;
  const displayTp1Price = Number.isFinite(nativeTpPrice) ? nativeTpPrice : tp1Price;
  const compactHeadline = (trailActive && Number.isFinite(trailStop))
    ? {
        left_label: runnerExit.stopSource === "RUNNER_FLOOR" ? "Runner" : "Trail",
        left_price: trailStop,
        right_label: "SL",
        right_price: displaySlPrice,
      }
    : {
        left_label: "SL",
        left_price: displaySlPrice,
        right_label: "TP1",
        right_price: displayTp1Price,
      };

  return {
    label,
    pill,
    side,
    leverage,
    avg_price: avg,
    current_qty_base: qtyBase,
    current_price: close,
    tp0_price: tp0Price,
    tp1_price: tp1Price,
    sl_price: slPrice,
    be_price: bePrice,
    tp1_qty_pct: resolveExitStageAbsoluteContractQtyRatio("TP1", rules),
    canonical_exit_stage: effectiveCanonicalStage,
    canonical_exit_stage_source: canonicalPositionStage.source,
    canonical_runner_remaining_abs: canonicalRunnerRemainingAbs,
    canonical_runner_remaining_source: canonicalRunnerRemainingSource,
    trail_r_multiple: toNum(rules.TRAIL_R_MULTIPLE),
    trail_pct: toNum(rules.TRAIL_PCT),
    tp0_done: tpP0Done,
    tp1_done: tpP1Done,
    tp1_pending: tpP1Pending,
    trail_active: trailActive,
    trail_delay_bars_ready: trailDelay.barsReady,
    trail_delay_mfe_ready: trailDelay.mfeReady,
    trail_delay_release_reason: trailDelay.releaseReason,
    tp1_gap_pct: tp1GapPct,
    tp1_skip_reason: tpSkipReason,
    trail_ref: trailRef,
    trail_high: toNum(trailSnapshot.trail_high),
    trail_high_at_ms: toNum(trailSnapshot.trail_high_at_ms),
    trail_low: toNum(trailSnapshot.trail_low),
    trail_low_at_ms: toNum(trailSnapshot.trail_low_at_ms),
    trail_source: trailSnapshot.trail_source || null,
    trail_stop: trailStop,
    trail_stop_raw: rawTrailStop,
    trail_stop_by_r: trailStopByR,
    r_based_trail_stop: trailStopByR,
    trail_stop_by_pct: trailStopByPct,
    runner_floor_pct: toNum(rules.RUNNER_MIN_PROFIT_PCT),
    runner_floor_stop: toNum(trailSnapshot.runner_floor_stop) ?? runnerFloorStop,
    runner_stop_source: runnerExit.stopSource,
    chosen_stop_source: chosenStopSource,
    chosen_stop_price: chosenStopPrice,
    final_effective_stop: expectedStopPrice,
    stop_divergence: stopDivergenceCodes.length > 0,
    stop_divergence_codes: stopDivergenceCodes,
    stop_divergence_items: stopDivergenceItems,
    native_stop_gap_abs: nativeStopGapAbs,
    native_stop_gap_pct: nativeStopGapPct,
    native_stop_price: nativeStopPrice,
    native_tp_price: nativeTpPrice,
    native_tp_qty_base: nativeTpQtyBase,
    native_tp_qty_ratio: nativeTpQtyRatio,
    native_refresh_status: nativeRefreshStatus,
    native_tp_status: nativeTpStatus,
    native_tp_reason: nativeTpReason,
    native_stop_order_id: nativeStopOrderId,
    native_tp_order_id: nativeTpOrderId,
    native_protection_stale: nativeProtectionStale,
    native_protection_active: nativeProtectionActive,
    display_sl_price: displaySlPrice,
    display_tp1_price: displayTp1Price,
    compact_headline: compactHeadline,
  };
}

module.exports = {
  buildExitStageView,
};
