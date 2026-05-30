"use strict";

const { normalizeSignalForV3, evaluateV3SignalPolicy } = require("./signalPolicy");

// 2026-05-30 — side-specific take-profit distance (RR), evidence-driven.
// A full 1m-path RR sweep over 296 closed paper trades
// (scripts/analyze-v3-rr-sweep.js) showed LONG and SHORT want OPPOSITE
// target distances in the BEAR-dominated sample:
//   SHORT: tightening RR 1.55 -> 1.2 lifts WR 45.8% -> 53.6% AND raises
//          expectancy +0.167R -> +0.180R AND net +27.8R -> +29.8R.
//          (downside momentum reaches a near target fast; waiting for the
//           far target gives back gains on reversals.)
//   LONG:  expectancy is best at the WIDE target (RR 1.55, +0.098R); every
//          tighter RR lowers expectancy and only crosses 50% WR at RR 0.8
//          where it turns money-losing (-0.072R). LONG has no real edge in
//          this sample, so it keeps the wider 1.55 target (operator
//          decision 2026-05-30: keep LONG profitable rather than force a
//          loss-making 50% WR).
// Both are env-overridable so the next regime can be retuned without a
// code change.
function resolveRawRr(side) {
  const env = side === "SHORT"
    ? Number(process.env.V3_RAW_RR_SHORT)
    : Number(process.env.V3_RAW_RR_LONG);
  if (Number.isFinite(env) && env > 0) return env;
  return side === "SHORT" ? 1.2 : 1.55;
}

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function clamp(value, min = 0, max = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function toDirectionalLabel(value) {
  const normalized = upper(value);
  if (normalized === "BULL") return "LONG";
  if (normalized === "BEAR") return "SHORT";
  return normalized || null;
}

function mean(values = []) {
  const nums = values.map(toNumberOrNull).filter((value) => value !== null);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function ema(values = [], period) {
  const nums = values.map(toNumberOrNull).filter((value) => value !== null);
  if (!nums.length || nums.length < period) return null;
  const multiplier = 2 / (period + 1);
  let current = nums[0];
  for (let index = 1; index < nums.length; index += 1) {
    current = ((nums[index] - current) * multiplier) + current;
  }
  return current;
}

function atr(bars = [], period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const ranges = [];
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index];
    const previous = bars[index - 1];
    const high = toNumberOrNull(current && current.high);
    const low = toNumberOrNull(current && current.low);
    const prevClose = toNumberOrNull(previous && previous.close);
    if (high === null || low === null || prevClose === null) continue;
    ranges.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));
  }
  if (ranges.length < period) return null;
  return mean(ranges.slice(-period));
}

function maxOf(values = []) {
  const nums = values.map(toNumberOrNull).filter((value) => value !== null);
  return nums.length ? Math.max(...nums) : null;
}

function minOf(values = []) {
  const nums = values.map(toNumberOrNull).filter((value) => value !== null);
  return nums.length ? Math.min(...nums) : null;
}

function parseBars(rawBars = []) {
  return Object.freeze(
    (Array.isArray(rawBars) ? rawBars : [])
      .map((row) => {
        if (!Array.isArray(row) || row.length < 7) return null;
        return Object.freeze({
          open_time_ms: Number(row[0]),
          close_time_ms: Number(row[6]),
          open: toNumberOrNull(row[1]),
          high: toNumberOrNull(row[2]),
          low: toNumberOrNull(row[3]),
          close: toNumberOrNull(row[4]),
          volume: toNumberOrNull(row[5]),
        });
      })
      .filter((row) => row && row.close !== null && row.high !== null && row.low !== null)
  );
}

function selectClosedBars(bars = [], nowMs = Date.now()) {
  return Object.freeze(
    (Array.isArray(bars) ? bars : [])
      .filter((row) => row && Number.isFinite(row.close_time_ms))
      .filter((row) => nowMs > row.close_time_ms)
  );
}

