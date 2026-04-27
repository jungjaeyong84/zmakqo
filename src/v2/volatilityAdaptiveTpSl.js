"use strict";

// 2026-04-27 Stage P — volatility-adaptive TP1/SL via ATR-based multiplier.
// The static TP1=2.5% / SL=1.65% targets work in "normal" 15m volatility
// (~0.5% ATR ratio) but waste edge in low-vol regimes (TP1 too far →
// rarely hit) and over-tight in high-vol regimes (SL chops out on noise).
//
// Phase 1 (this commit) ships the math + observability behind a default-OFF
// env flag so prod can compare adaptive vs static prices side-by-side
// without changing a single live order. Phase 2 (separate decision) flips
// the flag once the diagnostics look stable.
//
// Multiplier formula:
//   atr_ratio = ATR(14, 15m) / entry_price
//   base_atr_ratio = 0.005   (0.5% — normal 15m volatility)
//   multiplier = clamp(atr_ratio / base_atr_ratio, 0.7, 1.5)
//   → low vol  (0.3% atr) → 0.6 → clamp → 0.7  (TP1 1.75%, SL 1.155%)
//   → normal   (0.5% atr) → 1.0                 (TP1 2.5%,  SL 1.65%)
//   → high vol (0.75% atr) → 1.5                (TP1 3.75%, SL 2.475%)
//
// Clip [0.7, 1.5] keeps extreme outliers from blowing up sizing — a 3x ATR
// spike (e.g. flash crash) shouldn't widen SL to 5%; a flat-as-paint bar
// shouldn't tighten SL inside the spread.
//
// 안전 계약:
//   - default OFF (`V2_VOLATILITY_ADAPTIVE_TP_SL_ENABLED=0`).
//   - flag on + atr_ratio>0 일 때만 multiplier 적용.
//   - ATR 누락 / 비유효 → multiplier=1.0 (=raw 와 동일, silent no-op).
//   - clip bounds env override 가능 (운영 튜닝용).
//   - observe mode default ON: 매번 diagnostic 산출 (mode=ADAPTIVE|STATIC).

const DEFAULT_BASE_ATR_RATIO = 0.005;
const DEFAULT_MULTIPLIER_MIN = 0.7;
const DEFAULT_MULTIPLIER_MAX = 1.5;

function readEnv(env, name) {
  const raw = (env || process.env || {})[name];
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (text === "1" || text === "true" || text === "yes" || text === "on") return true;
  if (text === "0" || text === "false" || text === "no" || text === "off") return false;
  return null;
}

