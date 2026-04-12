"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function unwrapDataset(value) {
  if (!value || typeof value !== "object") return {};
  if (value.dataset && typeof value.dataset === "object") return value.dataset;
  if (value.raw && typeof value.raw === "object") return unwrapDataset(value.raw);
  if (value.display && typeof value.display === "object") return unwrapDataset(value.display);
  return value;
}

function normalizeRows(dataset = null) {
  const raw = unwrapDataset(dataset);
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  return rows
    .map((row) => {
      const feature = row && row.feature_snapshot && typeof row.feature_snapshot === "object" ? row.feature_snapshot : {};
      const label = row && row.label_snapshot && typeof row.label_snapshot === "object" ? row.label_snapshot : {};
      return {
        market: upper(row && row.market),
        close_ms: toNum(row && row.close_ms),
        fee_value: Math.abs(toNum(feature.fee_value) || 0),
        funding_paid: Math.abs(toNum(feature.funding_paid) || 0),
        notional_quote: Math.abs(toNum(feature.notional_krw) || 0),
        realized_pnl_quote: toNum(label.realized_pnl_quote),
        realized_ret_net: toNum(label.realized_ret_net),
        is_executed: label.is_executed === true,
        is_realized: label.is_realized === true,
        realized_direction: upper(label.realized_direction),
      };
    })
    .filter((row) => row.market);
}

function summarizeRows(rows = []) {
  let tradeCount = 0;
  let realizedCount = 0;
  let executedCount = 0;
  let feeSum = 0;
  let fundingSum = 0;
  let totalCost = 0;
  let realizedPnlSum = 0;
  let absRealizedPnlSum = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let notionalSum = 0;

  for (const row of rows) {
    tradeCount += 1;
    if (row.is_executed) executedCount += 1;
    feeSum += row.fee_value || 0;
    fundingSum += row.funding_paid || 0;
    totalCost += (row.fee_value || 0) + (row.funding_paid || 0);
    notionalSum += row.notional_quote || 0;
    if (row.is_realized && Number.isFinite(row.realized_pnl_quote)) {
      realizedCount += 1;
      realizedPnlSum += row.realized_pnl_quote;
      absRealizedPnlSum += Math.abs(row.realized_pnl_quote);
      if (row.realized_pnl_quote > 0) positiveCount += 1;
      else if (row.realized_pnl_quote < 0) negativeCount += 1;
    }
  }

  return {
    trade_count: tradeCount,
    executed_count: executedCount,
    realized_count: realizedCount,
    positive_count: positiveCount,
    negative_count: negativeCount,
    fee_sum_quote: feeSum,
    funding_sum_quote: fundingSum,
    total_cost_quote: totalCost,
    realized_pnl_sum_quote: realizedPnlSum,
    abs_realized_pnl_sum_quote: absRealizedPnlSum,
    fee_to_abs_realized_ratio: safeRatio(feeSum, absRealizedPnlSum),
    cost_to_abs_realized_ratio: safeRatio(totalCost, absRealizedPnlSum),
    cost_to_notional_bps: safeRatio(totalCost * 10000, notionalSum),
    positive_rate: safeRatio(positiveCount, realizedCount),
  };
}

function buildMarketEvidenceStatus(row, { softRatio, hardRatio } = {}) {
  const realizedCount = toNum(row && row.realized_count) || 0;
  const ratio = toNum(row && row.cost_to_abs_realized_ratio);
  const pnl = toNum(row && row.realized_pnl_sum_quote) || 0;
  if (realizedCount <= 0 || !Number.isFinite(ratio)) return "FEE_PNL_MARKET_NO_REALIZED";
  if (ratio >= hardRatio || (ratio >= softRatio && pnl <= 0)) return "FEE_PNL_MARKET_BLOCK";
  if (ratio >= softRatio) return "FEE_PNL_MARKET_REVIEW";
  return "FEE_PNL_MARKET_PASS";
}