function deriveMarketState(ema20, ema50, ema200, close) {
  if (![ema20, ema50, ema200, close].every(Number.isFinite)) return null;
  const spreadFast = Math.abs(ema20 - ema50) / close;
  const spreadSlow = Math.abs(ema50 - ema200) / close;
  if (ema20 > ema50 && ema50 > ema200 && spreadFast >= 0.0015 && spreadSlow >= 0.001) return "BULL";
  if (ema20 < ema50 && ema50 < ema200 && spreadFast >= 0.0015 && spreadSlow >= 0.001) return "BEAR";
  if (spreadFast <= 0.0012 && spreadSlow <= 0.0012) return "RANGE";
  return "TRANSITION";
}

function deriveHtfBias(ema20, ema50, ema200) {
  if (![ema20, ema50, ema200].every(Number.isFinite)) return null;
  if (ema20 > ema50 && ema50 > ema200) return "BULL";
  if (ema20 < ema50 && ema50 < ema200) return "BEAR";
  return "TRANSITION";
}

function buildSnapshot(symbol, bars15m = [], bars1h = [], marketMeta = {}, { nowMs = Date.now() } = {}) {
  const closed15m = selectClosedBars(bars15m, nowMs);
  const closed1h = selectClosedBars(bars1h, nowMs);
  if (!closed15m.length || !closed1h.length) return null;
  const closes15 = closed15m.map((row) => row.close);
  const closes1h = closed1h.map((row) => row.close);
  const last = closed15m[closed15m.length - 1];
  const previous = closed15m[closed15m.length - 2];
  if (!last || !previous) return null;

  const ema20 = ema(closes15, 20);
  const ema50 = ema(closes15, 50);
  const ema200 = ema(closes15, 200);
  const ema20h = ema(closes1h, 20);
  const ema50h = ema(closes1h, 50);
  const ema200h = ema(closes1h, 200);
  const atr14 = atr(closed15m, 14);
  const prior20 = closed15m.slice(-21, -1);
  const prior10 = closed15m.slice(-11, -1);
  const prev20High = maxOf(prior20.map((row) => row.high));
  const prev20Low = minOf(prior20.map((row) => row.low));
  const prev10High = maxOf(prior10.map((row) => row.high));
  const prev10Low = minOf(prior10.map((row) => row.low));
  const avgVolume20 = mean(prior20.map((row) => row.volume));
  const range = Number.isFinite(last.high) && Number.isFinite(last.low) ? last.high - last.low : null;
  const closePosLong = range && range > 0 ? (last.close - last.low) / range : null;
  const closePosShort = range && range > 0 ? (last.high - last.close) / range : null;
  const trendStrength = Number.isFinite(last.close) && last.close > 0 && Number.isFinite(ema20) && Number.isFinite(ema50) && Number.isFinite(ema200)
    ? (Math.abs(ema20 - ema50) + Math.abs(ema50 - ema200)) / last.close
    : null;
  const breakoutAtr = Number.isFinite(atr14) && atr14 > 0 && Number.isFinite(prev20High)
    ? (last.close - prev20High) / atr14
    : null;
  const breakdownAtr = Number.isFinite(atr14) && atr14 > 0 && Number.isFinite(prev20Low)
    ? (prev20Low - last.close) / atr14
    : null;
  const volumeRatio = Number.isFinite(avgVolume20) && avgVolume20 > 0 && Number.isFinite(last.volume)
    ? last.volume / avgVolume20
    : 1;

  const htfBias = deriveHtfBias(ema20h, ema50h, ema200h);
  return Object.freeze({
    symbol: upper(symbol),
    close_time_ms: last.close_time_ms,
    created_at: Number.isFinite(last.close_time_ms) ? new Date(last.close_time_ms).toISOString() : new Date().toISOString(),
    close: last.close,
    high: last.high,
    low: last.low,
    prev_close: previous.close,
    prev20High,
    prev20Low,
    prev10High,
    prev10Low,
    ema20,
    ema50,
    ema200,
    ema20h,
    ema50h,
    ema200h,
    atr14,
    close_pos_long: closePosLong,
    close_pos_short: closePosShort,
    trend_strength: trendStrength,
    breakout_atr: breakoutAtr,
    breakdown_atr: breakdownAtr,
    volume_ratio: volumeRatio,
    market_state: deriveMarketState(ema20, ema50, ema200, last.close),
    htf_bias: htfBias,
    btc_1h_trend: toDirectionalLabel(htfBias),
    mtf_1h_direction: toDirectionalLabel(htfBias),
    spread_bps: toNumberOrNull(marketMeta && marketMeta.spread_bps),
    funding_rate: toNumberOrNull(marketMeta && marketMeta.funding_rate),
  });
}

