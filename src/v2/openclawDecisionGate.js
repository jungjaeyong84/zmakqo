"use strict";

const { buildSignalShadowFilters } = require("./signalShadowFilters");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readEnvBool(envObj, name, fallback = false) {
  const env = asObject(envObj) || {};
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const text = String(raw).trim().toLowerCase();
  if (text === "1" || text === "true" || text === "yes" || text === "on") return true;
  if (text === "0" || text === "false" || text === "no" || text === "off") return false;
  return fallback;
}

function readEnvNumber(envObj, name, fallback) {
  const env = asObject(envObj) || {};
  return toNumberOrNull(env[name]) ?? fallback;
}

function featureValue(features = null, ...keys) {
  const row = asObject(features);
  if (!row) return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return null;
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

function mergeObjects(...rows) {
  const out = {};
  for (const row of rows) {
    const obj = asObject(row);
    if (!obj) continue;
    Object.assign(out, obj);
  }
  return Object.freeze(out);
}

function resolveFeatureValues(bundle = null) {
  const row = asObject(bundle);
  const featureSnapshot = asObject(row && row.featureSnapshot);
  const signalIntent = asObject(row && row.signalIntent);
  const decision = asObject(row && row.openclawDecision);
  const evidence = asObject(decision && decision.canonical_evidence_summary) || asObject(row && row.canonicalEvidenceSummary);
  const evidenceFeatureSnapshot = asObject(evidence && evidence.feature_snapshot);
  const signalCriteria = asObject(row && row.signalCriteria) || asObject(evidence && evidence.signal_criteria);
  const featureContract = asObject(signalCriteria && signalCriteria.feature_snapshot_contract);
  return mergeObjects(
    featureSnapshot && featureSnapshot.feature_values,
    featureSnapshot && featureSnapshot.features,
    featureSnapshot && featureSnapshot.featureValues,
    signalIntent && signalIntent.feature_values,
    signalIntent && signalIntent.features,
    evidenceFeatureSnapshot && evidenceFeatureSnapshot.feature_values,
    evidenceFeatureSnapshot && evidenceFeatureSnapshot.features,
    featureContract,
  );
}

function resolveSignalCriteria(bundle = null) {
  const row = asObject(bundle);
  const decision = asObject(row && row.openclawDecision);
  const evidence = asObject(decision && decision.canonical_evidence_summary) || asObject(row && row.canonicalEvidenceSummary);
  return asObject(row && row.signalCriteria) || asObject(evidence && evidence.signal_criteria) || null;
}

function resolveMarketDataQuality(bundle = null) {
  const row = asObject(bundle);
  const decision = asObject(row && row.openclawDecision);
  const evidence = asObject(decision && decision.canonical_evidence_summary) || asObject(row && row.canonicalEvidenceSummary);
  return asObject(row && row.marketDataQuality) || asObject(evidence && evidence.market_data_quality) || null;
}

function resolveEntryContext({ bundle = null, routedDecision = null } = {}) {
  const entryIntent = asObject(routedDecision && routedDecision.entryIntent);
  const signalIntent = asObject(bundle && bundle.signalIntent);
  return Object.freeze({
    symbol: upper(entryIntent && entryIntent.symbol) || upper(signalIntent && signalIntent.symbol),
    side: upper(entryIntent && entryIntent.side) || upper(signalIntent && signalIntent.side),
    decision_mode: upper(entryIntent && entryIntent.decision_mode)
      || upper(bundle && bundle.openclawDecision && bundle.openclawDecision.decision_mode),
  });
}

function normalizeFundingBps(rawFundingRate, rawFundingBps) {
  const bps = toNumberOrNull(rawFundingBps);
  if (bps !== null) return bps;
  const rate = toNumberOrNull(rawFundingRate);
  if (rate === null) return null;
  return Math.abs(rate) < 1 ? rate * 10000 : rate;
}

function normalizeBidShare(raw) {
  const n = toNumberOrNull(raw);
  if (n === null) return null;
  if (n >= 0 && n <= 1) return n;
  if (n > 1) return n / (1 + n);
  if (n >= -1 && n < 0) return (n + 1) / 2;
  return null;
}

function buildFilterResult({ id, status, reason, observed = null, threshold = null, wouldBlock = false } = {}) {
  return Object.freeze({
    id,
    status,
    reason,
    observed,
    threshold,
    would_block: wouldBlock === true,
  });
}

function normalizeSetupType(value) {
  const token = upper(value);
  if (!token) return "NONE";
  if (token === "BREAKOUT" || token === "BREAKDOWN") return "BREAKOUT_RETEST";
  if (token === "RECLAIM" || token === "LOSS") return "PULLBACK_RECLAIM";
  if (token === "CONTINUATION") return "MOMENTUM_CONTINUATION";
  if (token === "PULLBACK_RECLAIM" || token === "PULLBACK_PROBE" || token === "BREAKOUT_RETEST" || token === "MOMENTUM_CONTINUATION" || token === "NONE") {
    return token;
  }
  return "NONE";
}

function shouldSoftenDirectionalFiltersForDiscovery({ context = null, signalCriteria = null } = {}) {
  const criteria = asObject(signalCriteria);
  const ctx = asObject(context);
  const criteriaProfile = upper(criteria && criteria.criteria_profile);
  const verdict = upper(criteria && criteria.verdict);
  const entryGrade = upper(criteria && criteria.entry_grade);
  const setupType = normalizeSetupType(
    criteria && criteria.setup_gate && criteria.setup_gate.setup_type
  );
  const side = upper(ctx && ctx.side);
  if (criteriaProfile !== "V6_COMPAT_DISCOVERY") return false;
  if (verdict !== "PASS") return false;
  if (side !== "LONG") return false;
  if (entryGrade !== "CORE") return false;
  return setupType === "BREAKOUT_RETEST" || setupType === "MOMENTUM_CONTINUATION";
}

function softenDirectionalFilter(filter, reasonSuffix) {
  const row = asObject(filter);
  if (!row) return filter;
  return Object.freeze({
    ...row,
    status: "WARNING_ONLY",
    reason: `${row.reason}${reasonSuffix ? `:${reasonSuffix}` : ""}`,
    would_block: false,
    softened_by_discovery_long_core_policy: true,
  });
}

function resolvePolicy(env = process.env) {
  return Object.freeze({
    enabled: readEnvBool(env, "DONBEOLJA_V2_OPENCLAW_DECISION_GATE_ENABLED", true),
    mode: upper((asObject(env) || {}).DONBEOLJA_V2_OPENCLAW_DECISION_GATE_MODE) || "BLOCK_ONLY",
    require_evidence: readEnvBool(env, "DONBEOLJA_V2_OPENCLAW_DECISION_GATE_REQUIRE_EVIDENCE", false),
    max_volatility_30m_baseline_ratio: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MAX_VOLATILITY_30M_BASELINE_RATIO", 3),
    max_volatility_zscore: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MAX_VOLATILITY_ZSCORE", 3),
    min_cost_adjusted_edge_bps: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MIN_COST_ADJUSTED_EDGE_BPS", 0),
    min_cost_adjusted_net_r: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MIN_COST_ADJUSTED_NET_R", 0),
    max_adverse_funding_bps: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MAX_ADVERSE_FUNDING_BPS", 8),
    max_liquidation_notional_5m_quote: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MAX_LIQUIDATION_NOTIONAL_5M_QUOTE", 10000000),
    max_oi_delta_abs_pct_15m: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MAX_OI_DELTA_ABS_PCT_15M", 12),
    min_orderbook_bid_share_long: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MIN_ORDERBOOK_BID_SHARE_LONG", 0.35),
    max_orderbook_bid_share_short: readEnvNumber(env, "DONBEOLJA_V2_OPENCLAW_MAX_ORDERBOOK_BID_SHARE_SHORT", 0.65),
  });
}

function evaluateFundingFilter({ side, features, marketDataQuality, policy }) {
  const fundingBps = normalizeFundingBps(
    featureValue(features, "funding_rate", "current_funding_rate"),
    featureValue(features, "funding_rate_bps", "current_funding_rate_bps")
      ?? metricNumber(marketDataQuality, "funding_rate_bps", "current_funding_rate_bps")
  );
  const fundingPenaltyBps = toNumberOrNull(
    featureValue(features, "funding_penalty_bps") ?? metricNumber(marketDataQuality, "funding_penalty_bps")
  );
  const effectivePenalty = fundingPenaltyBps ?? (side === "LONG" && fundingBps !== null
    ? Math.max(0, fundingBps)
    : (side === "SHORT" && fundingBps !== null ? Math.max(0, -fundingBps) : null));
  if (effectivePenalty === null) {
    return buildFilterResult({
      id: "FUNDING_ADVERSE",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "FUNDING_EVIDENCE_MISSING",
      observed: { side, funding_rate_bps: fundingBps, funding_penalty_bps: fundingPenaltyBps },
      threshold: { max_adverse_funding_bps: policy.max_adverse_funding_bps },
    });
  }
  const wouldBlock = effectivePenalty > policy.max_adverse_funding_bps;
  return buildFilterResult({
    id: "FUNDING_ADVERSE",
    status: wouldBlock ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: wouldBlock ? "ADVERSE_FUNDING_TOO_HIGH" : "ADVERSE_FUNDING_WITHIN_LIMIT",
    observed: { side, funding_rate_bps: fundingBps, funding_penalty_bps: fundingPenaltyBps, effective_penalty_bps: effectivePenalty },
    threshold: { max_adverse_funding_bps: policy.max_adverse_funding_bps },
    wouldBlock,
  });
}

function evaluateLiquidationChaosFilter({ features, marketDataQuality, policy }) {
  const notional5m = toNumberOrNull(
    featureValue(features, "liquidation_notional_5m_quote", "force_order_notional_5m_quote")
      ?? metricNumber(marketDataQuality, "liquidation_notional_5m_quote", "force_order_notional_5m_quote")
  );
  if (notional5m === null) {
    return buildFilterResult({
      id: "LIQUIDATION_CHAOS_5M",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "LIQUIDATION_5M_EVIDENCE_MISSING",
      observed: { liquidation_notional_5m_quote: null },
      threshold: { max_liquidation_notional_5m_quote: policy.max_liquidation_notional_5m_quote },
    });
  }
  const wouldBlock = notional5m > policy.max_liquidation_notional_5m_quote;
  return buildFilterResult({
    id: "LIQUIDATION_CHAOS_5M",
    status: wouldBlock ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: wouldBlock ? "LIQUIDATION_CHAOS_ACTIVE" : "LIQUIDATION_WITHIN_LIMIT",
    observed: { liquidation_notional_5m_quote: notional5m },
    threshold: { max_liquidation_notional_5m_quote: policy.max_liquidation_notional_5m_quote },
    wouldBlock,
  });
}

function evaluateOpenInterestFilter({ side, features, policy }) {
  const oiDelta = toNumberOrNull(featureValue(features, "open_interest_delta_pct_15m", "open_interest_delta_pct", "oi_delta_pct_15m", "oi_delta_pct"));
  const priceDelta = toNumberOrNull(featureValue(features, "price_change_pct_15m", "return_pct_15m", "close_change_pct_15m"));
  const explicitAdverse = featureValue(features, "open_interest_adverse", "oi_price_divergence_adverse") === true;
  if (explicitAdverse) {
    return buildFilterResult({
      id: "OPEN_INTEREST_DIVERGENCE",
      status: "WOULD_BLOCK",
      reason: "OPEN_INTEREST_ADVERSE_FLAGGED",
      observed: { side, open_interest_delta_pct: oiDelta, price_change_pct_15m: priceDelta, open_interest_adverse: true },
      threshold: { max_oi_delta_abs_pct_15m: policy.max_oi_delta_abs_pct_15m },
      wouldBlock: true,
    });
  }
  if (oiDelta === null || priceDelta === null) {
    return buildFilterResult({
      id: "OPEN_INTEREST_DIVERGENCE",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "OPEN_INTEREST_PRICE_EVIDENCE_MISSING",
      observed: { side, open_interest_delta_pct: oiDelta, price_change_pct_15m: priceDelta },
      threshold: { max_oi_delta_abs_pct_15m: policy.max_oi_delta_abs_pct_15m },
    });
  }
  const shock = Math.abs(oiDelta) > policy.max_oi_delta_abs_pct_15m;
  const adverse = shock && ((side === "LONG" && priceDelta < 0) || (side === "SHORT" && priceDelta > 0));
  return buildFilterResult({
    id: "OPEN_INTEREST_DIVERGENCE",
    status: adverse ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: adverse ? "OPEN_INTEREST_SHOCK_AGAINST_SIGNAL" : "OPEN_INTEREST_NOT_ADVERSE",
    observed: { side, open_interest_delta_pct: oiDelta, price_change_pct_15m: priceDelta },
    threshold: { max_oi_delta_abs_pct_15m: policy.max_oi_delta_abs_pct_15m },
    wouldBlock: adverse,
  });
}

function evaluateOrderbookImbalanceFilter({ side, features, marketDataQuality, policy }) {
  const bidShare = normalizeBidShare(
    featureValue(features, "orderbook_bid_share_top5", "orderbook_imbalance_top5", "depth_imbalance_top5", "bid_ask_imbalance_top5")
      ?? metricNumber(marketDataQuality, "orderbook_bid_share_top5", "orderbook_imbalance_top5", "depth_imbalance_top5", "bid_ask_imbalance_top5")
  );
  if (bidShare === null) {
    return buildFilterResult({
      id: "ORDERBOOK_IMBALANCE_TOP5",
      status: "INSUFFICIENT_EVIDENCE",
      reason: "ORDERBOOK_IMBALANCE_EVIDENCE_MISSING",
      observed: { side, bid_share_top5: null },
      threshold: {
        min_orderbook_bid_share_long: policy.min_orderbook_bid_share_long,
        max_orderbook_bid_share_short: policy.max_orderbook_bid_share_short,
      },
    });
  }
  const wouldBlock = (side === "LONG" && bidShare < policy.min_orderbook_bid_share_long)
    || (side === "SHORT" && bidShare > policy.max_orderbook_bid_share_short);
  return buildFilterResult({
    id: "ORDERBOOK_IMBALANCE_TOP5",
    status: wouldBlock ? "WOULD_BLOCK" : "WOULD_PASS",
    reason: wouldBlock ? "ORDERBOOK_IMBALANCE_AGAINST_SIGNAL" : "ORDERBOOK_IMBALANCE_ACCEPTABLE",
    observed: { side, bid_share_top5: bidShare },
    threshold: {
      min_orderbook_bid_share_long: policy.min_orderbook_bid_share_long,
      max_orderbook_bid_share_short: policy.max_orderbook_bid_share_short,
    },
    wouldBlock,
  });
}

function evaluateV2OpenClawDecisionGate({
  env = process.env,
  bundle,
  routedDecision = null,
} = {}) {
  const policy = resolvePolicy(env);
  const context = resolveEntryContext({ bundle, routedDecision });
  if (policy.enabled !== true) {
    return Object.freeze({
      ok: true,
      reason: "V2_OPENCLAW_DECISION_GATE_DISABLED",
      enabled: false,
      mode: policy.mode,
      decision: "PASS",
      no_sizing_mutation: true,
      blockers: Object.freeze([]),
      warnings: Object.freeze([]),
      filters: Object.freeze([]),
      policy,
      context,
    });
  }
  const features = resolveFeatureValues(bundle);
  const marketDataQuality = resolveMarketDataQuality(bundle);
  const signalCriteria = resolveSignalCriteria(bundle);
  const softenDirectionalFilters = shouldSoftenDirectionalFiltersForDiscovery({
    context,
    signalCriteria,
  });
  const shadowFilterDecision = buildSignalShadowFilters({
    symbol: context.symbol,
    signalSide: context.side,
    featureValues: features,
    marketDataQuality,
    signalCriteria,
    thresholds: {
      mode: policy.mode,
      max_volatility_30m_baseline_ratio: policy.max_volatility_30m_baseline_ratio,
      max_volatility_zscore: policy.max_volatility_zscore,
      min_cost_adjusted_edge_bps: policy.min_cost_adjusted_edge_bps,
      min_cost_adjusted_net_r: policy.min_cost_adjusted_net_r,
    },
  });
  const directionalFilterIds = new Set(["BTC_1H_TREND_ALT_LONG", "MULTI_TF_1H_ALIGNMENT"]);
  const rawFilters = [
    evaluateFundingFilter({ side: context.side, features, marketDataQuality, policy }),
    evaluateLiquidationChaosFilter({ features, marketDataQuality, policy }),
    evaluateOpenInterestFilter({ side: context.side, features, policy }),
    evaluateOrderbookImbalanceFilter({ side: context.side, features, marketDataQuality, policy }),
  ];
  const microstructureFilters = Object.freeze(rawFilters);
  const filters = Object.freeze([
    ...Array.from(shadowFilterDecision.filters || []),
    ...microstructureFilters,
  ].map((row) => {
    if (
      softenDirectionalFilters
      && row
      && row.would_block === true
      && directionalFilterIds.has(row.id)
    ) {
      return softenDirectionalFilter(row, "DISCOVERY_LONG_CORE_WARNING_ONLY");
    }
    return row;
  }));
  const wouldBlockFilters = filters.filter((row) => row && row.would_block === true);
  const insufficientFilters = filters.filter((row) => row && row.status === "INSUFFICIENT_EVIDENCE");
  const softenedWarningFilters = filters.filter((row) => row && row.softened_by_discovery_long_core_policy === true);
  const blockers = Object.freeze(wouldBlockFilters.map((row) => `OPENCLAW_DECISION_GATE:${row.id}:${row.reason}`));
  const evidenceBlockers = policy.require_evidence === true
    ? insufficientFilters.map((row) => `OPENCLAW_DECISION_GATE:${row.id}:${row.reason}`)
    : [];
  const allBlockers = Object.freeze([...blockers, ...evidenceBlockers]);
  const warnings = Object.freeze([
    ...insufficientFilters.map((row) => `OPENCLAW_DECISION_GATE:${row.id}:${row.reason}`),
    ...softenedWarningFilters.map((row) => `OPENCLAW_DECISION_GATE:${row.id}:${row.reason}`),
  ]);
  const hardBlock = policy.mode === "BLOCK_ONLY" && allBlockers.length > 0;
  return Object.freeze({
    ok: !hardBlock,
    reason: hardBlock ? "V2_OPENCLAW_DECISION_GATE_BLOCKED" : "V2_OPENCLAW_DECISION_GATE_PASS",
    enabled: true,
    mode: policy.mode,
    decision: hardBlock ? "BLOCK" : "PASS",
    no_sizing_mutation: true,
    blockers: allBlockers,
    warnings,
    filters,
    shadow_filter_decision: Object.freeze({
      ...shadowFilterDecision,
      hard_block_enabled: policy.mode === "BLOCK_ONLY",
    }),
    policy,
    context,
  });
}

module.exports = {
  evaluateV2OpenClawDecisionGate,
  resolvePolicy,
  __test: {
    trimOrNull,
    upper,
    asObject,
    toNumberOrNull,
    normalizeFundingBps,
    normalizeBidShare,
    resolveFeatureValues,
    resolveSignalCriteria,
    resolveMarketDataQuality,
    evaluateFundingFilter,
    evaluateLiquidationChaosFilter,
    evaluateOpenInterestFilter,
    evaluateOrderbookImbalanceFilter,
    shouldSoftenDirectionalFiltersForDiscovery,
  },
};
