"use strict";

// 2026-04-28 F2 Phase 2 — V2 server-native ENTRY signal generator.
//
// Pure 1:1 port of code/donbeolja_v6.1.1.0_PRODUCTION_CANDIDATE.pine.txt
// (392 lines). Generates LONG/SHORT ENTRY signals from same-tf bars +
// HTF (240m) bars. Replaces the TV pine webhook source after V2 cutover
// disabled `DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1`. Designed to be
// deterministic and side-effect-free — caller (paperBinanceRunner)
// owns Firestore writes, cooldown state persistence, alert dispatch.
//
// See docs/V2_SERVER_ENTRY_SIGNAL_GENERATOR_PLAN.md for the full design
// rationale and pine ↔ JS parity notes.

const STRATEGY_ID = "donbeolja_v6.1.1.0";
const ENGINE_MODE = "CLEAN_REDESIGN";
const QTY_PROFILE = "FIXED";
const ENGINE_VERSION = "v2_pine_v6_1_1_0_parity_001";
const SIGNAL_SOURCE = "V2_SERVER_ENTRY_SIGNAL_GENERATOR";

// Pine input defaults (line 20-37 of pine).
const DEFAULT_PARAMS = Object.freeze({
  state_trend_min: 0.22,
  dead_atr_max: 0.0014,
  panic_atr_min: 0.0350,
  thr_early: 0.56,
  thr_core: 0.68,
  continuation_early_threshold_long: 0.54,
  thr_diag_c: 0.82,
  same_dir_cooldown_bars: 8,
  min_rr: 1.45,
  stop_atr: 1.8,
  target_atr: 2.8,
  reclaim_trigger_strength_min: 0.64,
  reclaim_trigger_directional_pressure_min: 0.38,
  continuation_close_pos_long_min: 0.48,
  continuation_close_pos_short_max: 0.52,
  continuation_pullback_depth_long_min: 0.30,
  continuation_pullback_depth_long_max: 0.88,
  continuation_pullback_depth_short_min: 0.12,
  continuation_pullback_depth_short_max: 0.70,
  continuation_pressure_min: 0.56,
  max_extension_long: 0.92,
  min_extension_short: 0.08,
  webhook_qty_pct: 1.0,
  htf_tf_minutes: 240,
});

// ───────────────────────────────────────────────────────────
// Indicator helpers (pure, deterministic)
// ───────────────────────────────────────────────────────────

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function safeDiv(a, b) {
  return Math.abs(b) > 1e-10 ? a / b : 0;
}

// SMA(values, period) — returns array of same length; first period-1 are null.
function sma(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  if (!Number.isFinite(period) || period < 1) return values.map(() => null);
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) {
      // null breaks SMA; reset window. Pine behavior: na propagates.
      sum = 0;
      const start = Math.max(0, i - period + 1);
      let allFinite = true;
      let s = 0;
      for (let j = start; j <= i; j += 1) {
        const x = Number(values[j]);
        if (!Number.isFinite(x)) { allFinite = false; break; }
        s += x;
      }
      out[i] = allFinite && i >= period - 1 ? s / period : null;
      continue;
    }
    sum += v;
    if (i >= period) sum -= Number(values[i - period]);
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// EMA(values, period) — TV/pine convention: seed with SMA(period), then
// recursive EMA = close*k + ema_prev*(1-k), k = 2/(period+1).
function ema(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  if (!Number.isFinite(period) || period < 1) return values.map(() => null);
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  // SMA seed at index period-1
  let seed = 0;
  for (let i = 0; i < period; i += 1) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) return out;
    seed += v;
  }
  seed /= period;
  out[period - 1] = seed;
  const k = 2 / (period + 1);
  let prev = seed;
  for (let i = period; i < values.length; i += 1) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) { out[i] = null; continue; }
    const cur = v * k + prev * (1 - k);
    out[i] = cur;
    prev = cur;
  }
  return out;
}

// RSI (Wilder smoothing). period=14 default.
function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return new Array(closes.length).fill(null);
  const out = new Array(closes.length).fill(null);
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const ch = Number(closes[i]) - Number(closes[i - 1]);
    if (ch >= 0) gainSum += ch;
    else lossSum += -ch;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i += 1) {
    const ch = Number(closes[i]) - Number(closes[i - 1]);
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

// MACD(closes, 12, 26, 9). Returns { macd_line[], signal[], hist[] }.
function macd(closes, fastP = 12, slowP = 26, signalP = 9) {
  const fast = ema(closes, fastP);
  const slow = ema(closes, slowP);
  const macdLine = closes.map((_, i) => {
    if (fast[i] == null || slow[i] == null) return null;
    return fast[i] - slow[i];
  });
  // signal EMA needs a series of finite values starting at the first
  // non-null macdLine index.
  const firstIdx = macdLine.findIndex((v) => v != null);
  let signal = new Array(closes.length).fill(null);
  let hist = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const stripped = macdLine.slice(firstIdx).map((v) => v == null ? 0 : v);
    const sigStripped = ema(stripped, signalP);
    for (let i = 0; i < sigStripped.length; i += 1) {
      const idx = firstIdx + i;
      signal[idx] = sigStripped[i];
      if (signal[idx] != null && macdLine[idx] != null) {
        hist[idx] = macdLine[idx] - signal[idx];
      }
    }
  }
  return { macd_line: macdLine, signal, hist };
}

// ATR (Wilder). period=14.
function atr(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  const tr = new Array(n).fill(null);
  tr[0] = Number(highs[0]) - Number(lows[0]);
  for (let i = 1; i < n; i += 1) {
    const h = Number(highs[i]);
    const l = Number(lows[i]);
    const cp = Number(closes[i - 1]);
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cp)) { tr[i] = null; continue; }
    tr[i] = Math.max(h - l, Math.abs(h - cp), Math.abs(l - cp));
  }
  // Seed: SMA of first `period` TR values.
  let seedSum = 0;
  for (let i = 0; i < period; i += 1) {
    if (tr[i] == null) return out;
    seedSum += tr[i];
  }
  out[period - 1] = seedSum / period;
  let prev = out[period - 1];
  for (let i = period; i < n; i += 1) {
    if (tr[i] == null) { out[i] = null; continue; }
    const cur = (prev * (period - 1) + tr[i]) / period;
    out[i] = cur;
    prev = cur;
  }
  return out;
}