function readEnvNumber(env, name, fallback) {
  const raw = (env || process.env || {})[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function isAdaptiveEnabled(env = process.env) {
  const explicit = readEnv(env, "V2_VOLATILITY_ADAPTIVE_TP_SL_ENABLED");
  return explicit === true;
}

function isAdaptiveObserveEnabled(env = process.env) {
  const explicit = readEnv(env, "V2_VOLATILITY_ADAPTIVE_TP_SL_OBSERVE");
  if (explicit === false) return false;
  return true; // default ON
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// Compute the multiplier from ATR/price ratio. Returns 1.0 (no-op) when ATR
// is missing or invalid so callers can multiply unconditionally.
function computeAtrMultiplier({
  atr,
  entryPrice,
  baseAtrRatio = DEFAULT_BASE_ATR_RATIO,
  multiplierMin = DEFAULT_MULTIPLIER_MIN,
  multiplierMax = DEFAULT_MULTIPLIER_MAX,
} = {}) {
  const atrNum = Number(atr);
  const priceNum = Number(entryPrice);
  if (!(Number.isFinite(atrNum) && atrNum > 0)) return 1.0;
  if (!(Number.isFinite(priceNum) && priceNum > 0)) return 1.0;
  const baseRatio = Number.isFinite(baseAtrRatio) && baseAtrRatio > 0 ? baseAtrRatio : DEFAULT_BASE_ATR_RATIO;
  const minBound = Number.isFinite(multiplierMin) && multiplierMin > 0 ? multiplierMin : DEFAULT_MULTIPLIER_MIN;
  const maxBound = Number.isFinite(multiplierMax) && multiplierMax > 0 ? multiplierMax : DEFAULT_MULTIPLIER_MAX;
  if (!(maxBound >= minBound)) return 1.0;
  const atrRatio = atrNum / priceNum;
  const raw = atrRatio / baseRatio;
  return clamp(raw, minBound, maxBound);
}

// Apply the multiplier to base TP1/SL pcts. Returns adapted pcts plus the
// multiplier itself so observers can correlate prod outcomes with regime.
function adaptTpSlPct({
  baseTp1Pct,
  baseStopLossPct,
  atr,
  entryPrice,
  baseAtrRatio = DEFAULT_BASE_ATR_RATIO,
  multiplierMin = DEFAULT_MULTIPLIER_MIN,
  multiplierMax = DEFAULT_MULTIPLIER_MAX,
} = {}) {
  const tpBase = Number(baseTp1Pct);
  const slBase = Number(baseStopLossPct);
  if (!(Number.isFinite(tpBase) && tpBase > 0) || !(Number.isFinite(slBase) && slBase > 0)) {
    return Object.freeze({
      multiplier: 1.0,
      tp1_pct: tpBase,
      stop_loss_pct: slBase,
      atr_ratio: null,
      base_atr_ratio: baseAtrRatio,
      adapted: false,
    });
  }
  const multiplier = computeAtrMultiplier({
    atr,
    entryPrice,
    baseAtrRatio,
    multiplierMin,
    multiplierMax,
  });
  const atrRatio = (Number.isFinite(Number(atr)) && Number(atr) > 0
    && Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0)
    ? Number(atr) / Number(entryPrice)
    : null;
  return Object.freeze({
    multiplier,
    tp1_pct: Number((tpBase * multiplier).toFixed(8)),
    stop_loss_pct: Number((slBase * multiplier).toFixed(8)),
    atr_ratio: atrRatio,
    base_atr_ratio: baseAtrRatio,
    adapted: multiplier !== 1.0,
  });
}

// Phase 1 observability: emit a single structured warn comparing static vs
// adaptive pcts. Live plan still uses static unless adaptive is enabled.
function observeAtrAdaptiveTpSl({
  baseTp1Pct,
  baseStopLossPct,
  atr,
  entryPrice,
  symbol = null,
  positionSide = null,
  positionCycleId = null,
  enabled = isAdaptiveEnabled(),
  env = process.env,
  emit = (payload) => console.warn(JSON.stringify(payload)),
} = {}) {
  if (isAdaptiveObserveEnabled(env) !== true) return null;
  const baseAtrRatio = readEnvNumber(env, "V2_VOLATILITY_ADAPTIVE_BASE_ATR_RATIO", DEFAULT_BASE_ATR_RATIO);
  const multiplierMin = readEnvNumber(env, "V2_VOLATILITY_ADAPTIVE_MULTIPLIER_MIN", DEFAULT_MULTIPLIER_MIN);
  const multiplierMax = readEnvNumber(env, "V2_VOLATILITY_ADAPTIVE_MULTIPLIER_MAX", DEFAULT_MULTIPLIER_MAX);
  const adapted = adaptTpSlPct({
    baseTp1Pct,
    baseStopLossPct,
    atr,
    entryPrice,
    baseAtrRatio,
    multiplierMin,
    multiplierMax,
  });
  if (adapted.atr_ratio === null) return null;
  const payload = {
    event: "v2_volatility_adaptive_tp_sl_diff",
    mode: enabled === true ? "ADAPTIVE" : "STATIC",
    symbol: symbol ? String(symbol).toUpperCase() : null,
    position_side: positionSide ? String(positionSide).toUpperCase() : null,
    position_cycle_id: positionCycleId || null,
    base_tp1_pct: Number(baseTp1Pct),
    base_stop_loss_pct: Number(baseStopLossPct),
    atr,
    entry_price: Number(entryPrice),
    atr_ratio: adapted.atr_ratio,
    base_atr_ratio: baseAtrRatio,
    multiplier: adapted.multiplier,
    adapted_tp1_pct: adapted.tp1_pct,
    adapted_stop_loss_pct: adapted.stop_loss_pct,
    observed_at: new Date().toISOString(),
  };
  if (typeof emit === "function") {
    try { emit(payload); } catch (_) { /* surveillance must be best-effort */ }
  }
  return payload;
}

module.exports = {
  computeAtrMultiplier,
  adaptTpSlPct,
  observeAtrAdaptiveTpSl,
  isAdaptiveEnabled,
  isAdaptiveObserveEnabled,
  __test: {
    DEFAULT_BASE_ATR_RATIO,
    DEFAULT_MULTIPLIER_MIN,
    DEFAULT_MULTIPLIER_MAX,
    clamp,
    readEnvNumber,
  },
};
