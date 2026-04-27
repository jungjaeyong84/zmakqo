"use strict";

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
  stopLossPct = 0.0165,
  tp1TargetPct = 0.0168,
  tp1QtyRatio = 0.5,
  exchange = "BINANCEFUT",
  leverage = null,
  protectionLeverageNormalize = isProtectionLeverageNormalizeEnabled(),
} = {}) {
  const sym = upper(symbol);
  const side = upper(positionSide);
  const qty = toNumber(entryQtyAbs);
  const entry = toNumber(entryPrice);
  const tpQtyRatioClamped = clampRatio(tp1QtyRatio, 0.5);
  if (!sym) throw new Error("SYMBOL_REQUIRED");
  if (side !== "LONG" && side !== "SHORT") throw new Error("POSITION_SIDE_REQUIRED");
  if (!(Number.isFinite(qty) && qty > 0)) throw new Error("ENTRY_QTY_ABS_REQUIRED");
  if (!(Number.isFinite(entry) && entry > 0)) throw new Error("ENTRY_PRICE_REQUIRED");
  if (tpQtyRatioClamped <= 0 || tpQtyRatioClamped >= 1) throw new Error("TP1_QTY_RATIO_INVALID");

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
    sl_trigger_price: Number(computePriceByPct(slPriceArgs).toFixed(8)),
    tp1_trigger_price: Number(computePriceByPct(tp1PriceArgs).toFixed(8)),
  });
}

module.exports = {
  buildInitialProtectionPlan,
  __test: {
    computePriceByPct,
    clampRatio,
    isProtectionLeverageNormalizeEnabled,
    resolveEffectivePct,
  },
};