function buildFeePnlKpiAuthority({
  dataset = null,
  minRealizedN = Number(process.env.FEE_PNL_KPI_MIN_REALIZED_N || 24),
  softCostToAbsRealizedRatio = Number(process.env.FEE_PNL_KPI_SOFT_COST_TO_ABS_REALIZED_RATIO || 0.30),
  hardCostToAbsRealizedRatio = Number(process.env.FEE_PNL_KPI_HARD_COST_TO_ABS_REALIZED_RATIO || 0.45),
} = {}) {
  const raw = unwrapDataset(dataset);
  const rows = normalizeRows(dataset);
  const summaryStats = summarizeRows(rows);
  const byMarketMap = new Map();
  for (const row of rows) {
    if (!byMarketMap.has(row.market)) byMarketMap.set(row.market, []);
    byMarketMap.get(row.market).push(row);
  }

  const byMarket = Array.from(byMarketMap.entries())
    .map(([market, marketRows]) => {
      const stats = summarizeRows(marketRows);
      const evidenceStatus = buildMarketEvidenceStatus(stats, {
        softRatio: softCostToAbsRealizedRatio,
        hardRatio: hardCostToAbsRealizedRatio,
      });
      return {
        market,
        ...stats,
        evidence_status: evidenceStatus,
      };
    })
    .sort((a, b) => {
      const ratioA = toNum(a.cost_to_abs_realized_ratio);
      const ratioB = toNum(b.cost_to_abs_realized_ratio);
      if (Number.isFinite(ratioA) && Number.isFinite(ratioB) && ratioB !== ratioA) return ratioB - ratioA;
      return (b.realized_count || 0) - (a.realized_count || 0);
    });

  const hardPenaltyMarkets = byMarket.filter((row) => row.evidence_status === "FEE_PNL_MARKET_BLOCK").map((row) => row.market);
  const softPenaltyMarkets = byMarket.filter((row) => row.evidence_status === "FEE_PNL_MARKET_REVIEW").map((row) => row.market);
  const ready = summaryStats.realized_count >= Math.max(1, minRealizedN);

  let evidenceStatus = "FEE_PNL_KPI_PASS";
  if (!ready) evidenceStatus = "FEE_PNL_KPI_INSUFFICIENT_SAMPLE";
  else if (
    (Number.isFinite(summaryStats.cost_to_abs_realized_ratio) && summaryStats.cost_to_abs_realized_ratio >= hardCostToAbsRealizedRatio)
    || ((Number.isFinite(summaryStats.cost_to_abs_realized_ratio) && summaryStats.cost_to_abs_realized_ratio >= softCostToAbsRealizedRatio)
      && (summaryStats.realized_pnl_sum_quote || 0) <= 0)
  ) {
    evidenceStatus = "FEE_PNL_KPI_BLOCK";
  } else if (
    (Number.isFinite(summaryStats.cost_to_abs_realized_ratio) && summaryStats.cost_to_abs_realized_ratio >= softCostToAbsRealizedRatio)
    || hardPenaltyMarkets.length > 0
    || softPenaltyMarkets.length > 0
  ) {
    evidenceStatus = "FEE_PNL_KPI_REVIEW";
  }

  const topFeeDragMarket = byMarket[0] || null;

  return {
    status: "FEE_PNL_KPI_AUTHORITY_READY",
    kpi_ready: ready,
    evidence_status: evidenceStatus,
    immutable_event_truth_only: raw.immutable_source === true && raw.source_collection === "UNIFIED_EVENT_TIMELINE",
    strict_event_truth_only: Boolean(raw.source_manifest && raw.source_manifest.strict_event_truth_only),
    rows_n: rows.length,
    realized_n: summaryStats.realized_count,
    executed_n: summaryStats.executed_count,
    trade_count: summaryStats.trade_count,
    fee_sum_quote: summaryStats.fee_sum_quote,
    funding_sum_quote: summaryStats.funding_sum_quote,
    total_cost_quote: summaryStats.total_cost_quote,
    realized_pnl_sum_quote: summaryStats.realized_pnl_sum_quote,
    abs_realized_pnl_sum_quote: summaryStats.abs_realized_pnl_sum_quote,
    fee_to_abs_realized_ratio: summaryStats.fee_to_abs_realized_ratio,
    cost_to_abs_realized_ratio: summaryStats.cost_to_abs_realized_ratio,
    cost_to_notional_bps: summaryStats.cost_to_notional_bps,
    positive_rate: summaryStats.positive_rate,
    top_fee_drag_market: topFeeDragMarket ? topFeeDragMarket.market : null,
    top_fee_drag_ratio: topFeeDragMarket ? topFeeDragMarket.cost_to_abs_realized_ratio : null,
    fee_pnl_soft_penalty_markets: softPenaltyMarkets,
    fee_pnl_hard_penalty_markets: hardPenaltyMarkets,
    blocking_reasons: [
      !ready ? "FEE_PNL_INSUFFICIENT_SAMPLE" : null,
      evidenceStatus === "FEE_PNL_KPI_BLOCK" ? "FEE_PNL_COST_OVERHANG" : null,
      evidenceStatus === "FEE_PNL_KPI_REVIEW" ? "FEE_PNL_REVIEW_REQUIRED" : null,
    ].filter(Boolean),
    thresholds: {
      min_realized_n: Math.max(1, minRealizedN),
      soft_cost_to_abs_realized_ratio: softCostToAbsRealizedRatio,
      hard_cost_to_abs_realized_ratio: hardCostToAbsRealizedRatio,
    },
    by_market: byMarket,
    worst_fee_drag_markets: byMarket.slice(0, 8),
  };
}

module.exports = {
  buildFeePnlKpiAuthority,
};
