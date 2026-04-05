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

function resolveSignalBarCloseMs(intent = null) {
  return (
    toNum(intent && intent.signal_bar_close_time_utc_ms)
    ?? parseMs(intent && intent.signal_bar_close_time_utc)
    ?? parseMs(intent && intent.bar_close_time_utc)
  );
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

function deriveIntentSource(intent = null) {
  const explicit = toUpper(intent && intent.source);
  if (explicit) return explicit;
  const runId = String(intent && intent.run_id || "").trim().toUpperCase();
  const reason = String(intent && (intent.reason || intent.decision_reason) || "").trim().toUpperCase();
  const executionMode = toUpper(intent && intent.execution_mode);
  if (runId.includes("REPLAY")) return "MANUAL_REPLAY";
  if (reason.includes("SERVER_NATIVE")) return "SERVER_SIGNAL";
  if (reason.includes("TV_WEBHOOK")) return "TV_WEBHOOK";
  if (runId.includes("WEBHOOK") || reason.includes("PINE_")) return "PINE_WEBHOOK";
  if (executionMode === "PAPER") return "PAPER_RUNTIME";
  if (executionMode === "LIVE") return "LIVE_RUNTIME";
  return null;
}

function deriveEntryScheduleReason(intent = null) {
  return toUpper(intent && intent.pending_reason);
}

function deriveWebhookDelayCause(row = null) {
  const source = toUpper(row && row.context && row.context.source);
  const scheduleReason = toUpper(row && row.execution && row.execution.entry_schedule_reason);
  const noFillReason = toUpper(row && row.execution && row.execution.no_fill_reason);
  const noFillSubtype = toUpper(row && row.execution && row.execution.no_fill_subtype);
  const noFillDetail = toUpper(row && row.execution && row.execution.no_fill_detail);
  const webhookDecision = toUpper(row && row.execution && row.execution.webhook_decision);
  const runId = toUpper(row && row.run_id);
  const wasFilled = row && row.labels && row.labels.was_filled === true;
  const signalToIntentMs = toNum(row && row.execution && row.execution.signal_to_intent_ms);
  const webhookToIntentMs = toNum(row && row.execution && row.execution.webhook_to_intent_ms);
  const signalBarCloseMs = toNum(row && row.execution && row.execution.signal_bar_close_ms);
  const scheduledExecBarCloseMs = toNum(row && row.execution && row.execution.scheduled_exec_bar_close_ms);
  const webhookSignalGapMs = Number.isFinite(webhookToIntentMs) && Number.isFinite(signalToIntentMs)
    ? (webhookToIntentMs - signalToIntentMs)
    : null;
  if (source === "MANUAL_REPLAY") return "MANUAL_REPLAY";
  if (runId && runId.includes("MANUAL_EARLY_RETRY")) return "MANUAL_RETRY";
  if (scheduleReason === "WAIT_NEXT_BAR") return "SCHEDULED_WAIT_NEXT_BAR";
  if (scheduleReason === "LATE_EXEC" && wasFilled) return "LATE_EXEC_DELAYED_INTENT_FILLED";
  if (scheduleReason === "LATE_EXEC" && noFillReason === "INTENT_EXPIRED") return "LATE_EXEC_EXPIRED";
  if (scheduleReason === "LATE_EXEC") return "LATE_EXEC_WINDOW";
  if (scheduleReason === "EXEC_CURRENT_BAR" && wasFilled) {
    if (Number.isFinite(signalBarCloseMs) && Number.isFinite(scheduledExecBarCloseMs) && scheduledExecBarCloseMs > signalBarCloseMs) {
      return "IMMEDIATE_EXEC_NEXT_EXEC_BAR";
    }
    if (Number.isFinite(signalToIntentMs) && signalToIntentMs < 0) return "IMMEDIATE_EXEC_BEFORE_BAR_CLOSE";
    if (Number.isFinite(webhookSignalGapMs) && webhookSignalGapMs > 300000) return "IMMEDIATE_EXEC_STALE_WEBHOOK_MATCH";
    if (Number.isFinite(signalToIntentMs) && signalToIntentMs > 300000) {
      if (webhookDecision === "DROP") return "IMMEDIATE_EXEC_WEBHOOK_DROP_LATER_INTENT";
      if (webhookDecision === "SAVED") return "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT";
      return "IMMEDIATE_EXEC_TRUE_INTENT_DELAY";
    }
    return "IMMEDIATE_EXEC_DELAYED_INTENT_FILLED";
  }
  if (
    scheduleReason === "EXEC_CURRENT_BAR"
    && (noFillReason === "BINANCEFUT_KEYS_MISSING" || noFillSubtype === "KEYS_MISSING" || (noFillDetail && noFillDetail.includes("KEYS_MISSING")))
  ) {
    return "IMMEDIATE_EXEC_KEYS_MISSING";
  }
  if (scheduleReason === "EXEC_CURRENT_BAR" && noFillReason === "LIVE_EXCEPTION" && noFillSubtype === "TIMING_IMMEDIATE_EXEC") {
    return "IMMEDIATE_EXEC_RUNTIME_EXCEPTION";
  }
  if (scheduleReason === "EXEC_CURRENT_BAR" && noFillReason === "POSITION_FULL") {
    return "IMMEDIATE_EXEC_POSITION_FULL";
  }
  if (scheduleReason === "EXEC_CURRENT_BAR") return "IMMEDIATE_EXEC_OTHER";
  if (noFillReason === "INTENT_EXPIRED") return "INTENT_EXPIRED";
  if (noFillReason) return noFillReason;
  return "UNKNOWN";
}

function isExitEvent(event) {
  return String(event || "").trim().toUpperCase().startsWith("EXIT_");
}

function deriveNoFillReason(intent = null) {
  const candidates = [
    intent && intent.cancel_reason,
    intent && intent.status_reason,
    intent && intent.reject_reason,
    intent && intent.pending_reason,
    intent && intent.terminal_failure_status,
  ];
  for (const value of candidates) {
    const normalized = toUpper(value);
    if (normalized) return normalized;
  }
  return null;
}

function deriveNoFillDetail(intent = null) {
  const candidates = [
    intent && intent.pending_note,
    intent && intent.exception_message,
    intent && intent.error_message,
    intent && intent.last_error_message,
    intent && intent.status_detail,
    intent && intent.exception_code,
    intent && intent.error_code,
    intent && intent.last_error_code,
  ];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return null;
}

function deriveNoFillReasonFamily(reason = null) {
  const normalized = toUpper(reason);
  if (!normalized) return null;
  if (
    normalized === "LIVE_EXCEPTION"
    || normalized.includes("KEYS_MISSING")
    || normalized.includes("MARGIN")
    || normalized.includes("LEVERAGE")
    || normalized.includes("HTTP_")
    || normalized.endsWith("_FAILED")
    || normalized.includes("SET_FAILED")
  ) {
    return "RUNTIME_ERROR";
  }
  if (
    normalized === "NO_POSITION"
    || normalized === "POSITION_FULL"
    || normalized === "TOTAL_BUDGET_EXCEEDED"
    || normalized === "RISK_BUDGET_DISABLED"
    || normalized === "ORDER_TOO_SMALL"
    || normalized === "MIN_ORDER_EXCEEDS_BUDGET"
    || normalized === "INSUFFICIENT_BUDGET"
  ) {
    return "POLICY_OR_CAPACITY";
  }
  if (
    normalized === "INTENT_EXPIRED"
    || normalized.startsWith("MODE_")
    || normalized.startsWith("BACKFILL_")
    || normalized === "INTENT_STATUS"
    || normalized === "SUPERSEDED"
  ) {
    return "CONTROL_FLOW";
  }
  if (
    normalized.startsWith("DROP_")
    || normalized.startsWith("LIVE_POLICY_")
    || normalized.startsWith("LINEAGE_SLO_")
  ) {
    return "FILTER_DROP";
  }
  return "UNKNOWN";
}

function deriveNoFillSubtype({ reason = null, detail = null } = {}) {
  const normalizedReason = toUpper(reason);
  const normalizedDetail = toUpper(detail);
  if (normalizedReason === "LIVE_EXCEPTION") {
    if (normalizedDetail && normalizedDetail.includes("IMMEDIATE_EXEC")) return "TIMING_IMMEDIATE_EXEC";
    if (normalizedDetail && normalizedDetail.includes("LATE_EXEC_FROM")) return "TIMING_LATE_EXEC";
    if (normalizedDetail && normalizedDetail.includes("MARGIN")) return "MARGIN";
    if (normalizedDetail && normalizedDetail.includes("KEYS_MISSING")) return "KEYS_MISSING";
    if (normalizedDetail && normalizedDetail.includes("HTTP_4")) return "HTTP_4XX";
    if (normalizedDetail && normalizedDetail.includes("HTTP_5")) return "HTTP_5XX";
    return "LIVE_EXCEPTION_OTHER";
  }
  if (!normalizedReason) return null;
  return normalizedReason;
}

function isOperationalSource(source = null) {
  const normalized = toUpper(source);
  return normalized === "TV_WEBHOOK" || normalized === "LIVE_RUNTIME" || normalized === "SERVER_SIGNAL";
}

function readDocs(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.docs)) return value.docs;
  return [];
}

