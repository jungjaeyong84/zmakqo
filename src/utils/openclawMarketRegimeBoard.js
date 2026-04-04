"use strict";

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

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function buildMap(rows = [], selector = (row) => row && row.market) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = toUpper(selector(row));
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return map;
}

function classifyCohort({
  active = false,
  dropVerdict = null,
  deltaVerdict = null,
  executionQualityPenalty = false,
  quarantineReason = null,
} = {}) {
  const verdict = toUpper(dropVerdict);
  const delta = toUpper(deltaVerdict);
  const quarantine = toUpper(quarantineReason);
  if (verdict === "HOLD_SAMPLE") return "HOLD_SAMPLE";
  if (!active && !verdict) return "HOLD_SAMPLE";
  if (verdict === "KEEP_DROP") return "KEEP_DROP";
  if (executionQualityPenalty || quarantine === "EXECUTION_QUALITY_PENALTY") return "KEEP_DROP";
  if (verdict === "FAVOR_RESCUE" && delta === "SHADOW_GAP_REVIEW") return "RESCUE";
  if (verdict === "FAVOR_RESCUE") return "MIXED";
  if (verdict === "MIXED") return "MIXED";
  return "MIXED";
}

function buildOpenClawMarketRegimeRows({
  marketObjectiveScore = null,
  serverVsPinePerformanceDelta = null,
  dropValidation = null,
  executionQuality = null,
  reversePolicy = null,
  serverMarketCapitalAllocator = null,
  serverMarketQuarantine = null,
} = {}) {
  const objectiveRows = readRows(marketObjectiveScore);
  const deltaRows = readRows(serverVsPinePerformanceDelta);
  const dropRows = readRows(dropValidation);
  const executionRows = readRows(executionQuality);
  const reverseRows = readRows(reversePolicy);
  const allocatorRows = readRows(serverMarketCapitalAllocator, "by_market").length
    ? readRows(serverMarketCapitalAllocator, "by_market")
    : ((readSummary(serverMarketCapitalAllocator).by_market && Array.isArray(readSummary(serverMarketCapitalAllocator).by_market))
      ? readSummary(serverMarketCapitalAllocator).by_market
      : []);
  const quarantineRows = readRows(serverMarketQuarantine, "by_market").length
    ? readRows(serverMarketQuarantine, "by_market")
    : ((readSummary(serverMarketQuarantine).by_market && Array.isArray(readSummary(serverMarketQuarantine).by_market))
      ? readSummary(serverMarketQuarantine).by_market
      : []);

  const objectiveMap = buildMap(objectiveRows);
  const deltaMap = buildMap(deltaRows);
  const dropMap = buildMap(dropRows);
  const executionMap = buildMap(executionRows);
  const reverseMap = buildMap(reverseRows);
  const allocatorMap = buildMap(allocatorRows);
  const quarantineMap = buildMap(quarantineRows);

  const markets = new Set([
    ...objectiveMap.keys(),
    ...deltaMap.keys(),
    ...dropMap.keys(),
    ...executionMap.keys(),
    ...reverseMap.keys(),
    ...allocatorMap.keys(),
    ...quarantineMap.keys(),
  ]);

  const rows = [];
  for (const market of markets) {
    const objectiveRow = objectiveMap.get(market) || {};
    const deltaRow = deltaMap.get(market) || {};
    const dropRow = dropMap.get(market) || {};
    const executionRow = executionMap.get(market) || {};
    const reverseRow = reverseMap.get(market) || {};
    const allocatorRow = allocatorMap.get(market) || {};
    const quarantineRow = quarantineMap.get(market) || {};

    const active = objectiveRow.active === true
      || deltaRow.active === true
      || allocatorRow.active === true
      || quarantineRow.learning_epoch_active === true;
    const executionQualityPenalty = allocatorRow.execution_quality_penalty === true
      || quarantineRow.execution_quality_penalty === true;
    const reversePolicyPenalty = allocatorRow.reverse_policy_penalty === true
      || quarantineRow.reverse_policy_penalty === true
      || toUpper(reverseRow.verdict) === "REVIEW_REVERSE_EXCEPTION_PATH"
      || toUpper(reverseRow.verdict) === "REVIEW_REVERSE_COOLDOWN_POLICY";
    const cohort = classifyCohort({
      active,
      dropVerdict: dropRow.verdict || objectiveRow.drop_verdict,
      deltaVerdict: deltaRow.verdict,
      executionQualityPenalty,
      quarantineReason: quarantineRow.quarantine_reason,
    });

    rows.push({
      market,
      active,
      cohort,
      objective_score: toNum(objectiveRow.objective_score),
      objective_band: toUpper(objectiveRow.objective_band),
      drop_verdict: toUpper(dropRow.verdict || objectiveRow.drop_verdict),
      drop_action: toUpper(dropRow.recommended_action || objectiveRow.drop_action),
      drop_dominant_family: toUpper(dropRow.dominant_family || objectiveRow.drop_dominant_family),
      drop_dominant_reason: toUpper(dropRow.dominant_reason || objectiveRow.drop_dominant_reason),
      performance_delta_score: toNum(deltaRow.performance_delta_score),
      delta_verdict: toUpper(deltaRow.verdict),
      delta_action: toUpper(deltaRow.recommended_action),
      mismatch_count: toNum(deltaRow.mismatch_count) || 0,
      execution_quality_penalty: executionQualityPenalty,
      execution_avg_created_to_fill_ms: toNum(executionRow.avg_created_to_fill_ms),
      execution_partial_fill_rate_pct: toNum(executionRow.partial_fill_rate_pct),
      reverse_policy_penalty: reversePolicyPenalty,
      reverse_verdict: toUpper(reverseRow.verdict),
      reverse_action: toUpper(reverseRow.recommended_action),
      allocation_score: toNum(allocatorRow.allocation_score),
      allocation_action: toUpper(allocatorRow.recommended_action),
      production_slot: allocatorRow.production_slot === true,
      exploration_slot: allocatorRow.exploration_slot === true,
      quarantine_reason: toUpper(quarantineRow.quarantine_reason),
      quarantine_severity: toUpper(quarantineRow.quarantine_severity),
      quarantine_action: toUpper(quarantineRow.recommended_action),
    });
  }

  const cohortOrder = { RESCUE: 0, MIXED: 1, KEEP_DROP: 2, HOLD_SAMPLE: 3 };
  return rows.sort((a, b) =>
    (cohortOrder[a.cohort] ?? 9) - (cohortOrder[b.cohort] ?? 9)
    || ((a.objective_score ?? Infinity) - (b.objective_score ?? Infinity))
    || ((a.performance_delta_score ?? Infinity) - (b.performance_delta_score ?? Infinity))
    || a.market.localeCompare(b.market));
}

