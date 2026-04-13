"use strict";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readSummary(doc = null) {
  if (!doc || typeof doc !== "object") return {};
  if (doc.summary && typeof doc.summary === "object") return doc.summary;
  return doc;
}

function severityForMetric(value, warnThreshold, criticalThreshold) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return "UNKNOWN";
  if (Number.isFinite(criticalThreshold) && n >= criticalThreshold) return "CRITICAL";
  if (Number.isFinite(warnThreshold) && n >= warnThreshold) return "WARN";
  return "OK";
}

function firstByMarket(rows = [], market = "") {
  const target = String(market || "").trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).find((row) => String(row && row.market || "").trim().toUpperCase() === target) || null;
}

function buildRecommendedActions(row = {}) {
  const actions = [];
  if (row.partial_fill_severity === "CRITICAL") actions.push("REDUCE_MULTI_SLICE_FRAGMENTATION");
  if (row.slippage_severity === "CRITICAL") actions.push("LIMIT_CHASING_AND_REPRICE");
  if (row.latency_severity === "CRITICAL" || row.latency_severity === "WARN") actions.push("TRIM_INTENT_TO_FILL_DELAY_PATH");
  if (row.top_entry_fallback_latency_group) actions.push("REDUCE_FALLBACK_MATCH_PATH");
  if (row.top_no_fill_market_bucket) actions.push("INSPECT_RUNTIME_NO_FILL_BUCKET");
  return Array.from(new Set(actions));
}

function buildExecutionQualityWatchReport({
  executionQuality = null,
  executionModelDataset = null,
  limit = 6,
} = {}) {
  const quality = readSummary(executionQuality);
  const model = readSummary(executionModelDataset);
  const watchMarkets = Array.isArray(quality.top_watch_markets) ? quality.top_watch_markets.slice(0, Math.max(1, Number(limit) || 6)) : [];
  const topSignalToIntentGroups = Array.isArray(model.top_operational_signal_to_intent_groups) ? model.top_operational_signal_to_intent_groups : [];
  const topMeasuredLatencyGroups = Array.isArray(model.top_entry_measured_latency_groups) ? model.top_entry_measured_latency_groups : [];
  const topFallbackLatencyGroups = Array.isArray(model.top_entry_fallback_latency_groups) ? model.top_entry_fallback_latency_groups : [];
  const topNoFillMarketBuckets = Array.isArray(model.top_no_fill_market_buckets) ? model.top_no_fill_market_buckets : [];

  const markets = watchMarkets.map((row, index) => {
    const market = String(row && row.market || "").trim().toUpperCase();
    const partialFillRatePct = toNum(row && row.partial_fill_rate_pct);
    const avgSlippageBps = toNum(row && row.avg_slippage_bps);
    const avgCreatedToFillMs = toNum(row && row.avg_created_to_fill_ms);
    const topSignalToIntentGroup = firstByMarket(topSignalToIntentGroups, market);
    const topMeasuredLatencyGroup = firstByMarket(topMeasuredLatencyGroups, market);
    const topFallbackLatencyGroup = firstByMarket(topFallbackLatencyGroups, market);
    const topNoFillMarketBucket = firstByMarket(topNoFillMarketBuckets, market);
    const payload = {
      rank: index + 1,
      market,
      avg_created_to_fill_ms: avgCreatedToFillMs,
      avg_slippage_bps: avgSlippageBps,
      partial_fill_rate_pct: partialFillRatePct,
      latency_severity: severityForMetric(avgCreatedToFillMs, 120000, 300000),
      slippage_severity: severityForMetric(avgSlippageBps, 2, 5),
      partial_fill_severity: severityForMetric(partialFillRatePct, 35, 60),
      top_operational_signal_to_intent_group: topSignalToIntentGroup ? {
        key: topSignalToIntentGroup.key || null,
        rows_n: toNum(topSignalToIntentGroup.rows_n),
        signal_to_intent_p95_ms: toNum(topSignalToIntentGroup.signal_to_intent_p95_ms),
      } : null,
      top_entry_measured_latency_group: topMeasuredLatencyGroup ? {
        key: topMeasuredLatencyGroup.key || null,
        rows_n: toNum(topMeasuredLatencyGroup.rows_n),
        created_to_fill_p95_ms: toNum(topMeasuredLatencyGroup.created_to_fill_p95_ms),
      } : null,
      top_entry_fallback_latency_group: topFallbackLatencyGroup ? {
        key: topFallbackLatencyGroup.key || null,
        rows_n: toNum(topFallbackLatencyGroup.rows_n),
        created_to_fill_p95_ms: toNum(topFallbackLatencyGroup.created_to_fill_p95_ms),
      } : null,
      top_no_fill_market_bucket: topNoFillMarketBucket ? {
        key: topNoFillMarketBucket.key || null,
        family: topNoFillMarketBucket.family || null,
        reason: topNoFillMarketBucket.reason || null,
        subtype: topNoFillMarketBucket.subtype || null,
        rows_n: toNum(topNoFillMarketBucket.rows_n),
      } : null,
    };
    payload.recommended_actions = buildRecommendedActions(payload);
    return payload;
  });

  return {
    summary: {
      status: markets.some((row) => row.recommended_actions.length > 0) ? "EXECUTION_WATCH_MARKETS_REVIEW" : "EXECUTION_WATCH_MARKETS_STABLE",
      review_market_n: markets.length,
      top_partial_driver_market: quality.root_cause && quality.root_cause.partial_fill ? quality.root_cause.partial_fill.driver_market || null : null,
      top_slippage_driver_market: quality.root_cause && quality.root_cause.slippage ? quality.root_cause.slippage.driver_market || null : null,
      top_no_fill_bucket: Array.isArray(model.top_no_fill_buckets) && model.top_no_fill_buckets[0] ? model.top_no_fill_buckets[0] : null,
      top_watch_market: markets[0] ? markets[0].market : null,
    },
    markets,
  };
}

module.exports = {
  buildExecutionQualityWatchReport,
};