function buildLevels(side, snapshot, rr = 1.55) {
  if (!snapshot || !Number.isFinite(snapshot.close) || !Number.isFinite(snapshot.atr14)) return null;
  if (side === "LONG") {
    const stop = Math.min(
      Number.isFinite(snapshot.prev10Low) ? snapshot.prev10Low : snapshot.close - snapshot.atr14 * 1.2,
      snapshot.close - snapshot.atr14 * 0.85
    );
    const risk = snapshot.close - stop;
    if (!(risk > 0)) return null;
    return Object.freeze({
      signal_price: round(snapshot.close, 6),
      stop_price: round(stop, 6),
      target_price: round(snapshot.close + (risk * rr), 6),
      rr: round((risk * rr) / risk, 4),
    });
  }
  if (side === "SHORT") {
    const stop = Math.max(
      Number.isFinite(snapshot.prev10High) ? snapshot.prev10High : snapshot.close + snapshot.atr14 * 1.2,
      snapshot.close + snapshot.atr14 * 0.85
    );
    const risk = stop - snapshot.close;
    if (!(risk > 0)) return null;
    return Object.freeze({
      signal_price: round(snapshot.close, 6),
      stop_price: round(stop, 6),
      target_price: round(snapshot.close - (risk * rr), 6),
      rr: round((risk * rr) / risk, 4),
    });
  }
  return null;
}

function scoreBundle(snapshot, { side, setupType, entryGrade, edgeCohort, triggerType, floors = {} }) {
  const aligned = snapshot.htf_bias === (side === "LONG" ? "BULL" : "BEAR") ? 0.9 : (snapshot.htf_bias === "TRANSITION" ? 0.75 : 0.55);
  const trendStrength = clamp((snapshot.trend_strength || 0) * 110, 0, 0.95);
  const thrust = side === "LONG"
    ? clamp((snapshot.breakout_atr || 0) * 0.35 + (snapshot.close_pos_long || 0) * 0.5, 0.35, 0.95)
    : clamp((snapshot.breakdown_atr || 0) * 0.35 + (snapshot.close_pos_short || 0) * 0.5, 0.35, 0.95);
  const volume = clamp(0.45 + Math.max(0, ((snapshot.volume_ratio || 1) - 0.8) * 0.25), 0.35, 0.95);
  const opportunity = clamp((thrust * 0.55) + (trendStrength * 0.25) + (volume * 0.2), 0.4, 0.95);
  const confidence = clamp((trendStrength * 0.35) + (aligned * 0.35) + (thrust * 0.3), 0.45, 0.95);
  const setupQuality = clamp((thrust * 0.45) + (volume * 0.25) + (aligned * 0.3), 0.35, 0.95);
  const structureAlignment = clamp((trendStrength * 0.6) + (aligned * 0.4), 0.35, 0.95);
  const htfAlignmentScore = clamp(aligned, 0.35, 0.95);
  const marketQuality = clamp((volume * 0.5) + (thrust * 0.2) + 0.25, 0.35, 0.95);
  const scored = {
    side,
    setupType,
    entryGrade,
    edgeCohort,
    triggerType,
    opportunity_score: round(Math.max(opportunity, Number(floors.opportunity_score || 0)), 4),
    confidence: round(Math.max(confidence, Number(floors.confidence || 0)), 4),
    setup_quality_score: round(Math.max(setupQuality, Number(floors.setup_quality_score || 0)), 4),
    structure_alignment: round(Math.max(structureAlignment, Number(floors.structure_alignment || 0)), 4),
    htf_alignment_score: round(Math.max(htfAlignmentScore, Number(floors.htf_alignment_score || 0)), 4),
    market_quality_score: round(Math.max(marketQuality, Number(floors.market_quality_score || 0)), 4),
  };
  return Object.freeze(scored);
}

