"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function summarizeCounts(values = []) {
  const counts = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const key = upper(value);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ key, count }));
}

function incrementCount(map, key) {
  const resolved = upper(key);
  if (!resolved) return;
  map.set(resolved, (map.get(resolved) || 0) + 1);
}

function deriveFailurePattern(row = {}) {
  const label = row && row.label_snapshot && typeof row.label_snapshot === "object" ? row.label_snapshot : {};
  const feature = row && row.feature_snapshot && typeof row.feature_snapshot === "object" ? row.feature_snapshot : {};
  const realizedRetNet = toNum(label.realized_ret_net);
  const pnlGross = toNum(feature.pnl_krw_gross);
  const feeValue = toNum(feature.fee_value) || 0;
  if (label.sl_first === true) return "SL_FIRST";
  if (label.pre_tp1_time_stop === true) return "PRE_TP1_TIME_STOP";
  if (label.time_stop_first === true) return "TIME_STOP_FIRST";
  if (label.tp0_hit === true && label.tp0_to_tp1_converted !== true) return "TP0_NO_TP1_CONVERT";
  if (Number.isFinite(realizedRetNet) && realizedRetNet < 0) return "NEGATIVE_REALIZED";
  if (Math.abs(feeValue) > Math.abs(toNum(pnlGross) || 0)) return "FEE_DRAG_DOMINANT";
  return "OTHER_FAILURE";
}

function normalizeDataset(dataset = null) {
  if (!dataset || typeof dataset !== "object") return {};
  if (dataset.dataset && typeof dataset.dataset === "object") return dataset.dataset;
  return dataset;
}

