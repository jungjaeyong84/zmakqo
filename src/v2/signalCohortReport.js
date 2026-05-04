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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function getPath(obj, path) {
  let cursor = obj;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = cursor[key];
  }
  return cursor == null ? null : cursor;
}

function firstValue(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
  }
  return null;
}

function bucketSignalScore(score) {
  const n = toNumberOrNull(score);
  if (n === null) return "UNKNOWN";
  if (n >= 90) return "ELITE";
  if (n >= 80) return "QUALIFIED";
  if (n >= 70) return "MARGINAL";
  return "SUBTHRESHOLD";
}

function bucketTriggerQuality({ triggerConfirmed = null, volumeZScore = null } = {}) {
  if (triggerConfirmed !== true) return "UNCONFIRMED";
  const volume = toNumberOrNull(volumeZScore) ?? 0;
  if (volume >= 1.8) return "CONFIRMED_EXPANSION";
  if (volume >= 1) return "CONFIRMED_BASE";
  return "CONFIRMED_LOW_POWER";
}

function bucketMarketQuality(score) {
  const n = toNumberOrNull(score);
  if (n === null) return "UNKNOWN";
  if (n >= 0.85) return "HIGH";
  if (n >= 0.75) return "ADEQUATE";
  if (n >= 0.65) return "THIN";
  return "POOR";
}

function bucketSpreadBps(spreadBps) {
  const n = toNumberOrNull(spreadBps);
  if (n === null) return "UNKNOWN";
  if (n < 3) return "TIGHT_LT3";
  if (n < 5) return "NORMAL_3_5";
  if (n < 8) return "WIDE_5_8";
  return "TOO_WIDE_GTE8";
}

function bucketFundingRate(rate) {
  const n = toNumberOrNull(rate);
  if (n === null) return "UNKNOWN";
  if (n < -0.0005) return "NEG_EXTREME";
  if (n < -0.0001) return "NEG";
  if (n <= 0.0001) return "NEUTRAL";
  if (n <= 0.0005) return "POS";
  return "POS_EXTREME";
}

function bucketSignedPct(value) {
  const n = toNumberOrNull(value);
  if (n === null) return "UNKNOWN";
  if (n < -3) return "DOWN_GT3";
  if (n < -1) return "DOWN_1_3";
  if (n < 0) return "DOWN_LT1";
  if (n <= 1) return "UP_LT1";
  if (n <= 3) return "UP_1_3";
  return "UP_GT3";
}

function bucketLiquidationNotional(notionalQuote) {
  const n = toNumberOrNull(notionalQuote);
  if (n === null) return "UNKNOWN";
  if (n < 100000) return "LOW_LT100K";
  if (n < 1000000) return "MED_100K_1M";
  if (n < 5000000) return "HIGH_1M_5M";
  if (n < 10000000) return "EXTREME_5M_10M";
  return "CHAOS_GTE10M";
}

function resolveBtcAlignment({ symbol, side, btcTrend }) {
  const normalizedSymbol = upper(symbol);
  const normalizedSide = upper(side);
  const normalizedTrend = upper(btcTrend);
  if (!normalizedTrend || normalizedTrend === "UNKNOWN" || normalizedTrend === "NONE") return "UNKNOWN";
  if (normalizedSymbol === "BTCUSDT") return "SELF";
  if (normalizedSide !== "LONG" && normalizedSide !== "SHORT") return "UNKNOWN";
  if (normalizedTrend === normalizedSide) return "ALIGNED";
  if (normalizedTrend === "NEUTRAL") return "NEUTRAL";
  return "OPPOSED";
}

const FULL_EVIDENCE_REQUIRED_FIELDS = Object.freeze([
  "setup_type",
  "edge_cohort",
  "market_quality_score",
  "spread_bps",
  "funding_rate",
  "open_interest_delta_pct",
  "liquidation_notional_5m_quote",
  "orderbook_imbalance_top5",
  "btc_1h_trend",
  "btc_1h_alignment",
  "mtf_1h_direction",
  "mtf_1h_alignment",
]);

function missingFullEvidenceFields(context = {}) {
  const missing = [];
  for (const field of FULL_EVIDENCE_REQUIRED_FIELDS) {
    const value = context[field];
    if (value === null || value === undefined || value === "" || value === "UNKNOWN" || value === "NONE") {
      missing.push(field);
    }
  }
  return Object.freeze(missing);
}

