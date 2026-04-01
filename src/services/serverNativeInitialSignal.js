"use strict";

const HTF_TF = "240m";
const STRATEGY_ID = "donbeolja_v6.1.1.0";
const ENGINE_MODE = "SERVER_NATIVE_V6110";
const QTY_PROFILE = "FIXED";
const STATE_TREND_MIN = 0.22;
const DEAD_ATR_MAX = 0.0014;
const PANIC_ATR_MIN = 0.0350;
const THR_EARLY = 0.56;
const THR_CORE = 0.68;
const SAME_DIR_COOLDOWN_BARS = 8;
const MIN_RR = 1.45;
const STOP_ATR = 1.8;
const TARGET_ATR = 2.8;
const MAX_EXTENSION_LONG = 0.92;
const MIN_EXTENSION_SHORT = 0.08;
const EPS = 1e-10;
const RANGE_EPS = 1e-8;
const HTF_EMA_SLOW_LEN = 55;
const DERIVED_HTF_TARGET_BARS = 60;

function msToUtcZ(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString().replace(".000Z", "Z");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function tfToMs(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  const m = raw.match(/^(\d+)(m|h|d)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2] === "m") return n * 60 * 1000;
  if (m[2] === "h") return n * 60 * 60 * 1000;
  if (m[2] === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}

function safeDiv(a, b) {
  const aa = Number(a);
  const bb = Number(b);
  if (!Number.isFinite(aa) || !Number.isFinite(bb) || Math.abs(bb) <= EPS) return 0;
  return aa / bb;
}

function emaSeries(values, length) {
  const out = new Array(values.length).fill(null);
  if (!Array.isArray(values) || !values.length) return out;
  const len = Math.max(1, Number(length) || 1);
  const alpha = 2 / (len + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) {
      out[i] = prev;
      continue;
    }
    prev = prev == null ? v : (alpha * v) + ((1 - alpha) * prev);
    out[i] = prev;
  }
  return out;
}

function smaSeries(values, length) {
  const out = new Array(values.length).fill(null);
  const len = Math.max(1, Number(length) || 1);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]);
    sum += Number.isFinite(v) ? v : 0;
    if (i >= len) {
      const old = Number(values[i - len]);
      sum -= Number.isFinite(old) ? old : 0;
    }
    const count = Math.min(i + 1, len);
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

function rsiSeries(values, length) {
  const out = new Array(values.length).fill(null);
  const len = Math.max(1, Number(length) || 1);
  if (!Array.isArray(values) || values.length < 2) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < values.length; i += 1) {
    const diff = Number(values[i]) - Number(values[i - 1]);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    if (i <= len) {
      gainSum += gain;
      lossSum += loss;
      if (i === len) {
        let avgGain = gainSum / len;
        let avgLoss = lossSum / len;
        out[i] = avgLoss <= EPS ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
        for (let j = i + 1; j < values.length; j += 1) {
          const d = Number(values[j]) - Number(values[j - 1]);
          const g = d > 0 ? d : 0;
          const l = d < 0 ? Math.abs(d) : 0;
          avgGain = ((avgGain * (len - 1)) + g) / len;
          avgLoss = ((avgLoss * (len - 1)) + l) / len;
          out[j] = avgLoss <= EPS ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
        }
        break;
      }
    }
  }
  return out;
}

function trueRange(bar, prevClose) {
  const h = Number(bar && (bar.high ?? bar.h));
  const l = Number(bar && (bar.low ?? bar.l));
  if (!Number.isFinite(h) || !Number.isFinite(l)) return null;
  if (!Number.isFinite(prevClose)) return Math.max(h - l, RANGE_EPS);
  return Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
}

function atrSeries(bars, length) {
  const out = new Array(bars.length).fill(null);
  const tr = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i += 1) {
    const prevClose = i > 0 ? Number(bars[i - 1].close ?? bars[i - 1].c) : null;
    tr[i] = trueRange(bars[i], prevClose);
  }
  const len = Math.max(1, Number(length) || 1);
  let sum = 0;
  let prevAtr = null;
  for (let i = 0; i < tr.length; i += 1) {
    const cur = Number(tr[i]);
    if (!Number.isFinite(cur)) continue;
    if (i < len) {
      sum += cur;
      if (i === len - 1) {
        prevAtr = sum / len;
        out[i] = prevAtr;
      }
      continue;
    }
    prevAtr = ((prevAtr * (len - 1)) + cur) / len;
    out[i] = prevAtr;
  }
  return out;
}