function buildSignalRow(snapshot, score, levels) {
  const side = upper(score.side);
  const event = side;
  const exchangeSide = side === "LONG" ? "BUY" : "SELL";
  const signalId = `V3SIG__BINANCEFUT__${snapshot.symbol}__15m__${snapshot.close_time_ms}__${side}`;
  return Object.freeze({
    signal_id: signalId,
    created_at: snapshot.created_at,
    symbol: snapshot.symbol,
    exchange: "BINANCEFUT",
    tf: "15m",
    event,
    event_intent: "ENTRY",
    side: exchangeSide,
    reason: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
    features_json: Object.freeze({
      setup_type: score.setupType,
      trigger_type: score.triggerType,
      entry_grade: score.entryGrade,
      source_band: score.entryGrade,
      market_state: snapshot.market_state,
      htf_bias: snapshot.htf_bias,
      risk_mode: "PASS",
      opportunity_score: score.opportunity_score,
      confidence: score.confidence,
      setup_quality_score: score.setup_quality_score,
      structure_alignment: score.structure_alignment,
      htf_alignment_score: score.htf_alignment_score,
      market_quality_score: score.market_quality_score,
      spread_bps: snapshot.spread_bps,
      funding_rate: snapshot.funding_rate,
      btc_1h_trend: snapshot.btc_1h_trend,
      mtf_1h_direction: snapshot.mtf_1h_direction,
      feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
      rr: levels.rr,
      signal_price: levels.signal_price,
      stop_price: levels.stop_price,
      target_price: levels.target_price,
      edge_cohort: score.edgeCohort,
      structural_regime: snapshot.market_state === "BULL" || snapshot.market_state === "BEAR" ? "TREND" : snapshot.market_state,
    }),
  });
}