function extractOutcomeContext(row) {
  const evidence = asObject(row && row.evidence) || {};
  const criteria = asObject(firstValue(
    evidence.signal_criteria,
    getPath(evidence, ["bundle", "signalCriteria"]),
    getPath(evidence, ["canonical_evidence_summary", "signal_criteria"])
  )) || {};
  const entryFeatures = asObject(evidence.entry_features) || {};
  const regimeProfile = asObject(firstValue(
    evidence.signal_regime_profile,
    criteria.regime_profile,
    getPath(evidence, ["bundle", "signalCriteria", "regime_profile"])
  )) || {};
  const expectedEdgeModel = asObject(firstValue(
    evidence.expected_edge_model,
    criteria.expected_edge_model,
    getPath(evidence, ["bundle", "signalCriteria", "expected_edge_model"])
  )) || {};
  const featureSnapshotContract = asObject(firstValue(
    criteria.feature_snapshot_contract,
    getPath(evidence, ["bundle", "signalCriteria", "feature_snapshot_contract"])
  )) || {};
  const triggerGate = asObject(firstValue(
    criteria.trigger_gate,
    getPath(evidence, ["bundle", "signalCriteria", "trigger_gate"])
  )) || {};
  const setupGate = asObject(firstValue(
    criteria.setup_gate,
    getPath(evidence, ["bundle", "signalCriteria", "setup_gate"])
  )) || {};

  const symbol = upper(firstValue(row && row.symbol, evidence.symbol, getPath(evidence, ["bundle", "signalIntent", "symbol"]))) || "UNKNOWN";
  const side = upper(firstValue(row && row.side, evidence.side, getPath(evidence, ["bundle", "signalIntent", "side"]))) || "UNKNOWN";
  const setupType = upper(firstValue(evidence.setup_type, entryFeatures.effective_setup_type, entryFeatures.setup_type, featureSnapshotContract.effective_setup_type, setupGate.setup_type)) || "UNKNOWN";
  const structuralRegime = upper(firstValue(
    evidence.structural_regime,
    entryFeatures.structural_regime,
    entryFeatures.htf_regime,
    regimeProfile.structural_regime,
    evidence.market_regime,
  )) || "UNKNOWN";
  const regimeCohort = upper(firstValue(evidence.regime_cohort, entryFeatures.regime_cohort, regimeProfile.regime_cohort)) || `${structuralRegime}__UNKNOWN__UNKNOWN`;
  const edgeCohort = upper(firstValue(evidence.edge_cohort, entryFeatures.edge_cohort, expectedEdgeModel.edge_cohort)) || "UNKNOWN";
  const signalScore = toNumberOrNull(firstValue(evidence.signal_score, entryFeatures.signal_score, entryFeatures.score_norm, criteria.signal_score));
  const volumeZScore = toNumberOrNull(firstValue(evidence.volume_zscore, entryFeatures.volume_zscore, entryFeatures.volume_ratio, triggerGate.volume_zscore));
  const triggerConfirmed = firstValue(evidence.trigger_confirmed, entryFeatures.trigger_confirmed, triggerGate.trigger_confirmed) === true;
  const expectedNetRAfterCost = toNumberOrNull(firstValue(
    evidence.expected_net_r_after_cost,
    entryFeatures.expected_net_r_after_cost,
    getPath(criteria, ["expected_edge_gate", "effective_expected_net_r_after_cost"]),
    getPath(criteria, ["expected_edge_gate", "expected_net_r_after_cost"]),
    expectedEdgeModel.effective_net_r_multiple,
    expectedEdgeModel.net_r_multiple
  ));
  const timingMeasurement = asObject(evidence.timing_measurement) || {};
  const entryGrade = upper(firstValue(evidence.entry_grade, entryFeatures.entry_grade, criteria.entry_grade, timingMeasurement.entry_grade)) || "UNKNOWN";
  const triggerType = upper(firstValue(evidence.trigger_type, entryFeatures.trigger_type, criteria.trigger_type, triggerGate.trigger_type, timingMeasurement.trigger_type)) || "UNKNOWN";
  const timingBucket = upper(firstValue(evidence.timing_bucket, entryFeatures.timing_bucket, timingMeasurement.timing_bucket, evidence.febt_phase)) || "UNKNOWN";
  const marketDataQuality = asObject(evidence.market_data_quality) || {};
  const marketMetrics = asObject(marketDataQuality.metrics) || {};
  const marketQualityScore = toNumberOrNull(firstValue(evidence.market_quality_score, entryFeatures.market_quality_score, marketMetrics.market_quality_score, marketMetrics.quality_score, marketDataQuality.quality_score));
  const spreadBps = toNumberOrNull(firstValue(evidence.spread_bps, entryFeatures.spread_bps, marketMetrics.spread_bps));
  const fundingRate = toNumberOrNull(firstValue(evidence.funding_rate, entryFeatures.funding_rate, entryFeatures.funding_rate_current, marketMetrics.funding_rate, marketMetrics.fundingRate));
  const fundingPenaltyBps = toNumberOrNull(firstValue(evidence.funding_penalty_bps, entryFeatures.funding_penalty_bps, getPath(criteria, ["expected_edge_gate", "funding_penalty_bps"])));
  const openInterestDeltaPct = toNumberOrNull(firstValue(evidence.open_interest_delta_pct, entryFeatures.open_interest_delta_pct, entryFeatures.open_interest_change_pct, featureSnapshotContract.open_interest_delta_pct, marketMetrics.open_interest_delta_pct, marketMetrics.open_interest_change_pct));
  const liquidationNotional5mQuote = toNumberOrNull(firstValue(evidence.liquidation_notional_5m_quote, entryFeatures.liquidation_notional_5m_quote, entryFeatures.liquidation_notional_5m, featureSnapshotContract.liquidation_notional_5m_quote, marketMetrics.liquidation_notional_5m_quote, marketMetrics.liquidation_notional_5m));
  const orderbookImbalanceTop5 = toNumberOrNull(firstValue(evidence.orderbook_imbalance_top5, entryFeatures.orderbook_imbalance_top5, entryFeatures.order_book_imbalance_top5, featureSnapshotContract.orderbook_imbalance_top5, marketMetrics.orderbook_imbalance_top5, marketMetrics.order_book_imbalance_top5));
  const btcOneHourTrend = upper(firstValue(
    evidence.btc_1h_trend,
    entryFeatures.btc_1h_trend,
    entryFeatures.btc_1h_direction,
    entryFeatures.btc_htf_trend,
    featureSnapshotContract.btc_1h_trend,
    marketMetrics.btc_1h_trend,
    marketMetrics.btc_1h_direction,
  )) || "UNKNOWN";
  const mtfOneHourDirection = upper(firstValue(
    evidence.mtf_1h_direction,
    entryFeatures.mtf_1h_direction,
    entryFeatures.htf_1h_direction,
    entryFeatures.one_hour_direction,
    featureSnapshotContract.mtf_1h_direction,
    marketMetrics.mtf_1h_direction,
    marketMetrics.htf_1h_direction,
  )) || "UNKNOWN";

  const baseContext = {
    symbol,
    side,
    entry_grade: entryGrade,
    trigger_type: triggerType,
    timing_bucket: timingBucket,
    setup_type: setupType,
    raw_setup_type: upper(firstValue(evidence.raw_setup_type, entryFeatures.raw_setup_type, featureSnapshotContract.raw_setup_type)) || setupType,
    structural_regime: structuralRegime,
    regime_cohort: regimeCohort,
    edge_cohort: edgeCohort,
    signal_score_bucket: bucketSignalScore(signalScore),
    trigger_quality_bucket: bucketTriggerQuality({ triggerConfirmed, volumeZScore }),
    expected_edge_bucket: edgeCohort,
    setup_regime_key: `${setupType}__${structuralRegime}`,
    expected_net_r_after_cost: expectedNetRAfterCost,
    adverse_selection_penalty_r: toNumberOrNull(firstValue(
      evidence.adverse_selection_penalty_r,
      entryFeatures.adverse_selection_penalty_r,
      getPath(criteria, ["expected_edge_gate", "adverse_selection_penalty_r"]),
      expectedEdgeModel.adverse_selection_penalty_r,
    )),
    market_quality_score: marketQualityScore,
    market_quality_bucket: bucketMarketQuality(marketQualityScore),
    spread_bps: spreadBps,
    spread_bucket: bucketSpreadBps(spreadBps),
    funding_rate: fundingRate,
    funding_rate_bucket: bucketFundingRate(fundingRate),
    funding_penalty_bps: fundingPenaltyBps,
    open_interest_delta_pct: openInterestDeltaPct,
    open_interest_delta_bucket: bucketSignedPct(openInterestDeltaPct),
    liquidation_notional_5m_quote: liquidationNotional5mQuote,
    liquidation_notional_5m_bucket: bucketLiquidationNotional(liquidationNotional5mQuote),
    orderbook_imbalance_top5: orderbookImbalanceTop5,
    btc_1h_trend: btcOneHourTrend,
    btc_1h_alignment: resolveBtcAlignment({ symbol, side, btcTrend: btcOneHourTrend }),
    mtf_1h_direction: mtfOneHourDirection,
    mtf_1h_alignment: resolveBtcAlignment({ symbol, side, btcTrend: mtfOneHourDirection }),
  };
  const missing = missingFullEvidenceFields(baseContext);
  return Object.freeze({
    ...baseContext,
    full_evidence: missing.length === 0,
    evidence_completeness: missing.length === 0 ? "FULL_EVIDENCE" : "PARTIAL_OR_UNKNOWN_EVIDENCE",
    missing_feature_fields: missing,
  });
}

