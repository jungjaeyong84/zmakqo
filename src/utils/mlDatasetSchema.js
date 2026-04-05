"use strict";

const { labelOutcome } = require("../services/outcomeLabeler");

const ML_DATASET_SCHEMA_VERSION = "2026-04-05.v1";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
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

function buildMlTrainingRow(row = {}) {
  const features = normalizeFeatureBag(row.features_json);
  const labels = labelOutcome(row);
  const rowId = String(
    row.entry_event_id
    || row.signal_id
    || row.signal_key
    || `${row.provider || "UNKNOWN"}__${row.market || "UNKNOWN"}__${row.tf || "UNKNOWN"}__${row.event || "UNKNOWN"}__${row.signal_bar_close_time_utc_ms || "NA"}`
  ).trim();

  return {
    schema_version: ML_DATASET_SCHEMA_VERSION,
    row_id: rowId,
    lineage: {
      signal_id: String(row.signal_id || "").trim() || null,
      signal_key: String(row.signal_key || "").trim() || null,
      entry_event_id: String(row.entry_event_id || "").trim() || null,
    },
    context: {
      provider: toUpper(row.provider),
      market: toUpper(row.market),
      tf: String(row.tf || "").trim() || null,
      side: toUpper(row.side),
      event: toUpper(row.event),
      source_row_type: toUpper(row.source_row_type),
      signal_bar_close_time_utc_ms: toNum(row.signal_bar_close_time_utc_ms),
    },
    verdicts: {
      integrity: toUpper(row.integrity_verdict),
      quality: toUpper(row.quality_verdict),
      state_soft_sizing: toUpper(row.state_soft_sizing_verdict),
      ev: toUpper(row.ev_verdict),
      wait: toUpper(row.wait_verdict),
    },
    execution: {
      intent_created_at_ms: toNum(row.intent_created_at_ms),
      fill_created_at_ms: toNum(row.fill_created_at_ms),
      trade_closed_at_ms: toNum(row.trade_closed_at_ms),
      fill_status: toUpper(row.fill_status),
      partial_fill: row.partial_fill === true,
      fills_n: toNum(row.fills_n) || 0,
      trades_n: toNum(row.trades_n) || 0,
      drops_n: toNum(row.drops_n) || 0,
      reject_reason: String(row.reject_reason || "").trim() || null,
    },
    drop: {
      stage_key: toUpper(row.drop_stage_key),
      reason: String(row.drop_reason || "").trim() || null,
      fallback_reason: String(row.fallback_reason || "").trim() || null,
    },
    febt: {
      mode: toUpper(row.febt_mode),
      phase: toUpper(row.febt_phase),
      calc_ok: row.febt_calc_ok === true,
      timing_action: toUpper(row.febt_timing_action),
      authority: toUpper(row.febt_authority),
      lock_score: toNum(row.febt_lock_score),
      delay_cost: toNum(row.febt_delay_cost),
      late_risk: toNum(row.febt_late_risk),
      failure_risk: toNum(row.febt_failure_risk),
      edge: toNum(row.febt_edge),
    },
    lifecycle: {
      tp0_hit: row.tp0_hit === true,
      tp0_first: row.tp0_first === true,
      tp1_first: row.tp1_first === true,
      sl_first: row.sl_first === true,
      time_stop_hit: row.time_stop_hit === true,
      time_stop_first: row.time_stop_first === true,
    },
    labels,
    features,
  };
}

function validateMlTrainingRow(row = {}) {
  const errors = [];
  if (String(row.schema_version || "").trim() !== ML_DATASET_SCHEMA_VERSION) errors.push("SCHEMA_VERSION_MISMATCH");
  if (!String(row.row_id || "").trim()) errors.push("ROW_ID_MISSING");
  if (!row.context || !row.context.market) errors.push("MARKET_MISSING");
  if (!row.context || !row.context.tf) errors.push("TF_MISSING");
  if (!row.context || !row.context.event) errors.push("EVENT_MISSING");
  if (!row.context || !row.context.source_row_type) errors.push("SOURCE_ROW_TYPE_MISSING");
  if (!row.labels || !String(row.labels.outcome_state || "").trim()) errors.push("OUTCOME_STATE_MISSING");
  return {
    ok: errors.length === 0,
    errors,
  };
}

function summarizeMlTrainingRows(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  let invalidN = 0;
  const byOutcomeState = new Map();
  const bySourceRowType = new Map();
  const byMarket = new Map();
  let realizedN = 0;

  for (const row of scoped) {
    const validation = validateMlTrainingRow(row);
    if (!validation.ok) invalidN += 1;
    const outcomeState = String(row && row.labels && row.labels.outcome_state || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    const sourceRowType = String(row && row.context && row.context.source_row_type || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    const market = String(row && row.context && row.context.market || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    byOutcomeState.set(outcomeState, (byOutcomeState.get(outcomeState) || 0) + 1);
    bySourceRowType.set(sourceRowType, (bySourceRowType.get(sourceRowType) || 0) + 1);
    byMarket.set(market, (byMarket.get(market) || 0) + 1);
    if (row && row.labels && row.labels.is_realized === true) realizedN += 1;
  }

  const sortMap = (map) => Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));

  return {
    rows_n: scoped.length,
    valid_n: scoped.length - invalidN,
    invalid_n: invalidN,
    realized_n: realizedN,
    by_outcome_state: sortMap(byOutcomeState),
    by_source_row_type: sortMap(bySourceRowType),
    by_market: sortMap(byMarket).slice(0, 12),
  };
}

module.exports = {
  ML_DATASET_SCHEMA_VERSION,
  buildMlTrainingRow,
  validateMlTrainingRow,
  summarizeMlTrainingRows,
};
