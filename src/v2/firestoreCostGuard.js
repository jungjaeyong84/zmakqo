"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sumNumbers(values) {
  return values.reduce((sum, value) => {
    const num = toNumberOrNull(value);
    return Number.isFinite(num) ? sum + num : sum;
  }, 0);
}

function resolveFirestoreCostThresholds(env = process.env) {
  return Object.freeze({
    max_total_estimated_reads: Number(env.V2_FIRESTORE_COST_GUARD_MAX_TOTAL_READS || 1000),
    max_single_artifact_reads: Number(env.V2_FIRESTORE_COST_GUARD_MAX_SINGLE_ARTIFACT_READS || 300),
    max_collector_query_limit_total: Number(env.V2_FIRESTORE_COST_GUARD_MAX_COLLECTOR_QUERY_LIMIT_TOTAL || 450),
    max_artifact_age_minutes: Number(env.V2_FIRESTORE_COST_GUARD_MAX_ARTIFACT_AGE_MINUTES || 180),
  });
}

function collectBudgetRows({ unifiedReport = null, artifacts = [] } = {}) {
  const rows = [];
  const report = asObject(unifiedReport);
  const bounded = asObject(report && report.bounded_runtime_summary);
  if (bounded) {
    const collector = asObject(bounded.collector_query_budget);
    const selector = asObject(bounded.selector_query_budget);
    if (collector) rows.push({ id: "collector_query_budget", source: "unified_report", estimated_reads: sumNumbers(Object.values(collector)), query_limit_total: sumNumbers(Object.values(collector)) });
    if (selector) rows.push({ id: "selector_query_budget", source: "unified_report", estimated_reads: sumNumbers(Object.values(selector)), query_limit_total: sumNumbers(Object.values(selector)) });
  }
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const row = asObject(artifact);
    if (!row) continue;
    const id = trimOrNull(row.artifact_filename) || trimOrNull(row.reason) || "artifact";
    rows.push({
      id,
      source: "artifact",
      estimated_reads: sumNumbers([row.firestore_read_limit, row.row_n, row.healthy_run_n]),
      firestore_read_limit: toNumberOrNull(row.firestore_read_limit),
      row_n: toNumberOrNull(row.row_n),
      artifact_generated_age_minutes: toNumberOrNull(row.artifact_generated_age_minutes),
    });
  }
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function evaluateFirestoreCostGuard({ unifiedReport = null, artifacts = [], thresholds = resolveFirestoreCostThresholds() } = {}) {
  const budgetRows = collectBudgetRows({ unifiedReport, artifacts });
  const blockers = [];
  const totalEstimatedReads = sumNumbers(budgetRows.map((row) => row.estimated_reads));
  const collectorLimitTotal = sumNumbers(budgetRows.filter((row) => row.id === "collector_query_budget").map((row) => row.query_limit_total));
  if (budgetRows.length === 0) blockers.push("FIRESTORE_COST_GUARD:BUDGET_EVIDENCE_REQUIRED");
  if (totalEstimatedReads > Number(thresholds.max_total_estimated_reads)) blockers.push("FIRESTORE_COST_GUARD:TOTAL_READ_BUDGET_EXCEEDED");
  if (collectorLimitTotal > Number(thresholds.max_collector_query_limit_total)) blockers.push("FIRESTORE_COST_GUARD:COLLECTOR_QUERY_BUDGET_EXCEEDED");
  if (budgetRows.some((row) => Number(row.estimated_reads || 0) > Number(thresholds.max_single_artifact_reads))) {
    blockers.push("FIRESTORE_COST_GUARD:SINGLE_ARTIFACT_READ_BUDGET_EXCEEDED");
  }
  if (budgetRows.some((row) => row.artifact_generated_age_minutes != null && Number(row.artifact_generated_age_minutes) > Number(thresholds.max_artifact_age_minutes))) {
    blockers.push("FIRESTORE_COST_GUARD:STALE_BUDGET_ARTIFACT");
  }
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_FIRESTORE_COST_GUARD_PASS" : "V2_FIRESTORE_COST_GUARD_BLOCKED",
    blockers: Object.freeze(blockers),
    thresholds: Object.freeze({ ...thresholds }),
    estimated_total_reads: totalEstimatedReads,
    collector_query_limit_total: collectorLimitTotal,
    budget_rows: budgetRows,
  });
}

module.exports = {
  resolveFirestoreCostThresholds,
  collectBudgetRows,
  evaluateFirestoreCostGuard,
  __test: {
    trimOrNull,
    toNumberOrNull,
    sumNumbers,
  },
};