function buildWebhookOutcomeIndex(webhooks = []) {
  const outcomeRows = readDocs(webhooks).filter((row) => row && row.stage === "OUTCOME");
  const bySignalId = new Map();
  const byComposite = new Map();
  for (const row of outcomeRows) {
    const createdAtMs = parseMs(row.created_at);
    const signalId = String(row.signal_id || "").trim();
    if (signalId) {
      if (!bySignalId.has(signalId)) bySignalId.set(signalId, []);
      bySignalId.get(signalId).push({ row, createdAtMs });
    }
    const compositeKey = [
      toUpper(row.exchange),
      toUpper(row.symbol),
      String(row.tf || "").trim(),
      toNum(row.bar_close_time_utc_ms),
      toUpper(row.event),
    ].join("|");
    if (!byComposite.has(compositeKey)) byComposite.set(compositeKey, []);
    byComposite.get(compositeKey).push({ row, createdAtMs });
  }
  for (const arr of bySignalId.values()) arr.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  for (const arr of byComposite.values()) arr.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  return { bySignalId, byComposite };
}

function buildWebhookIngressIndex(webhooks = []) {
  const ingressRows = readDocs(webhooks).filter((row) => row && row.stage === "INGRESS");
  const byRequestId = new Map();
  for (const row of ingressRows) {
    const requestId = String(row.request_id || "").trim();
    if (!requestId) continue;
    const createdAtMs = parseMs(row.created_at);
    const prev = byRequestId.get(requestId);
    if (!prev || ((createdAtMs || 0) < (prev.createdAtMs || 0))) {
      byRequestId.set(requestId, { row, createdAtMs });
    }
  }
  return byRequestId;
}

