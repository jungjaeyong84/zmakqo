const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { fetchRecentNewFills, buildTradesFromFillsWithFunding } = require("./tradesFromFills");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function withinRange(ms, fromMs, toMs) {
  if (!Number.isFinite(ms)) return false;
  if (Number.isFinite(fromMs) && ms < fromMs) return false;
  if (Number.isFinite(toMs) && ms >= toMs) return false;
  return true;
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function normalizeTradeRow(row) {
  if (!row || typeof row !== "object") return null;
  const closeMs = toNum(row.close_ms);
  if (!Number.isFinite(closeMs)) return null;
  const market = String(row.market || row.symbol || row.symbol_or_pair_id || "").toUpperCase() || null;
  const pnlNet = toNum(row.pnl_krw);
  const pnlGrossRaw = toNum(row.pnl_krw_gross);
  const feePaid = toNum(row.fee_value) || 0;
  const fundingPaid = toNum(row.funding_paid) || 0;
  const pnlGross = pnlGrossRaw != null ? pnlGrossRaw : (pnlNet != null ? (pnlNet + feePaid + fundingPaid) : null);
  return {
    market,
    close_ms: closeMs,
    pnl_krw: pnlNet,
    pnl_krw_gross: pnlGross,
    fee_value: feePaid,
    funding_paid: fundingPaid,
    notional_krw: toNum(row.notional_krw),
    close_type: String(row.close_type || "UNKNOWN").toUpperCase(),
  };
}

function summarizeTradeRows(rows) {
  let tradeCount = 0;
  let grossPnl = 0;
  let netPnl = 0;
  let feePaid = 0;
  let fundingPaid = 0;
  let notional = 0;
  let grossAbs = 0;
  let netAbs = 0;
  let winCount = 0;
  let lossCount = 0;
  const closeTypeBreakdown = {};

  for (const row of rows) {
    tradeCount += 1;
    const gross = toNum(row.pnl_krw_gross);
    const net = toNum(row.pnl_krw);
    const fee = toNum(row.fee_value) || 0;
    const funding = toNum(row.funding_paid) || 0;
    const rowNotional = toNum(row.notional_krw) || 0;
    if (gross != null) {
      grossPnl += gross;
      grossAbs += Math.abs(gross);
    }
    if (net != null) {
      netPnl += net;
      netAbs += Math.abs(net);
      if (net > 0) winCount += 1;
      else if (net < 0) lossCount += 1;
    }
    feePaid += fee;
    fundingPaid += funding;
    notional += rowNotional;
    const closeType = String(row.close_type || "UNKNOWN").toUpperCase();
    closeTypeBreakdown[closeType] = (closeTypeBreakdown[closeType] || 0) + 1;
  }

  const totalCost = feePaid + fundingPaid;
  return {
    trade_count: tradeCount,
    gross_pnl_krw: tradeCount ? grossPnl : 0,
    net_pnl_krw: tradeCount ? netPnl : 0,
    fee_paid_krw: tradeCount ? feePaid : 0,
    funding_paid_krw: tradeCount ? fundingPaid : 0,
    total_cost_krw: tradeCount ? totalCost : 0,
    notional_krw: tradeCount ? notional : 0,
    win_count: winCount,
    loss_count: lossCount,
    flat_count: Math.max(0, tradeCount - winCount - lossCount),
    win_rate: safeRatio(winCount, tradeCount),
    avg_fee_krw: tradeCount ? (feePaid / tradeCount) : null,
    avg_net_pnl_krw: tradeCount ? (netPnl / tradeCount) : null,
    fee_to_gross_pnl_ratio: safeRatio(feePaid, grossAbs),
    fee_to_net_pnl_ratio: safeRatio(feePaid, netAbs),
    cost_to_notional_bps: safeRatio(totalCost * 10000, notional),
    close_type_breakdown: closeTypeBreakdown,
  };
}

function buildTradeQualitySummary(trades, opts = {}) {
  const fromMs = Number(opts.fromMs);
  const toMs = Number(opts.toMs);
  const topN = Math.max(1, Math.trunc(Number(opts.topN) || 5));
  const normalized = [];
  const byMarket = new Map();

  for (const trade of (Array.isArray(trades) ? trades : [])) {
    const row = normalizeTradeRow(trade);
    if (!row) continue;
    if (!withinRange(row.close_ms, fromMs, toMs)) continue;
    normalized.push(row);
    const market = row.market || "UNKNOWN";
    if (!byMarket.has(market)) byMarket.set(market, []);
    byMarket.get(market).push(row);
  }

  const summary = summarizeTradeRows(normalized);
  const byMarketRows = Array.from(byMarket.entries()).map(([market, rows]) => ({
    market,
    ...summarizeTradeRows(rows),
  }));

  byMarketRows.sort((a, b) => {
    const feeA = Math.abs(toNum(a.fee_to_gross_pnl_ratio) || -1);
    const feeB = Math.abs(toNum(b.fee_to_gross_pnl_ratio) || -1);
    if (feeB !== feeA) return feeB - feeA;
    return (b.trade_count || 0) - (a.trade_count || 0);
  });

  return {
    as_of: new Date().toISOString(),
    from_ms: Number.isFinite(fromMs) ? fromMs : null,
    to_ms: Number.isFinite(toMs) ? toMs : null,
    markets_n: byMarketRows.length,
    top_n: topN,
    summary,
    by_market: byMarketRows,
    worst_fee_drag_markets: byMarketRows.slice(0, topN),
  };
}

async function loadTradeQualitySummaryForExchange({
  exchange,
  markets,
  tf = defaultExecTfFromEnv() || "15m",
  fallbackTf = defaultExecTfFromEnv() || "15m",
  mode = String(process.env.TRADE_PNL_MODE || "EACH_SELL"),
  limitN = Number(process.env.DASHBOARD_FILLS_LIMIT || 2000),
  fromMs = null,
  toMs = null,
  topN = 5,
} = {}) {
  const out = [];
  const primaryTf = String(tf || fallbackTf || defaultExecTfFromEnv() || "15m");
  const secondaryTf = (fallbackTf && String(fallbackTf) !== primaryTf) ? String(fallbackTf) : null;
  const marketList = Array.isArray(markets) ? markets : [];

  for (const market of marketList) {
    let fills = await fetchRecentNewFills({
      exchange,
      symbol: market,
      tf: primaryTf,
      limitN,
      fromMs,
    });
    if ((!fills || !fills.length) && secondaryTf) {
      fills = await fetchRecentNewFills({
        exchange,
        symbol: market,
        tf: secondaryTf,
        limitN,
        fromMs,
      });
    }
    if (!Array.isArray(fills) || !fills.length) continue;
    const built = await buildTradesFromFillsWithFunding(fills, {
      mode,
      exchange,
      symbol: market,
    });
    for (const trade of (built.trades || [])) {
      out.push({ market, ...trade });
    }
  }

  return buildTradeQualitySummary(out, { fromMs, toMs, topN });
}

module.exports = {
  buildTradeQualitySummary,
  loadTradeQualitySummaryForExchange,
};
