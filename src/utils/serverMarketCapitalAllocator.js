"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function readRows(value, key = "by_market") {
  const raw = unwrapRawReport(value) || {};
  return Array.isArray(raw[key]) ? raw[key] : [];
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function buildPenaltySets(executionQualitySummary = {}, reversePolicySummary = {}) {
  const executionHardPenaltyMarkets = new Set();
  const executionSoftPenaltyMarkets = new Set();
  const topWatchRows = Array.isArray(executionQualitySummary.top_watch_markets) ? executionQualitySummary.top_watch_markets : [];
  const executionHardLatencyMs = 600000;
  const executionSoftLatencyMs = 450000;
  const executionHardPartialPct = 80;
  const executionSoftPartialPct = 65;
  const executionHardSlippageBps = 8;
  const executionSoftSlippageBps = 4;

  for (const row of topWatchRows) {
    const market = upper(row && row.market);
    if (!market) continue;
    const latency = toNum(row && row.avg_created_to_fill_ms);
    const partial = toNum(row && row.partial_fill_rate_pct);
    const slippage = toNum(row && row.avg_slippage_bps);
    if (
      (Number.isFinite(latency) && latency >= executionHardLatencyMs)
      || (Number.isFinite(partial) && partial >= executionHardPartialPct)
      || (Number.isFinite(slippage) && slippage >= executionHardSlippageBps)
    ) {
      executionHardPenaltyMarkets.add(market);
      continue;
    }
    if (
      (Number.isFinite(latency) && latency >= executionSoftLatencyMs)
      || (Number.isFinite(partial) && partial >= executionSoftPartialPct)
      || (Number.isFinite(slippage) && slippage >= executionSoftSlippageBps)
    ) {
      executionSoftPenaltyMarkets.add(market);
    }
  }

  [
    executionQualitySummary.top_latency_market,
    executionQualitySummary.top_slippage_market,
    executionQualitySummary.top_partial_market,
  ].map((row) => upper(row)).filter(Boolean).forEach((market) => executionSoftPenaltyMarkets.add(market));

  const reversePenaltyMarkets = new Set([
    reversePolicySummary.top_watch_market,
    ...(Array.isArray(reversePolicySummary.top_watch_markets)
      ? reversePolicySummary.top_watch_markets.map((row) => upper(row && row.market))
      : []),
  ].filter(Boolean));
  return { executionHardPenaltyMarkets, executionSoftPenaltyMarkets, reversePenaltyMarkets };
}

function buildFailurePenaltyMarkets(failureLearningSummary = {}) {
  const rows = Array.isArray(failureLearningSummary.market_breakdown) ? failureLearningSummary.market_breakdown : [];
  const hardPenaltyMarkets = new Set();
  const softPenaltyMarkets = new Set();
  for (const row of rows) {
    const market = upper(row && row.market);
    if (!market) continue;
    const failN = toNum(row && row.fail_n) || 0;
    const avgRet = toNum(row && row.avg_realized_ret_net);
    const dominantPattern = upper(row && row.dominant_failure_pattern);
    const negativeN = toNum(row && row.negative_realized_n) || 0;
    if (failN >= 4 && negativeN >= 2 && Number.isFinite(avgRet) && avgRet < 0 && (dominantPattern === "NEGATIVE_REALIZED" || dominantPattern === "SL_FIRST")) {
      hardPenaltyMarkets.add(market);
      continue;
    }
    if (failN >= 2 && ((Number.isFinite(avgRet) && avgRet < 0) || dominantPattern === "NEGATIVE_REALIZED" || dominantPattern === "TP0_NO_TP1_CONVERT")) {
      softPenaltyMarkets.add(market);
    }
  }
  return { hardPenaltyMarkets, softPenaltyMarkets };
}

function buildFeePnlPenaltyMarkets(feePnlSummary = {}) {
  const rows = Array.isArray(feePnlSummary.by_market) ? feePnlSummary.by_market : [];
  const hardPenaltyMarkets = new Set();
  const softPenaltyMarkets = new Set();
  for (const row of rows) {
    const market = upper(row && row.market);
    if (!market) continue;
    const evidenceStatus = upper(row && row.evidence_status);
    if (evidenceStatus === "FEE_PNL_MARKET_BLOCK") {
      hardPenaltyMarkets.add(market);
      continue;
    }
    if (evidenceStatus === "FEE_PNL_MARKET_REVIEW") {
      softPenaltyMarkets.add(market);
    }
  }
  return { hardPenaltyMarkets, softPenaltyMarkets };
}

