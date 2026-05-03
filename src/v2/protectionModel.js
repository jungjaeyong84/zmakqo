"use strict";

const { V2_SIMPLE_EXIT_CONTRACT } = require("./exitPolicy");

// 2026-04-27 Stage A — V2 protection plan 의 SL/TP1 가격이 V1 의 leverage 정규화
// (`pnlPct/lev`) 와 어긋나 prod 에서 실제 PnL 손절/익절 기준이 leverage 만큼
// 더 멀리 잡혔던 회귀를 회복하기 위한 격리 경로.
//
// 안전망:
//   - `V2_PROTECTION_LEVERAGE_NORMALIZE` env flag (prod/non-prod 모두 default off).
//   - flag on **그리고** leverage 가 명시적 양수일 때만 `pct/leverage` 적용.
//   - flag off 또는 leverage 누락 → 기존 raw 동작 (V2 origin) 유지.
//   기존 caller / 테스트 / prod 배포는 영향 0. Stage B 의 diff 로깅, Stage D 의
//   prod flip 시점에서만 실효.

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampRatio(value, fallback) {
  const num = toNumber(value, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function readEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (text === "1" || text === "true" || text === "yes" || text === "on") return true;
  if (text === "0" || text === "false" || text === "no" || text === "off") return false;
  return null;
}

function isProtectionLeverageNormalizeEnabled() {
  const explicit = readEnv("V2_PROTECTION_LEVERAGE_NORMALIZE");
  if (explicit === true || explicit === false) return explicit;
  return false;
}

function resolveEffectivePct({ pct, leverage, normalize }) {
  const ratio = Math.abs(toNumber(pct));
  if (!(Number.isFinite(ratio) && ratio > 0)) return null;
  if (normalize !== true) return ratio;
  const lev = toNumber(leverage);
  if (!(Number.isFinite(lev) && lev > 0)) return ratio;
  return ratio / lev;
}

function computePriceByPct({
  entryPrice,
  pct,
  positionSide,
  kind,
  leverage = null,
  normalize = isProtectionLeverageNormalizeEnabled(),
} = {}) {
  const price = toNumber(entryPrice);
  const side = upper(positionSide);
  const type = upper(kind);
  if (!(Number.isFinite(price) && price > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  const effective = resolveEffectivePct({ pct, leverage, normalize });
  if (!(Number.isFinite(effective) && effective > 0)) throw new Error("PCT_REQUIRED");
  if (side !== "LONG" && side !== "SHORT") throw new Error("POSITION_SIDE_REQUIRED");

  if (type === "SL") {
    return side === "LONG"
      ? price * (1 - effective)
      : price * (1 + effective);
  }
  if (type === "TP1") {
    return side === "LONG"
      ? price * (1 + effective)
      : price * (1 - effective);
  }
  throw new Error("PROTECTION_KIND_INVALID");
}

function buildInitialProtectionPlan({
  symbol,
  positionSide,
  entryPrice,
  entryQtyAbs,
  stopLossPct = V2_SIMPLE_EXIT_CONTRACT.stop_loss_pct,
  tp1TargetPct = V2_SIMPLE_EXIT_CONTRACT.tp1_target_pct,
  tp1QtyRatio = V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio,
  exchange = "BINANCEFUT",
  leverage = null,
  protectionLeverageNormalize = isProtectionLeverageNormalizeEnabled(),
} = {}) {
  const sym = upper(symbol);
  const side = upper(positionSide);
  const qty = toNumber(entryQtyAbs);
  const entry = toNumber(entryPrice);
  const tpQtyRatioClamped = clampRatio(tp1QtyRatio, V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio);
  if (!sym) throw new Error("SYMBOL_REQUIRED");
  if (side !== "LONG" && side !== "SHORT") throw new Error("POSITION_SIDE_REQUIRED");
  if (!(Number.isFinite(qty) && qty > 0)) throw new Error("ENTRY_QTY_ABS_REQUIRED");
  if (!(Number.isFinite(entry) && entry > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  if (tpQtyRatioClamped <= 0 || tpQtyRatioClamped > 1) throw new Error("TP1_QTY_RATIO_INVALID");

  const closeSide = side === "LONG" ? "SELL" : "BUY";
  const tp1QtyAbs = Number((qty * tpQtyRatioClamped).toFixed(8));
  const runnerRemainingQtyAbs = Number((qty - tp1QtyAbs).toFixed(8));

  const slPriceArgs = {
    entryPrice: entry,
    pct: stopLossPct,
    positionSide: side,
    kind: "SL",
    leverage,
    normalize: protectionLeverageNormalize === true,
  };
  const tp1PriceArgs = {
    entryPrice: entry,
    pct: tp1TargetPct,
    positionSide: side,
    kind: "TP1",
    leverage,
    normalize: protectionLeverageNormalize === true,
  };

  const slTriggerPrice = Number(computePriceByPct(slPriceArgs).toFixed(8));
  const tp1TriggerPrice = Number(computePriceByPct(tp1PriceArgs).toFixed(8));
  // Surface the normalized SL distance as a single source of truth for any
  // downstream trail meta (entry_r_distance / initial_stop_price). Without
  // this the exit path falls back to signalEngine.resolveEntryRDistance
  // recomputing `sl/lev` — correct today but fragile to future refactors.
  const entryRDistance = Number(Math.abs(slTriggerPrice - entry).toFixed(8));
  return Object.freeze({
    exchange: upper(exchange) || "BINANCEFUT",
    symbol: sym,
    position_side: side,
    close_side: closeSide,
    entry_price: entry,
    entry_qty_abs: qty,
    stop_loss_pct: Math.abs(stopLossPct),
    tp1_target_pct: Math.abs(tp1TargetPct),
    tp1_qty_ratio: tpQtyRatioClamped,
    tp1_qty_abs: tp1QtyAbs,
    runner_remaining_qty_abs: runnerRemainingQtyAbs,
    sl_trigger_price: slTriggerPrice,
    tp1_trigger_price: tp1TriggerPrice,
    initial_stop_price: slTriggerPrice,
    entry_r_distance: entryRDistance,
  });
}

// Stage B — warn-only diagnostic. Returns the parallel SL/TP1 prices under
// both modes so prod can observe how far apart raw vs normalized would land
// before Stage D flips the flag. Returns null when no comparison is possible
// (missing leverage, leverage<=1 collapses to raw, or invalid inputs).
function computeProtectionLeverageDiagnostics({
  entryPrice,
  positionSide,
  stopLossPct = 0.0165,
  tp1TargetPct = 0.025,
  leverage = null,
} = {}) {
  const entry = toNumber(entryPrice);
  const lev = toNumber(leverage);
  const side = upper(positionSide);
  if (!(Number.isFinite(entry) && entry > 0)) return null;
  if (!(Number.isFinite(lev) && lev > 1)) return null;
  if (side !== "LONG" && side !== "SHORT") return null;
  if (!(Number.isFinite(Number(stopLossPct)) && Math.abs(Number(stopLossPct)) > 0)) return null;
  if (!(Number.isFinite(Number(tp1TargetPct)) && Math.abs(Number(tp1TargetPct)) > 0)) return null;

  const slRaw = computePriceByPct({
    entryPrice: entry, pct: stopLossPct, positionSide: side, kind: "SL", normalize: false,
  });
  const tp1Raw = computePriceByPct({
    entryPrice: entry, pct: tp1TargetPct, positionSide: side, kind: "TP1", normalize: false,
  });
  const slNormalized = computePriceByPct({
    entryPrice: entry, pct: stopLossPct, positionSide: side, kind: "SL", leverage: lev, normalize: true,
  });
  const tp1Normalized = computePriceByPct({
    entryPrice: entry, pct: tp1TargetPct, positionSide: side, kind: "TP1", leverage: lev, normalize: true,
  });

  return Object.freeze({
    leverage: lev,
    sl_price_raw: Number(slRaw.toFixed(8)),
    sl_price_normalized: Number(slNormalized.toFixed(8)),
    sl_price_delta_abs: Number((slNormalized - slRaw).toFixed(8)),
    sl_price_delta_pct: Number(((slNormalized - slRaw) / entry).toFixed(8)),
    tp1_price_raw: Number(tp1Raw.toFixed(8)),
    tp1_price_normalized: Number(tp1Normalized.toFixed(8)),
    tp1_price_delta_abs: Number((tp1Normalized - tp1Raw).toFixed(8)),
    tp1_price_delta_pct: Number(((tp1Normalized - tp1Raw) / entry).toFixed(8)),
  });
}

function isProtectionLeverageObserveEnabled() {
  const explicit = readEnv("V2_PROTECTION_LEVERAGE_OBSERVE");
  if (explicit === false) return false;
  return true;
}

// Emit one structured warn line per protected entry once leverage flows in.
// Cloud Logging query: jsonPayload.event="v2_protection_leverage_normalize_diff".
// `mode` records which side the live plan landed on so analysts can join the
// observation against the actual SL/TP1 prices that hit Firestore/Binance.
function observeProtectionLeveragePlan({
  plan,
  entryPrice,
  positionSide,
  stopLossPct,
  tp1TargetPct,
  leverage,
  exchange,
  symbol,
  positionCycleId = null,
  protectionLeverageNormalize = isProtectionLeverageNormalizeEnabled(),
  emit = (payload) => console.warn(JSON.stringify(payload)),
} = {}) {
  if (isProtectionLeverageObserveEnabled() !== true) return null;
  const diag = computeProtectionLeverageDiagnostics({
    entryPrice,
    positionSide,
    stopLossPct,
    tp1TargetPct,
    leverage,
  });
  if (!diag) return null;
  const mode = protectionLeverageNormalize === true ? "NORMALIZED" : "RAW";
  const livePlanSl = plan && Number.isFinite(Number(plan.sl_trigger_price)) ? Number(plan.sl_trigger_price) : null;
  const livePlanTp1 = plan && Number.isFinite(Number(plan.tp1_trigger_price)) ? Number(plan.tp1_trigger_price) : null;
  const payload = {
    event: "v2_protection_leverage_normalize_diff",
    mode,
    exchange: upper(exchange) || null,
    symbol: upper(symbol) || null,
    position_side: upper(positionSide) || null,
    position_cycle_id: positionCycleId || null,
    entry_price: Number(entryPrice),
    leverage: diag.leverage,
    stop_loss_pct: Math.abs(Number(stopLossPct)),
    tp1_target_pct: Math.abs(Number(tp1TargetPct)),
    sl_price_raw: diag.sl_price_raw,
    sl_price_normalized: diag.sl_price_normalized,
    sl_price_delta_abs: diag.sl_price_delta_abs,
    sl_price_delta_pct: diag.sl_price_delta_pct,
    tp1_price_raw: diag.tp1_price_raw,
    tp1_price_normalized: diag.tp1_price_normalized,
    tp1_price_delta_abs: diag.tp1_price_delta_abs,
    tp1_price_delta_pct: diag.tp1_price_delta_pct,
    live_plan_sl_trigger_price: livePlanSl,
    live_plan_tp1_trigger_price: livePlanTp1,
    observed_at: new Date().toISOString(),
  };
  if (typeof emit === "function") emit(payload);
  return payload;
}

module.exports = {
  buildInitialProtectionPlan,
  computeProtectionLeverageDiagnostics,
  observeProtectionLeveragePlan,
  __test: {
    computePriceByPct,
    clampRatio,
    isProtectionLeverageNormalizeEnabled,
    isProtectionLeverageObserveEnabled,
    resolveEffectivePct,
  },
};
