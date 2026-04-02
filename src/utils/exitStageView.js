"use strict";

const { resolveExitRulesForPosition, computeRunnerExitStopPrice, resolveEntryRDistance } = require("../engine/signalEngine");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function buildExitStageView({ exchange, position, closePrice, leverageFallback = 1 } = {}) {
  if (!position || typeof position !== "object") return null;
  const state = String(position.state || position.position_state || "").toUpperCase();
  const size = toNum(position.size_pct);
  if (!Number.isFinite(size) || size <= 0 || state === "FLAT") return null;

  const avg = toNum(position.avg_price);
  if (!Number.isFinite(avg) || avg <= 0) return null;

  const meta = position && typeof position.meta === "object" ? position.meta : {};
  const side = normalizeSide(position);
  const leverage = resolveLeverage(position, leverageFallback);
  const rules = resolveExitRulesForPosition({ exchange, position });

  const tp1Price = pctToPrice({ avg, pct: rules.TP_P1, leverage, side, kind: "TP1" });
  const slPrice = pctToPrice({ avg, pct: rules.SL, leverage, side, kind: "SL" });
  const bePrice = pctToPrice({ avg, pct: rules.BE_PCT, leverage, side, kind: "BE" });

  const tpP1Done = meta.tp_p1_done === true;
  const tpP1Pending = meta.tp_p1_pending === true;
  const trailActive = meta.trail_active === true;
  const tpSkipReason = meta.tp_p1_skip_reason ? String(meta.tp_p1_skip_reason) : null;
  const trailRef = side === "SHORT" ? toNum(meta.trail_low) : toNum(meta.trail_high);
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
    trailHigh: toNum(meta.trail_high),
    trailLow: toNum(meta.trail_low),
    entryRDistance,
  });
  const trailStop = runnerExit.stopPrice;
  const runnerFloorStop = runnerExit.runnerFloorStop;
  const rawTrailStop = runnerExit.trailStop;
  const nativeStopPrice = toNum(meta.native_protection_stop_price);
  const nativeTpPrice = toNum(meta.native_protection_tp_price);
  const nativeTpQtyBase = toNum(meta.native_protection_tp_qty_base);
  const nativeTpQtyRatio = toNum(meta.native_protection_tp_qty_ratio);
  const nativeRefreshStatus = meta.native_protection_refresh_status ? String(meta.native_protection_refresh_status) : null;
  const nativeTpStatus = meta.native_protection_tp_status ? String(meta.native_protection_tp_status) : null;
  const nativeTpReason = meta.native_protection_tp_reason ? String(meta.native_protection_tp_reason) : null;
  const nativeStopOrderId = meta.native_protection_stop_order_id ? String(meta.native_protection_stop_order_id) : null;
  const nativeTpOrderId = meta.native_protection_tp_order_id ? String(meta.native_protection_tp_order_id) : null;
  const nativeProtectionStale = meta.native_protection_stale === true;
  const nativeProtectionActive = hasNativeProtection({
    nativeStopPrice,
    nativeTpPrice,
    nativeRefreshStatus,
    nativeTpStatus,
  });

  const close = toNum(closePrice);
  const tp1GapPct = buildGapPct({ currentPrice: close, targetPrice: tp1Price, side });
  const tp1Near = !tpP1Done && !tpP1Pending && Number.isFinite(tp1GapPct) && tp1GapPct >= 0 && tp1GapPct <= 0.5;

  let label = "TP1 대기";
  let pill = "dim";
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
    label = trailActive ? "트레일링" : "TP1 완료";
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
    current_price: close,
    tp1_price: tp1Price,
    sl_price: slPrice,
    be_price: bePrice,
    tp1_qty_pct: toNum(rules.TP_P1_QTY),
    trail_r_multiple: toNum(rules.TRAIL_R_MULTIPLE),
    trail_pct: toNum(rules.TRAIL_PCT),
    tp1_done: tpP1Done,
    tp1_pending: tpP1Pending,
    trail_active: trailActive,
    tp1_gap_pct: tp1GapPct,
    tp1_skip_reason: tpSkipReason,
    trail_ref: trailRef,
    trail_stop: trailStop,
    trail_stop_raw: rawTrailStop,
    runner_floor_pct: toNum(rules.RUNNER_MIN_PROFIT_PCT),
    runner_floor_stop: runnerFloorStop,
    runner_stop_source: runnerExit.stopSource,
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
