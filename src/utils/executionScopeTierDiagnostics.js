"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function getPath(row, path) {
  const parts = String(path || "").split(".");
  let cur = row;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return cur;
}

function resolveTierFromEvent(event = null) {
  const text = String(event || "").trim().toUpperCase();
  if (text.startsWith("EARLY_")) return "EARLY";
  if (text.startsWith("CORE_")) return "CORE";
  return null;
}

function buildRowMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeText(row && row.row_id);
    if (key) map.set(key, row);
  }
  return map;
}

function countBy(items = [], keyFn) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeText(keyFn(item)) || "UNKNOWN";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, rows_n]) => ({ key, rows_n }))
    .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key));
}

function summarizeCoverage(rows = [], paths = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  return (Array.isArray(paths) ? paths : []).map((path) => {
    const presentN = scoped.filter((row) => normalizeText(getPath(row, path))).length;
    return {
      path,
      rows_n: scoped.length,
      present_n: presentN,
      coverage_rate: scoped.length ? presentN / scoped.length : null,
    };
  }).sort((a, b) => {
    const covDelta = (a.coverage_rate ?? 1) - (b.coverage_rate ?? 1);
    if (covDelta !== 0) return covDelta;
    return String(a.path || "").localeCompare(String(b.path || ""));
  });
}

function summarizeExecutionScopeTierDiagnostics({
  executionEntryDataset = null,
  executionScopeInference = null,
  executionScopeTierComparison = null,
} = {}) {
  const datasetRows = executionEntryDataset && Array.isArray(executionEntryDataset.rows) ? executionEntryDataset.rows : [];
  const inferenceSummary = executionScopeInference && executionScopeInference.summary && typeof executionScopeInference.summary === "object"
    ? executionScopeInference.summary
    : (executionScopeInference || {});
  const inferenceRows = executionScopeInference && Array.isArray(executionScopeInference.rows) ? executionScopeInference.rows : [];
  const tierSummary = executionScopeTierComparison && executionScopeTierComparison.summary && typeof executionScopeTierComparison.summary === "object"
    ? executionScopeTierComparison.summary
    : (executionScopeTierComparison || {});
  const targetTier = normalizeText(tierSummary.weaker_tier) || "CORE";
  const rowMap = buildRowMap(datasetRows);
  const scopedInferenceRows = inferenceRows.filter((row) => resolveTierFromEvent(row && row.event) === targetTier);
  const mismatches = scopedInferenceRows.filter((row) => row && row.actual_scope && row.pred_class && row.actual_scope !== row.pred_class);
  const falsePositiveGroups = countBy(mismatches, (row) => [
    row.actual_scope,
    row.pred_class,
    row.source || "UNKNOWN",
    row.event || "UNKNOWN",
    row.market || "UNKNOWN",
  ].join("|"));
  const falseNegativeGroups = countBy(mismatches, (row) => [
    row.pred_class,
    row.actual_scope,
    row.source || "UNKNOWN",
    row.event || "UNKNOWN",
    row.market || "UNKNOWN",
  ].join("|"));

  const policyBlockedInferenceRows = scopedInferenceRows.filter((row) => normalizeText(row.actual_scope) === "POLICY_BLOCKED");
  const policyBlockedRows = policyBlockedInferenceRows.map((row) => rowMap.get(row.row_id)).filter(Boolean);
  const coverage = summarizeCoverage(policyBlockedRows, [
    "execution.no_fill_reason",
    "execution.entry_schedule_reason",
    "execution.entry_schedule_profile",
    "features.reason",
    "features.action",
    "features.pos_state",
    "features.pro_conflict",
    "features.score_bucket",
  ]);
  const lowestCoverage = coverage[0] || null;

  return {
    summary: {
      status: "EXECUTION_SCOPE_TIER_DIAGNOSTICS_READY",
      target_tier: targetTier,
      target_rows_n: scopedInferenceRows.length,
      mismatch_n: mismatches.length,
      mismatch_rate: scopedInferenceRows.length ? (mismatches.length / scopedInferenceRows.length) : null,
      top_false_positive_group: falsePositiveGroups[0] ? falsePositiveGroups[0].key : null,
      top_false_positive_rows_n: falsePositiveGroups[0] ? falsePositiveGroups[0].rows_n : 0,
      top_false_negative_group: falseNegativeGroups[0] ? falseNegativeGroups[0].key : null,
      top_false_negative_rows_n: falseNegativeGroups[0] ? falseNegativeGroups[0].rows_n : 0,
      policy_blocked_rows_n: policyBlockedRows.length,
      policy_blocked_top_source: countBy(policyBlockedInferenceRows, (row) => row.source)[0]?.key || null,
      policy_blocked_top_no_fill_reason: countBy(policyBlockedRows, (row) => getPath(row, "execution.no_fill_reason"))[0]?.key || null,
      policy_blocked_lowest_coverage_feature: lowestCoverage ? lowestCoverage.path : null,
      policy_blocked_lowest_coverage_rate: lowestCoverage ? lowestCoverage.coverage_rate : null,
      policy_blocked_coverage: coverage,
      policy_blocked_by_source: countBy(policyBlockedInferenceRows, (row) => row.source).slice(0, 8),
      policy_blocked_by_reason: countBy(policyBlockedRows, (row) => getPath(row, "execution.no_fill_reason")).slice(0, 8),
    },
  };
}

module.exports = {
  summarizeExecutionScopeTierDiagnostics,
};