function firstBy(rows = [], predicate) {
  return rows.find((row) => predicate(row)) || null;
}

function buildOpenClawMarketRegimeSummary({ rows = [] } = {}) {
  const activeRows = rows.filter((row) => row.active);
  const rescueRows = rows.filter((row) => row.cohort === "RESCUE");
  const mixedRows = rows.filter((row) => row.cohort === "MIXED");
  const keepDropRows = rows.filter((row) => row.cohort === "KEEP_DROP");
  const holdSampleRows = rows.filter((row) => row.cohort === "HOLD_SAMPLE");
  const positiveRows = rows.filter((row) => Number.isFinite(row.objective_score) && row.objective_score > 0);
  const negativeRows = rows.filter((row) => Number.isFinite(row.objective_score) && row.objective_score < 0);
  const topRescue = rescueRows[0] || null;
  const topKeepDrop = keepDropRows[0] || null;
  const topMixed = mixedRows[0] || null;
  const topHoldSample = holdSampleRows[0] || null;
  const topPositive = positiveRows.slice().sort((a, b) => (b.objective_score || 0) - (a.objective_score || 0))[0] || null;
  const topDrag = negativeRows.slice().sort((a, b) => (a.objective_score || 0) - (b.objective_score || 0))[0] || null;
  const status = topRescue
    ? "RESCUE_COHORT_ACTIVE"
    : (keepDropRows.length ? "KEEP_DROP_COHORT_ACTIVE" : "COHORTS_BALANCED");

  return {
    status,
    market_n: rows.length,
    active_market_n: activeRows.length,
    rescue_market_n: rescueRows.length,
    mixed_market_n: mixedRows.length,
    keep_drop_market_n: keepDropRows.length,
    hold_sample_market_n: holdSampleRows.length,
    positive_market_n: positiveRows.length,
    negative_market_n: negativeRows.length,
    top_rescue_market: topRescue ? topRescue.market : null,
    top_mixed_market: topMixed ? topMixed.market : null,
    top_keep_drop_market: topKeepDrop ? topKeepDrop.market : null,
    top_hold_sample_market: topHoldSample ? topHoldSample.market : null,
    top_positive_market: topPositive ? topPositive.market : null,
    top_positive_objective_score: topPositive ? topPositive.objective_score : null,
    top_drag_market: topDrag ? topDrag.market : null,
    top_drag_objective_score: topDrag ? topDrag.objective_score : null,
    cohort_markets: {
      rescue: rescueRows.map((row) => row.market),
      mixed: mixedRows.map((row) => row.market),
      keep_drop: keepDropRows.map((row) => row.market),
      hold_sample: holdSampleRows.map((row) => row.market),
    },
    top_watch_markets: rows.slice(0, 8).map((row) => ({
      market: row.market,
      cohort: row.cohort,
      objective_score: row.objective_score,
      drop_verdict: row.drop_verdict,
      delta_verdict: row.delta_verdict,
      allocation_action: row.allocation_action,
      quarantine_reason: row.quarantine_reason,
    })),
    rescue_ready_market_n: rows.filter((row) => row.cohort === "RESCUE" && row.delta_verdict === "SHADOW_GAP_REVIEW").length,
    keep_drop_penalty_market_n: rows.filter((row) => row.cohort === "KEEP_DROP" && (row.execution_quality_penalty || row.reverse_policy_penalty)).length,
    has_market_split: rescueRows.length > 0 && keepDropRows.length > 0,
    dominant_rescue_reason: firstBy(rescueRows, () => true) ? firstBy(rescueRows, () => true).drop_dominant_reason : null,
    dominant_keep_drop_reason: firstBy(keepDropRows, () => true) ? firstBy(keepDropRows, () => true).drop_dominant_reason : null,
  };
}

module.exports = {
  unwrapRawReport,
  buildOpenClawMarketRegimeRows,
  buildOpenClawMarketRegimeSummary,
};
