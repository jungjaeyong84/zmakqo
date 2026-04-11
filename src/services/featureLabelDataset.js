"use strict";

const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { fetchRecentNewFills, buildTradesFromFillsWithFunding } = require("./tradesFromFills");
const { labelOutcome } = require("./outcomeLabeler");

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function buildFeatureLabelDataset({
  exchange,
  markets,
  tf = defaultExecTfFromEnv() || "15m",
  limitN = 2000,
  fromMs = null,
} = {}) {
  const rows = [];
  for (const market of (Array.isArray(markets) ? markets : [])) {
    const fills = await fetchRecentNewFills({
      exchange,
      symbol: market,
      tf,
      limitN,
      fromMs,
    });
    if (!Array.isArray(fills) || !fills.length) continue;
    const built = await buildTradesFromFillsWithFunding(fills, {
      mode: String(process.env.TRADE_PNL_MODE || "EACH_SELL"),
      exchange,
      symbol: market,
    });
    for (const trade of (built.trades || [])) {
      const outcome = labelOutcome(trade);
      rows.push({
        exchange: String(exchange || "").toUpperCase(),
        market: String(market || "").toUpperCase(),
        tf: String(tf || "").trim() || null,
        close_ms: toNum(trade.close_ms),
        close_type: String(trade.close_type || "").trim().toUpperCase() || null,
        entry_event_id: trade.entry_event_id || null,
        feature_snapshot: {
          market: String(market || "").toUpperCase(),
          tf: String(tf || "").trim() || null,
          pnl_krw_gross: toNum(trade.pnl_krw_gross),
          fee_value: toNum(trade.fee_value),
          funding_paid: toNum(trade.funding_paid),
          notional_krw: toNum(trade.notional_krw),
        },
        label_snapshot: outcome,
      });
    }
  }
  rows.sort((a, b) => Number(a.close_ms || 0) - Number(b.close_ms || 0));
  return {
    schema_version: "FEATURE_LABEL_DATASET_V1",
    created_at: new Date().toISOString(),
    rows_n: rows.length,
    rows,
  };
}

module.exports = {
  buildFeatureLabelDataset,
};