function macdHistSeries(values, fastLen = 12, slowLen = 26, signalLen = 9) {
  const fast = emaSeries(values, fastLen);
  const slow = emaSeries(values, slowLen);
  const macdLine = values.map((_, i) => {
    const f = Number(fast[i]);
    const s = Number(slow[i]);
    return Number.isFinite(f) && Number.isFinite(s) ? f - s : null;
  });
  const signal = emaSeries(macdLine.map((v) => (Number.isFinite(v) ? v : 0)), signalLen);
  return values.map((_, i) => {
    const m = Number(macdLine[i]);
    const s = Number(signal[i]);
    return Number.isFinite(m) && Number.isFinite(s) ? m - s : null;
  });
}

function highestInRange(values, start, end) {
  let best = null;
  for (let i = Math.max(0, start); i <= end && i < values.length; i += 1) {
    const n = Number(values[i]);
    if (!Number.isFinite(n)) continue;
    best = best == null ? n : Math.max(best, n);
  }
  return best;
}

function lowestInRange(values, start, end) {
  let best = null;
  for (let i = Math.max(0, start); i <= end && i < values.length; i += 1) {
    const n = Number(values[i]);
    if (!Number.isFinite(n)) continue;
    best = best == null ? n : Math.min(best, n);
  }
  return best;
}

function normalizeBars(bars) {
  const list = Array.isArray(bars) ? bars : [];
  return list
    .map((bar) => ({
      open: num(bar && (bar.open ?? bar.o)),
      high: num(bar && (bar.high ?? bar.h)),
      low: num(bar && (bar.low ?? bar.l)),
      close: num(bar && (bar.close ?? bar.c)),
      volume: num(bar && (bar.volume ?? bar.v), 0),
      timestamp: num(bar && (bar.closeTimeUtcMs ?? bar.timestamp ?? bar.t ?? bar.bar_close_time_utc_ms)),
    }))
    .filter((bar) => Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close));
}

function deriveHigherTimeframeBars({ bars, sourceTf, targetTf }) {
  const normalized = normalizeBars(bars);
  const sourceTfMs = tfToMs(sourceTf);
  const targetTfMs = tfToMs(targetTf);
  if (!normalized.length || !Number.isFinite(sourceTfMs) || !Number.isFinite(targetTfMs)) return [];
  if (targetTfMs <= sourceTfMs) return [];
  const ratio = targetTfMs / sourceTfMs;
  if (!Number.isFinite(ratio) || ratio < 2 || Math.round(ratio) !== ratio) return [];

  const grouped = new Map();
  for (const bar of normalized) {
    const ts = Number(bar && bar.timestamp);
    if (!Number.isFinite(ts)) continue;
    const bucketCloseMs = Math.ceil(ts / targetTfMs) * targetTfMs;
    if (!grouped.has(bucketCloseMs)) {
      grouped.set(bucketCloseMs, {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Number(bar.volume || 0),
        timestamp: bucketCloseMs,
        count: 1,
      });
      continue;
    }
    const agg = grouped.get(bucketCloseMs);
    agg.high = Math.max(Number(agg.high), Number(bar.high));
    agg.low = Math.min(Number(agg.low), Number(bar.low));
    agg.close = bar.close;
    agg.volume = Number(agg.volume || 0) + Number(bar.volume || 0);
    agg.count += 1;
  }

  return Array.from(grouped.values())
    .filter((row) => Number(row.count) === ratio)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    .map((row) => ({
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      timestamp: row.timestamp,
      closeTimeUtcMs: row.timestamp,
    }));
}

function resolveEffectiveHtfBars({ bars, htfBars, tf }) {
  const normalizedHtfBars = normalizeBars(htfBars);
  if (normalizedHtfBars.length) return normalizedHtfBars;
  return deriveHigherTimeframeBars({ bars, sourceTf: tf, targetTf: HTF_TF });
}

function minBaseBarsForDerivedHtf({ sourceTf, targetTf = HTF_TF, targetBars = DERIVED_HTF_TARGET_BARS } = {}) {
  const sourceTfMs = tfToMs(sourceTf);
  const targetTfMs = tfToMs(targetTf);
  if (!Number.isFinite(sourceTfMs) || !Number.isFinite(targetTfMs) || targetTfMs <= sourceTfMs) return 0;
  const ratio = targetTfMs / sourceTfMs;
  if (!Number.isFinite(ratio) || ratio < 1) return 0;
  const desiredTargetBars = Math.max(Number(targetBars) || 0, HTF_EMA_SLOW_LEN);
  return Math.ceil(desiredTargetBars * ratio);
}