function createBucketRow(key, context) {
  return {
    key,
    symbol: context.symbol,
    side: context.side,
    setup_type: context.setup_type,
    structural_regime: context.structural_regime,
    regime_cohort: context.regime_cohort,
    edge_cohort: context.edge_cohort,
    signal_score_bucket: context.signal_score_bucket,
    trigger_quality_bucket: context.trigger_quality_bucket,
    entry_grade: context.entry_grade,
    trigger_type: context.trigger_type,
    timing_bucket: context.timing_bucket,
    market_quality_bucket: context.market_quality_bucket,
    spread_bucket: context.spread_bucket,
    funding_rate_bucket: context.funding_rate_bucket,
    open_interest_delta_bucket: context.open_interest_delta_bucket,
    liquidation_notional_5m_bucket: context.liquidation_notional_5m_bucket,
    btc_1h_alignment: context.btc_1h_alignment,
    mtf_1h_alignment: context.mtf_1h_alignment,
    evidence_completeness: context.evidence_completeness,
    outcome_n: 0,
    trade_n: 0,
    win_n: 0,
    loss_n: 0,
    net_pnl_usdt: 0,
    gross_profit_usdt: 0,
    gross_loss_abs_usdt: 0,
    avg_expected_net_r_after_cost: 0,
    expected_edge_sample_n: 0,
  };
}