function buildAlphaPenaltyMarkets(alphaValidationSummary = {}) {
  const rows = Array.isArray(alphaValidationSummary.by_market) ? alphaValidationSummary.by_market : [];
  const contextRows = Array.isArray(alphaValidationSummary.by_market_side_regime) ? alphaValidationSummary.by_market_side_regime : [];
  const hardPenaltyMarkets = new Set();
  const softPenaltyMarkets = new Set();
  const contextRowsByMarket = new Map();
  for (const row of rows) {
    const market = upper(row && row.key);
    if (!market) continue;
    const realizedN = toNum(row && row.realized_n) || 0;
    const positiveRate = toNum(row && row.positive_rate);
    const avgRet = toNum(row && row.avg_realized_ret_net);
    if (
      realizedN >= 3
      && Number.isFinite(avgRet)
      && avgRet < 0
      && Number.isFinite(positiveRate)
      && positiveRate < 0.45
    ) {
      hardPenaltyMarkets.add(market);
      continue;
    }
    if (
      realizedN >= 2
      && (
        (Number.isFinite(avgRet) && avgRet < 0)
        || (Number.isFinite(positiveRate) && positiveRate < 0.5)
      )
    ) {
      softPenaltyMarkets.add(market);
    }
  }
  for (const row of contextRows) {
    const rawKey = upper(row && row.key);
    if (!rawKey) continue;
    const [market, positionSide, regimeKey] = rawKey.split("|");
    if (!market) continue;
    const realizedN = toNum(row && row.realized_n) || 0;
    const positiveRate = toNum(row && row.positive_rate);
    const avgRet = toNum(row && row.avg_realized_ret_net);
    let severity = null;
    if (
      realizedN >= 3
      && Number.isFinite(avgRet)
      && avgRet < 0
      && Number.isFinite(positiveRate)
      && positiveRate < 0.45
    ) {
      severity = "HARD";
    } else if (
      realizedN >= 2
      && (
        (Number.isFinite(avgRet) && avgRet < 0)
        || (Number.isFinite(positiveRate) && positiveRate < 0.5)
      )
    ) {
      severity = "SOFT";
    }
    if (!severity) continue;
    const bucket = contextRowsByMarket.get(market) || [];
    bucket.push({
      key: rawKey,
      market,
      position_side: positionSide || "UNKNOWN",
      regime_key: regimeKey || "UNKNOWN",
      realized_n: realizedN,
      positive_rate: positiveRate,
      avg_realized_ret_net: avgRet,
      severity,
    });
    contextRowsByMarket.set(market, bucket);
  }
  for (const [market, bucket] of contextRowsByMarket.entries()) {
    bucket.sort((a, b) => {
      const sevGap = (a.severity === "HARD" ? 1 : 0) - (b.severity === "HARD" ? 1 : 0);
      if (sevGap !== 0) return -sevGap;
      const retA = toNum(a.avg_realized_ret_net);
      const retB = toNum(b.avg_realized_ret_net);
      if (Number.isFinite(retA) && Number.isFinite(retB) && retA !== retB) return retA - retB;
      return (toNum(b.realized_n) || 0) - (toNum(a.realized_n) || 0);
    });
  }
  return { hardPenaltyMarkets, softPenaltyMarkets, contextRowsByMarket };
}

function classifyAction({ market, score, production, exploration, deferred, severePenalty, reversePenalty, objectiveBand }) {
  const severeDrag = objectiveBand === "SEVERE_DRAG" || score <= -3;
  if (deferred && (severePenalty || reversePenalty || severeDrag)) return "QUARANTINE";
  if (severeDrag && (severePenalty || reversePenalty)) return "QUARANTINE";
  if (production && score >= 1.5) return "INCREASE";
  if (production && score > -1) return "HOLD";
  if (exploration && score >= 0) return "EXPLORE_LIGHT";
  if (exploration) return "HOLD";
  if (score <= -1.5 || deferred) return "REDUCE";
  return "HOLD";
}