function resolveHtfBias(htfBars, barMs) {
  const bars = normalizeBars(htfBars);
  if (!bars.length) return "NEUTRAL";
  const closes = bars.map((bar) => bar.close);
  const ema21 = emaSeries(closes, 21);
  const ema55 = emaSeries(closes, 55);
  let idx = -1;
  for (let i = 0; i < bars.length; i += 1) {
    if (!Number.isFinite(barMs) || !Number.isFinite(bars[i].timestamp) || bars[i].timestamp <= barMs) idx = i;
  }
  if (idx < 0) idx = bars.length - 1;
  const fast = Number(ema21[idx]);
  const slow = Number(ema55[idx]);
  if (!Number.isFinite(fast) || !Number.isFinite(slow)) return "NEUTRAL";
  if (fast > slow) return "BULL";
  if (fast < slow) return "BEAR";
  return "NEUTRAL";
}

function regimeForMarketState(marketState) {
  if (marketState === "BULL" || marketState === "BEAR") return "trend";
  if (marketState === "TRANSITION") return "transition";
  return "range";
}

function buildNativeSignal({
  exchange,
  symbol,
  tf,
  barMs,
  direction,
  grade,
  opportunity,
  marketState,
  htfBias,
  triggerType,
  riskMode,
  rr,
  stopPrice,
  targetPrice,
  structureAlignment,
  directionalPressure,
  continuationPressure,
  participation,
  pullbackQuality,
  riskEfficiency,
  transitionRisk,
  coherence,
  fieldAlignment,
  domainWallDensity,
  freeEnergy,
  susceptibility,
}) {
  const dir = String(direction || "").toUpperCase();
  const opp = Number(opportunity);
  const scoreAbs = Number.isFinite(opp) ? opp * 100 : null;
  const score = dir === "SHORT" ? -scoreAbs : scoreAbs;
  const confidence = clamp01(
    (0.32 * Number(structureAlignment || 0)) +
    (0.28 * Number(directionalPressure || 0)) +
    (0.20 * Number(participation || 0)) +
    (0.20 * Number(continuationPressure || 0))
  );
  const waveConf = clamp01(
    (0.45 * Number(continuationPressure || 0)) +
    (0.35 * Number(directionalPressure || 0)) +
    (0.20 * Number(participation || 0))
  );
  const posterior = clamp01(opp);
  const side = dir === "SHORT" ? "SELL" : "BUY";
  const event = dir === "SHORT" ? "SHORT" : "LONG";
  const features = {
    strategy_id: STRATEGY_ID,
    engine_mode: ENGINE_MODE,
    entry_grade: grade,
    entry_timing_tier: grade,
    entry_tier: grade,
    qty_profile: QTY_PROFILE,
    market_state: marketState,
    regime: regimeForMarketState(marketState),
    market_regime: regimeForMarketState(marketState),
    htf_bias: htfBias,
    trigger_type: triggerType,
    risk_mode: riskMode,
    opportunity_score: opp,
    score,
    score_abs: scoreAbs,
    score_norm: opp,
    signal_strength: opp,
    confidence,
    wave_conf: waveConf,
    zz_wave_conf: waveConf,
    posterior,
    posterior_long: dir === "LONG" ? posterior : (1 - posterior),
    posterior_short: dir === "SHORT" ? posterior : (1 - posterior),
    post_prob_long: dir === "LONG" ? posterior : (1 - posterior),
    post_prob_short: dir === "SHORT" ? posterior : (1 - posterior),
    rr,
    stop_price: stopPrice,
    target_price: targetPrice,
    _event_intent: "ENTRY",
    action: "ENTRY",
    signal_family: dir,
    source_band: grade,
    source_origin: "SERVER_NATIVE",
    server_native_initial_signal: true,
    canonical_engine_candidate_source: "SERVER_NATIVE",
    transition_bias: marketState === "TRANSITION",
    structure_alignment: structureAlignment,
    directional_pressure: directionalPressure,
    continuation_pressure: continuationPressure,
    pullback_quality: pullbackQuality,
    participation,
    risk_efficiency: riskEfficiency,
    sp_transition_risk: transitionRisk,
    sp_field_alignment: fieldAlignment,
    sp_coherence_score: coherence,
    sp_domain_wall_density: domainWallDensity,
    sp_susceptibility: susceptibility,
    sp_free_energy: freeEnergy,
    signal_bar_close_time_utc_ms: barMs,
    signal_bar_close_time_utc: Number.isFinite(barMs) ? msToUtcZ(barMs) : null,
  };
  return {
    event,
    side,
    qty_pct: 1,
    reason: "SERVER_NATIVE_INITIAL_SIGNAL",
    features,
  };
}