function buildFailureLearningLoop({
  dataset = null,
} = {}) {
  const item = normalizeDataset(dataset);
  const rows = Array.isArray(item.rows) ? item.rows : [];
  const executedRows = rows.filter((row) => row && row.label_snapshot && row.label_snapshot.is_executed === true);
  const failingRows = executedRows.filter((row) => {
    const label = row.label_snapshot || {};
    const feature = row.feature_snapshot || {};
    const realizedRetNet = toNum(label.realized_ret_net);
    const pnlGross = toNum(feature.pnl_krw_gross);
    const feeValue = toNum(feature.fee_value) || 0;
    return label.sl_first === true
      || label.pre_tp1_time_stop === true
      || label.time_stop_first === true
      || (label.tp0_hit === true && label.tp0_to_tp1_converted !== true)
      || (Number.isFinite(realizedRetNet) && realizedRetNet < 0)
      || (Math.abs(feeValue) > Math.abs(pnlGross || 0));
  });

  const patternBreakdown = summarizeCounts(failingRows.map(deriveFailurePattern));
  const marketMap = new Map();
  for (const row of failingRows) {
    const market = upper(row.market) || "UNKNOWN";
    const acc = marketMap.get(market) || {
      market,
      fail_n: 0,
      realized_ret_sum: 0,
      fee_dominant_n: 0,
      negative_realized_n: 0,
      sl_first_n: 0,
      tp0_no_tp1_n: 0,
      time_stop_n: 0,
      by_entry_tier: new Map(),
      by_pattern: new Map(),
    };
    const pattern = deriveFailurePattern(row);
    const entryTier = upper(row && row.feature_snapshot && row.feature_snapshot.entry_tier) || "UNKNOWN";
    acc.fail_n += 1;
    acc.realized_ret_sum += toNum(row.label_snapshot && row.label_snapshot.realized_ret_net) || 0;
    if (pattern === "FEE_DRAG_DOMINANT") acc.fee_dominant_n += 1;
    if (pattern === "NEGATIVE_REALIZED") acc.negative_realized_n += 1;
    if (pattern === "SL_FIRST") acc.sl_first_n += 1;
    if (pattern === "TP0_NO_TP1_CONVERT") acc.tp0_no_tp1_n += 1;
    if (pattern === "PRE_TP1_TIME_STOP" || pattern === "TIME_STOP_FIRST") acc.time_stop_n += 1;
    incrementCount(acc.by_entry_tier, entryTier);
    incrementCount(acc.by_pattern, pattern);
    marketMap.set(market, acc);
  }
  const marketBreakdown = [...marketMap.values()]
    .map((row) => ({
      ...row,
      avg_realized_ret_net: row.fail_n > 0 ? row.realized_ret_sum / row.fail_n : null,
      dominant_entry_tier: [...row.by_entry_tier.entries()].sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || null,
      dominant_failure_pattern: [...row.by_pattern.entries()].sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || null,
      by_entry_tier: [...row.by_entry_tier.entries()]
        .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
        .map(([key, count]) => ({ key, count })),
      by_pattern: [...row.by_pattern.entries()]
        .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
        .map(([key, count]) => ({ key, count })),
    }))
    .sort((a, b) => Number(b.fail_n) - Number(a.fail_n) || (toNum(a.avg_realized_ret_net) || Infinity) - (toNum(b.avg_realized_ret_net) || Infinity))
    .slice(0, 10);

  const failRate = executedRows.length > 0 ? failingRows.length / executedRows.length : null;
  const minFailureSampleN = Math.max(5, Number(process.env.FAILURE_LEARNING_MIN_FAILURE_N || 12));
  const maxFailureRate = Math.max(0, Math.min(1, Number(process.env.FAILURE_LEARNING_MAX_FAIL_RATE || 0.45)));
  const severeNegativeAvgRetNet = Number(process.env.FAILURE_LEARNING_SEVERE_NEGATIVE_AVG_RET_NET || -0.005);
  const severeNegativeMarketMinFailN = Math.max(2, Number(process.env.FAILURE_LEARNING_SEVERE_NEGATIVE_MARKET_MIN_FAIL_N || 4));
  const severeNegativeMarketMinN = Math.max(1, Number(process.env.FAILURE_LEARNING_SEVERE_NEGATIVE_MARKET_N || 3));
  const dominantPattern = patternBreakdown[0] ? patternBreakdown[0].key : null;
  const topFailureMarket = marketBreakdown[0] ? marketBreakdown[0].market : null;
  const strongNegativeMarketN = marketBreakdown.filter((row) => (
    (row.dominant_failure_pattern === "NEGATIVE_REALIZED" || row.dominant_failure_pattern === "SL_FIRST")
    && (toNum(row.fail_n) || 0) >= severeNegativeMarketMinFailN
    && Number.isFinite(toNum(row.avg_realized_ret_net))
    && toNum(row.avg_realized_ret_net) <= severeNegativeAvgRetNet
  )).length;
  const negativeDominantReview = dominantPattern === "SL_FIRST" || dominantPattern === "NEGATIVE_REALIZED";
  const severeNegativeDominant = negativeDominantReview
    && (
      (Number.isFinite(failRate) && failRate > maxFailureRate)
      || strongNegativeMarketN >= severeNegativeMarketMinN
    );

  const recommendations = [];
  if (dominantPattern === "PRE_TP1_TIME_STOP" || dominantPattern === "TIME_STOP_FIRST") {
    recommendations.push({ key: "REVIEW_TRAIL_AND_RUNNER_FLOOR", reason: dominantPattern });
  }
  if (dominantPattern === "TP0_NO_TP1_CONVERT") {
    recommendations.push({ key: "REVIEW_TP0_TP1_CONVERSION", reason: dominantPattern });
  }
  if (dominantPattern === "SL_FIRST" || dominantPattern === "NEGATIVE_REALIZED") {
    recommendations.push({ key: "TIGHTEN_ENTRY_AND_CAPITAL_SCALE", reason: dominantPattern });
  }
  if (patternBreakdown.some((row) => row.key === "FEE_DRAG_DOMINANT")) {
    recommendations.push({ key: "RAISE_EXECUTION_QUALITY_AND_REENTRY_FILTER", reason: "FEE_DRAG_DOMINANT" });
  }

  const blockingReasons = [];
  if (failingRows.length < minFailureSampleN) blockingReasons.push("FAILURE_LEARNING_SAMPLE_LOW");
  if (Number.isFinite(failRate) && failRate > maxFailureRate) blockingReasons.push("FAILURE_LEARNING_FAIL_RATE_HIGH");
  if (severeNegativeDominant) blockingReasons.push("FAILURE_LEARNING_NEGATIVE_DOMINANT");

  let evidenceStatus = "FAILURE_LEARNING_PASS";
  if (failingRows.length < minFailureSampleN) evidenceStatus = "FAILURE_LEARNING_SAMPLE_LOW";
  else if (Number.isFinite(failRate) && failRate > maxFailureRate) evidenceStatus = "FAILURE_LEARNING_FAIL_RATE_HIGH";
  else if (severeNegativeDominant) evidenceStatus = "FAILURE_LEARNING_NEGATIVE_DOMINANT";
  else if (negativeDominantReview) evidenceStatus = "FAILURE_LEARNING_NEGATIVE_REVIEW";

  return {
    status: "FAILURE_LEARNING_LOOP_READY",
    learning_ready: failingRows.length >= minFailureSampleN,
    evidence_status: evidenceStatus,
    rows_n: rows.length,
    executed_rows_n: executedRows.length,
    failure_rows_n: failingRows.length,
    fail_rate: failRate,
    dominant_failure_pattern: dominantPattern,
    top_failure_market: topFailureMarket,
    strong_negative_market_n: strongNegativeMarketN,
    pattern_breakdown: patternBreakdown,
    market_breakdown: marketBreakdown,
    recommendations,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
    thresholds: {
      min_failure_n: minFailureSampleN,
      max_fail_rate: maxFailureRate,
      severe_negative_avg_ret_net: severeNegativeAvgRetNet,
      severe_negative_market_min_fail_n: severeNegativeMarketMinFailN,
      severe_negative_market_n: severeNegativeMarketMinN,
    },
    dataset_hash: norm(item.dataset_hash),
  };
}

module.exports = {
  buildFailureLearningLoop,
  __test: {
    deriveFailurePattern,
    normalizeDataset,
  },
};