// highest(values, period) — rolling max, length-aligned.
function highest(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i += 1) {
    let m = -Infinity;
    let ok = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      const v = Number(values[j]);
      if (!Number.isFinite(v)) { ok = false; break; }
      if (v > m) m = v;
    }
    out[i] = ok ? m : null;
  }
  return out;
}

function lowest(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i += 1) {
    let m = Infinity;
    let ok = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      const v = Number(values[j]);
      if (!Number.isFinite(v)) { ok = false; break; }
      if (v < m) m = v;
    }
    out[i] = ok ? m : null;
  }
  return out;
}

// ───────────────────────────────────────────────────────────
// Pine ↔ JS bar indexing helpers
// ───────────────────────────────────────────────────────────

function _last(arr) { return arr[arr.length - 1]; }
function _at(arr, offset) {
  // pine `[N]` = N bars ago from current (where current is last entry).
  return arr[arr.length - 1 - offset];
}

// ───────────────────────────────────────────────────────────
// HTF bias (separate fn so caller can pre-compute / cache)
// ───────────────────────────────────────────────────────────

function computeHtfBias(htfBars) {
  if (!Array.isArray(htfBars) || htfBars.length < 56) {
    return { htf_bias: "NEUTRAL", htf_fast: null, htf_slow: null, ok: false, reason: "HTF_INSUFFICIENT_BARS" };
  }
  const closes = htfBars.map((b) => Number(b.close ?? b.c));
  const fast = _last(ema(closes, 21));
  const slow = _last(ema(closes, 55));
  if (!Number.isFinite(fast) || !Number.isFinite(slow)) {
    return { htf_bias: "NEUTRAL", htf_fast: null, htf_slow: null, ok: false, reason: "HTF_EMA_NA" };
  }
  const bias = fast > slow ? "BULL" : fast < slow ? "BEAR" : "NEUTRAL";
  return { htf_bias: bias, htf_fast: fast, htf_slow: slow, ok: true, reason: null };
}

function deriveDirectionDecision({
  direction,
  triggerType,
  triggerActive,
  signalFired,
  signalGrade,
  canFire,
  earlyEligible,
  coreEligible,
  opportunity,
  thrEarly,
  thrCore,
  riskOkEarly,
  riskOkCore,
  structureAlignment,
  structureFloorEarly,
  structureFloorCore,
  directionalPressure,
  directionalFloorEarly,
  participation,
  participationFloorCore,
  antiChopGate,
  transitionCoreQuality,
} = {}) {
  const prefix = String(direction || "UNKNOWN").toUpperCase();
  if (signalFired === true) {
    return {
      path: signalGrade === "CORE" ? `${prefix}_CORE` : `${prefix}_EARLY`,
      reason: signalGrade === "CORE" ? `${prefix}_CORE_SIGNAL` : `${prefix}_EARLY_SIGNAL`,
    };
  }
  if (triggerActive !== true || triggerType === "NONE") {
    return {
      path: `${prefix}_NONE`,
      reason: `${prefix}_NO_TRIGGER`,
    };
  }
  if (canFire !== true) {
    return {
      path: `${prefix}_${coreEligible ? "CORE" : "EARLY"}`,
      reason: `${prefix}_COOLDOWN_BLOCKED`,
    };
  }
  if (coreEligible) {
    if (opportunity < thrCore) {
      return { path: `${prefix}_CORE`, reason: `${prefix}_CORE_THRESHOLD_BLOCKED` };
    }
    if (riskOkCore !== true) {
      return { path: `${prefix}_CORE`, reason: `${prefix}_CORE_RISK_BLOCKED` };
    }
    if (structureAlignment < structureFloorCore) {
      return { path: `${prefix}_CORE`, reason: `${prefix}_CORE_STRUCTURE_BLOCKED` };
    }
    if (participation < participationFloorCore) {
      return { path: `${prefix}_CORE`, reason: `${prefix}_CORE_PARTICIPATION_BLOCKED` };
    }
    if (transitionCoreQuality !== true) {
      return { path: `${prefix}_CORE`, reason: `${prefix}_CORE_TRANSITION_BLOCKED` };
    }
    if (earlyEligible) {
      if (opportunity < thrEarly) {
        return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_THRESHOLD_BLOCKED` };
      }
      if (riskOkEarly !== true) {
        return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_RISK_BLOCKED` };
      }
      if (structureAlignment < structureFloorEarly) {
        return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_STRUCTURE_BLOCKED` };
      }
      if (directionalPressure < directionalFloorEarly) {
        return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_DIRECTIONAL_BLOCKED` };
      }
      if (antiChopGate !== true) {
        return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_ANTI_CHOP_BLOCKED` };
      }
    }
    return { path: `${prefix}_CORE`, reason: `${prefix}_CORE_OTHER_BLOCKED` };
  }
  if (earlyEligible) {
    if (opportunity < thrEarly) {
      return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_THRESHOLD_BLOCKED` };
    }
    if (riskOkEarly !== true) {
      return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_RISK_BLOCKED` };
    }
    if (structureAlignment < structureFloorEarly) {
      return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_STRUCTURE_BLOCKED` };
    }
    if (directionalPressure < directionalFloorEarly) {
      return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_DIRECTIONAL_BLOCKED` };
    }
    if (antiChopGate !== true) {
      return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_ANTI_CHOP_BLOCKED` };
    }
    return { path: `${prefix}_EARLY`, reason: `${prefix}_EARLY_OTHER_BLOCKED` };
  }
  return {
    path: `${prefix}_OTHER`,
    reason: `${prefix}_UNCLASSIFIED_BLOCKED`,
  };
}

function shouldUseLongContinuationEarlyPath({
  triggerContinuationLong,
  opportunity,
  continuationEarlyThresholdLong,
  riskOkLongCore,
  structureAlignmentLong,
  participation,
  participationFloorCore,
  continuationPressureLong,
  continuationPressureFloor,
  antiChopGate,
  transitionCoreQualityLong,
} = {}) {
  return triggerContinuationLong === true
    && Number(opportunity) >= Number(continuationEarlyThresholdLong)
    && riskOkLongCore === true
    && Number(structureAlignmentLong) >= 0.62
    && Number(participation) >= Number(participationFloorCore)
    && Number(continuationPressureLong) >= Number(continuationPressureFloor)
    && antiChopGate === true
    && transitionCoreQualityLong === true;
}