function evaluateSignalsForBars({ exchange, symbol, tf, bars, htfBars }) {
  const candles = normalizeBars(bars);
  if (candles.length < 60) return [];
  const effectiveHtfBars = resolveEffectiveHtfBars({ bars: candles, htfBars, tf });
  const closes = candles.map((bar) => bar.close);
  const highs = candles.map((bar) => bar.high);
  const lows = candles.map((bar) => bar.low);
  const opens = candles.map((bar) => bar.open);
  const volumes = candles.map((bar) => bar.volume || 0);

  const emaFast = emaSeries(closes, 8);
  const emaMid = emaSeries(closes, 21);
  const emaSlow = emaSeries(closes, 55);
  const emaAnchor = emaSeries(closes, 144);
  const rsi = rsiSeries(closes, 14);
  const macdHist = macdHistSeries(closes, 12, 26, 9);
  const atr = atrSeries(candles, 14);
  const volMa = smaSeries(volumes, 20);

  const results = new Array(candles.length).fill(null);
  let lastLongSignalBar = null;
  let lastShortSignalBar = null;
  let lastLongTrigger = "NONE";
  let lastShortTrigger = "NONE";

  for (let i = 0; i < candles.length; i += 1) {
    const close = closes[i];
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const ef = emaFast[i];
    const em = emaMid[i];
    const es = emaSlow[i];
    const ea = emaAnchor[i];
    const atrNow = atr[i];
    const volRatio = safeDiv(volumes[i], volMa[i] || 1);
    const atrRatio = safeDiv(atrNow, close);
    const slopeFast = Number.isFinite(emaFast[i - 5]) ? ef - emaFast[i - 5] : 0;
    const slopeMid = Number.isFinite(emaMid[i - 5]) ? em - emaMid[i - 5] : 0;
    const trendStrengthRaw = Math.abs(safeDiv(ef - es, es)) * 100;
    const rangeHigh = highestInRange(highs, i - 19, i);
    const rangeLow = lowestInRange(lows, i - 19, i);
    const rangeSpan = Math.max((rangeHigh ?? high) - (rangeLow ?? low), RANGE_EPS);
    const pricePosition = clamp01((close - (rangeLow ?? low)) / rangeSpan);
    const barRange = Math.max(high - low, RANGE_EPS);
    const bodyRatio = Math.abs(close - open) / barRange;
    const upperWickRatio = (high - Math.max(open, close)) / barRange;
    const lowerWickRatio = (Math.min(open, close) - low) / barRange;
    const htfBias = resolveHtfBias(effectiveHtfBars, candles[i].timestamp);

    const stateBull = ef > em && em > es && slopeFast > 0 && slopeMid >= 0 && trendStrengthRaw >= STATE_TREND_MIN;
    const stateBear = ef < em && em < es && slopeFast < 0 && slopeMid <= 0 && trendStrengthRaw >= STATE_TREND_MIN;
    const stateTransition = !stateBull && !stateBear && trendStrengthRaw >= (STATE_TREND_MIN * 0.55);
    const stateChaos = atrRatio >= PANIC_ATR_MIN || (upperWickRatio >= 0.44 && lowerWickRatio >= 0.44 && bodyRatio <= 0.28);
    const stateDead = atrRatio <= DEAD_ATR_MAX && volRatio <= 0.72;
    const marketState = stateChaos ? "CHAOS" : stateBull ? "BULL" : stateBear ? "BEAR" : stateTransition ? "TRANSITION" : "RANGE";

    const closePosInBar = clamp01((close - low) / barRange);
    const bullClose = close > open && closePosInBar >= 0.55;
    const bearClose = close < open && closePosInBar <= 0.45;
    const recentHigh = highestInRange(highs, i - 5, i - 1);
    const recentLow = lowestInRange(lows, i - 5, i - 1);
    const reclaimStrengthLong = clamp01((0.45 * (close > ef ? 1 : 0)) + (0.30 * closePosInBar) + (0.25 * (low <= ef ? 1 : 0)));
    const reclaimStrengthShort = clamp01((0.45 * (close < ef ? 1 : 0)) + (0.30 * (1 - closePosInBar)) + (0.25 * (high >= ef ? 1 : 0)));
    const transitionBiasLong = marketState === "TRANSITION" && Number.isFinite(emaFast[i - 2]) && ef >= emaFast[i - 2];
    const transitionBiasShort = marketState === "TRANSITION" && Number.isFinite(emaFast[i - 2]) && ef <= emaFast[i - 2];

    const structureAlignmentLong = marketState === "BULL"
      ? 1.0
      : marketState === "TRANSITION"
        ? (ef >= em ? 0.82 : close >= ef ? 0.62 : 0.45)
        : marketState === "RANGE"
          ? 0.40
          : 0.15;
    const structureAlignmentShort = marketState === "BEAR"
      ? 1.0
      : marketState === "TRANSITION"
        ? (ef <= em ? 0.82 : close <= ef ? 0.62 : 0.45)
        : marketState === "RANGE"
          ? 0.40
          : 0.15;

    const directionalPressureLong = clamp01(
      (0.38 * clamp01((Number(rsi[i]) - 45) / 25)) +
      (0.34 * clamp01((Number(macdHist[i]) + (atrRatio * 0.6)) / ((atrRatio * 1.8) + 1e-6))) +
      (0.28 * clamp01((close - em) / ((atrNow * 1.5) + 1e-6)))
    );
    const directionalPressureShort = clamp01(
      (0.38 * clamp01((55 - Number(rsi[i])) / 25)) +
      (0.34 * clamp01(((-Number(macdHist[i])) + (atrRatio * 0.6)) / ((atrRatio * 1.8) + 1e-6))) +
      (0.28 * clamp01((em - close) / ((atrNow * 1.5) + 1e-6)))
    );

    const pullbackQualityLong = clamp01((0.55 * clamp01(1 - (Math.abs(pricePosition - 0.42) / 0.42))) + (0.45 * reclaimStrengthLong));
    const pullbackQualityShort = clamp01((0.55 * clamp01(1 - (Math.abs(pricePosition - 0.58) / 0.42))) + (0.45 * reclaimStrengthShort));
    const participation = clamp01((0.55 * clamp01(volRatio / 1.8)) + (0.45 * clamp01(atrRatio / 0.01)));
    const antiChopGate = marketState !== "RANGE" || participation >= 0.52 || trendStrengthRaw >= (STATE_TREND_MIN * 0.9);
    const continuationPressureLong = clamp01((0.42 * (close > ef ? 1 : 0)) + (0.28 * clamp01(bodyRatio / 0.7)) + (0.30 * (Number(macdHist[i]) >= Number(macdHist[i - 1]) ? 1 : 0)));
    const continuationPressureShort = clamp01((0.42 * (close < ef ? 1 : 0)) + (0.28 * clamp01(bodyRatio / 0.7)) + (0.30 * (Number(macdHist[i]) <= Number(macdHist[i - 1]) ? 1 : 0)));
    const riskEfficiencyLong = clamp01((0.60 * (pricePosition <= MAX_EXTENSION_LONG ? 1 : 0)) + (0.40 * (close >= (ea * 0.97) ? 1 : 0.35)));
    const riskEfficiencyShort = clamp01((0.60 * (pricePosition >= MIN_EXTENSION_SHORT ? 1 : 0)) + (0.40 * (close <= (ea * 1.03) ? 1 : 0.35)));
    const transitionCoreQualityLong = marketState !== "TRANSITION" || (transitionBiasLong && structureAlignmentLong >= 0.82 && participation >= 0.54 && directionalPressureLong >= 0.52 && continuationPressureLong >= 0.58 && bodyRatio >= 0.50 && pricePosition >= 0.38 && pricePosition <= 0.74);
    const transitionCoreQualityShort = marketState !== "TRANSITION" || (transitionBiasShort && structureAlignmentShort >= 0.82 && participation >= 0.54 && directionalPressureShort >= 0.52 && continuationPressureShort >= 0.58 && bodyRatio >= 0.50 && pricePosition <= 0.62 && pricePosition >= 0.26);

    const longOpportunity = (0.22 * structureAlignmentLong) + (0.20 * directionalPressureLong) + (0.18 * pullbackQualityLong) + (0.12 * participation) + (0.14 * continuationPressureLong) + (0.14 * riskEfficiencyLong);
    const shortOpportunity = (0.22 * structureAlignmentShort) + (0.20 * directionalPressureShort) + (0.18 * pullbackQualityShort) + (0.12 * participation) + (0.14 * continuationPressureShort) + (0.14 * riskEfficiencyShort);

    const pullbackDepthOkLong = pricePosition >= 0.34 && pricePosition <= 0.82;
    const pullbackDepthOkShort = pricePosition <= 0.66 && pricePosition >= 0.18;
    const triggerBreakoutLong = Number.isFinite(recentHigh) && close > recentHigh && close > ef && bullClose && bodyRatio >= 0.46;
    const triggerReclaimLong = close > ef && low <= ef && close >= (em * 0.998) && reclaimStrengthLong >= 0.68 && bullClose && directionalPressureLong >= 0.42 && (marketState !== "TRANSITION" || transitionBiasLong);
    const triggerContinuationLong = close > ef && ef >= em && pullbackDepthOkLong && bullClose && Number(macdHist[i]) >= Number(macdHist[i - 1]);
    const triggerBreakdownShort = Number.isFinite(recentLow) && close < recentLow && close < ef && bearClose && bodyRatio >= 0.46;
    const triggerLossShort = close < ef && high >= ef && close <= (em * 1.002) && reclaimStrengthShort >= 0.68 && bearClose && directionalPressureShort >= 0.42 && (marketState !== "TRANSITION" || transitionBiasShort);
    const triggerContinuationShort = close < ef && ef <= em && pullbackDepthOkShort && bearClose && Number(macdHist[i]) <= Number(macdHist[i - 1]);

    const triggerTypeLong = triggerBreakoutLong ? "BREAKOUT" : triggerReclaimLong ? "RECLAIM" : triggerContinuationLong ? "CONTINUATION" : "NONE";
    const triggerTypeShort = triggerBreakdownShort ? "BREAKDOWN" : triggerLossShort ? "LOSS" : triggerContinuationShort ? "CONTINUATION" : "NONE";

    const longStop = close - (atrNow * STOP_ATR);
    const longTarget = close + (atrNow * TARGET_ATR);
    const shortStop = close + (atrNow * STOP_ATR);
    const shortTarget = close - (atrNow * TARGET_ATR);
    const longRr = safeDiv(longTarget - close, close - longStop);
    const shortRr = safeDiv(close - shortTarget, shortStop - close);
    const extensionLongBlock = pricePosition > MAX_EXTENSION_LONG;
    const extensionShortBlock = pricePosition < MIN_EXTENSION_SHORT;
    const htfConflictLong = htfBias === "BEAR";
    const htfConflictShort = htfBias === "BULL";
    const hardBlockLong = longRr < MIN_RR || extensionLongBlock || stateDead || stateChaos;
    const hardBlockShort = shortRr < MIN_RR || extensionShortBlock || stateDead || stateChaos;
    const riskOkLongEarly = !hardBlockLong;
    const riskOkShortEarly = !hardBlockShort;
    const riskOkLongCore = !hardBlockLong && !htfConflictLong;
    const riskOkShortCore = !hardBlockShort && !htfConflictShort;
    const riskModeLongEarly = !riskOkLongEarly ? (stateDead ? "DEAD_MARKET" : stateChaos ? "CHAOS_MARKET" : extensionLongBlock ? "EXTREME_EXTENSION" : "RR_FAIL") : "PASS";
    const riskModeShortEarly = !riskOkShortEarly ? (stateDead ? "DEAD_MARKET" : stateChaos ? "CHAOS_MARKET" : extensionShortBlock ? "EXTREME_EXTENSION" : "RR_FAIL") : "PASS";
    const riskModeLongCore = !riskOkLongCore ? (stateDead ? "DEAD_MARKET" : stateChaos ? "CHAOS_MARKET" : htfConflictLong ? "HTF_CONFLICT" : extensionLongBlock ? "EXTREME_EXTENSION" : "RR_FAIL") : "PASS";
    const riskModeShortCore = !riskOkShortCore ? (stateDead ? "DEAD_MARKET" : stateChaos ? "CHAOS_MARKET" : htfConflictShort ? "HTF_CONFLICT" : extensionShortBlock ? "EXTREME_EXTENSION" : "RR_FAIL") : "PASS";

    const longEarlyRaw = longOpportunity >= THR_EARLY && (triggerReclaimLong || triggerBreakoutLong) && riskOkLongEarly && structureAlignmentLong >= 0.40 && directionalPressureLong >= 0.42 && antiChopGate;
    const longCoreRaw = longOpportunity >= THR_CORE && (triggerContinuationLong || triggerBreakoutLong) && riskOkLongCore && structureAlignmentLong >= 0.62 && participation >= 0.42 && transitionCoreQualityLong;
    const shortEarlyRaw = shortOpportunity >= THR_EARLY && (triggerLossShort || triggerBreakdownShort) && riskOkShortEarly && structureAlignmentShort >= 0.40 && directionalPressureShort >= 0.42 && antiChopGate;
    const shortCoreRaw = shortOpportunity >= THR_CORE && (triggerContinuationShort || triggerBreakdownShort) && riskOkShortCore && structureAlignmentShort >= 0.62 && participation >= 0.42 && transitionCoreQualityShort;

    const longCanFire = lastLongSignalBar == null || ((i - lastLongSignalBar) > SAME_DIR_COOLDOWN_BARS) || triggerTypeLong !== lastLongTrigger;
    const shortCanFire = lastShortSignalBar == null || ((i - lastShortSignalBar) > SAME_DIR_COOLDOWN_BARS) || triggerTypeShort !== lastShortTrigger;
    const longCorePulse = longCoreRaw && longCanFire;
    const shortCorePulse = shortCoreRaw && shortCanFire;
    const longEarlyPulse = longEarlyRaw && !longCorePulse && longCanFire;
    const shortEarlyPulse = shortEarlyRaw && !shortCorePulse && shortCanFire;

    if (longCorePulse || longEarlyPulse) {
      lastLongSignalBar = i;
      lastLongTrigger = triggerTypeLong;
    }
    if (shortCorePulse || shortEarlyPulse) {
      lastShortSignalBar = i;
      lastShortTrigger = triggerTypeShort;
    }

    const coherence = clamp01((0.42 * Math.max(structureAlignmentLong, structureAlignmentShort)) + (0.30 * Math.max(directionalPressureLong, directionalPressureShort)) + (0.28 * Math.max(continuationPressureLong, continuationPressureShort)));
    const transitionRisk = marketState === "TRANSITION"
      ? clamp01(1 - ((Math.max(structureAlignmentLong, structureAlignmentShort) + Math.max(directionalPressureLong, directionalPressureShort) + Math.max(continuationPressureLong, continuationPressureShort)) / 3))
      : marketState === "RANGE"
        ? 0.60
        : marketState === "CHAOS"
          ? 0.88
          : 0.24;
    const fieldAlignment = Math.max(structureAlignmentLong, structureAlignmentShort);
    const domainWallDensity = clamp01(marketState === "RANGE" ? 0.56 : marketState === "TRANSITION" ? 0.44 : marketState === "CHAOS" ? 0.68 : 0.22);
    const susceptibility = clamp01((0.45 * (1 - participation)) + (0.35 * transitionRisk) + (0.20 * (1 - coherence)));
    const entropy = clamp01(marketState === "CHAOS" ? 0.82 : marketState === "RANGE" ? 0.60 : marketState === "TRANSITION" ? 0.56 : 0.34);
    const freeEnergy = clamp01((0.35 * entropy) + (0.30 * transitionRisk) + (0.20 * domainWallDensity) + (0.15 * (1 - coherence)));

    const emitted = [];
    if (longCorePulse) {
      emitted.push(buildNativeSignal({
        exchange,
        symbol,
        tf,
        barMs: candles[i].timestamp,
        direction: "LONG",
        grade: "CORE",
        opportunity: longOpportunity,
        marketState,
        htfBias,
        triggerType: triggerTypeLong,
        riskMode: riskModeLongCore,
        rr: longRr,
        stopPrice: longStop,
        targetPrice: longTarget,
        structureAlignment: structureAlignmentLong,
        directionalPressure: directionalPressureLong,
        continuationPressure: continuationPressureLong,
        participation,
        pullbackQuality: pullbackQualityLong,
        riskEfficiency: riskEfficiencyLong,
        transitionRisk,
        coherence,
        fieldAlignment,
        domainWallDensity,
        freeEnergy,
        susceptibility,
      }));
    } else if (longEarlyPulse) {
      emitted.push(buildNativeSignal({
        exchange,
        symbol,
        tf,
        barMs: candles[i].timestamp,
        direction: "LONG",
        grade: "EARLY",
        opportunity: longOpportunity,
        marketState,
        htfBias,
        triggerType: triggerTypeLong,
        riskMode: riskModeLongEarly,
        rr: longRr,
        stopPrice: longStop,
        targetPrice: longTarget,
        structureAlignment: structureAlignmentLong,
        directionalPressure: directionalPressureLong,
        continuationPressure: continuationPressureLong,
        participation,
        pullbackQuality: pullbackQualityLong,
        riskEfficiency: riskEfficiencyLong,
        transitionRisk,
        coherence,
        fieldAlignment,
        domainWallDensity,
        freeEnergy,
        susceptibility,
      }));
    }

    if (shortCorePulse) {
      emitted.push(buildNativeSignal({
        exchange,
        symbol,
        tf,
        barMs: candles[i].timestamp,
        direction: "SHORT",
        grade: "CORE",
        opportunity: shortOpportunity,
        marketState,
        htfBias,
        triggerType: triggerTypeShort,
        riskMode: riskModeShortCore,
        rr: shortRr,
        stopPrice: shortStop,
        targetPrice: shortTarget,
        structureAlignment: structureAlignmentShort,
        directionalPressure: directionalPressureShort,
        continuationPressure: continuationPressureShort,
        participation,
        pullbackQuality: pullbackQualityShort,
        riskEfficiency: riskEfficiencyShort,
        transitionRisk,
        coherence,
        fieldAlignment,
        domainWallDensity,
        freeEnergy,
        susceptibility,
      }));
    } else if (shortEarlyPulse) {
      emitted.push(buildNativeSignal({
        exchange,
        symbol,
        tf,
        barMs: candles[i].timestamp,
        direction: "SHORT",
        grade: "EARLY",
        opportunity: shortOpportunity,
        marketState,
        htfBias,
        triggerType: triggerTypeShort,
        riskMode: riskModeShortEarly,
        rr: shortRr,
        stopPrice: shortStop,
        targetPrice: shortTarget,
        structureAlignment: structureAlignmentShort,
        directionalPressure: directionalPressureShort,
        continuationPressure: continuationPressureShort,
        participation,
        pullbackQuality: pullbackQualityShort,
        riskEfficiency: riskEfficiencyShort,
        transitionRisk,
        coherence,
        fieldAlignment,
        domainWallDensity,
        freeEnergy,
        susceptibility,
      }));
    }

    results[i] = {
      emitted,
      marketState,
      htfBias,
      longOpportunity,
      shortOpportunity,
      triggerTypeLong,
      triggerTypeShort,
      diagnostics: {
        timestamp: candles[i].timestamp,
        close,
        open,
        high,
        low,
        atrNow,
        atrRatio,
        volRatio,
        trendStrengthRaw,
        pricePosition,
        bodyRatio,
        upperWickRatio,
        lowerWickRatio,
        stateBull,
        stateBear,
        stateTransition,
        stateChaos,
        stateDead,
        transitionBiasLong,
        transitionBiasShort,
        structureAlignmentLong,
        structureAlignmentShort,
        directionalPressureLong,
        directionalPressureShort,
        pullbackQualityLong,
        pullbackQualityShort,
        participation,
        antiChopGate,
        continuationPressureLong,
        continuationPressureShort,
        riskEfficiencyLong,
        riskEfficiencyShort,
        transitionCoreQualityLong,
        transitionCoreQualityShort,
        longOpportunity,
        shortOpportunity,
        pullbackDepthOkLong,
        pullbackDepthOkShort,
        triggerBreakoutLong,
        triggerReclaimLong,
        triggerContinuationLong,
        triggerBreakdownShort,
        triggerLossShort,
        triggerContinuationShort,
        triggerTypeLong,
        triggerTypeShort,
        longRr,
        shortRr,
        extensionLongBlock,
        extensionShortBlock,
        htfConflictLong,
        htfConflictShort,
        hardBlockLong,
        hardBlockShort,
        riskOkLongEarly,
        riskOkShortEarly,
        riskOkLongCore,
        riskOkShortCore,
        riskModeLongEarly,
        riskModeShortEarly,
        riskModeLongCore,
        riskModeShortCore,
        longEarlyRaw,
        longCoreRaw,
        shortEarlyRaw,
        shortCoreRaw,
        longCanFire,
        shortCanFire,
        longCorePulse,
        shortCorePulse,
        longEarlyPulse,
        shortEarlyPulse,
      },
    };
  }

  return results;
}

function buildServerNativeInitialSignals({ exchange, symbol, tf, bars, htfBars, barCloseMs } = {}) {
  const evaluated = evaluateSignalsForBars({ exchange, symbol, tf, bars, htfBars });
  if (!evaluated.length) return [];
  if (Number.isFinite(barCloseMs)) {
    const matched = evaluated.find((row) => Number(row && row.diagnostics && row.diagnostics.timestamp) === Number(barCloseMs));
    if (!matched || !Array.isArray(matched.emitted) || !matched.emitted.length) return [];
    return matched.emitted.filter((signal) => Number(signal && signal.features && signal.features.signal_bar_close_time_utc_ms) === Number(barCloseMs));
  }
  const last = evaluated[evaluated.length - 1];
  if (!last || !Array.isArray(last.emitted) || !last.emitted.length) return [];
  return last.emitted;
}

module.exports = {
  HTF_TF,
  STRATEGY_ID,
  buildServerNativeInitialSignals,
  minBaseBarsForDerivedHtf,
  __test: {
    normalizeBars,
    tfToMs,
    deriveHigherTimeframeBars,
    resolveEffectiveHtfBars,
    resolveHtfBias,
    evaluateSignalsForBars,
  },
};