function generateCandidates(snapshot) {
  const candidates = [];
  if (!snapshot || !Number.isFinite(snapshot.close) || !Number.isFinite(snapshot.atr14) || snapshot.atr14 <= 0) return candidates;

  const longLevels = buildLevels("LONG", snapshot, resolveRawRr("LONG"));
  const shortLevels = buildLevels("SHORT", snapshot, resolveRawRr("SHORT"));

  const trendUp = snapshot.market_state === "BULL" && snapshot.htf_bias === "BULL" && snapshot.close > snapshot.ema20;
  const breakoutLong = Number.isFinite(snapshot.breakout_atr) && snapshot.breakout_atr >= 0.08;
  const continuationLong = trendUp && (snapshot.close_pos_long || 0) >= 0.54 && snapshot.close > (snapshot.prev_close || -Infinity);

  if (trendUp && continuationLong && longLevels) {
    const edge = (snapshot.trend_strength || 0) >= 0.009 && (snapshot.volume_ratio || 1) >= 1.05 ? "BUILDABLE_EDGE" : "MARGINAL_EDGE";
    const coreOk = (snapshot.close_pos_long || 0) >= 0.62;
    if (coreOk) {
      const score = scoreBundle(snapshot, {
        side: "LONG",
        setupType: "CONTINUATION",
        entryGrade: "CORE",
        edgeCohort: edge,
        triggerType: "CONTINUATION",
        floors: edge === "BUILDABLE_EDGE"
          ? { opportunity_score: 0.79, confidence: 0.79, setup_quality_score: 0.89, structure_alignment: 0.91, htf_alignment_score: 0.91, market_quality_score: 0.81 }
          : { opportunity_score: 0.73, confidence: 0.73, setup_quality_score: 0.73, structure_alignment: 0.73, htf_alignment_score: 0.73 },
      });
      candidates.push(buildSignalRow(snapshot, score, longLevels));
    }
  }

  if (snapshot.market_state === "BULL" && snapshot.htf_bias === "BULL" && breakoutLong && longLevels) {
    const coreOk = (snapshot.breakout_atr || 0) >= 0.16 && (snapshot.close_pos_long || 0) >= 0.58;
    const score = scoreBundle(snapshot, {
      side: "LONG",
      setupType: "BREAKOUT",
      entryGrade: coreOk ? "CORE" : "EARLY",
      edgeCohort: "MARGINAL_EDGE",
      triggerType: "BREAKOUT",
      floors: coreOk
        ? { opportunity_score: 0.71, confidence: 0.71, setup_quality_score: 0.69, structure_alignment: 0.73, htf_alignment_score: 0.73 }
        : { opportunity_score: 0.69, confidence: 0.69, setup_quality_score: 0.56, structure_alignment: 0.56, htf_alignment_score: 0.56 },
    });
    candidates.push(buildSignalRow(snapshot, score, longLevels));
  }

  if (snapshot.market_state === "RANGE" && snapshot.htf_bias === "BULL" && breakoutLong && (snapshot.close_pos_long || 0) >= 0.55 && longLevels) {
    const score = scoreBundle(snapshot, {
      side: "LONG",
      setupType: "BREAKOUT",
      entryGrade: "EARLY",
      edgeCohort: "MARGINAL_EDGE",
      triggerType: "BREAKOUT",
      floors: { opportunity_score: 0.65, confidence: 0.65, setup_quality_score: 0.41, structure_alignment: 0.36, htf_alignment_score: 0.36 },
    });
    candidates.push(buildSignalRow(snapshot, score, longLevels));
  }

  if (snapshot.market_state === "TRANSITION" && snapshot.htf_bias === "BULL" && breakoutLong && (snapshot.close_pos_long || 0) >= 0.57 && longLevels) {
    const score = scoreBundle(snapshot, {
      side: "LONG",
      setupType: "BREAKOUT",
      entryGrade: "EARLY",
      edgeCohort: "BUILDABLE_EDGE",
      triggerType: "BREAKOUT",
      floors: { opportunity_score: 0.69, confidence: 0.69, setup_quality_score: 0.61, structure_alignment: 0.76, htf_alignment_score: 0.76 },
    });
    candidates.push(buildSignalRow(snapshot, score, longLevels));
  }

  const trendDown = snapshot.market_state === "BEAR" && snapshot.htf_bias === "BEAR" && snapshot.close < snapshot.ema20;
  const continuationShort = trendDown && (snapshot.close_pos_short || 0) >= 0.54 && snapshot.close < (snapshot.prev_close || Infinity);

  if (trendDown && continuationShort && shortLevels) {
    const score = scoreBundle(snapshot, {
      side: "SHORT",
      setupType: "CONTINUATION",
      entryGrade: "CORE",
      edgeCohort: "MARGINAL_EDGE",
      triggerType: "CONTINUATION",
      floors: { opportunity_score: 0.73, confidence: 0.73, setup_quality_score: 0.73, structure_alignment: 0.73, htf_alignment_score: 0.73 },
    });
    candidates.push(buildSignalRow(snapshot, score, shortLevels));
  }

  return Object.freeze(candidates);
}

function selectBestCandidate(rows = []) {
  const evaluated = [];
  for (const row of rows) {
    const normalized = normalizeSignalForV3(row);
    const verdict = evaluateV3SignalPolicy(normalized);
    evaluated.push(Object.freeze({
      row,
      normalized,
      verdict,
      score: (normalized.opportunity_score || 0) + (normalized.confidence || 0),
    }));
  }
  const allowed = evaluated
    .filter((entry) => entry.verdict && entry.verdict.ok)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  if (!allowed.length) {
    return Object.freeze({
      ok: false,
      reason: evaluated.length ? "V3_SOURCE_POLICY_REJECTED" : "V3_SOURCE_NO_PATTERN",
      evaluated,
      signal: null,
      verdict: null,
    });
  }
  return Object.freeze({
    ok: true,
    reason: "V3_SOURCE_SIGNAL_READY",
    evaluated,
    signal: allowed[0].row,
    verdict: allowed[0].verdict,
  });
}

