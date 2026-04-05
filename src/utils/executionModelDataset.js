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

function computeAdverseSlippageBps({ side = null, signalPrice = null, execPrice = null } = {}) {
  const ref = toNum(signalPrice);
  const fill = toNum(execPrice);
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(fill) || fill <= 0) return null;
  const normalizedSide = String(side || "").trim().toUpperCase();
  const adverseBps = normalizedSide === "SELL"
    ? ((ref - fill) / ref) * 10000
    : ((fill - ref) / ref) * 10000;
  if (!Number.isFinite(adverseBps)) return null;
  return Math.max(0, adverseBps);
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

function summarizeFillAggregate(fills = [], intent = null) {
  const scoped = (Array.isArray(fills) ? fills : []).filter((row) => row && typeof row === "object");
  if (!scoped.length) {
    return {
      fill_n: 0,
      fill_id: null,
      first_fill_at_ms: null,
      avg_slippage_bps: null,
      slippage_measured_n: 0,
      slippage_missing_n: 0,
      max_partial_fill_pct: null,
      avg_latency_ms: null,
      exec_price: null,
      primary_fill_source: "NO_FILL",
      fill_source_counts: {},
    };
  }
  const firstFill = scoped
    .map((row) => ({ row, ms: parseMs(row.created_at) ?? toNum(row.exec_bar_close_time_utc_ms) }))
    .filter((row) => Number.isFinite(row.ms))
    .sort((a, b) => a.ms - b.ms)[0] || null;
  const intentSignalPrice = toNum(intent && (intent.signal_price || (intent.features_json && intent.features_json.signal_price)));
  const slippageValues = scoped
    .map((row) => {
      const computed = computeAdverseSlippageBps({
        side: row.side || (intent && intent.side),
        signalPrice: toNum(row.signal_price) ?? intentSignalPrice,
        execPrice: row.exec_price,
      });
      if (Number.isFinite(computed)) return computed;
      return toNum(row.slippage_bps) ?? toNum(row.live_exec_policy_quality_slippage_bps);
    })
    .filter((value) => Number.isFinite(value));
  const slippageMissingN = scoped.length - slippageValues.length;
  const partialValues = scoped
    .map((row) => toNum(row.live_exec_policy_quality_partial_pct))
    .filter((value) => Number.isFinite(value));
  const latencyValues = scoped
    .map((row) => toNum(row.live_exec_policy_quality_latency_ms))
    .filter((value) => Number.isFinite(value));
  const execPriceValues = scoped
    .map((row) => toNum(row.exec_price))
    .filter((value) => Number.isFinite(value));
  const fillSourceCounts = new Map();
  for (const row of scoped) {
    const source = toUpper(row.source || row.fill_source || row.exec_price_source) || "UNKNOWN";
    fillSourceCounts.set(source, (fillSourceCounts.get(source) || 0) + 1);
  }
  const primaryFillSource = Array.from(fillSourceCounts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0] || null;
  return {
    fill_n: scoped.length,
    fill_id: String(firstFill && firstFill.row && (firstFill.row.fill_id || firstFill.row.id) || "").trim() || null,
    first_fill_at_ms: firstFill ? firstFill.ms : null,
    avg_slippage_bps: slippageValues.length ? (slippageValues.reduce((acc, value) => acc + value, 0) / slippageValues.length) : null,
    slippage_measured_n: slippageValues.length,
    slippage_missing_n: slippageMissingN,
    max_partial_fill_pct: partialValues.length ? Math.max(...partialValues) : null,
    avg_latency_ms: latencyValues.length ? (latencyValues.reduce((acc, value) => acc + value, 0) / latencyValues.length) : null,
    exec_price: execPriceValues.length ? execPriceValues[execPriceValues.length - 1] : null,
    primary_fill_source: primaryFillSource,
    fill_source_counts: Object.fromEntries(fillSourceCounts),
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
    const agg = summarizeFillAggregate(linkedFills, intent);
    const intentCreatedAtMs = parseMs(intent.created_at);
    const filledAtMs = agg.first_fill_at_ms ?? parseMs(intent.filled_at);
    const measuredCreatedToFillMs = Number.isFinite(intentCreatedAtMs) && Number.isFinite(filledAtMs)
      ? (filledAtMs - intentCreatedAtMs)
      : null;
    const fallbackCreatedToFillMs = toNum(intent.live_exec_policy_quality_latency_ms) ?? agg.avg_latency_ms;
    const createdToFillMs = measuredCreatedToFillMs ?? fallbackCreatedToFillMs;
    const createdToFillSource = Number.isFinite(measuredCreatedToFillMs)
      ? "FILL_CHAIN"
      : (Number.isFinite(fallbackCreatedToFillMs) ? "LIVE_POLICY_FALLBACK" : null);
    const partialFillPct = agg.max_partial_fill_pct ?? toNum(intent.live_exec_policy_quality_partial_pct);
    const slippageBps = agg.avg_slippage_bps ?? toNum(intent.live_exec_policy_quality_slippage_bps);
    const status = toUpper(intent.status);
    const terminalFailureStatus = toUpper(intent.terminal_failure_status);
    const rejected = terminalFailureStatus != null || status === "REJECTED" || status === "FAILED";
    const rejectReason = rejected
      ? (String(intent.status_reason || intent.reject_reason || intent.pending_reason || "").trim() || null)
      : null;
    const features = normalizeFeatureBag(intent.features_json);
    const isTimeStopEvent = String(intent.event || "").trim().toUpperCase().startsWith("EXIT_TIME_STOP");
    const preTp1TimeStop = isTimeStopEvent && features.tp_p1_done !== true;
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
        primary_fill_source: agg.primary_fill_source,
        is_exit_event: isExitEvent(intent.event),
      },
      execution: {
        status,
        terminal_failure_status: terminalFailureStatus,
        reject_reason: rejectReason,
        intent_created_at_ms: intentCreatedAtMs,
        filled_at_ms: filledAtMs,
        created_to_fill_ms: createdToFillMs,
        created_to_fill_source: createdToFillSource,
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
        fill_source_counts: agg.fill_source_counts,
        slippage_measured_n: agg.slippage_measured_n,
        slippage_missing_n: agg.slippage_missing_n,
      },
      labels: {
        was_filled: agg.fill_n > 0 || status === "FILLED",
        was_partial: Number.isFinite(partialFillPct) && partialFillPct > 0,
        was_rejected: rejected,
        time_stop_hit: isTimeStopEvent,
        pre_tp1_time_stop: preTp1TimeStop,
        created_to_fill_ms: createdToFillMs,
        created_to_fill_measured: Number.isFinite(measuredCreatedToFillMs),
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
  const measuredLatencyVals = scoped
    .filter((row) => row && row.labels && row.labels.created_to_fill_measured === true)
    .map((row) => toNum(row.labels && row.labels.created_to_fill_ms))
    .filter((v) => Number.isFinite(v));
  const slippageVals = scoped.map((row) => toNum(row.labels && row.labels.slippage_bps)).filter((v) => Number.isFinite(v));
  const timeStopN = scoped.filter((row) => row && row.labels && row.labels.time_stop_hit === true).length;
  const preTp1TimeStopN = scoped.filter((row) => row && row.labels && row.labels.pre_tp1_time_stop === true).length;
  const byPrimaryFillSource = new Map();
  for (const row of scoped) {
    const key = String(
      row && row.context && row.context.primary_fill_source
      || (row && row.labels && row.labels.was_filled === false ? "NO_FILL" : null)
      || row && row.context && row.context.source
      || "UNKNOWN"
    ).trim().toUpperCase() || "UNKNOWN";
    if (!byPrimaryFillSource.has(key)) {
      byPrimaryFillSource.set(key, {
        key,
        rows_n: 0,
        slippage_zero_n: 0,
        slippage_measured_n: 0,
        slippage_missing_n: 0,
        entry_rows_n: 0,
        exit_rows_n: 0,
      });
    }
    const bucket = byPrimaryFillSource.get(key);
    bucket.rows_n += 1;
    const slippage = toNum(row && row.labels && row.labels.slippage_bps);
    if (Number.isFinite(slippage)) {
      bucket.slippage_measured_n += 1;
      if (slippage === 0) bucket.slippage_zero_n += 1;
    } else {
      bucket.slippage_missing_n += 1;
    }
    if (row && row.context && row.context.is_exit_event === true) bucket.exit_rows_n += 1;
    else bucket.entry_rows_n += 1;
  }
  const p95 = (values) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b)=>a-b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    return sorted[idx];
  };
  const byEntryLatencyGroup = new Map();
  const byMeasuredEntryLatencyGroup = new Map();
  const byFallbackEntryLatencyGroup = new Map();
  for (const row of scoped) {
    if (!row || !row.context || row.context.is_exit_event === true) continue;
    const latencyMs = toNum(row.labels && row.labels.created_to_fill_ms);
    if (!Number.isFinite(latencyMs)) continue;
    const event = String(row.context.event || "").trim().toUpperCase() || "UNKNOWN";
    const source = String(row.context.source || "").trim().toUpperCase() || "UNKNOWN";
    const fillSource = String(row.context.primary_fill_source || "NO_FILL").trim().toUpperCase() || "UNKNOWN";
    const market = String(row.context.market || "").trim().toUpperCase() || "UNKNOWN";
    const key = [event, source, fillSource, market].join("|");
    if (!byEntryLatencyGroup.has(key)) {
      byEntryLatencyGroup.set(key, { key, event, source, primary_fill_source: fillSource, market, rows_n: 0, latency_values: [] });
    }
    const bucket = byEntryLatencyGroup.get(key);
    bucket.rows_n += 1;
    bucket.latency_values.push(latencyMs);
    const measured = row && row.labels && row.labels.created_to_fill_measured === true;
    const targetMap = measured ? byMeasuredEntryLatencyGroup : byFallbackEntryLatencyGroup;
    if (!targetMap.has(key)) {
      targetMap.set(key, { key, event, source, primary_fill_source: fillSource, market, rows_n: 0, latency_values: [] });
    }
    const target = targetMap.get(key);
    target.rows_n += 1;
    target.latency_values.push(latencyMs);
  }
  return {
    rows_n: scoped.length,
    entry_rows_n: entryRowsN,
    exit_rows_n: exitRowsN,
    filled_n: filledN,
    partial_n: partialN,
    rejected_n: rejectedN,
    time_stop_n: timeStopN,
    pre_tp1_time_stop_n: preTp1TimeStopN,
    fill_rate: scoped.length > 0 ? (filledN / scoped.length) : null,
    partial_rate: scoped.length > 0 ? (partialN / scoped.length) : null,
    reject_rate: scoped.length > 0 ? (rejectedN / scoped.length) : null,
    created_to_fill_p95_ms: p95(latencyVals),
    created_to_fill_measured_p95_ms: p95(measuredLatencyVals),
    slippage_p95_bps: p95(slippageVals),
    feature_keys_n: Array.from(new Set(scoped.flatMap((row) => Object.keys(row.features || {})))).length,
    by_primary_fill_source: Array.from(byPrimaryFillSource.values())
      .map((row) => ({
        ...row,
        slippage_zero_rate: row.slippage_measured_n > 0 ? (row.slippage_zero_n / row.slippage_measured_n) : null,
        slippage_measured_rate: row.rows_n > 0 ? (row.slippage_measured_n / row.rows_n) : null,
      }))
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key)),
    top_entry_latency_groups: Array.from(byEntryLatencyGroup.values())
      .map((row) => ({
        key: row.key,
        event: row.event,
        source: row.source,
        primary_fill_source: row.primary_fill_source,
        market: row.market,
        rows_n: row.rows_n,
        created_to_fill_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.created_to_fill_p95_ms || 0) - (a.created_to_fill_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_entry_measured_latency_groups: Array.from(byMeasuredEntryLatencyGroup.values())
      .map((row) => ({
        key: row.key,
        event: row.event,
        source: row.source,
        primary_fill_source: row.primary_fill_source,
        market: row.market,
        rows_n: row.rows_n,
        created_to_fill_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.created_to_fill_p95_ms || 0) - (a.created_to_fill_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_entry_fallback_latency_groups: Array.from(byFallbackEntryLatencyGroup.values())
      .map((row) => ({
        key: row.key,
        event: row.event,
        source: row.source,
        primary_fill_source: row.primary_fill_source,
        market: row.market,
        rows_n: row.rows_n,
        created_to_fill_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.created_to_fill_p95_ms || 0) - (a.created_to_fill_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    status: scoped.length > 0 ? 'EXECUTION_MODEL_DATASET_READY' : 'EXECUTION_MODEL_DATASET_EMPTY',
  };
}

function splitExecutionModelRows(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  return {
    entry_rows: scoped.filter((row) => row && row.context && row.context.is_exit_event !== true),
    exit_rows: scoped.filter((row) => row && row.context && row.context.is_exit_event === true),
  };
}

module.exports = {
  EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
  buildExecutionModelRows,
  summarizeExecutionModelRows,
  splitExecutionModelRows,
  __test: {
    summarizeFillAggregate,
  },
};
