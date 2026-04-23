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

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function resolveFirestoreCostThresholds(env = process.env) {
  return Object.freeze({
    max_total_estimated_reads: Number(env.V2_FIRESTORE_COST_GUARD_MAX_TOTAL_READS || 1000),
    max_single_artifact_reads: Number(env.V2_FIRESTORE_COST_GUARD_MAX_SINGLE_ARTIFACT_READS || 300),
    max_collector_query_limit_total: Number(env.V2_FIRESTORE_COST_GUARD_MAX_COLLECTOR_QUERY_LIMIT_TOTAL || 450),
    max_artifact_age_minutes: Number(env.V2_FIRESTORE_COST_GUARD_MAX_ARTIFACT_AGE_MINUTES || 180),
    max_billing_read_ops: Number(env.V2_FIRESTORE_COST_GUARD_MAX_BILLING_READ_OPS || 5000),
    require_billing_metric: parseBool(env.V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC, false),
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

function collectBillingMetricRows({ billingMetric = null } = {}) {
  const source = asObject(billingMetric);
  if (!source) return Object.freeze([]);
  const rawRows = Array.isArray(source.rows)
    ? source.rows
    : (Array.isArray(source.time_series) ? source.time_series : [source]);
  const rows = rawRows.map((row, index) => {
    const metric = asObject(row) || {};
    const readOps = toNumberOrNull(
      metric.read_ops
      ?? metric.readOps
      ?? metric.document_read_count
      ?? metric.documentReadCount
      ?? metric.value
      ?? metric.points
    );
    return Object.freeze({
      id: trimOrNull(metric.id) || `billing_metric_${index + 1}`,
      source: trimOrNull(metric.source) || trimOrNull(source.source) || "billing_metric",
      window_start: trimOrNull(metric.window_start || metric.windowStart || source.window_start || source.windowStart),
      window_end: trimOrNull(metric.window_end || metric.windowEnd || source.window_end || source.windowEnd),
      read_ops: readOps,
    });
  }).filter((row) => Number.isFinite(Number(row.read_ops)));
  return Object.freeze(rows);
}

function evaluateFirestoreCostGuard({
  unifiedReport = null,
  artifacts = [],
  billingMetric = null,
  thresholds = resolveFirestoreCostThresholds(),
} = {}) {
  const budgetRows = collectBudgetRows({ unifiedReport, artifacts });
  const billingMetricRows = collectBillingMetricRows({ billingMetric });
  const blockers = [];
  const totalEstimatedReads = sumNumbers(budgetRows.map((row) => row.estimated_reads));
  const collectorLimitTotal = sumNumbers(budgetRows.filter((row) => row.id === "collector_query_budget").map((row) => row.query_limit_total));
  const billingReadOpsTotal = sumNumbers(billingMetricRows.map((row) => row.read_ops));
  if (budgetRows.length === 0) blockers.push("FIRESTORE_COST_GUARD:BUDGET_EVIDENCE_REQUIRED");
  if (totalEstimatedReads > Number(thresholds.max_total_estimated_reads)) blockers.push("FIRESTORE_COST_GUARD:TOTAL_READ_BUDGET_EXCEEDED");
  if (collectorLimitTotal > Number(thresholds.max_collector_query_limit_total)) blockers.push("FIRESTORE_COST_GUARD:COLLECTOR_QUERY_BUDGET_EXCEEDED");
  if (budgetRows.some((row) => Number(row.estimated_reads || 0) > Number(thresholds.max_single_artifact_reads))) {
    blockers.push("FIRESTORE_COST_GUARD:SINGLE_ARTIFACT_READ_BUDGET_EXCEEDED");
  }
  if (budgetRows.some((row) => row.artifact_generated_age_minutes != null && Number(row.artifact_generated_age_minutes) > Number(thresholds.max_artifact_age_minutes))) {
    blockers.push("FIRESTORE_COST_GUARD:STALE_BUDGET_ARTIFACT");
  }
  if (thresholds.require_billing_metric === true && billingMetricRows.length === 0) {
    blockers.push("FIRESTORE_COST_GUARD:BILLING_METRIC_REQUIRED");
  }
  if (billingMetricRows.length > 0 && billingReadOpsTotal > Number(thresholds.max_billing_read_ops)) {
    blockers.push("FIRESTORE_COST_GUARD:BILLING_READ_OPS_EXCEEDED");
  }
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_FIRESTORE_COST_GUARD_PASS" : "V2_FIRESTORE_COST_GUARD_BLOCKED",
    blockers: Object.freeze(blockers),
    thresholds: Object.freeze({ ...thresholds }),
    estimated_total_reads: totalEstimatedReads,
    collector_query_limit_total: collectorLimitTotal,
    billing_metric_required: thresholds.require_billing_metric === true,
    billing_read_ops_total: billingReadOpsTotal,
    budget_rows: budgetRows,
    billing_metric_rows: billingMetricRows,
  });
}

module.exports = {
  resolveFirestoreCostThresholds,
  collectBudgetRows,
  collectBillingMetricRows,
  evaluateFirestoreCostGuard,
  __test: {
    trimOrNull,
    toNumberOrNull,
    sumNumbers,
    parseBool,
  },
};
