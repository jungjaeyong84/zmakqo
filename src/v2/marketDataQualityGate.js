"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveMarketDataQualityPolicy(env = process.env) {
  return Object.freeze({
    max_candle_age_ms: toNumberOrNull(env.DONBEOLJA_V2_MARKET_DATA_MAX_CANDLE_AGE_MS) || 180000,
    max_mark_index_divergence_bps: toNumberOrNull(env.DONBEOLJA_V2_MARKET_DATA_MAX_MARK_INDEX_DIVERGENCE_BPS) || 35,
    max_spread_bps: toNumberOrNull(env.DONBEOLJA_V2_MARKET_DATA_MAX_SPREAD_BPS) || 20,
    min_volume_quote_24h: toNumberOrNull(env.DONBEOLJA_V2_MARKET_DATA_MIN_VOLUME_QUOTE_24H) || 1000000,
    max_gap_bars: Math.floor(toNumberOrNull(env.DONBEOLJA_V2_MARKET_DATA_MAX_GAP_BARS) || 0),
  });
}

function bpsDiff(a, b) {
  const x = toNumberOrNull(a);
  const y = toNumberOrNull(b);
  if (!(x > 0) || !(y > 0)) return null;
  return Math.abs(x - y) / ((x + y) / 2) * 10000;
}

function evaluateMarketDataQualityGate({
  env = process.env,
  policy = resolveMarketDataQualityPolicy(env),
  snapshot = {},
  nowMs = Date.now(),
} = {}) {
  const row = snapshot && typeof snapshot === "object" ? snapshot : {};
  const blockers = [];
  const warnings = [];
  const symbol = trimOrNull(row.symbol);
  const candleCloseMs = toNumberOrNull(row.candle_close_ms ?? row.candleCloseMs ?? row.last_candle_close_ms);
  const candleAgeMs = candleCloseMs == null ? null : Math.max(0, Number(nowMs) - candleCloseMs);
  const markPrice = toNumberOrNull(row.mark_price ?? row.markPrice);
  const indexPrice = toNumberOrNull(row.index_price ?? row.indexPrice);
  const bid = toNumberOrNull(row.best_bid ?? row.bestBid);
  const ask = toNumberOrNull(row.best_ask ?? row.bestAsk);
  const volumeQuote24h = toNumberOrNull(row.volume_quote_24h ?? row.quoteVolume24h);
  const gapBars = toNumberOrNull(row.gap_bars ?? row.gapBars) || 0;
  const markIndexDivergenceBps = bpsDiff(markPrice, indexPrice);
  const spreadBps = bpsDiff(ask, bid);

  if (!symbol) blockers.push("MARKET_DATA:SYMBOL_REQUIRED");
  if (!(candleCloseMs > 0)) blockers.push("MARKET_DATA:CANDLE_TIMESTAMP_REQUIRED");
  if (candleAgeMs != null && candleAgeMs > policy.max_candle_age_ms) blockers.push("MARKET_DATA:STALE_CANDLE");
  if (!(markPrice > 0)) blockers.push("MARKET_DATA:MARK_PRICE_REQUIRED");
  if (!(indexPrice > 0)) blockers.push("MARKET_DATA:INDEX_PRICE_REQUIRED");
  if (markIndexDivergenceBps != null && markIndexDivergenceBps > policy.max_mark_index_divergence_bps) blockers.push("MARKET_DATA:MARK_INDEX_DIVERGENCE");
  if (!(bid > 0) || !(ask > 0) || ask < bid) blockers.push("MARKET_DATA:BID_ASK_INVALID");
  if (spreadBps != null && spreadBps > policy.max_spread_bps) blockers.push("MARKET_DATA:SPREAD_TOO_WIDE");
  if (!(volumeQuote24h >= policy.min_volume_quote_24h)) blockers.push("MARKET_DATA:VOLUME_TOO_LOW");
  if (gapBars > policy.max_gap_bars) blockers.push("MARKET_DATA:CANDLE_GAP_DETECTED");
  if (row.source && String(row.source).toUpperCase().includes("FALLBACK")) warnings.push("MARKET_DATA:FALLBACK_SOURCE_USED");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_MARKET_DATA_QUALITY_PASS" : "V2_MARKET_DATA_QUALITY_BLOCKED",
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(Array.from(new Set(warnings))),
    policy,
    metrics: Object.freeze({
      symbol,
      candle_age_ms: candleAgeMs,
      mark_index_divergence_bps: markIndexDivergenceBps,
      spread_bps: spreadBps,
      volume_quote_24h: volumeQuote24h,
      gap_bars: gapBars,
    }),
  });
}

module.exports = {
  resolveMarketDataQualityPolicy,
  evaluateMarketDataQualityGate,
  __test: { trimOrNull, toNumberOrNull, bpsDiff },
};