// ───────────────────────────────────────────────────────────
// Main generator
// ───────────────────────────────────────────────────────────

function generateV2EntrySignals({
  exchange,
  symbol,
  tf,
  bars,
  htfBars = null,
  htfBias = null,           // pre-computed alternative
  position = null,
  cooldownState = null,
  params = null,
  runId = null,
  barCloseMs = null,
} = {}) {
  const p = Object.freeze({ ...DEFAULT_PARAMS, ...(params || {}) });

  const result = {
    signals: [],
    diagnostics: {
      generated_at: new Date().toISOString(),
      exchange: exchange || null,
      symbol: symbol || null,
      tf: tf || null,
      strategy_id: STRATEGY_ID,
      engine_version: ENGINE_VERSION,
    },
    cooldownStateNext: cooldownState || {
      last_long_signal_bar_close_ms: null,
      last_long_trigger: null,
      last_short_signal_bar_close_ms: null,
      last_short_trigger: null,
    },
    skipped: false,
    skipReason: null,
  };

  // (A) bars sanity — need at least 144 (anchor) + 5 (slope) safety
  if (!Array.isArray(bars) || bars.length < 150) {
    result.skipped = true;
    result.skipReason = "BARS_INSUFFICIENT";
    return result;
  }

  // (B) position must be flat (pine logic generates per bar regardless,
  //     but downstream V2 entry path assumes no open position)
  if (position && String(position.state || "").toUpperCase() === "ACTIVE"
      && Number(position.size_pct || 0) > 0) {
    result.skipped = true;
    result.skipReason = "POSITION_ACTIVE";
    return result;
  }

  // (C) HTF
  let htf;
  if (htfBias && (htfBias === "BULL" || htfBias === "BEAR" || htfBias === "NEUTRAL")) {
    htf = { htf_bias: htfBias, htf_fast: null, htf_slow: null, ok: true, reason: null };
  } else {
    htf = computeHtfBias(htfBars);
    if (!htf.ok) {
      result.skipped = true;
      result.skipReason = htf.reason;
      result.diagnostics.htf = htf;
      return result;
    }
  }

  // (D) extract series
  const opens   = bars.map((b) => Number(b.open  ?? b.o));
  const highs   = bars.map((b) => Number(b.high  ?? b.h));
  const lows    = bars.map((b) => Number(b.low   ?? b.l));
  const closes  = bars.map((b) => Number(b.close ?? b.c));
  const volumes = bars.map((b) => Number(b.volume ?? b.v));

  const nLast = closes.length - 1;
  if (nLast < 0) {
    result.skipped = true;
    result.skipReason = "EMPTY_BARS";
    return result;
  }

  // (E) indicators
  const emaFastSeries   = ema(closes, 8);
  const emaMidSeries    = ema(closes, 21);
  const emaSlowSeries   = ema(closes, 55);
  const emaAnchorSeries = ema(closes, 144);
  const rsiSeries       = rsi(closes, 14);
  const macdRes         = macd(closes, 12, 26, 9);
  const macdHistSeries  = macdRes.hist;
  const atrSeries       = atr(highs, lows, closes, 14);
  const volMaSeries     = sma(volumes, 20);
  const rangeHighSeries = highest(highs, 20);
  const rangeLowSeries  = lowest(lows, 20);
  const recentHighSeries = highest(highs, 5);
  const recentLowSeries  = lowest(lows,  5);

  // current-bar values (last index)
  const ema_fast = _last(emaFastSeries);
  const ema_mid  = _last(emaMidSeries);
  const ema_slow = _last(emaSlowSeries);
  const ema_anchor = _last(emaAnchorSeries);
  const ema_fast_5_ago = _at(emaFastSeries, 5);
  const ema_mid_5_ago  = _at(emaMidSeries, 5);
  const ema_fast_2_ago = _at(emaFastSeries, 2);
  const rsi_val = _last(rsiSeries);
  const macd_hist = _last(macdHistSeries);
  const macd_hist_prev = _at(macdHistSeries, 1);
  const atr_val = _last(atrSeries);
  const vol_ma = _last(volMaSeries);
  const range_high = _last(rangeHighSeries);
  const range_low = _last(rangeLowSeries);
  const recent_high = _at(recentHighSeries, 1);
  const recent_low = _at(recentLowSeries, 1);
  const open_cur = _last(opens);
  const high_cur = _last(highs);
  const low_cur = _last(lows);
  const close_cur = _last(closes);
  const vol_cur = _last(volumes);

  // sanity — any NaN means we don't have enough warmup yet
  for (const [k, v] of Object.entries({
    ema_fast, ema_mid, ema_slow, ema_anchor, ema_fast_5_ago, ema_mid_5_ago,
    ema_fast_2_ago, rsi_val, macd_hist, atr_val, vol_ma, range_high,
    range_low, recent_high, recent_low,
  })) {
    if (!Number.isFinite(v)) {
      result.skipped = true;
      result.skipReason = `INDICATOR_NA:${k}`;
      return result;
    }
  }

  // (F) derived
  const slope_fast = ema_fast - ema_fast_5_ago;
  const slope_mid  = ema_mid  - ema_mid_5_ago;
  const trend_strength_raw = Math.abs(safeDiv(ema_fast - ema_slow, ema_slow)) * 100;

  const atr_ratio = safeDiv(atr_val, close_cur);
  const vol_ratio = vol_ma > 0 ? vol_cur / vol_ma : 1.0;

  const mintick = 1e-8; // numeric guard
  const range_span = Math.max(range_high - range_low, mintick);
  const price_position = clamp01(safeDiv(close_cur - range_low, range_span));

  const bar_range = Math.max(high_cur - low_cur, mintick);
  const body_ratio = Math.abs(close_cur - open_cur) / bar_range;
  const upper_wick_ratio = (high_cur - Math.max(open_cur, close_cur)) / bar_range;
  const lower_wick_ratio = (Math.min(open_cur, close_cur) - low_cur) / bar_range;

  // (G) market state
  const state_bull = (
    ema_fast > ema_mid && ema_mid > ema_slow &&
    slope_fast > 0 && slope_mid >= 0 &&
    trend_strength_raw >= p.state_trend_min
  );
  const state_bear = (
    ema_fast < ema_mid && ema_mid < ema_slow &&
    slope_fast < 0 && slope_mid <= 0 &&
    trend_strength_raw >= p.state_trend_min
  );
  const state_transition = (
    !state_bull && !state_bear &&
    trend_strength_raw >= p.state_trend_min * 0.55
  );
  const state_chaos = (
    atr_ratio >= p.panic_atr_min ||
    (upper_wick_ratio >= 0.44 && lower_wick_ratio >= 0.44 && body_ratio <= 0.28)
  );
  const state_dead = atr_ratio <= p.dead_atr_max && vol_ratio <= 0.72;

  let market_state;
  if (state_chaos) market_state = "CHAOS";
  else if (state_bull) market_state = "BULL";
  else if (state_bear) market_state = "BEAR";
  else if (state_transition) market_state = "TRANSITION";
  else market_state = "RANGE";

  // (H) opportunity sub-scores (LONG/SHORT)
  const close_pos_in_bar = clamp01(safeDiv(close_cur - low_cur, bar_range));
  const bull_close = close_cur > open_cur && close_pos_in_bar >= 0.55;
  const bear_close = close_cur < open_cur && close_pos_in_bar <= 0.45;

  const reclaim_strength_long = clamp01(
    0.45 * (close_cur > ema_fast ? 1.0 : 0.0) +
    0.30 * close_pos_in_bar +
    0.25 * (low_cur <= ema_fast ? 1.0 : 0.0)
  );
  const reclaim_strength_short = clamp01(
    0.45 * (close_cur < ema_fast ? 1.0 : 0.0) +
    0.30 * (1.0 - close_pos_in_bar) +
    0.25 * (high_cur >= ema_fast ? 1.0 : 0.0)
  );

  const transition_bias_long  = market_state === "TRANSITION" && ema_fast >= ema_fast_2_ago;
  const transition_bias_short = market_state === "TRANSITION" && ema_fast <= ema_fast_2_ago;

  const structure_alignment_long = market_state === "BULL" ? 1.0
    : market_state === "TRANSITION" ? (ema_fast >= ema_mid ? 0.82 : close_cur >= ema_fast ? 0.62 : 0.45)
    : market_state === "RANGE" ? 0.40
    : 0.15;
  const structure_alignment_short = market_state === "BEAR" ? 1.0
    : market_state === "TRANSITION" ? (ema_fast <= ema_mid ? 0.82 : close_cur <= ema_fast ? 0.62 : 0.45)
    : market_state === "RANGE" ? 0.40
    : 0.15;

  const directional_pressure_long = clamp01(
    0.38 * clamp01((rsi_val - 45.0) / 25.0) +
    0.34 * clamp01((macd_hist + atr_ratio * 0.6) / (atr_ratio * 1.8 + 1e-6)) +
    0.28 * clamp01((close_cur - ema_mid) / (atr_val * 1.5 + 1e-6))
  );
  const directional_pressure_short = clamp01(
    0.38 * clamp01((55.0 - rsi_val) / 25.0) +
    0.34 * clamp01((-macd_hist + atr_ratio * 0.6) / (atr_ratio * 1.8 + 1e-6)) +
    0.28 * clamp01((ema_mid - close_cur) / (atr_val * 1.5 + 1e-6))
  );

  const pullback_quality_long = clamp01(
    0.55 * clamp01(1.0 - Math.abs(price_position - 0.42) / 0.42) +
    0.45 * reclaim_strength_long
  );
  const pullback_quality_short = clamp01(
    0.55 * clamp01(1.0 - Math.abs(price_position - 0.58) / 0.42) +
    0.45 * reclaim_strength_short
  );

  const participation = clamp01(
    0.55 * clamp01(vol_ratio / 1.8) +
    0.45 * clamp01(atr_ratio / 0.01)
  );

  const anti_chop_gate = market_state !== "RANGE"
    || participation >= 0.52
    || trend_strength_raw >= p.state_trend_min * 0.9;

  const continuation_pressure_long = clamp01(
    0.42 * (close_cur > ema_fast ? 1.0 : 0.0) +
    0.28 * clamp01(body_ratio / 0.7) +
    0.30 * (Number.isFinite(macd_hist_prev) && macd_hist >= macd_hist_prev ? 1.0 : 0.0)
  );
  const continuation_pressure_short = clamp01(
    0.42 * (close_cur < ema_fast ? 1.0 : 0.0) +
    0.28 * clamp01(body_ratio / 0.7) +
    0.30 * (Number.isFinite(macd_hist_prev) && macd_hist <= macd_hist_prev ? 1.0 : 0.0)
  );

  const risk_efficiency_long = clamp01(
    0.60 * (price_position <= p.max_extension_long ? 1.0 : 0.0) +
    0.40 * (close_cur >= ema_anchor * 0.97 ? 1.0 : 0.35)
  );
  const risk_efficiency_short = clamp01(
    0.60 * (price_position >= p.min_extension_short ? 1.0 : 0.0) +
    0.40 * (close_cur <= ema_anchor * 1.03 ? 1.0 : 0.35)
  );

  const transition_core_quality_long = market_state !== "TRANSITION" || (
    transition_bias_long &&
    structure_alignment_long >= 0.82 &&
    participation >= 0.54 &&
    directional_pressure_long >= 0.52 &&
    continuation_pressure_long >= 0.58 &&
    body_ratio >= 0.50 &&
    price_position >= 0.38 &&
    price_position <= 0.74
  );
  const transition_core_quality_short = market_state !== "TRANSITION" || (
    transition_bias_short &&
    structure_alignment_short >= 0.82 &&
    participation >= 0.54 &&
    directional_pressure_short >= 0.52 &&
    continuation_pressure_short >= 0.58 &&
    body_ratio >= 0.50 &&
    price_position <= 0.62 &&
    price_position >= 0.26
  );

  const long_opportunity =
    0.22 * structure_alignment_long +
    0.20 * directional_pressure_long +
    0.18 * pullback_quality_long +
    0.12 * participation +
    0.14 * continuation_pressure_long +
    0.14 * risk_efficiency_long;

  const short_opportunity =
    0.22 * structure_alignment_short +
    0.20 * directional_pressure_short +
    0.18 * pullback_quality_short +
    0.12 * participation +
    0.14 * continuation_pressure_short +
    0.14 * risk_efficiency_short;

  // (I) trigger
  const pullback_depth_ok_long  = price_position >= p.continuation_pullback_depth_long_min
    && price_position <= p.continuation_pullback_depth_long_max;
  const pullback_depth_ok_short = price_position <= p.continuation_pullback_depth_short_max
    && price_position >= p.continuation_pullback_depth_short_min;

  const continuation_bar_bias_long = bull_close
    || (close_cur >= open_cur * 0.998 && close_pos_in_bar >= p.continuation_close_pos_long_min);
  const continuation_bar_bias_short = bear_close
    || (close_cur <= open_cur * 1.002 && close_pos_in_bar <= p.continuation_close_pos_short_max);

  const trigger_breakout_long     = close_cur > recent_high && close_cur > ema_fast && bull_close && body_ratio >= 0.46;
  const trigger_reclaim_long      = close_cur > ema_fast && low_cur <= ema_fast && close_cur >= ema_mid * 0.998
                                    && reclaim_strength_long >= p.reclaim_trigger_strength_min && bull_close
                                    && directional_pressure_long >= p.reclaim_trigger_directional_pressure_min
                                    && (market_state !== "TRANSITION" || transition_bias_long);
  const trigger_continuation_long = close_cur > ema_fast && ema_fast >= ema_mid && pullback_depth_ok_long
                                    && continuation_bar_bias_long
                                    && continuation_pressure_long >= p.continuation_pressure_min
                                    && Number.isFinite(macd_hist_prev) && macd_hist >= macd_hist_prev;
  const trigger_breakdown_short   = close_cur < recent_low && close_cur < ema_fast && bear_close && body_ratio >= 0.46;
  const trigger_loss_short        = close_cur < ema_fast && high_cur >= ema_fast && close_cur <= ema_mid * 1.002
                                    && reclaim_strength_short >= p.reclaim_trigger_strength_min && bear_close
                                    && directional_pressure_short >= p.reclaim_trigger_directional_pressure_min
                                    && (market_state !== "TRANSITION" || transition_bias_short);
  const trigger_continuation_short = close_cur < ema_fast && ema_fast <= ema_mid && pullback_depth_ok_short
                                    && continuation_bar_bias_short
                                    && continuation_pressure_short >= p.continuation_pressure_min
                                    && Number.isFinite(macd_hist_prev) && macd_hist <= macd_hist_prev;

  const trigger_type_long = trigger_breakout_long ? "BREAKOUT"
    : trigger_reclaim_long ? "RECLAIM"
    : trigger_continuation_long ? "CONTINUATION" : "NONE";
  const trigger_type_short = trigger_breakdown_short ? "BREAKDOWN"
    : trigger_loss_short ? "LOSS"
    : trigger_continuation_short ? "CONTINUATION" : "NONE";

  const trigger_long  = trigger_type_long  !== "NONE";
  const trigger_short = trigger_type_short !== "NONE";

  // (J) risk
  const long_stop   = close_cur - atr_val * p.stop_atr;
  const long_target = close_cur + atr_val * p.target_atr;
  const short_stop  = close_cur + atr_val * p.stop_atr;
  const short_target = close_cur - atr_val * p.target_atr;
  const long_rr  = safeDiv(long_target - close_cur,  close_cur - long_stop);
  const short_rr = safeDiv(close_cur - short_target, short_stop - close_cur);

  const extension_long_block  = price_position > p.max_extension_long;
  const extension_short_block = price_position < p.min_extension_short;
  const htf_conflict_long  = htf.htf_bias === "BEAR";
  const htf_conflict_short = htf.htf_bias === "BULL";

  const hard_block_long  = long_rr  < p.min_rr || extension_long_block  || state_dead || state_chaos;
  const hard_block_short = short_rr < p.min_rr || extension_short_block || state_dead || state_chaos;

  const risk_ok_long_early  = !hard_block_long;
  const risk_ok_long_core   = !hard_block_long  && !htf_conflict_long;
  const risk_ok_short_early = !hard_block_short;
  const risk_ok_short_core  = !hard_block_short && !htf_conflict_short;

  const risk_mode_long_early = !risk_ok_long_early
    ? (state_dead ? "DEAD_MARKET" : state_chaos ? "CHAOS_MARKET"
        : extension_long_block ? "EXTREME_EXTENSION" : "RR_FAIL")
    : "PASS";
  const risk_mode_long_core = !risk_ok_long_core
    ? (state_dead ? "DEAD_MARKET" : state_chaos ? "CHAOS_MARKET"
        : htf_conflict_long ? "HTF_CONFLICT"
        : extension_long_block ? "EXTREME_EXTENSION" : "RR_FAIL")
    : "PASS";
  const risk_mode_short_early = !risk_ok_short_early
    ? (state_dead ? "DEAD_MARKET" : state_chaos ? "CHAOS_MARKET"
        : extension_short_block ? "EXTREME_EXTENSION" : "RR_FAIL")
    : "PASS";
  const risk_mode_short_core = !risk_ok_short_core
    ? (state_dead ? "DEAD_MARKET" : state_chaos ? "CHAOS_MARKET"
        : htf_conflict_short ? "HTF_CONFLICT"
        : extension_short_block ? "EXTREME_EXTENSION" : "RR_FAIL")
    : "PASS";

  // (K) raw final
  const long_early_raw = long_opportunity >= p.thr_early
    && (trigger_reclaim_long || trigger_breakout_long)
    && risk_ok_long_early
    && structure_alignment_long >= 0.40
    && directional_pressure_long >= p.reclaim_trigger_directional_pressure_min
    && anti_chop_gate;
  const long_continuation_early_raw = shouldUseLongContinuationEarlyPath({
    triggerContinuationLong: trigger_continuation_long,
    opportunity: long_opportunity,
    continuationEarlyThresholdLong: p.continuation_early_threshold_long,
    riskOkLongCore: risk_ok_long_core,
    structureAlignmentLong: structure_alignment_long,
    participation,
    participationFloorCore: 0.42,
    continuationPressureLong: continuation_pressure_long,
    continuationPressureFloor: p.continuation_pressure_min,
    antiChopGate: anti_chop_gate,
    transitionCoreQualityLong: transition_core_quality_long,
  });
  const long_core_raw = long_opportunity >= p.thr_core
    && (trigger_continuation_long || trigger_breakout_long)
    && risk_ok_long_core
    && structure_alignment_long >= 0.62
    && participation >= 0.42
    && transition_core_quality_long;
  const short_early_raw = short_opportunity >= p.thr_early
    && (trigger_loss_short || trigger_breakdown_short)
    && risk_ok_short_early
    && structure_alignment_short >= 0.40
    && directional_pressure_short >= p.reclaim_trigger_directional_pressure_min
    && anti_chop_gate;
  const short_core_raw = short_opportunity >= p.thr_core
    && (trigger_continuation_short || trigger_breakdown_short)
    && risk_ok_short_core
    && structure_alignment_short >= 0.62
    && participation >= 0.42
    && transition_core_quality_short;

  // (L) cooldown
  const tfMs = tfStringToMs(tf);
  const cd = result.cooldownStateNext;
  const lastLongMs = Number(cd && cd.last_long_signal_bar_close_ms);
  const lastShortMs = Number(cd && cd.last_short_signal_bar_close_ms);
  const lastLongTrigger = String(cd && cd.last_long_trigger || "NONE");
  const lastShortTrigger = String(cd && cd.last_short_trigger || "NONE");

  const cur = Number(barCloseMs) || _last(bars).barCloseTimeUtcMs || _last(bars).close_time_utc_ms || _last(bars).t;
  const longBarsSince = (Number.isFinite(lastLongMs) && tfMs > 0) ? (cur - lastLongMs) / tfMs : Infinity;
  const shortBarsSince = (Number.isFinite(lastShortMs) && tfMs > 0) ? (cur - lastShortMs) / tfMs : Infinity;

  const long_can_fire = !Number.isFinite(lastLongMs)
    || longBarsSince > p.same_dir_cooldown_bars
    || trigger_type_long !== lastLongTrigger;
  const short_can_fire = !Number.isFinite(lastShortMs)
    || shortBarsSince > p.same_dir_cooldown_bars
    || trigger_type_short !== lastShortTrigger;

  const long_core_pulse  = long_core_raw  && long_can_fire;
  const short_core_pulse = short_core_raw && short_can_fire;
  const long_early_pulse  = (long_early_raw || long_continuation_early_raw) && !long_core_pulse  && long_can_fire;
  const short_early_pulse = short_early_raw && !short_core_pulse && short_can_fire;

  const longDecision = deriveDirectionDecision({
    direction: "LONG",
    triggerType: trigger_type_long,
    triggerActive: trigger_long,
    signalFired: long_core_pulse || long_early_pulse,
    signalGrade: long_core_pulse ? "CORE" : (long_early_pulse ? "EARLY" : null),
    canFire: long_can_fire,
    earlyEligible: trigger_reclaim_long || trigger_breakout_long || trigger_continuation_long,
    coreEligible: trigger_continuation_long || trigger_breakout_long,
    opportunity: long_opportunity,
    thrEarly: p.thr_early,
    thrCore: p.thr_core,
    riskOkEarly: risk_ok_long_early,
    riskOkCore: risk_ok_long_core,
    structureAlignment: structure_alignment_long,
    structureFloorEarly: 0.40,
    structureFloorCore: 0.62,
    directionalPressure: directional_pressure_long,
    directionalFloorEarly: p.reclaim_trigger_directional_pressure_min,
    participation,
    participationFloorCore: 0.42,
    antiChopGate: anti_chop_gate,
    transitionCoreQuality: transition_core_quality_long,
  });
  const shortDecision = deriveDirectionDecision({
    direction: "SHORT",
    triggerType: trigger_type_short,
    triggerActive: trigger_short,
    signalFired: short_core_pulse || short_early_pulse,
    signalGrade: short_core_pulse ? "CORE" : (short_early_pulse ? "EARLY" : null),
    canFire: short_can_fire,
    earlyEligible: trigger_loss_short || trigger_breakdown_short,
    coreEligible: trigger_continuation_short || trigger_breakdown_short,
    opportunity: short_opportunity,
    thrEarly: p.thr_early,
    thrCore: p.thr_core,
    riskOkEarly: risk_ok_short_early,
    riskOkCore: risk_ok_short_core,
    structureAlignment: structure_alignment_short,
    structureFloorEarly: 0.40,
    structureFloorCore: 0.62,
    directionalPressure: directional_pressure_short,
    directionalFloorEarly: p.reclaim_trigger_directional_pressure_min,
    participation,
    participationFloorCore: 0.42,
    antiChopGate: anti_chop_gate,
    transitionCoreQuality: transition_core_quality_short,
  });

  // (M) signal payload(s)
  // Per-direction inputs the V2 signalCriteria gate inspects via
  // buildSignalCriteriaSeedFromIntent. We expose them here through
  // buildPayload's `criteriaInputs` so the criteria gate finds the
  // values it needs (htf_alignment_score / setup_quality_score /
  // trigger_level / volume_zscore / rsi_entry_tf / directional_pressure
  // / participation / expected_gross_r / etc.). Pine v6.1.1.0 already
  // computes all of these — just plumb them out.
  const longCriteriaInputs = Object.freeze({
    structure_alignment: structure_alignment_long,
    pullback_quality: pullback_quality_long,
    directional_pressure: directional_pressure_long,
    continuation_pressure: continuation_pressure_long,
    risk_efficiency: risk_efficiency_long,
    confidence: long_opportunity,
    hold_after_reclaim: trigger_reclaim_long,
    reclaim_hold_confirmed: trigger_reclaim_long,
    reclaim_level_held: trigger_reclaim_long,
    stop_distance_sane: !hard_block_long,
    trigger_stop_distance_sane: !hard_block_long,
  });
  const shortCriteriaInputs = Object.freeze({
    structure_alignment: structure_alignment_short,
    pullback_quality: pullback_quality_short,
    directional_pressure: directional_pressure_short,
    continuation_pressure: continuation_pressure_short,
    risk_efficiency: risk_efficiency_short,
    confidence: short_opportunity,
    hold_after_reclaim: trigger_loss_short,
    reclaim_hold_confirmed: trigger_loss_short,
    reclaim_level_held: trigger_loss_short,
    stop_distance_sane: !hard_block_short,
    trigger_stop_distance_sane: !hard_block_short,
    pullback_reclaim_short_recovery_confirmed: trigger_loss_short ? true : null,
    short_reclaim_recovery_confirmed: trigger_loss_short ? true : null,
    short_reclaim_live_override: trigger_loss_short ? true : null,
  });
  const sharedCriteriaInputs = Object.freeze({
    participation,
    volume_zscore: vol_ratio,            // bridge falls back to volume_ratio / participation; expose vol_ratio explicitly
    volume_ratio: vol_ratio,
    rsi_entry_tf: rsi_val,
    rsi: rsi_val,
    atr_ratio,
    market_state_score: market_state === "BULL" || market_state === "BEAR" ? 1.0
      : market_state === "TRANSITION" ? 0.6
      : market_state === "RANGE" ? 0.4
      : 0.1,
  });

  const out = result.signals;
  if (long_core_pulse) {
    out.push(buildPayload({
      direction: "LONG", grade: "CORE",
      score: long_opportunity, market_state, htf_bias: htf.htf_bias,
      trigger_type: trigger_type_long, risk_mode: risk_mode_long_core,
      rr: long_rr, stop: long_stop, target: long_target,
      close: close_cur, exchange, symbol, tf, barCloseMs: cur, qtyPct: p.webhook_qty_pct, runId,
      criteriaInputs: { ...sharedCriteriaInputs, ...longCriteriaInputs },
    }));
    result.cooldownStateNext = {
      ...cd,
      last_long_signal_bar_close_ms: cur,
      last_long_trigger: trigger_type_long,
    };
  } else if (long_early_pulse) {
    out.push(buildPayload({
      direction: "LONG", grade: "EARLY",
      score: long_opportunity, market_state, htf_bias: htf.htf_bias,
      trigger_type: trigger_type_long, risk_mode: risk_mode_long_early,
      rr: long_rr, stop: long_stop, target: long_target,
      close: close_cur, exchange, symbol, tf, barCloseMs: cur, qtyPct: p.webhook_qty_pct, runId,
      criteriaInputs: { ...sharedCriteriaInputs, ...longCriteriaInputs },
    }));
    result.cooldownStateNext = {
      ...cd,
      last_long_signal_bar_close_ms: cur,
      last_long_trigger: trigger_type_long,
    };
  }
  if (short_core_pulse) {
    out.push(buildPayload({
      direction: "SHORT", grade: "CORE",
      score: short_opportunity, market_state, htf_bias: htf.htf_bias,
      trigger_type: trigger_type_short, risk_mode: risk_mode_short_core,
      rr: short_rr, stop: short_stop, target: short_target,
      close: close_cur, exchange, symbol, tf, barCloseMs: cur, qtyPct: p.webhook_qty_pct, runId,
      criteriaInputs: { ...sharedCriteriaInputs, ...shortCriteriaInputs },
    }));
    result.cooldownStateNext = {
      ...result.cooldownStateNext,
      last_short_signal_bar_close_ms: cur,
      last_short_trigger: trigger_type_short,
    };
  } else if (short_early_pulse) {
    out.push(buildPayload({
      direction: "SHORT", grade: "EARLY",
      score: short_opportunity, market_state, htf_bias: htf.htf_bias,
      trigger_type: trigger_type_short, risk_mode: risk_mode_short_early,
      rr: short_rr, stop: short_stop, target: short_target,
      close: close_cur, exchange, symbol, tf, barCloseMs: cur, qtyPct: p.webhook_qty_pct, runId,
      criteriaInputs: { ...sharedCriteriaInputs, ...shortCriteriaInputs },
    }));
    result.cooldownStateNext = {
      ...result.cooldownStateNext,
      last_short_signal_bar_close_ms: cur,
      last_short_trigger: trigger_type_short,
    };
  }

  // (N) diagnostics
  result.diagnostics = {
    ...result.diagnostics,
    market_state,
    htf_bias: htf.htf_bias,
    long_opportunity,
    short_opportunity,
    trigger_type_long,
    trigger_type_short,
    trigger_breakout_long,
    trigger_reclaim_long,
    trigger_continuation_long,
    trigger_breakdown_short,
    trigger_loss_short,
    trigger_continuation_short,
    pullback_depth_ok_long,
    pullback_depth_ok_short,
    continuation_bar_bias_long,
    continuation_bar_bias_short,
    continuation_pressure_long,
    continuation_pressure_short,
    bull_close,
    bear_close,
    close_pos_in_bar,
    price_position,
    risk_mode_long_early,
    risk_mode_long_core,
    risk_mode_short_early,
    risk_mode_short_core,
    long_can_fire,
    short_can_fire,
    long_core_raw,
    long_early_raw,
    long_continuation_early_raw,
    short_core_raw,
    short_early_raw,
    long_decision_path: longDecision.path,
    long_decision_reason: longDecision.reason,
    short_decision_path: shortDecision.path,
    short_decision_reason: shortDecision.reason,
  };

  return result;
}

