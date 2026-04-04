"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampIntEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = toNum(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function readBoolEnv(name, fallback = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
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

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function collectOrderedUniqueMarkets(...groups) {
  const seen = new Set();
  const rows = [];
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const market = upper(item && item.market ? item.market : item);
      if (!market || seen.has(market)) continue;
      seen.add(market);
      rows.push(market);
    }
  }
  return rows;
}

function deriveExplorationBudget({
  overrideAuthority = null,
  marketObjectiveScore = null,
  serverVsPinePerformanceDelta = null,
  executionQuality = null,
  reversePolicy = null,
  serverPrimaryLearningEpoch = null,
  changeResultAttribution = null,
  reasoningJournal = null,
} = {}) {
  const overrideSummary = readSummary(overrideAuthority);
  const objectiveSummary = readSummary(marketObjectiveScore);
  const deltaSummary = readSummary(serverVsPinePerformanceDelta);
  const executionSummary = readSummary(executionQuality);
  const reverseSummary = readSummary(reversePolicy);
  const epochSummary = readSummary(serverPrimaryLearningEpoch);
  const changeResultSummary = readSummary(changeResultAttribution);
  const reasoningSummary = readSummary(reasoningJournal);

  const baseProductionSlotN = clampIntEnv(
    "OPENCLAW_PRODUCTION_SLOT_N",
    Math.max(3, toNum(overrideSummary.max_market_overrides_per_cycle) || 4),
    1,
    8
  );
  const baseExplorationSlotN = clampIntEnv("OPENCLAW_EXPLORATION_SLOT_N", 2, 1, 4);
  const learningEpochExplorationMin = clampIntEnv("OPENCLAW_LEARNING_EPOCH_EXPLORATION_MIN", 3, 1, 6);
  const serverSignalLearningMode = readBoolEnv("OPENCLAW_SERVER_SIGNAL_LEARNING_MODE", true);
  const epochActive = epochSummary.active === true || upper(epochSummary.status) === "SERVER_PRIMARY_EPOCH_ACTIVE";
  const epochExplorationBoost = epochActive ? (toNum(epochSummary.exploration_boost) || 1.15) : 1;
  let productionSlotN = baseProductionSlotN;
  let explorationSlotN = Math.max(
    baseExplorationSlotN,
    epochActive ? Math.min(6, Math.round(baseExplorationSlotN * epochExplorationBoost)) : baseExplorationSlotN
  );
  const adaptiveReasons = [];
  const successRate = toNum(changeResultSummary.success_rate);
  const positiveN = toNum(changeResultSummary.positive_change_n) || 0;
  const adverseN = toNum(changeResultSummary.adverse_change_n) || 0;
  const verificationRate = toNum(reasoningSummary.verification_rate);
  const verifiedN = toNum(reasoningSummary.verified_n) || 0;

  if (serverSignalLearningMode && epochActive && verifiedN < 2 && (verificationRate == null || verificationRate < 0.25)) {
    explorationSlotN = Math.min(6, explorationSlotN + 1);
    adaptiveReasons.push("LOW_VERIFICATION_RATE_EXPLORE_UP");
  }
  if (successRate != null && positiveN >= 4 && successRate >= 0.6) {
    explorationSlotN = Math.min(6, explorationSlotN + 1);
    adaptiveReasons.push("POSITIVE_ATTRIBUTION_STREAK_EXPLORE_UP");
  }
  if (successRate != null && adverseN >= 4 && successRate <= 0.35) {
    explorationSlotN = Math.max(1, explorationSlotN - 1);
    productionSlotN = Math.max(2, productionSlotN - 1);
    adaptiveReasons.push("ADVERSE_ATTRIBUTION_STREAK_BUDGET_DOWN");
  }
  if (serverSignalLearningMode && epochActive) {
    explorationSlotN = Math.max(learningEpochExplorationMin, explorationSlotN);
  }

  const productionMarkets = collectOrderedUniqueMarkets(
    Array.isArray(overrideSummary.top_priority_markets) ? overrideSummary.top_priority_markets : []
  ).slice(0, productionSlotN);

  const penaltyMarkets = collectOrderedUniqueMarkets(
    Array.isArray(overrideSummary.execution_quality_penalty_markets) ? overrideSummary.execution_quality_penalty_markets : [],
    Array.isArray(overrideSummary.reverse_policy_penalty_markets) ? overrideSummary.reverse_policy_penalty_markets : [],
    [executionSummary.top_latency_market, executionSummary.top_slippage_market, executionSummary.top_partial_market],
    [reverseSummary.top_watch_market]
  );

  const explorationCandidates = collectOrderedUniqueMarkets(
    [objectiveSummary.top_recovery_market],
    Array.isArray(objectiveSummary.top_watch_markets) ? objectiveSummary.top_watch_markets : [],
    [deltaSummary.top_shadow_gap_market],
    Array.isArray(deltaSummary.top_watch_markets) ? deltaSummary.top_watch_markets : []
  );

  const explorationMarkets = [];
  const deferredPenaltyMarkets = [];
  for (const market of explorationCandidates) {
    if (productionMarkets.includes(market)) continue;
    if (!serverSignalLearningMode && penaltyMarkets.includes(market)) {
      deferredPenaltyMarkets.push(market);
      continue;
    }
    if (explorationMarkets.length < explorationSlotN) explorationMarkets.push(market);
  }

  const watchMarkets = collectOrderedUniqueMarkets(productionMarkets, explorationCandidates).slice(0, 8);
  const status = explorationMarkets.length > 0
    ? "EXPLORATION_BUDGET_ACTIVE"
    : (productionMarkets.length > 0 ? "PRODUCTION_ONLY" : "BUDGET_EMPTY");

  return {
    status,
    base_production_slot_n: baseProductionSlotN,
    base_exploration_slot_n: baseExplorationSlotN,
    production_slot_n: productionSlotN,
    exploration_slot_n: explorationSlotN,
    server_signal_learning_mode: serverSignalLearningMode,
    penalty_mode: serverSignalLearningMode ? "ADVISORY_ONLY" : "ENFORCED",
    learning_epoch_status: upper(epochSummary.status),
    learning_epoch_active: epochActive,
    learning_epoch_age_days: toNum(epochSummary.age_days),
    learning_epoch_penalty_weight: toNum(epochSummary.penalty_weight),
    learning_epoch_exploration_boost: toNum(epochSummary.exploration_boost),
    learning_epoch_exploration_min: learningEpochExplorationMin,
    change_result_success_rate: successRate,
    change_result_positive_n: positiveN,
    change_result_adverse_n: adverseN,
    reasoning_verification_rate: verificationRate,
    reasoning_verified_n: verifiedN,
    adaptive_budget_reasons: adaptiveReasons,
    production_markets: productionMarkets,
    exploration_markets: explorationMarkets,
    deferred_penalty_markets: serverSignalLearningMode ? [] : deferredPenaltyMarkets,
    advisory_penalty_markets: penaltyMarkets,
    execution_quality_penalty_markets: Array.isArray(overrideSummary.execution_quality_penalty_markets)
      ? overrideSummary.execution_quality_penalty_markets
      : [],
    reverse_policy_penalty_markets: Array.isArray(overrideSummary.reverse_policy_penalty_markets)
      ? overrideSummary.reverse_policy_penalty_markets
      : [],
    top_watch_markets: watchMarkets,
    top_exploration_market: explorationMarkets[0] || null,
    top_production_market: productionMarkets[0] || null,
    objective_top_recovery_market: upper(objectiveSummary.top_recovery_market),
    shadow_gap_top_market: upper(deltaSummary.top_shadow_gap_market),
  };
}

module.exports = {
  deriveExplorationBudget,
};