function resolveWebhookMatch({ intent = null, webhookOutcomes = null, webhookIngressByRequestId = null } = {}) {
  const signalDocId = String(intent && (intent.signal_doc_id || intent.signal_id) || "").trim();
  const compositeKey = [
    toUpper(intent && intent.exchange),
    toUpper(intent && (intent.symbol || intent.symbol_or_pair_id || intent.market)),
    String(intent && intent.tf || "").trim(),
    toNum(intent && intent.signal_bar_close_time_utc_ms),
    toUpper(intent && intent.event),
  ].join("|");
  let candidate = null;
  if (signalDocId && webhookOutcomes && webhookOutcomes.bySignalId.has(signalDocId)) {
    candidate = webhookOutcomes.bySignalId.get(signalDocId)[0] || null;
  }
  if (!candidate && webhookOutcomes && webhookOutcomes.byComposite.has(compositeKey)) {
    candidate = webhookOutcomes.byComposite.get(compositeKey)[0] || null;
  }
  if (!candidate) {
    return {
      webhook_request_id: null,
      webhook_ingress_at_ms: null,
      webhook_outcome_at_ms: null,
      webhook_decision: null,
      webhook_reason: null,
    };
  }
  const requestId = String(candidate.row.request_id || "").trim() || null;
  const ingress = requestId && webhookIngressByRequestId ? webhookIngressByRequestId.get(requestId) : null;
  return {
    webhook_request_id: requestId,
    webhook_ingress_at_ms: ingress ? ingress.createdAtMs : null,
    webhook_outcome_at_ms: candidate.createdAtMs,
    webhook_decision: String(candidate.row.decision || "").trim() || null,
    webhook_reason: String(candidate.row.reason || "").trim() || null,
  };
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

function buildExecutionModelRows({ intents = [], fills = [], webhooks = [] } = {}) {
  const intentRows = readDocs(intents).filter((row) => row && typeof row === "object");
  const fillRows = readDocs(fills).filter((row) => row && typeof row === "object");
  const webhookOutcomes = buildWebhookOutcomeIndex(webhooks);
  const webhookIngressByRequestId = buildWebhookIngressIndex(webhooks);
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
    const fillDocAtMs = agg.first_fill_at_ms;
    const intentFilledAtMs = parseMs(intent.filled_at);
    const filledAtMs = fillDocAtMs ?? intentFilledAtMs;
    const signalBarCloseMs = resolveSignalBarCloseMs(intent);
    const webhook = resolveWebhookMatch({ intent, webhookOutcomes, webhookIngressByRequestId });
    const measuredCreatedToFillMs = Number.isFinite(intentCreatedAtMs) && Number.isFinite(filledAtMs)
      ? (filledAtMs - intentCreatedAtMs)
      : null;
    const signalToIntentMs = Number.isFinite(signalBarCloseMs) && Number.isFinite(intentCreatedAtMs)
      ? (intentCreatedAtMs - signalBarCloseMs)
      : null;
    const signalToFillMs = Number.isFinite(signalBarCloseMs) && Number.isFinite(filledAtMs)
      ? (filledAtMs - signalBarCloseMs)
      : null;
    const webhookToIntentMs = Number.isFinite(webhook.webhook_ingress_at_ms) && Number.isFinite(intentCreatedAtMs)
      ? (intentCreatedAtMs - webhook.webhook_ingress_at_ms)
      : null;
    const webhookToOutcomeMs = Number.isFinite(webhook.webhook_ingress_at_ms) && Number.isFinite(webhook.webhook_outcome_at_ms)
      ? (webhook.webhook_outcome_at_ms - webhook.webhook_ingress_at_ms)
      : null;
    const fallbackCreatedToFillMs = toNum(intent.live_exec_policy_quality_latency_ms) ?? agg.avg_latency_ms;
    const createdToFillMs = measuredCreatedToFillMs ?? fallbackCreatedToFillMs;
    const createdToFillSource = Number.isFinite(measuredCreatedToFillMs)
      ? (Number.isFinite(fillDocAtMs) ? "FILL_DOC" : "INTENT_FILLED_AT")
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
    const wasFilled = agg.fill_n > 0 || status === "FILLED";
    const noFillReason = wasFilled ? null : deriveNoFillReason(intent);
    const noFillDetail = wasFilled ? null : deriveNoFillDetail(intent);
    const noFillReasonFamily = wasFilled ? null : deriveNoFillReasonFamily(noFillReason);
    const noFillSubtype = wasFilled ? null : deriveNoFillSubtype({ reason: noFillReason, detail: noFillDetail });
    const entryScheduleReason = deriveEntryScheduleReason(intent);
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
        source: deriveIntentSource(intent),
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
        signal_bar_close_ms: signalBarCloseMs,
        scheduled_exec_bar_close_ms: toNum(intent.scheduled_exec_bar_close_time_utc_ms),
        webhook_request_id: webhook.webhook_request_id,
        webhook_ingress_at_ms: webhook.webhook_ingress_at_ms,
        webhook_outcome_at_ms: webhook.webhook_outcome_at_ms,
        webhook_decision: webhook.webhook_decision,
        webhook_reason: webhook.webhook_reason,
        webhook_to_intent_ms: webhookToIntentMs,
        webhook_to_outcome_ms: webhookToOutcomeMs,
        exec_price: agg.exec_price ?? toNum(intent.exec_price),
        qty_pct: toNum(intent.qty_pct),
        qty_fraction: toNum(intent.qty_fraction),
        live_policy_latency_ms: toNum(intent.live_exec_policy_quality_latency_ms),
        live_policy_slippage_bps: toNum(intent.live_exec_policy_quality_slippage_bps),
        live_policy_partial_pct: toNum(intent.live_exec_policy_quality_partial_pct),
        entry_schedule_reason: entryScheduleReason,
        entry_schedule_note: String(intent.pending_note || "").trim() || null,
        signal_to_intent_ms: signalToIntentMs,
        signal_to_fill_ms: signalToFillMs,
        fill_source_counts: agg.fill_source_counts,
        slippage_measured_n: agg.slippage_measured_n,
        slippage_missing_n: agg.slippage_missing_n,
        no_fill_reason: noFillReason,
        no_fill_detail: noFillDetail,
        no_fill_reason_family: noFillReasonFamily,
        no_fill_subtype: noFillSubtype,
      },
      labels: {
        was_filled: wasFilled,
        was_partial: Number.isFinite(partialFillPct) && partialFillPct > 0,
        was_rejected: rejected,
        time_stop_hit: isTimeStopEvent,
        pre_tp1_time_stop: preTp1TimeStop,
        created_to_fill_ms: createdToFillMs,
        created_to_fill_measured: Number.isFinite(measuredCreatedToFillMs),
        created_to_fill_source: createdToFillSource,
        signal_to_intent_ms: signalToIntentMs,
        signal_to_fill_ms: signalToFillMs,
        webhook_to_intent_ms: webhookToIntentMs,
        webhook_to_outcome_ms: webhookToOutcomeMs,
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
  const signalToIntentVals = scoped.map((row) => toNum(row.labels && row.labels.signal_to_intent_ms)).filter((v) => Number.isFinite(v));
  const signalToFillVals = scoped.map((row) => toNum(row.labels && row.labels.signal_to_fill_ms)).filter((v) => Number.isFinite(v));
  const webhookToIntentVals = scoped.map((row) => toNum(row.labels && row.labels.webhook_to_intent_ms)).filter((v) => Number.isFinite(v));
  const webhookToOutcomeVals = scoped.map((row) => toNum(row.labels && row.labels.webhook_to_outcome_ms)).filter((v) => Number.isFinite(v));
  const timeStopN = scoped.filter((row) => row && row.labels && row.labels.time_stop_hit === true).length;
  const preTp1TimeStopN = scoped.filter((row) => row && row.labels && row.labels.pre_tp1_time_stop === true).length;
  const byPrimaryFillSource = new Map();
  const byNoFillReason = new Map();
  const byNoFillReasonFamily = new Map();
  const byNoFillSubtype = new Map();
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

    if (row && row.labels && row.labels.was_filled === false) {
      const noFillReason = String(row.execution && row.execution.no_fill_reason || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
      const noFillReasonFamily = String(row.execution && row.execution.no_fill_reason_family || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
      if (!byNoFillReason.has(noFillReason)) {
        byNoFillReason.set(noFillReason, { key: noFillReason, rows_n: 0 });
      }
      if (!byNoFillReasonFamily.has(noFillReasonFamily)) {
        byNoFillReasonFamily.set(noFillReasonFamily, { key: noFillReasonFamily, rows_n: 0 });
      }
      const noFillSubtype = String(row.execution && row.execution.no_fill_subtype || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
      if (!byNoFillSubtype.has(noFillSubtype)) {
        byNoFillSubtype.set(noFillSubtype, { key: noFillSubtype, rows_n: 0 });
      }
      byNoFillReason.get(noFillReason).rows_n += 1;
      byNoFillReasonFamily.get(noFillReasonFamily).rows_n += 1;
      byNoFillSubtype.get(noFillSubtype).rows_n += 1;
    }
  }
  const p95 = (values) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b)=>a-b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    return sorted[idx];
  };
  const byEntryLatencyGroup = new Map();
  const bySignalToIntentGroup = new Map();
  const byOperationalSignalToIntentGroup = new Map();
  const byWebhookToIntentGroup = new Map();
  const byWebhookDelayReason = new Map();
  const byWebhookDelayCause = new Map();
  const byOperationalWebhookDelayCause = new Map();
  const byOperationalImmediateIntentDelayGroup = new Map();
  const byMeasuredEntryLatencyGroup = new Map();
  const byFallbackEntryLatencyGroup = new Map();
  for (const row of scoped) {
    if (!row || !row.context || row.context.is_exit_event === true) continue;
    const latencyMs = toNum(row.labels && row.labels.created_to_fill_ms);
    const signalToIntentMs = toNum(row.labels && row.labels.signal_to_intent_ms);
    const webhookToIntentMs = toNum(row.labels && row.labels.webhook_to_intent_ms);
    if (!Number.isFinite(latencyMs)) continue;
    const event = String(row.context.event || "").trim().toUpperCase() || "UNKNOWN";
    const source = String(row.context.source || "").trim().toUpperCase() || "UNKNOWN";
    const fillSource = String(row.context.primary_fill_source || "NO_FILL").trim().toUpperCase() || "UNKNOWN";
    const latencySource = String(row.labels && row.labels.created_to_fill_source || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    const market = String(row.context.market || "").trim().toUpperCase() || "UNKNOWN";
    const key = [event, source, fillSource, latencySource, market].join("|");
    if (!byEntryLatencyGroup.has(key)) {
      byEntryLatencyGroup.set(key, { key, event, source, primary_fill_source: fillSource, latency_source: latencySource, market, rows_n: 0, latency_values: [] });
    }
    const bucket = byEntryLatencyGroup.get(key);
    bucket.rows_n += 1;
    bucket.latency_values.push(latencyMs);
    const measured = row && row.labels && row.labels.created_to_fill_measured === true;
    const targetMap = measured ? byMeasuredEntryLatencyGroup : byFallbackEntryLatencyGroup;
    if (!targetMap.has(key)) {
      targetMap.set(key, { key, event, source, primary_fill_source: fillSource, latency_source: latencySource, market, rows_n: 0, latency_values: [] });
    }
    const target = targetMap.get(key);
    target.rows_n += 1;
    target.latency_values.push(latencyMs);
    if (Number.isFinite(signalToIntentMs)) {
      const preKey = [event, source, market].join("|");
      if (!bySignalToIntentGroup.has(preKey)) {
        bySignalToIntentGroup.set(preKey, { key: preKey, event, source, market, rows_n: 0, latency_values: [] });
      }
      const preBucket = bySignalToIntentGroup.get(preKey);
      preBucket.rows_n += 1;
      preBucket.latency_values.push(signalToIntentMs);
      if (isOperationalSource(source)) {
        if (!byOperationalSignalToIntentGroup.has(preKey)) {
          byOperationalSignalToIntentGroup.set(preKey, { key: preKey, event, source, market, rows_n: 0, latency_values: [] });
        }
        const operationalBucket = byOperationalSignalToIntentGroup.get(preKey);
        operationalBucket.rows_n += 1;
        operationalBucket.latency_values.push(signalToIntentMs);
      }
    }
    if (Number.isFinite(webhookToIntentMs)) {
      const webhookKey = [event, source, market].join("|");
      if (!byWebhookToIntentGroup.has(webhookKey)) {
        byWebhookToIntentGroup.set(webhookKey, { key: webhookKey, event, source, market, rows_n: 0, latency_values: [] });
      }
      const webhookBucket = byWebhookToIntentGroup.get(webhookKey);
      webhookBucket.rows_n += 1;
      webhookBucket.latency_values.push(webhookToIntentMs);
      if (webhookToIntentMs >= 60000) {
        const delayReason = String(row.execution && row.execution.entry_schedule_reason || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
        const delayCause = deriveWebhookDelayCause(row);
        if (!byWebhookDelayReason.has(delayReason)) {
          byWebhookDelayReason.set(delayReason, { key: delayReason, rows_n: 0 });
        }
        byWebhookDelayReason.get(delayReason).rows_n += 1;
        if (!byWebhookDelayCause.has(delayCause)) {
          byWebhookDelayCause.set(delayCause, { key: delayCause, rows_n: 0 });
        }
        byWebhookDelayCause.get(delayCause).rows_n += 1;
        if (isOperationalSource(source)) {
          if (!byOperationalWebhookDelayCause.has(delayCause)) {
            byOperationalWebhookDelayCause.set(delayCause, { key: delayCause, rows_n: 0 });
          }
          byOperationalWebhookDelayCause.get(delayCause).rows_n += 1;
          if ([
            "IMMEDIATE_EXEC_TRUE_INTENT_DELAY",
            "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT",
            "IMMEDIATE_EXEC_WEBHOOK_DROP_LATER_INTENT",
          ].includes(delayCause)) {
            const causeKey = [source, event, market].join("|");
            if (!byOperationalImmediateIntentDelayGroup.has(causeKey)) {
              byOperationalImmediateIntentDelayGroup.set(causeKey, { key: causeKey, source, event, market, rows_n: 0, latency_values: [] });
            }
            const causeBucket = byOperationalImmediateIntentDelayGroup.get(causeKey);
            causeBucket.rows_n += 1;
            causeBucket.latency_values.push(webhookToIntentMs);
          }
        }
      }
    }
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
    signal_to_intent_p95_ms: p95(signalToIntentVals),
    signal_to_fill_p95_ms: p95(signalToFillVals),
    webhook_to_intent_p95_ms: p95(webhookToIntentVals),
    webhook_to_outcome_p95_ms: p95(webhookToOutcomeVals),
    slippage_p95_bps: p95(slippageVals),
    feature_keys_n: Array.from(new Set(scoped.flatMap((row) => Object.keys(row.features || {})))).length,
    by_primary_fill_source: Array.from(byPrimaryFillSource.values())
      .map((row) => ({
        ...row,
        slippage_zero_rate: row.slippage_measured_n > 0 ? (row.slippage_zero_n / row.slippage_measured_n) : null,
        slippage_measured_rate: row.rows_n > 0 ? (row.slippage_measured_n / row.rows_n) : null,
      }))
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key)),
    top_no_fill_reasons: Array.from(byNoFillReason.values())
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_no_fill_reason_families: Array.from(byNoFillReasonFamily.values())
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_no_fill_subtypes: Array.from(byNoFillSubtype.values())
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_entry_latency_groups: Array.from(byEntryLatencyGroup.values())
      .map((row) => ({
        key: row.key,
        event: row.event,
        source: row.source,
        primary_fill_source: row.primary_fill_source,
        latency_source: row.latency_source,
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
        latency_source: row.latency_source,
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
        latency_source: row.latency_source,
        market: row.market,
        rows_n: row.rows_n,
        created_to_fill_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.created_to_fill_p95_ms || 0) - (a.created_to_fill_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_signal_to_intent_latency_groups: Array.from(bySignalToIntentGroup.values())
      .map((row) => ({
        key: row.key,
        event: row.event,
        source: row.source,
        market: row.market,
        rows_n: row.rows_n,
        signal_to_intent_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.signal_to_intent_p95_ms || 0) - (a.signal_to_intent_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_operational_signal_to_intent_latency_groups: Array.from(byOperationalSignalToIntentGroup.values())
      .map((row) => ({
        key: row.key,
        event: row.event,
        source: row.source,
        market: row.market,
        rows_n: row.rows_n,
        signal_to_intent_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.signal_to_intent_p95_ms || 0) - (a.signal_to_intent_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_webhook_to_intent_latency_groups: Array.from(byWebhookToIntentGroup.values())
      .map((row) => ({
        key: row.key,
        event: row.event,
        source: row.source,
        market: row.market,
        rows_n: row.rows_n,
        webhook_to_intent_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.webhook_to_intent_p95_ms || 0) - (a.webhook_to_intent_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_webhook_delay_reasons: Array.from(byWebhookDelayReason.values())
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_webhook_delay_causes: Array.from(byWebhookDelayCause.values())
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_operational_webhook_delay_causes: Array.from(byOperationalWebhookDelayCause.values())
      .sort((a, b) => (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
      .slice(0, 12),
    top_operational_immediate_intent_delay_groups: Array.from(byOperationalImmediateIntentDelayGroup.values())
      .map((row) => ({
        key: row.key,
        source: row.source,
        event: row.event,
        market: row.market,
        rows_n: row.rows_n,
        webhook_to_intent_p95_ms: p95(row.latency_values),
      }))
      .sort((a, b) => ((b.webhook_to_intent_p95_ms || 0) - (a.webhook_to_intent_p95_ms || 0)) || (b.rows_n - a.rows_n) || a.key.localeCompare(b.key))
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
    deriveNoFillReason,
    deriveNoFillDetail,
    deriveNoFillReasonFamily,
    deriveNoFillSubtype,
    deriveEntryScheduleReason,
    deriveWebhookDelayCause,
    isOperationalSource,
    buildWebhookOutcomeIndex,
    buildWebhookIngressIndex,
    resolveWebhookMatch,
  },
};