function finalizeBucketRows(map) {
  return Object.freeze(Array.from(map.values()).map((row) => {
    const tradeN = row.trade_n;
    return Object.freeze({
      ...row,
      win_rate_pct: tradeN > 0 ? (row.win_n / tradeN) * 100 : null,
      profit_factor: row.gross_loss_abs_usdt > 0 ? row.gross_profit_usdt / row.gross_loss_abs_usdt : (row.gross_profit_usdt > 0 ? Infinity : null),
      avg_expected_net_r_after_cost: row.expected_edge_sample_n > 0 ? row.avg_expected_net_r_after_cost / row.expected_edge_sample_n : null,
    });
  }).sort((a, b) => Number(b.net_pnl_usdt || 0) - Number(a.net_pnl_usdt || 0) || String(a.key).localeCompare(String(b.key))));
}

function summarizeOutcomeCohorts(outcomes = []) {
  const rows = asArray(outcomes).filter((row) => row && typeof row === "object");
  const bySetupType = new Map();
  const byRegimeCohort = new Map();
  const byEdgeCohort = new Map();
  const bySetupRegime = new Map();
  const bySignalScoreBucket = new Map();
  const byTriggerQualityBucket = new Map();
  const byEntryGrade = new Map();
  const byTimingBucket = new Map();
  const byMarketQualityBucket = new Map();
  const bySpreadBucket = new Map();
  const byFundingRateBucket = new Map();
  const byOpenInterestDeltaBucket = new Map();
  const byLiquidationNotional5mBucket = new Map();
  const byBtc1hAlignment = new Map();
  const byMtf1hAlignment = new Map();
  const byEvidenceCompleteness = new Map();

  function record(map, key, row, context) {
    if (!map.has(key)) map.set(key, createBucketRow(key, context));
    const bucket = map.get(key);
    const pnl = toNumberOrNull(row.realized_pnl);
    bucket.outcome_n += 1;
    if (pnl != null) {
      bucket.trade_n += 1;
      bucket.net_pnl_usdt += pnl;
      if (pnl > 0) {
        bucket.win_n += 1;
        bucket.gross_profit_usdt += pnl;
      } else if (pnl < 0) {
        bucket.loss_n += 1;
        bucket.gross_loss_abs_usdt += Math.abs(pnl);
      }
    }
    if (context.expected_net_r_after_cost != null) {
      bucket.avg_expected_net_r_after_cost += context.expected_net_r_after_cost;
      bucket.expected_edge_sample_n += 1;
    }
  }

  for (const row of rows) {
    const context = extractOutcomeContext(row);
    record(bySetupType, context.setup_type, row, context);
    record(byRegimeCohort, context.regime_cohort, row, context);
    record(byEdgeCohort, context.edge_cohort, row, context);
    record(bySetupRegime, context.setup_regime_key, row, context);
    record(bySignalScoreBucket, context.signal_score_bucket, row, context);
    record(byTriggerQualityBucket, context.trigger_quality_bucket, row, context);
    record(byEntryGrade, context.entry_grade, row, context);
    record(byTimingBucket, context.timing_bucket, row, context);
    record(byMarketQualityBucket, context.market_quality_bucket, row, context);
    record(bySpreadBucket, context.spread_bucket, row, context);
    record(byFundingRateBucket, context.funding_rate_bucket, row, context);
    record(byOpenInterestDeltaBucket, context.open_interest_delta_bucket, row, context);
    record(byLiquidationNotional5mBucket, context.liquidation_notional_5m_bucket, row, context);
    record(byBtc1hAlignment, context.btc_1h_alignment, row, context);
    record(byMtf1hAlignment, context.mtf_1h_alignment, row, context);
    record(byEvidenceCompleteness, context.evidence_completeness, row, context);
  }

  const setupRegimeRows = finalizeBucketRows(bySetupRegime);
  const topPositiveSetupRegime = setupRegimeRows[0] || null;
  const topNegativeSetupRegime = setupRegimeRows.length
    ? [...setupRegimeRows].sort((a, b) => Number(a.net_pnl_usdt || 0) - Number(b.net_pnl_usdt || 0) || String(a.key).localeCompare(String(b.key)))[0]
    : null;

  return Object.freeze({
    by_setup_type: finalizeBucketRows(bySetupType),
    by_regime_cohort: finalizeBucketRows(byRegimeCohort),
    by_edge_cohort: finalizeBucketRows(byEdgeCohort),
    by_setup_regime: setupRegimeRows,
    by_signal_score_bucket: finalizeBucketRows(bySignalScoreBucket),
    by_trigger_quality_bucket: finalizeBucketRows(byTriggerQualityBucket),
    by_entry_grade: finalizeBucketRows(byEntryGrade),
    by_timing_bucket: finalizeBucketRows(byTimingBucket),
    by_market_quality_bucket: finalizeBucketRows(byMarketQualityBucket),
    by_spread_bucket: finalizeBucketRows(bySpreadBucket),
    by_funding_rate_bucket: finalizeBucketRows(byFundingRateBucket),
    by_open_interest_delta_bucket: finalizeBucketRows(byOpenInterestDeltaBucket),
    by_liquidation_notional_5m_bucket: finalizeBucketRows(byLiquidationNotional5mBucket),
    by_btc_1h_alignment: finalizeBucketRows(byBtc1hAlignment),
    by_mtf_1h_alignment: finalizeBucketRows(byMtf1hAlignment),
    by_evidence_completeness: finalizeBucketRows(byEvidenceCompleteness),
    top_positive_setup_regime: topPositiveSetupRegime,
    top_negative_setup_regime: topNegativeSetupRegime,
  });
}

module.exports = {
  extractOutcomeContext,
  summarizeOutcomeCohorts,
  missingFullEvidenceFields,
  FULL_EVIDENCE_REQUIRED_FIELDS,
  __test: {
    bucketSignalScore,
    bucketTriggerQuality,
    bucketMarketQuality,
    bucketSpreadBps,
    bucketFundingRate,
    bucketSignedPct,
    bucketLiquidationNotional,
    resolveBtcAlignment,
  },
};