// ───────────────────────────────────────────────────────────
// Payload builder (matches pine f_entry_payload + V2 metadata)
// ───────────────────────────────────────────────────────────

function buildPayload({
  direction, grade, score, market_state, htf_bias,
  trigger_type, risk_mode, rr, stop, target,
  close, exchange, symbol, tf, barCloseMs, qtyPct, runId,
  criteriaInputs = null,
}) {
  const side = direction === "LONG" ? "BUY" : "SELL";
  const ci = (criteriaInputs && typeof criteriaInputs === "object") ? criteriaInputs : {};
  const features = {
    strategy_id: STRATEGY_ID,
    engine_mode: ENGINE_MODE,
    entry_grade: grade,
    qty_profile: QTY_PROFILE,
    market_state,
    htf_bias,
    trigger_type,
    risk_mode,
    opportunity_score: score,
    rr,
    stop_price: stop,
    target_price: target,
    _event_intent: "ENTRY",
    signal_family: direction,
    source_band: grade,
    // V2 server-native metadata
    source: SIGNAL_SOURCE,
    v2_server_native: true,
    engine_version: ENGINE_VERSION,
    // ── V2 signalCriteria gate inputs (Pine v6.1.1.0 derived series).
    //    buildSignalCriteriaSeedFromIntent maps these into the bridge's
    //    htf_regime / setup_gate / trigger_gate / no_trade_gate /
    //    expected_edge_gate doc shape.
    htf_alignment_score: Number.isFinite(Number(ci.structure_alignment))
      ? Number(ci.structure_alignment)
      : (htf_bias === "BULL" || htf_bias === "BEAR" ? 1.0 : 0.5),
    structure_alignment: Number.isFinite(Number(ci.structure_alignment))
      ? Number(ci.structure_alignment) : null,
    confidence: Number.isFinite(Number(ci.confidence)) ? Number(ci.confidence) : score,
    canonical_engine_field_alignment: Number.isFinite(Number(ci.structure_alignment))
      ? Number(ci.structure_alignment) : null,
    setup_quality_score: Number.isFinite(Number(ci.pullback_quality))
      ? Number(ci.pullback_quality) : score,
    pullback_quality: Number.isFinite(Number(ci.pullback_quality))
      ? Number(ci.pullback_quality) : null,
    setup_type: trigger_type && trigger_type !== "NONE" ? trigger_type : "NONE",
    trigger_confirmed: !!(trigger_type && trigger_type !== "NONE"),
    trigger_level: Number.isFinite(Number(close)) ? Number(close) : null,
    hold_after_reclaim: ci.hold_after_reclaim === true,
    reclaim_hold_confirmed: ci.reclaim_hold_confirmed === true,
    reclaim_level_held: ci.reclaim_level_held === true,
    stop_distance_sane: ci.stop_distance_sane === true,
    trigger_stop_distance_sane: ci.trigger_stop_distance_sane === true,
    pullback_reclaim_short_recovery_confirmed: ci.pullback_reclaim_short_recovery_confirmed === true,
    short_reclaim_recovery_confirmed: ci.short_reclaim_recovery_confirmed === true,
    short_reclaim_live_override: ci.short_reclaim_live_override === true,
    directional_pressure: Number.isFinite(Number(ci.directional_pressure))
      ? Number(ci.directional_pressure) : null,
    continuation_pressure: Number.isFinite(Number(ci.continuation_pressure))
      ? Number(ci.continuation_pressure) : null,
    risk_efficiency: Number.isFinite(Number(ci.risk_efficiency))
      ? Number(ci.risk_efficiency) : null,
    participation: Number.isFinite(Number(ci.participation))
      ? Number(ci.participation) : null,
    volume_ratio: Number.isFinite(Number(ci.volume_ratio))
      ? Number(ci.volume_ratio) : null,
    volume_zscore: Number.isFinite(Number(ci.volume_zscore))
      ? Number(ci.volume_zscore) : null,
    rsi_entry_tf: Number.isFinite(Number(ci.rsi_entry_tf))
      ? Number(ci.rsi_entry_tf) : null,
    atr_ratio: Number.isFinite(Number(ci.atr_ratio))
      ? Number(ci.atr_ratio) : null,
    market_quality_score: Number.isFinite(Number(ci.market_state_score))
      ? Number(ci.market_state_score) : null,
    expected_gross_r: Number.isFinite(Number(rr)) ? Number(rr) : null,
  };
  return {
    exchange: String(exchange || "").toUpperCase(),
    symbol: String(symbol || "").toUpperCase(),
    market: String(symbol || "").toUpperCase(),
    ticker: String(symbol || "").toUpperCase(),
    tf: String(tf || ""),
    strategy_id: STRATEGY_ID,
    engine_mode: ENGINE_MODE,
    action: "ENTRY",
    event_intent: "ENTRY",
    event: direction,
    side,
    direction,
    entry_grade: grade,
    qty_profile: QTY_PROFILE,
    timeframe: String(tf || ""),
    market_state,
    htf_bias,
    trigger_type,
    risk_mode,
    qtyPct: Number(qtyPct) || 1.0,
    qty_pct: Number(qtyPct) || 1.0,
    price: close,
    opportunity_score: score,
    rr,
    stop_price: stop,
    target_price: target,
    bar_close_time_utc_ms: barCloseMs,
    bar_time: barCloseMs,
    run_id: runId || null,
    features,
  };
}