function generateV3SourceSignalForSymbol({ symbol, bars15m = [], bars1h = [], marketMeta = {}, nowMs = Date.now() } = {}) {
  const parsed15m = parseBars(bars15m);
  const parsed1h = parseBars(bars1h);
  const snapshot = buildSnapshot(symbol, parsed15m, parsed1h, marketMeta, { nowMs });
  if (!snapshot) {
    return Object.freeze({
      ok: false,
      symbol: upper(symbol),
      reason: "V3_SOURCE_MARKET_DATA_INSUFFICIENT",
      snapshot: null,
      signal: null,
      verdict: null,
    });
  }
  const candidates = generateCandidates(snapshot);
  const selected = selectBestCandidate(candidates);
  return Object.freeze({
    ok: selected.ok,
    symbol: snapshot.symbol,
    reason: selected.reason,
    snapshot: Object.freeze({
      market_state: snapshot.market_state,
      htf_bias: snapshot.htf_bias,
      close: round(snapshot.close, 6),
      atr14: round(snapshot.atr14, 6),
      trend_strength: round(snapshot.trend_strength, 6),
      breakout_atr: round(snapshot.breakout_atr, 6),
      breakdown_atr: round(snapshot.breakdown_atr, 6),
      volume_ratio: round(snapshot.volume_ratio, 4),
    }),
    candidate_n: candidates.length,
    signal: selected.signal,
    verdict: selected.verdict,
  });
}

function buildClosedBarWindows(rawBars = [], nowMs = Date.now()) {
  const windows = [];
  for (let index = 0; index < (Array.isArray(rawBars) ? rawBars.length : 0); index += 1) {
    const row = rawBars[index];
    if (!Array.isArray(row) || row.length < 7) continue;
    const closeTimeMs = Number(row[6]);
    if (!Number.isFinite(closeTimeMs)) continue;
    if (!(nowMs > closeTimeMs)) continue;
    windows.push(Object.freeze({
      index,
      close_time_ms: closeTimeMs,
      created_at: new Date(closeTimeMs).toISOString(),
    }));
  }
  return Object.freeze(windows);
}

function generateV3SourceSignalsForSymbolWindow({
  symbol,
  bars15m = [],
  bars1h = [],
  marketMeta = {},
  nowMs = Date.now(),
  sinceCreatedAt = null,
} = {}) {
  const sinceMs = Date.parse(String(sinceCreatedAt || ""));
  const windows = buildClosedBarWindows(bars15m, nowMs)
    .filter((row) => !Number.isFinite(sinceMs) || row.close_time_ms > sinceMs);
  const decisions = windows.map((window) => {
    const decision = generateV3SourceSignalForSymbol({
      symbol,
      bars15m: bars15m.slice(0, window.index + 1),
      bars1h,
      marketMeta,
      nowMs: window.close_time_ms + 1,
    });
    return Object.freeze({
      ...decision,
      close_time_ms: window.close_time_ms,
      created_at: window.created_at,
    });
  });
  const signals = decisions
    .filter((row) => row && row.ok && row.signal)
    .map((row) => row.signal);
  return Object.freeze({
    ok: signals.length > 0,
    symbol: upper(symbol),
    reason: signals.length > 0 ? "V3_SOURCE_SIGNAL_WINDOW_READY" : "V3_SOURCE_NO_PATTERN_IN_WINDOW",
    evaluated_bar_n: windows.length,
    generated_signal_n: signals.length,
    signals: Object.freeze(signals),
    decision_summaries: Object.freeze(
      decisions.map((row) => Object.freeze({
        ok: row.ok,
        reason: row.reason,
        close_time_ms: row.close_time_ms,
        created_at: row.created_at,
        candidate_n: row.candidate_n,
        verdict: row.verdict,
        snapshot: row.snapshot,
      }))
    ),
  });
}

module.exports = Object.freeze({
  generateV3SourceSignalForSymbol,
  generateV3SourceSignalsForSymbolWindow,
  __test: {
    parseBars,
    selectClosedBars,
    buildClosedBarWindows,
    ema,
    atr,
    buildSnapshot,
    generateCandidates,
    selectBestCandidate,
  },
});