function deriveServerMarketCapitalAllocator({
  marketObjectiveScore = null,
  executionQuality = null,
  reversePolicy = null,
  explorationBudget = null,
  serverPrimaryLearningEpoch = null,
  failureLearningLoop = null,
  feePnlKpiAuthority = null,
  eventTruthAlphaValidation = null,
} = {}) {
  const objectiveSummary = readSummary(marketObjectiveScore);
  const objectiveRows = readRows(marketObjectiveScore, "by_market");
  const executionSummary = readSummary(executionQuality);
  const reverseSummary = readSummary(reversePolicy);
  const budgetSummary = readSummary(explorationBudget);
  const epochSummary = readSummary(serverPrimaryLearningEpoch);
  const failureLearningSummary = readSummary(failureLearningLoop);
  const feePnlSummary = readSummary(feePnlKpiAuthority);
  const alphaValidationSummary = readSummary(eventTruthAlphaValidation);
  const epochActive = epochSummary.active === true || upper(epochSummary.status) === "SERVER_PRIMARY_EPOCH_ACTIVE";
  const epochPenaltyWeight = epochActive ? (toNum(epochSummary.penalty_weight) || 0.35) : 1;
  const epochExplorationBoost = epochActive ? (toNum(epochSummary.exploration_boost) || 1.15) : 1;

  const productionMarkets = new Set((Array.isArray(budgetSummary.production_markets) ? budgetSummary.production_markets : []).map((row) => upper(row)).filter(Boolean));
  const explorationMarkets = new Set((Array.isArray(budgetSummary.exploration_markets) ? budgetSummary.exploration_markets : []).map((row) => upper(row)).filter(Boolean));
  const deferredMarkets = new Set((Array.isArray(budgetSummary.deferred_penalty_markets) ? budgetSummary.deferred_penalty_markets : []).map((row) => upper(row)).filter(Boolean));
  const { executionHardPenaltyMarkets, executionSoftPenaltyMarkets, reversePenaltyMarkets } = buildPenaltySets(executionSummary, reverseSummary);
  const { hardPenaltyMarkets, softPenaltyMarkets } = buildFailurePenaltyMarkets(failureLearningSummary);
  const { hardPenaltyMarkets: feeHardPenaltyMarkets, softPenaltyMarkets: feeSoftPenaltyMarkets } = buildFeePnlPenaltyMarkets(feePnlSummary);
  const { hardPenaltyMarkets: alphaHardPenaltyMarkets, softPenaltyMarkets: alphaSoftPenaltyMarkets, contextRowsByMarket: alphaContextRowsByMarket } = buildAlphaPenaltyMarkets(alphaValidationSummary);

  const rows = objectiveRows.map((row) => {
    const market = upper(row.market);
    const objectiveScore = toNum(row.objective_score) || 0;
    const recoveryPriorityScore = toNum(row.recovery_priority_score) || 0;
    const avgProxy = toNum(row.drop_avg_horizon_pnl_quote_proxy) || 0;
    const production = productionMarkets.has(market);
    const exploration = explorationMarkets.has(market);
    const deferred = deferredMarkets.has(market);
    const executionHardPenalty = executionHardPenaltyMarkets.has(market);
    const executionSoftPenalty = executionSoftPenaltyMarkets.has(market);
    const reversePenalty = reversePenaltyMarkets.has(market);
    const failureHardPenalty = hardPenaltyMarkets.has(market);
    const failureSoftPenalty = softPenaltyMarkets.has(market);
    const feePnlHardPenalty = feeHardPenaltyMarkets.has(market);
    const feePnlSoftPenalty = feeSoftPenaltyMarkets.has(market);
    const alphaHardPenalty = alphaHardPenaltyMarkets.has(market);
    const alphaSoftPenalty = alphaSoftPenaltyMarkets.has(market);
    const alphaPenaltyContexts = (alphaContextRowsByMarket.get(market) || []).slice(0, 5);
    const baseScore = objectiveScore + clamp(recoveryPriorityScore / 4, -2, 3) + clamp(avgProxy / 20, -1, 2);
    const slotBoost = production ? 1.25 : (exploration ? Number((0.5 * epochExplorationBoost).toFixed(4)) : 0);
    const penaltyScore = (
      + (executionSoftPenalty ? 0.8 : 0)
      + (executionHardPenalty ? 1.4 : 0)
      + (reversePenalty ? 1.0 : 0)
      + (deferred ? 1.0 : 0)
      + (failureSoftPenalty ? 0.9 : 0)
      + (failureHardPenalty ? 2.0 : 0)
      + (feePnlSoftPenalty ? 0.8 : 0)
      + (feePnlHardPenalty ? 1.6 : 0)
      + (alphaSoftPenalty ? 0.8 : 0)
      + (alphaHardPenalty ? 1.8 : 0)
    ) * epochPenaltyWeight;
    const allocationScore = Number((baseScore + slotBoost - penaltyScore).toFixed(4));
    const penaltyReasons = [
      executionHardPenalty ? "EXECUTION_HARD" : null,
      executionSoftPenalty ? "EXECUTION_SOFT" : null,
      reversePenalty ? "REVERSE_POLICY" : null,
      deferred ? "DEFERRED_PENALTY" : null,
      failureHardPenalty ? "FAILURE_HARD" : null,
      failureSoftPenalty ? "FAILURE_SOFT" : null,
      feePnlHardPenalty ? "FEE_PNL_HARD" : null,
      feePnlSoftPenalty ? "FEE_PNL_SOFT" : null,
      alphaHardPenalty ? "ALPHA_HARD" : null,
      alphaSoftPenalty ? "ALPHA_SOFT" : null,
    ].filter(Boolean);
    const action = classifyAction({
      market,
      score: allocationScore,
      production,
      exploration,
      deferred: deferred || failureHardPenalty || feePnlHardPenalty || executionHardPenalty || alphaHardPenalty,
      severePenalty: executionHardPenalty || failureHardPenalty || feePnlHardPenalty || alphaHardPenalty,
      reversePenalty,
      objectiveBand: upper(row.objective_band),
    });
    return {
      market,
      active: row.active === true,
      objective_score: toNum(row.objective_score),
      recovery_priority_score: toNum(row.recovery_priority_score),
      avg_horizon_pnl_quote_proxy: toNum(row.drop_avg_horizon_pnl_quote_proxy),
      objective_band: upper(row.objective_band),
      drop_verdict: upper(row.drop_verdict),
      production_slot: production,
      exploration_slot: exploration,
      deferred_penalty: deferred,
      execution_quality_penalty: executionSoftPenalty || executionHardPenalty,
      execution_quality_soft_penalty: executionSoftPenalty,
      execution_quality_hard_penalty: executionHardPenalty,
      reverse_policy_penalty: reversePenalty,
      failure_soft_penalty: failureSoftPenalty,
      failure_hard_penalty: failureHardPenalty,
      fee_pnl_soft_penalty: feePnlSoftPenalty,
      fee_pnl_hard_penalty: feePnlHardPenalty,
      alpha_soft_penalty: alphaSoftPenalty,
      alpha_hard_penalty: alphaHardPenalty,
      alpha_penalty_contexts: alphaPenaltyContexts,
      penalty_reasons: penaltyReasons,
      allocation_score: allocationScore,
      recommended_action: action,
    };
  }).sort((a, b) => b.allocation_score - a.allocation_score || String(a.market).localeCompare(String(b.market)));

  const activeRows = rows.filter((row) => row.active);
  const increaseRows = activeRows.filter((row) => row.recommended_action === "INCREASE");
  const reduceRows = activeRows.filter((row) => row.recommended_action === "REDUCE");
  const quarantineRows = activeRows.filter((row) => row.recommended_action === "QUARANTINE");
  const exploreRows = activeRows.filter((row) => row.recommended_action === "EXPLORE_LIGHT");

  const topIncrease = increaseRows[0] || null;
  const topReduce = reduceRows.slice().sort((a, b) => a.allocation_score - b.allocation_score)[0] || null;
  const topQuarantine = quarantineRows.slice().sort((a, b) => a.allocation_score - b.allocation_score)[0] || null;
  const topExplore = exploreRows[0] || null;

  const status = quarantineRows.length > 0
    ? "QUARANTINE_REVIEW"
    : (increaseRows.length > 0 || exploreRows.length > 0 ? "CAPITAL_ALLOCATION_ACTIVE" : "CAPITAL_ALLOCATION_HOLD");

  return {
    status,
    market_n: rows.length,
    active_market_n: activeRows.length,
    increase_market_n: increaseRows.length,
    reduce_market_n: reduceRows.length,
    quarantine_market_n: quarantineRows.length,
    explore_market_n: exploreRows.length,
    top_increase_market: topIncrease ? topIncrease.market : null,
    top_increase_score: topIncrease ? topIncrease.allocation_score : null,
    top_reduce_market: topReduce ? topReduce.market : null,
    top_reduce_score: topReduce ? topReduce.allocation_score : null,
    top_quarantine_market: topQuarantine ? topQuarantine.market : null,
    top_quarantine_score: topQuarantine ? topQuarantine.allocation_score : null,
    top_explore_market: topExplore ? topExplore.market : null,
    top_explore_score: topExplore ? topExplore.allocation_score : null,
    production_markets: Array.from(productionMarkets),
    exploration_markets: Array.from(explorationMarkets),
    deferred_penalty_markets: Array.from(deferredMarkets),
    execution_soft_penalty_markets: Array.from(executionSoftPenaltyMarkets),
    execution_hard_penalty_markets: Array.from(executionHardPenaltyMarkets),
    failure_soft_penalty_markets: Array.from(softPenaltyMarkets),
    failure_hard_penalty_markets: Array.from(hardPenaltyMarkets),
    fee_pnl_soft_penalty_markets: Array.from(feeSoftPenaltyMarkets),
    fee_pnl_hard_penalty_markets: Array.from(feeHardPenaltyMarkets),
    alpha_soft_penalty_markets: Array.from(alphaSoftPenaltyMarkets),
    alpha_hard_penalty_markets: Array.from(alphaHardPenaltyMarkets),
    alpha_penalty_context_rows: Array.from(alphaContextRowsByMarket.values())
      .flat()
      .sort((a, b) => {
        const sevGap = (a.severity === "HARD" ? 1 : 0) - (b.severity === "HARD" ? 1 : 0);
        if (sevGap !== 0) return -sevGap;
        const retA = toNum(a.avg_realized_ret_net);
        const retB = toNum(b.avg_realized_ret_net);
        if (Number.isFinite(retA) && Number.isFinite(retB) && retA !== retB) return retA - retB;
        return (toNum(b.realized_n) || 0) - (toNum(a.realized_n) || 0);
      })
      .slice(0, 30),
    learning_epoch_status: upper(epochSummary.status),
    learning_epoch_active: epochActive,
    learning_epoch_penalty_weight: epochPenaltyWeight,
    by_market: activeRows,
    top_watch_markets: activeRows.slice(0, 8).map((row) => ({
      market: row.market,
      allocation_score: row.allocation_score,
      recommended_action: row.recommended_action,
      production_slot: row.production_slot,
      exploration_slot: row.exploration_slot,
      deferred_penalty: row.deferred_penalty,
      execution_quality_penalty: row.execution_quality_penalty,
      execution_quality_soft_penalty: row.execution_quality_soft_penalty,
      execution_quality_hard_penalty: row.execution_quality_hard_penalty,
      reverse_policy_penalty: row.reverse_policy_penalty,
      failure_soft_penalty: row.failure_soft_penalty,
      failure_hard_penalty: row.failure_hard_penalty,
      fee_pnl_soft_penalty: row.fee_pnl_soft_penalty,
      fee_pnl_hard_penalty: row.fee_pnl_hard_penalty,
      alpha_soft_penalty: row.alpha_soft_penalty,
      alpha_hard_penalty: row.alpha_hard_penalty,
      alpha_penalty_contexts: row.alpha_penalty_contexts,
      penalty_reasons: row.penalty_reasons,
    })),
    global_objective_score: toNum(objectiveSummary.global_objective_score),
  };
}

module.exports = {
  deriveServerMarketCapitalAllocator,
};