// ───────────────────────────────────────────────────────────
// tf helper — "1"/"5"/"15"/"60"/"240" (TV string) → ms
// ───────────────────────────────────────────────────────────

function tfStringToMs(tf) {
  if (typeof tf === "number" && Number.isFinite(tf)) return tf;
  const s = String(tf || "").trim().toUpperCase();
  if (!s) return 60_000;
  // Numeric minutes: "1", "5", "15", "60", "240"
  if (/^\d+$/.test(s)) return Number(s) * 60_000;
  // Suffix forms: "1m", "5m", "1h", "4h", "1d"
  const m = s.match(/^(\d+)([SMHD])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit === "S") return n * 1000;
    if (unit === "M") return n * 60_000;
    if (unit === "H") return n * 3_600_000;
    if (unit === "D") return n * 86_400_000;
  }
  return 60_000;
}

module.exports = {
  generateV2EntrySignals,
  computeHtfBias,
  DEFAULT_PARAMS,
  STRATEGY_ID,
  ENGINE_MODE,
  ENGINE_VERSION,
  SIGNAL_SOURCE,
  __test: {
    sma,
    ema,
    rsi,
    macd,
    atr,
    highest,
    lowest,
    clamp01,
    safeDiv,
    tfStringToMs,
    buildPayload,
    deriveDirectionDecision,
    shouldUseLongContinuationEarlyPath,
  },
};
