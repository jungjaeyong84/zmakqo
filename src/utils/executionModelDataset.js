"use strict";

const EXECUTION_MODEL_DATASET_SCHEMA_VERSION = "2026-04-05.v1";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function parseMs(value) {
  const direct = toNum(value);
  if (Number.isFinite(direct)) return direct;
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function normalizeFeatureBag(features = null) {
  if (!features || typeof features !== "object" || Array.isArray(features)) return {};
  const out = {};
  for (const [key, value] of Object.entries(features)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function isExitEvent(event) {
  return String(event || "").trim().toUpperCase().startsWith("EXIT_");
}

function readDocs(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.docs)) return value.docs;
  return [];
}

function summarizeFillAggregate(fills = []) {
  const scoped = (Array.isArray(fills) ? fills : []).filter((row) => row && typeof row === "object");
  const firstFill = scoped
    .map((row) => ({ row, ms: parseMs(row.created_at) ?? toNum(row.exec_bar_close_time_utc_ms) }))
    .filter((row) => Number.isFinite(row.ms))
    .sort((a, b) => a.ms - b.ms)[0] || null;
  const slippageValues = scoped
    .map((row) => toNum(row.slippage_bps) ?? toNum(row.live_exec_policy_quality_slippage_bps))
    .filter((value) => Number.isFinite(value));
  const partialValues = scoped
    .map((row) => toNum(row.live_exec_policy_quality_partial_pct))
    .filter((value) => Number.isFinite(value));
  const latencyValues = scoped
    .map((row) => toNum(row.live_exec_policy_quality_latency_ms))
    .filter((value) => Number.isFinite(value));
  const execPriceValues = scoped
    .map((row) => toNum(row.exec_price))
    .filter((value) => Number.isFinite(value));
  return {
    fill_n: scoped.length,
    fill_id: String(firstFill && firstFill.row && (firstFill.row.fill_id || firstFill.row.id) || "").trim() || null,
    first_fill_at_ms: firstFill ? firstFill.ms : null,
    avg_slippage_bps: slippageValues.length ? (slippageValues.reduce((acc, value) => acc + value, 0) / slippageValues.length) : null,
    max_partial_fill_pct: partialValues.length ? Math.max(...partialValues) : null,
    avg_latency_ms: latencyValues.length ? (latencyValues.reduce((acc, value) => acc + value, 0) / latencyValues.length) : null,
    exec_price: execPriceValues.length ? execPriceValues[execPriceValues.length - 1] : null,
  };
}

function buildExecutionModelRows({ intents = [], fills = [] } = {}) {
  const intentRows = readDocs(intents).filter((row) => row && typeof row === "object");
  const fillRows = readDocs(fills).filter((row) => row && typeof row === "object");
  const fillsByIntent = new Map();
  for (const fill of fillRows) {
    const key = String(fill.intent_id || fill.intentId || "").trim();
    if (!key) continue;
    if (!fillsByIntent.has(key)) fillsByIntent.set(key, []);
    fillsByIntent.get(key).push(fill);
  }

  return intentRows.map((intent) => {
    const intentId = String(intent.intent_id || intent.id || "").trim() || null;
    const linkedFills = intentId ? (fillsByIntent.get(intentId) || []) : [];
    const agg = summarizeFillAggregate(linkedFills);
    const intentCreatedAtMs = parseMs(intent.created_at);
    const filledAtMs = agg.first_fill_at_ms ?? parseMs(intent.filled_at);
    const createdToFillMs = Number.isFinite(intentCreatedAtMs) && Number.isFinite(filledAtMs)
      ? (filledAtMs - intentCreatedAtMs)
      : (toNum(intent.live_exec_policy_quality_latency_ms) ?? agg.avg_latency_ms);
    const partialFillPct = agg.max_partial_fill_pct ?? toNum(intent.live_exec_policy_quality_partial_pct);
    const slippageBps = agg.avg_slippage_bps ?? toNum(intent.live_exec_policy_quality_slippage_bps);
    const status = toUpper(intent.status);
    const terminalFailureStatus = toUpper(intent.terminal_failure_status);
    const rejected = terminalFailureStatus != null || status === "REJECTED" || status === "FAILED";
    const rejectReason = rejected
      ? (String(intent.status_reason || intent.reject_reason || intent.pending_reason || "").trim() || null)
      : null;
    const features = normalizeFeatureBag(intent.features_json);
    return {
      schema_version: EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
      row_id: intentId || String(intent.signal_id || intent.id || "").trim() || null,
      lineage: {
        intent_id: intentId,
        fill_id: agg.fill_id,
        signal_id: String(intent.signal_id || "").trim() || null,
        entry_event_id: String(intent.entry_event_id || "").trim() || null,
      },
      context: {
        exchange: toUpper(intent.exchange),
        market: toUpper(intent.symbol || intent.symbol_or_pair_id || intent.market),
        tf: String(intent.tf || "").trim() || null,
        event: toUpper(intent.event),
        side: toUpper(intent.side),
        regime: toUpper(intent.regime || intent.market_regime),
        source: toUpper(intent.source),
        is_exit_event: isExitEvent(intent.event),
      },
      execution: {
        status,
        terminal_failure_status: terminalFailureStatus,
        reject_reason: rejectReason,
        intent_created_at_ms: intentCreatedAtMs,
        filled_at_ms: filledAtMs,
        created_to_fill_ms: createdToFillMs,
        slippage_bps: slippageBps,
        partial_fill_pct: partialFillPct,
        fill_n: agg.fill_n,
        signal_price: toNum(intent.signal_price),
        exec_price: agg.exec_price ?? toNum(intent.exec_price),
        qty_pct: toNum(intent.qty_pct),
        qty_fraction: toNum(intent.qty_fraction),
        live_policy_latency_ms: toNum(intent.live_exec_policy_quality_latency_ms),
        live_policy_slippage_bps: toNum(intent.live_exec_policy_quality_slippage_bps),
        live_policy_partial_pct: toNum(intent.live_exec_policy_quality_partial_pct),
      },
      labels: {
        was_filled: agg.fill_n > 0 || status === "FILLED",
        was_partial: Number.isFinite(partialFillPct) && partialFillPct > 0,
        was_rejected: rejected,
        created_to_fill_ms: createdToFillMs,
        slippage_bps: slippageBps,
        partial_fill_pct: partialFillPct,
      },
      features,
    };
  }).filter((row) => row.row_id && row.context.market && row.context.tf && row.context.event);
}

function summarizeExecutionModelRows(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  const entryRowsN = scoped.filter((row) => row && row.context && row.context.is_exit_event !== true).length;
  const exitRowsN = scoped.filter((row) => row && row.context && row.context.is_exit_event === true).length;
  const filledN = scoped.filter((row) => row.labels && row.labels.was_filled === true).length;
  const partialN = scoped.filter((row) => row.labels && row.labels.was_partial === true).length;
  const rejectedN = scoped.filter((row) => row.labels && row.labels.was_rejected === true).length;
  const latencyVals = scoped.map((row) => toNum(row.labels && row.labels.created_to_fill_ms)).filter((v) => Number.isFinite(v));
  const slippageVals = scoped.map((row) => toNum(row.labels && row.labels.slippage_bps)).filter((v) => Number.isFinite(v));
  const p95 = (values) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b)=>a-b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    return sorted[idx];
  };
  return {
    rows_n: scoped.length,
    entry_rows_n: entryRowsN,
    exit_rows_n: exitRowsN,
    filled_n: filledN,
    partial_n: partialN,
    rejected_n: rejectedN,
    fill_rate: scoped.length > 0 ? (filledN / scoped.length) : null,
    partial_rate: scoped.length > 0 ? (partialN / scoped.length) : null,
    reject_rate: scoped.length > 0 ? (rejectedN / scoped.length) : null,
    created_to_fill_p95_ms: p95(latencyVals),
    slippage_p95_bps: p95(slippageVals),
    feature_keys_n: Array.from(new Set(scoped.flatMap((row) => Object.keys(row.features || {})))).length,
    status: scoped.length > 0 ? 'EXECUTION_MODEL_DATASET_READY' : 'EXECUTION_MODEL_DATASET_EMPTY',
  };
}

module.exports = {
  EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
  buildExecutionModelRows,
  summarizeExecutionModelRows,
  __test: {
    summarizeFillAggregate,
  },
};
