"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readRows(value) {
  if (!value || typeof value !== "object") return [];
  return Array.isArray(value.rows) ? value.rows : [];
}

function p95(values = []) {
  const scoped = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(Number(v))).map(Number);
  if (!scoped.length) return null;
  const sorted = scoped.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[idx];
}

function isOperationalSource(source = null) {
  const normalized = String(source || "").trim().toUpperCase();
  return normalized === "TV_WEBHOOK" || normalized === "LIVE_RUNTIME" || normalized === "SERVER_SIGNAL";
}

function topGroups(rows = [], valueKey, filters = () => true, limit = 8) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!filters(row)) continue;
    const source = String(row && row.context && row.context.source || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    const event = String(row && row.context && row.context.event || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    const market = String(row && row.context && row.context.market || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    const key = [source, event, market].join("|");
    if (!groups.has(key)) groups.set(key, { key, source, event, market, rows_n: 0, values: [] });
    const bucket = groups.get(key);
    const value = toNum(valueKey(row));
    if (!Number.isFinite(value)) continue;
    bucket.rows_n += 1;
    bucket.values.push(value);
  }
  return Array.from(groups.values())
    .map((row) => ({
      key: row.key,
      source: row.source,
      event: row.event,
      market: row.market,
      rows_n: row.rows_n,
      p95_ms: p95(row.values),
    }))
    .filter((row) => Number.isFinite(row.p95_ms))
    .sort((a, b) => ((b.p95_ms || 0) - (a.p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function summarizeExecutionStageLatency(value = null) {
  const rows = readRows(value).filter((row) => row && row.context && row.context.is_exit_event !== true);
  const signalToIntent = rows.map((row) => toNum(row.labels && row.labels.signal_to_intent_ms)).filter((v) => Number.isFinite(v));
  const webhookToOutcome = rows.map((row) => toNum(row.labels && row.labels.webhook_to_outcome_ms)).filter((v) => Number.isFinite(v));
  const webhookSavedToIntentRows = rows.filter((row) => String(row && row.execution && row.execution.webhook_decision || "").trim().toUpperCase() === "SAVED");
  const webhookSavedToIntent = webhookSavedToIntentRows
    .map((row) => toNum(row.labels && row.labels.webhook_to_intent_ms))
    .filter((v) => Number.isFinite(v));
  const intentToFillMeasuredRows = rows.filter((row) => row && row.labels && row.labels.created_to_fill_measured === true);
  const intentToFillMeasured = intentToFillMeasuredRows
    .map((row) => toNum(row.labels && row.labels.created_to_fill_ms))
    .filter((v) => Number.isFinite(v));
  const intentToFillFallbackRows = rows.filter((row) => row && row.labels && row.labels.created_to_fill_measured !== true);
  const intentToFillFallback = intentToFillFallbackRows
    .map((row) => toNum(row.labels && row.labels.created_to_fill_ms))
    .filter((v) => Number.isFinite(v));

  const topSignalToIntentGroups = topGroups(rows, (row) => row.labels && row.labels.signal_to_intent_ms, (row) => Number.isFinite(toNum(row && row.labels && row.labels.signal_to_intent_ms)));
  const topOperationalSignalToIntentGroups = topGroups(
    rows,
    (row) => row.labels && row.labels.signal_to_intent_ms,
    (row) => Number.isFinite(toNum(row && row.labels && row.labels.signal_to_intent_ms)) && isOperationalSource(row && row.context && row.context.source)
  );
  const topWebhookSavedToIntentGroups = topGroups(
    webhookSavedToIntentRows,
    (row) => row.labels && row.labels.webhook_to_intent_ms,
    (row) => Number.isFinite(toNum(row && row.labels && row.labels.webhook_to_intent_ms))
  );
  const topOperationalWebhookSavedToIntentGroups = topGroups(
    webhookSavedToIntentRows,
    (row) => row.labels && row.labels.webhook_to_intent_ms,
    (row) => Number.isFinite(toNum(row && row.labels && row.labels.webhook_to_intent_ms)) && isOperationalSource(row && row.context && row.context.source)
  );
  const topIntentToFillMeasuredGroups = topGroups(
    intentToFillMeasuredRows,
    (row) => row.labels && row.labels.created_to_fill_ms,
    (row) => Number.isFinite(toNum(row && row.labels && row.labels.created_to_fill_ms))
  );

  return {
    status: rows.length > 0 ? "EXECUTION_STAGE_LATENCY_READY" : "EXECUTION_STAGE_LATENCY_EMPTY",
    entry_rows_n: rows.length,
    signal_to_intent_p95_ms: p95(signalToIntent),
    webhook_to_outcome_p95_ms: p95(webhookToOutcome),
    webhook_saved_to_intent_p95_ms: p95(webhookSavedToIntent),
    intent_to_fill_measured_p95_ms: p95(intentToFillMeasured),
    intent_to_fill_fallback_p95_ms: p95(intentToFillFallback),
    webhook_saved_to_intent_rows_n: webhookSavedToIntent.length,
    intent_to_fill_measured_rows_n: intentToFillMeasured.length,
    intent_to_fill_fallback_rows_n: intentToFillFallback.length,
    top_signal_to_intent_groups: topSignalToIntentGroups,
    top_operational_signal_to_intent_groups: topOperationalSignalToIntentGroups,
    top_webhook_saved_to_intent_groups: topWebhookSavedToIntentGroups,
    top_operational_webhook_saved_to_intent_groups: topOperationalWebhookSavedToIntentGroups,
    top_intent_to_fill_measured_groups: topIntentToFillMeasuredGroups,
  };
}

module.exports = {
  summarizeExecutionStageLatency,
};
