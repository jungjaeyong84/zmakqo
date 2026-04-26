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

function metricNumber(marketDataQuality = null, ...keys) {
  const row = asObject(marketDataQuality);
  const metrics = asObject(row && row.metrics);
  for (const source of [metrics, row]) {
    const obj = asObject(source);
    if (!obj) continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const n = toNumberOrNull(obj[key]);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

function featureValue(features = null, ...keys) {
  const row = asObject(features);
  if (!row) return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return null;
}

function normalizeDirection(value) {
  const token = upper(value);
  if (token === "LONG" || token === "BUY" || token === "BULL" || token === "UP" || token === "RISING") return "LONG";
  if (token === "SHORT" || token === "SELL" || token === "BEAR" || token === "DOWN" || token === "FALLING") return "SHORT";
  if (token === "NEUTRAL" || token === "SIDEWAYS" || token === "FLAT") return "NEUTRAL";
  return null;
}

function resolveShadowFilterPolicy({ thresholds = null } = {}) {
  const cfg = asObject(thresholds) || {};
  return Object.freeze({
    mode: upper(cfg.mode) || "SHADOW_ONLY",
    max_volatility_30m_baseline_ratio: toNumberOrNull(cfg.max_volatility_30m_baseline_ratio) ?? 3,
    max_volatility_zscore: toNumberOrNull(cfg.max_volatility_zscore) ?? 3,
    min_cost_adjusted_edge_bps: toNumberOrNull(cfg.min_cost_adjusted_edge_bps) ?? 0,
    min_cost_adjusted_net_r: toNumberOrNull(cfg.min_cost_adjusted_net_r) ?? 0,
  });
}

function buildFilterResult({ id, status, reason, observed = null, threshold = null, wouldBlock = false } = {}) {
  return Object.freeze({
    id,
    status,
    reason,
    would_block: wouldBlock === true,
    observed,
    threshold,
  });
}

function evaluateBtcTrendFilter({ symbol, side, features }) {
  const sym = upper(symbol);
  const signalSide = upper(side);
  const btcTrend = normalizeDirection(
    featureValue(features, "btc_1h_trend", "btc_1h_direction", "btc_1h_regime", "btc_htf_regime")
  );
  if (!sym || sym === "BTCUSDT" || signalSide !== "LONG") {
    return buildFilterResult({
      id: "BTC_1H_TREND_ALT_LONG",
      status: "NOT_APPLICABLE",
      reason: "BTC_TREND_FILTER_ONLY_APPLIES_TO_ALT_LONG",
      observed: { symbol: sym, side: signalSide, btc_1h_trend: btcTrend },
    });
  }
  if (!btcTrend) {
    return buildFilterResult({
      id: "BTC_1H_TREND_ALT_LONG",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "BTC_1H_TREND_MISSING",
      observed: { symbol: sym, side: signalSide, btc_1h_trend: null },
    });
  }
  const wouldBlock = btcTrend === "SHORT";
  return buildFilterResult({
    id: "BTC_1H_TREND_ALT_LONG",
    status: wouldBlock ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: wouldBlock ? "BTC_1H_TREND_DOWN_ALT_LONG_RISK" : "BTC_1H_TREND_NOT_DOWN",
    observed: { symbol: sym, side: signalSide, btc_1h_trend: btcTrend },
    wouldBlock,
  });
}

function evaluateMultiTfAlignmentFilter({ side, features, signalCriteria = null }) {
  const signalSide = upper(side);
  const criteria = asObject(signalCriteria);
  const htf = asObject(criteria && criteria.htf_regime);
  const direction = normalizeDirection(
    featureValue(features, "mtf_1h_direction", "one_hour_direction", "h1_direction", "htf_direction", "htf_regime")
    ?? (htf && htf.regime)
  );
  if (!direction) {
    return buildFilterResult({
      id: "MULTI_TF_1H_ALIGNMENT",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "ONE_HOUR_DIRECTION_MISSING",
      observed: { side: signalSide, one_hour_direction: null },
    });
  }
  if (direction === "NEUTRAL") {
    return buildFilterResult({
      id: "MULTI_TF_1H_ALIGNMENT",
      status: "WOULD_BLOCK",
      reason: "ONE_HOUR_DIRECTION_NEUTRAL",
      observed: { side: signalSide, one_hour_direction: direction },
      wouldBlock: true,
    });
  }
  const wouldBlock = signalSide !== direction;
  return buildFilterResult({
    id: "MULTI_TF_1H_ALIGNMENT",
    status: wouldBlock ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: wouldBlock ? "ONE_HOUR_DIRECTION_OPPOSES_SIGNAL" : "ONE_HOUR_DIRECTION_ALIGNED",
    observed: { side: signalSide, one_hour_direction: direction },
    wouldBlock,
  });
}

function evaluateVolatilityChaosFilter({ features, marketDataQuality, policy }) {
  const ratio = toNumberOrNull(
    featureValue(features, "volatility_30m_baseline_ratio", "range_30m_baseline_ratio", "volatility_30m_vs_normal")
  );
  const zscore = toNumberOrNull(
    featureValue(features, "volatility_30m_zscore", "range_30m_zscore", "volatility_zscore")
    ?? metricNumber(marketDataQuality, "volatility_30m_zscore", "volatility_zscore")
  );
  if (ratio === null && zscore === null) {
    return buildFilterResult({
      id: "VOLATILITY_CHAOS_30M",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "VOLATILITY_30M_EVIDENCE_MISSING",
      observed: { volatility_30m_baseline_ratio: null, volatility_zscore: null },
      threshold: {
        max_volatility_30m_baseline_ratio: policy.max_volatility_30m_baseline_ratio,
        max_volatility_zscore: policy.max_volatility_zscore,
      },
    });
  }
  const ratioBlock = ratio !== null && ratio > policy.max_volatility_30m_baseline_ratio;
  const zBlock = zscore !== null && zscore > policy.max_volatility_zscore;
  const wouldBlock = ratioBlock || zBlock;
  return buildFilterResult({
    id: "VOLATILITY_CHAOS_30M",
    status: wouldBlock ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: wouldBlock ? "VOLATILITY_CHAOS_REGIME" : "VOLATILITY_WITHIN_NORMAL_RANGE",
    observed: { volatility_30m_baseline_ratio: ratio, volatility_zscore: zscore },
    threshold: {
      max_volatility_30m_baseline_ratio: policy.max_volatility_30m_baseline_ratio,
      max_volatility_zscore: policy.max_volatility_zscore,
    },
    wouldBlock,
  });
}

function evaluateCostAdjustedEdgeFilter({ features, marketDataQuality, signalCriteria = null, policy }) {
  const criteria = asObject(signalCriteria);
  const edgeGate = asObject(criteria && criteria.expected_edge_gate);
  const expectedAlphaBps = toNumberOrNull(
    featureValue(features, "expected_alpha_bps", "edge_bps", "expected_return_bps")
  );
  const totalCostBps = toNumberOrNull(
    featureValue(features, "total_cost_bps", "cost_estimate_bps")
    ?? metricNumber(marketDataQuality, "total_cost_bps", "cost_estimate_bps")
    ?? (edgeGate && edgeGate.cost_estimate_bps)
  );
  const expectedNetR = toNumberOrNull(
    featureValue(features, "expected_net_r_after_cost", "net_r_after_cost", "expected_net_r")
    ?? (edgeGate && edgeGate.expected_net_r_after_cost)
  );
  const bpsEdge = expectedAlphaBps !== null && totalCostBps !== null
    ? expectedAlphaBps - totalCostBps
    : null;
  if (bpsEdge === null && expectedNetR === null) {
    return buildFilterResult({
      id: "COST_ADJUSTED_EDGE",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "COST_ADJUSTED_EDGE_EVIDENCE_MISSING",
      observed: { expected_alpha_bps: expectedAlphaBps, total_cost_bps: totalCostBps, expected_net_r_after_cost: expectedNetR },
      threshold: {
        min_cost_adjusted_edge_bps: policy.min_cost_adjusted_edge_bps,
        min_cost_adjusted_net_r: policy.min_cost_adjusted_net_r,
      },
    });
  }
  const bpsBlock = bpsEdge !== null && bpsEdge <= policy.min_cost_adjusted_edge_bps;
  const netRBlock = expectedNetR !== null && expectedNetR <= policy.min_cost_adjusted_net_r;
  const wouldBlock = bpsBlock || netRBlock;
  return buildFilterResult({
    id: "COST_ADJUSTED_EDGE",
    status: wouldBlock ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: wouldBlock ? "EXPECTED_ALPHA_NOT_ABOVE_COST" : "EXPECTED_ALPHA_ABOVE_COST",
    observed: { expected_alpha_bps: expectedAlphaBps, total_cost_bps: totalCostBps, edge_after_cost_bps: bpsEdge, expected_net_r_after_cost: expectedNetR },
    threshold: {
      min_cost_adjusted_edge_bps: policy.min_cost_adjusted_edge_bps,
      min_cost_adjusted_net_r: policy.min_cost_adjusted_net_r,
    },
    wouldBlock,
  });
}

function buildSignalShadowFilters({
  symbol,
  signalSide,
  featureValues = null,
  marketDataQuality = null,
  signalCriteria = null,
  thresholds = null,
} = {}) {
  const side = upper(signalSide);
  const features = asObject(featureValues) || {};
  const policy = resolveShadowFilterPolicy({ thresholds });
  const filters = Object.freeze([
    evaluateBtcTrendFilter({ symbol, side, features }),
    evaluateMultiTfAlignmentFilter({ side, features, signalCriteria }),
    evaluateVolatilityChaosFilter({ features, marketDataQuality, policy }),
    evaluateCostAdjustedEdgeFilter({ features, marketDataQuality, signalCriteria, policy }),
  ]);
  const wouldBlockFilters = filters.filter((row) => row && row.would_block === true);
  const insufficientEvidenceFilters = filters.filter((row) => row && row.status === "INSUFFICIENT_EVIDENCE");
  return Object.freeze({
    present: true,
    mode: policy.mode,
    hard_block_enabled: false,
    shadow_verdict: wouldBlockFilters.length ? "WOULD_BLOCK" : "WOULD_PASS",
    would_block: wouldBlockFilters.length > 0,
    blockers: Object.freeze(wouldBlockFilters.map((row) => `SHADOW_FILTER:${row.id}:${row.reason}`)),
    insufficient_evidence: Object.freeze(insufficientEvidenceFilters.map((row) => `SHADOW_FILTER:${row.id}:${row.reason}`)),
    filters,
    policy,
  });
}

module.exports = {
  buildSignalShadowFilters,
  resolveShadowFilterPolicy,
  __test: {
    normalizeDirection,
    evaluateBtcTrendFilter,
    evaluateMultiTfAlignmentFilter,
    evaluateVolatilityChaosFilter,
    evaluateCostAdjustedEdgeFilter,
  },
};
