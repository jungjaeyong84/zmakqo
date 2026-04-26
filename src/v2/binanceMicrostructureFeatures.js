"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bpsDiff(a, b) {
  const x = toNumberOrNull(a);
  const y = toNumberOrNull(b);
  if (!(x > 0) || !(y > 0)) return null;
  return Math.abs(x - y) / ((x + y) / 2) * 10000;
}

function sumDepthNotional(levels) {
  return asArray(levels).slice(0, 5).reduce((sum, level) => {
    const row = Array.isArray(level) ? level : [];
    const price = toNumberOrNull(row[0]);
    const qty = toNumberOrNull(row[1]);
    if (!(price > 0) || !(qty > 0)) return sum;
    return sum + (price * qty);
  }, 0);
}

function normalizeFundingRate(rows) {
  const list = asArray(rows);
  const row = asObject(list[list.length - 1]) || asObject(rows);
  const fundingRate = toNumberOrNull(row && row.fundingRate);
  return Object.freeze({
    funding_rate: fundingRate,
    funding_penalty_bps: fundingRate === null ? null : Math.abs(fundingRate * 10000),
    funding_time_ms: toNumberOrNull(row && row.fundingTime),
    funding_mark_price: toNumberOrNull(row && row.markPrice),
  });
}

function normalizeOpenInterest(row) {
  const data = asObject(row) || {};
  return Object.freeze({
    open_interest: toNumberOrNull(data.openInterest),
    open_interest_time_ms: toNumberOrNull(data.time),
  });
}

function normalizeOrderBookDepth(row) {
  const data = asObject(row) || {};
  const bids = asArray(data.bids);
  const asks = asArray(data.asks);
  const bidNotional = sumDepthNotional(bids);
  const askNotional = sumDepthNotional(asks);
  const total = bidNotional + askNotional;
  const bestBid = bids.length ? toNumberOrNull(bids[0][0]) : null;
  const bestAsk = asks.length ? toNumberOrNull(asks[0][0]) : null;
  return Object.freeze({
    orderbook_bid_notional_top5: bidNotional || null,
    orderbook_ask_notional_top5: askNotional || null,
    orderbook_imbalance_top5: total > 0 ? (bidNotional - askNotional) / total : null,
    depth_spread_bps: bpsDiff(bestAsk, bestBid),
    depth_event_time_ms: toNumberOrNull(data.E),
    depth_transaction_time_ms: toNumberOrNull(data.T),
  });
}

function normalizeLiquidationSnapshot(snapshot = null) {
  const row = asObject(snapshot) || {};
  return Object.freeze({
    liquidation_notional_5m_quote: toNumberOrNull(row.liquidation_notional_5m_quote ?? row.liquidationNotional5mQuote),
    liquidation_event_count_5m: toNumberOrNull(row.liquidation_event_count_5m ?? row.liquidationEventCount5m),
    liquidation_source: trimOrNull(row.source) || null,
  });
}

function mergeFeatureRows(...rows) {
  return Object.freeze(Object.assign({}, ...rows.filter(Boolean)));
}

async function collectBinanceMicrostructureFeatures({
  symbol,
  env = process.env,
  fetchJson,
  liquidationSnapshot = null,
} = {}) {
  const sym = upper(symbol);
  if (!sym) throw new Error("BINANCE_MICROSTRUCTURE_SYMBOL_REQUIRED");
  if (typeof fetchJson !== "function") throw new Error("BINANCE_MICROSTRUCTURE_FETCH_JSON_REQUIRED");
  const enabled = String(env.DONBEOLJA_V2_MICROSTRUCTURE_FEATURES_ENABLED ?? "1").trim() !== "0";
  if (!enabled) {
    return Object.freeze({
      ok: true,
      reason: "BINANCE_MICROSTRUCTURE_FEATURES_DISABLED",
      symbol: sym,
      features: Object.freeze({ symbol: sym }),
      errors: Object.freeze([]),
    });
  }
  const requests = [
    ["funding", () => fetchJson("/fapi/v1/fundingRate", { symbol: sym, limit: 1 })],
    ["open_interest", () => fetchJson("/fapi/v1/openInterest", { symbol: sym })],
    ["depth", () => fetchJson("/fapi/v1/depth", { symbol: sym, limit: 5 })],
  ];
  const settled = await Promise.all(requests.map(async ([name, fn]) => {
    try {
      return { name, ok: true, value: await fn() };
    } catch (error) {
      return {
        name,
        ok: false,
        error: error && error.message ? String(error.message) : String(error),
      };
    }
  }));
  const byName = new Map(settled.map((row) => [row.name, row]));
  const funding = byName.get("funding");
  const openInterest = byName.get("open_interest");
  const depth = byName.get("depth");
  const features = mergeFeatureRows(
    { symbol: sym, source: "BINANCE_FUTURES_PUBLIC_MICROSTRUCTURE" },
    funding && funding.ok ? normalizeFundingRate(funding.value) : null,
    openInterest && openInterest.ok ? normalizeOpenInterest(openInterest.value) : null,
    depth && depth.ok ? normalizeOrderBookDepth(depth.value) : null,
    normalizeLiquidationSnapshot(liquidationSnapshot),
  );
  const errors = settled
    .filter((row) => row.ok !== true)
    .map((row) => `${row.name}:${row.error}`);
  return Object.freeze({
    ok: errors.length === 0,
    reason: errors.length === 0 ? "BINANCE_MICROSTRUCTURE_FEATURES_COLLECTED" : "BINANCE_MICROSTRUCTURE_FEATURES_PARTIAL",
    symbol: sym,
    features,
    errors: Object.freeze(errors),
  });
}

module.exports = {
  collectBinanceMicrostructureFeatures,
  normalizeFundingRate,
  normalizeOpenInterest,
  normalizeOrderBookDepth,
  normalizeLiquidationSnapshot,
  __test: {
    bpsDiff,
    sumDepthNotional,
  },
};
