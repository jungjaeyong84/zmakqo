"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Date.parse(String(value));
  return Number.isFinite(n) ? n : null;
}

function normalizeVenue(row = null) {
  return String(row && (row.exchange || row.provider || row.market_source) || "").trim().toUpperCase();
}

function allowVenue(venue = "") {
  if (!venue) return true;
  return venue === "BINANCEFUT";
}

function summarizeExecutionQuality({
  microstructure = null,
  bridgeLatency = null,
  fills = [],
  intents = [],
} = {}) {
  const micro = microstructure && typeof microstructure === "object" ? microstructure : {};
  const metrics = micro.metrics && typeof micro.metrics === "object" ? micro.metrics : {};
  const latency = metrics.latency && typeof metrics.latency === "object" ? metrics.latency : {};
  const slippage = metrics.slippage && typeof metrics.slippage === "object" ? metrics.slippage : {};
  const partial = metrics.partial_fill && typeof metrics.partial_fill === "object" ? metrics.partial_fill : {};
  const bridge = bridgeLatency && typeof bridgeLatency === "object" ? bridgeLatency : {};
  const fillDocs = (Array.isArray(fills) ? fills : []).filter((row) => allowVenue(normalizeVenue(row)));
  const intentDocs = (Array.isArray(intents) ? intents : []).filter((row) => allowVenue(normalizeVenue(row)));

  const intentsById = new Map();
  for (const row of intentDocs) {
    const key = String(row && (row.intent_id || row.id) || "").trim();
    if (key) intentsById.set(key, row);
  }

  const byMarket = new Map();
  for (const fill of fillDocs) {
    const market = String(fill && (fill.symbol || fill.symbol_or_pair_id) || "").trim().toUpperCase();
    if (!market) continue;
    const row = byMarket.get(market) || {
      market,
      fill_n: 0,
      slippage_bps_sum: 0,
      slippage_bps_n: 0,
      created_to_fill_ms_sum: 0,
      created_to_fill_ms_n: 0,
      partial_fill_n: 0,
      intent_seen: new Set(),
      fill_count_by_intent: new Map(),
    };
    row.fill_n += 1;
    const slippageBps = toNum(fill && fill.slippage_bps);
    if (slippageBps != null) {
      row.slippage_bps_sum += slippageBps;
      row.slippage_bps_n += 1;
    }
    const intentId = String(fill && fill.intent_id || "").trim();
    const fillCreatedMs = toIsoMs(fill && fill.created_at);
    const intent = intentId ? intentsById.get(intentId) : null;
    const intentCreatedMs = intent ? toIsoMs(intent.created_at) : null;
    if (fillCreatedMs != null && intentCreatedMs != null && fillCreatedMs >= intentCreatedMs) {
      row.created_to_fill_ms_sum += (fillCreatedMs - intentCreatedMs);
      row.created_to_fill_ms_n += 1;
    }
    if (intentId) {
      row.intent_seen.add(intentId);
      row.fill_count_by_intent.set(intentId, (row.fill_count_by_intent.get(intentId) || 0) + 1);
    }
    byMarket.set(market, row);
  }

  const rows = Array.from(byMarket.values()).map((row) => {
    const partialFillN = Array.from(row.fill_count_by_intent.values()).filter((count) => count > 1).length;
    const intentCount = row.intent_seen.size;
    return {
      market: row.market,
      fill_n: row.fill_n,
      intent_n: intentCount,
      avg_slippage_bps: row.slippage_bps_n > 0 ? row.slippage_bps_sum / row.slippage_bps_n : null,
      avg_created_to_fill_ms: row.created_to_fill_ms_n > 0 ? row.created_to_fill_ms_sum / row.created_to_fill_ms_n : null,
      partial_fill_intent_n: partialFillN,
      partial_fill_rate_pct: intentCount > 0 ? (partialFillN / intentCount) * 100 : null,
    };
  }).sort((a, b) => {
    const latencyDelta = (toNum(b.avg_created_to_fill_ms) || -Infinity) - (toNum(a.avg_created_to_fill_ms) || -Infinity);
    if (latencyDelta !== 0) return latencyDelta;
    return String(a.market || "").localeCompare(String(b.market || ""));
  });

  const topLatency = rows
    .filter((row) => Number.isFinite(toNum(row.avg_created_to_fill_ms)))
    .sort((a, b) => (toNum(b.avg_created_to_fill_ms) || 0) - (toNum(a.avg_created_to_fill_ms) || 0))[0] || null;
  const topSlippage = rows
    .filter((row) => Number.isFinite(toNum(row.avg_slippage_bps)))
    .sort((a, b) => (toNum(b.avg_slippage_bps) || 0) - (toNum(a.avg_slippage_bps) || 0))[0] || null;
  const topPartial = rows
    .filter((row) => Number.isFinite(toNum(row.partial_fill_rate_pct)))
    .sort((a, b) => (toNum(b.partial_fill_rate_pct) || 0) - (toNum(a.partial_fill_rate_pct) || 0))[0] || null;

  const createdToFillP95 = toNum(latency.created_to_fill_p95_ms);
  const adverseSlippageP95 = toNum(slippage.adverse_p95_bps);
  const partialRate = toNum(partial.partial_fill_rate_pct);
  const webhookToFillP95 = bridge.webhook_to_fill_ms && typeof bridge.webhook_to_fill_ms === "object"
    ? toNum(bridge.webhook_to_fill_ms.p95)
    : null;

  const reviewReasons = [];
  if (createdToFillP95 != null && createdToFillP95 > 60000) reviewReasons.push("CREATED_TO_FILL_P95_HIGH");
  if (adverseSlippageP95 != null && adverseSlippageP95 > 80) reviewReasons.push("ADVERSE_SLIPPAGE_P95_HIGH");
  if (partialRate != null && partialRate > 60) reviewReasons.push("PARTIAL_FILL_RATE_HIGH");
  if (webhookToFillP95 != null && webhookToFillP95 > 60000) reviewReasons.push("WEBHOOK_TO_FILL_P95_HIGH");

  return {
    summary: {
      status: reviewReasons.length ? "EXECUTION_QUALITY_REVIEW" : "EXECUTION_QUALITY_STABLE",
      created_to_fill_p95_ms: createdToFillP95,
      adverse_slippage_p95_bps: adverseSlippageP95,
      partial_fill_rate_pct: partialRate,
      webhook_to_fill_p95_ms: webhookToFillP95,
      execution_venue: "BINANCEFUT",
      top_latency_market: topLatency ? topLatency.market : null,
      top_slippage_market: topSlippage ? topSlippage.market : null,
      top_partial_market: topPartial ? topPartial.market : null,
      review_reasons: reviewReasons,
      market_n: rows.length,
      top_watch_markets: rows.slice(0, 6).map((row) => ({
        market: row.market,
        avg_created_to_fill_ms: row.avg_created_to_fill_ms,
        avg_slippage_bps: row.avg_slippage_bps,
        partial_fill_rate_pct: row.partial_fill_rate_pct,
      })),
    },
    by_market: rows,
  };
}

module.exports = {
  summarizeExecutionQuality,
};
