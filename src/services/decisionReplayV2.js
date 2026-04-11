"use strict";

const crypto = require("crypto");
const { fetchUnifiedEventTimeline } = require("../storage/unifiedEventTimeline");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toTimeMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function normalizeDecisionRow(row = {}) {
  return {
    kind: "DECISION",
    ts_ms: toTimeMs(row.created_at) || 0,
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.event),
    trace_id: row.idempotency_key || row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    payload: {
      hook: row.hook || null,
      policy_stage: row.policy_stage || null,
      policy_reason: row.policy_reason || null,
      qty_pct_final: Number.isFinite(Number(row.qty_pct_final)) ? Number(row.qty_pct_final) : null,
      action: upper(row.action),
      intent: upper(row.intent),
    },
    raw: safeClone(row),
  };
}

function normalizeIntentRow(row = {}) {
  return {
    kind: "INTENT",
    ts_ms: toTimeMs(row.created_at) || toTimeMs(row.updated_at) || 0,
    created_at: row.created_at || row.updated_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol_or_pair_id || row.symbol),
    event: upper(row.event),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    payload: {
      status: upper(row.status),
      side: upper(row.side),
      event_intent: upper(row.event_intent),
      qty_pct: Number.isFinite(Number(row.qty_pct)) ? Number(row.qty_pct) : null,
      decision_reason: row.decision_reason || null,
    },
    raw: safeClone(row),
  };
}

function normalizeIntentMutationRow(row = {}) {
  return {
    kind: "INTENT_MUTATION",
    ts_ms: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.mutation_type),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: null,
    intent_id: row.intent_id || null,
    payload: {
      mutation_type: upper(row.mutation_type),
      after_status: row.after && row.after.status ? upper(row.after.status) : null,
      extra: safeClone(row.extra),
    },
    raw: safeClone(row),
  };
}

function normalizeFillRow(row = {}) {
  return {
    kind: "FILL",
    ts_ms: toTimeMs(row.created_at) || toTimeMs(row.updated_at) || 0,
    created_at: row.created_at || row.updated_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol || row.symbol_or_pair_id),
    event: upper(row.event),
    trace_id: row.trace_id || row.idempotency_key || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    fill_id: row.fill_id || null,
    payload: {
      side: upper(row.side),
      qty_pct: Number.isFinite(Number(row.qty_pct)) ? Number(row.qty_pct) : null,
      qty_fraction: Number.isFinite(Number(row.qty_fraction)) ? Number(row.qty_fraction) : null,
      exec_price: Number.isFinite(Number(row.exec_price)) ? Number(row.exec_price) : null,
      decision_reason: row.decision_reason || null,
    },
    raw: safeClone(row),
  };
}

function normalizeFillMutationRow(row = {}) {
  return {
    kind: "FILL_MUTATION",
    ts_ms: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.mutation_type),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: null,
    intent_id: null,
    fill_id: row.fill_id || null,
    payload: {
      mutation_type: upper(row.mutation_type),
      extra: safeClone(row.extra),
      classification_verified: row.after && row.after.classification_verified === false ? false : true,
    },
    raw: safeClone(row),
  };
}

function normalizeExchangeAckRow(row = {}) {
  return {
    ...normalizeFillMutationRow(row),
    kind: "EXCHANGE_ACK",
  };
}

function normalizePositionEventRow(row = {}) {
  return {
    kind: "POSITION_MUTATION",
    ts_ms: Number.isFinite(Number(row.sequence_ms)) ? Number(row.sequence_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.mutation_kind),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: null,
    intent_id: null,
    payload: {
      reason: row.reason || null,
      before_summary: safeClone(row.before_summary),
      after_summary: safeClone(row.after_summary),
      transition: safeClone(row.transition),
    },
    raw: safeClone(row),
  };
}

function normalizeUnifiedTimelineRow(row = {}) {
  return {
    kind: upper(row.event_kind || row.kind),
    ts_ms: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.event || row.event_name),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    fill_id: row.fill_id || null,
    unified_event_id: row.unified_event_id || null,
    source_document_id: row.source_document_id || null,
    payload: safeClone(row.payload),
    raw: safeClone(row.raw || row),
  };
}

const TIMELINE_PRIORITY = Object.freeze({
  DECISION: 1,
  INTENT: 2,
  INTENT_MUTATION: 3,
  FILL: 4,
  FILL_MUTATION: 5,
  EXCHANGE_ACK: 6,
  FILL_AUDIT: 7,
  TRAIL_RUNTIME: 8,
  POSITION_MUTATION: 9,
});

function sortTimeline(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const timeDiff = Number(a.ts_ms || 0) - Number(b.ts_ms || 0);
    if (timeDiff !== 0) return timeDiff;
    const pa = TIMELINE_PRIORITY[a.kind] || 99;
    const pb = TIMELINE_PRIORITY[b.kind] || 99;
    if (pa !== pb) return pa - pb;
    return String(a.event || "").localeCompare(String(b.event || ""));
  });
}

function buildTimelineHash(timeline = []) {
  const canonical = (Array.isArray(timeline) ? timeline : []).map((row) => ({
    ts_ms: Number(row.ts_ms || 0),
    kind: row.kind || null,
    event: row.event || null,
    exchange: row.exchange || null,
    symbol: row.symbol || null,
    unified_event_id: row.unified_event_id || null,
    source_document_id: row.source_document_id || null,
    payload: row.payload || null,
  }));
  return crypto.createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function buildSummaryHash(value = null) {
  return crypto.createHash("sha256").update(JSON.stringify(value || null), "utf8").digest("hex");
}

function buildReplayValidations(timeline = []) {
  const rows = Array.isArray(timeline) ? timeline : [];
  const issues = [];
  if (!rows.length) issues.push("UNIFIED_TIMELINE_EMPTY");
  if (rows.some((row) => !String(row && row.unified_event_id || "").trim())) issues.push("UNIFIED_EVENT_ID_MISSING");
  if (!rows.some((row) => row.kind === "POSITION_MUTATION")) issues.push("POSITION_MUTATION_MISSING");
  if (!rows.some((row) => row.kind === "INTENT_MUTATION")) issues.push("INTENT_MUTATION_MISSING");
  if (!rows.some((row) => row.kind === "FILL_MUTATION" || row.kind === "EXCHANGE_ACK")) issues.push("FILL_MUTATION_MISSING");
  const duplicateUnifiedEventIds = new Set();
  const seenUnifiedEventIds = new Set();
  for (const row of rows) {
    const eventId = String(row && row.unified_event_id || "").trim();
    if (!eventId) continue;
    if (seenUnifiedEventIds.has(eventId)) duplicateUnifiedEventIds.add(eventId);
    seenUnifiedEventIds.add(eventId);
  }
  if (duplicateUnifiedEventIds.size > 0) issues.push("UNIFIED_EVENT_ID_DUPLICATED");
  let monotonic = true;
  for (let i = 1; i < rows.length; i += 1) {
    if (Number(rows[i].ts_ms || 0) < Number(rows[i - 1].ts_ms || 0)) {
      monotonic = false;
      break;
    }
  }
  if (!monotonic) issues.push("TIMELINE_NOT_MONOTONIC");
  return {
    issues,
    authoritative_ready: issues.length === 0,
    authoritative_verdict: issues.length === 0 ? "PASS" : "BLOCK",
  };
}

function replayUnifiedEventTimelineAuthoritative(unifiedRows = [], meta = {}) {
  const timeline = sortTimeline((Array.isArray(unifiedRows) ? unifiedRows : []).map(normalizeUnifiedTimelineRow));
  const lastPositionMutation = timeline.filter((row) => row.kind === "POSITION_MUTATION").slice(-1)[0] || null;
  const lastExchangeAck = timeline.filter((row) => row.kind === "EXCHANGE_ACK").slice(-1)[0] || null;
  const validations = buildReplayValidations(timeline);
  const latestPositionSummary = lastPositionMutation && lastPositionMutation.payload
    ? lastPositionMutation.payload.after_summary || null
    : null;
  return {
    exchange: upper(meta.exchange),
    symbol: upper(meta.symbol),
    from_ms: Number.isFinite(Number(meta.fromMs)) ? Number(meta.fromMs) : null,
    to_ms: Number.isFinite(Number(meta.toMs)) ? Number(meta.toMs) : null,
    schema_version: "DECISION_REPLAY_V2",
    source_collection: "UNIFIED_EVENT_TIMELINE",
    authoritative_source: "UNIFIED_EVENT_TIMELINE",
    event_only: true,
    legacy_fallback_used: false,
    authoritative_ready: validations.authoritative_ready,
    authoritative_verdict: validations.authoritative_verdict,
    residual_issues: validations.issues.slice(),
    timeline_n: timeline.length,
    timeline_hash: buildTimelineHash(timeline),
    latest_position_hash: buildSummaryHash(latestPositionSummary),
    source_event_ids: timeline.map((row) => row.unified_event_id || row.source_document_id).filter(Boolean),
    counts: {
      decisions_n: timeline.filter((row) => row.kind === "DECISION").length,
      intents_n: timeline.filter((row) => row.kind === "INTENT").length,
      intent_mutations_n: timeline.filter((row) => row.kind === "INTENT_MUTATION").length,
      fills_n: timeline.filter((row) => row.kind === "FILL").length,
      fill_mutations_n: timeline.filter((row) => row.kind === "FILL_MUTATION").length,
      exchange_ack_n: timeline.filter((row) => row.kind === "EXCHANGE_ACK").length,
      trail_runtime_n: timeline.filter((row) => row.kind === "TRAIL_RUNTIME").length,
      position_mutations_n: timeline.filter((row) => row.kind === "POSITION_MUTATION").length,
    },
    latest_exchange_ack: lastExchangeAck ? safeClone(lastExchangeAck.payload) : null,
    latest_position_summary: latestPositionSummary,
    validations,
    timeline,
  };
}

function replayDecisionTimelineV2FromRows({
  decisions = [],
  intents = [],
  intentEvents = [],
  fills = [],
  fillEvents = [],
  exchangeAcks = [],
  positionEvents = [],
} = {}) {
  const timeline = sortTimeline([
    ...(Array.isArray(decisions) ? decisions.map(normalizeDecisionRow) : []),
    ...(Array.isArray(intents) ? intents.map(normalizeIntentRow) : []),
    ...(Array.isArray(intentEvents) ? intentEvents.map(normalizeIntentMutationRow) : []),
    ...(Array.isArray(fills) ? fills.map(normalizeFillRow) : []),
    ...(Array.isArray(fillEvents) ? fillEvents.map(normalizeFillMutationRow) : []),
    ...(Array.isArray(exchangeAcks) ? exchangeAcks.map(normalizeExchangeAckRow) : []),
    ...(Array.isArray(positionEvents) ? positionEvents.map(normalizePositionEventRow) : []),
  ]);
  const lastPositionMutation = timeline.filter((row) => row.kind === "POSITION_MUTATION").slice(-1)[0] || null;
  const lastExchangeAck = timeline.filter((row) => row.kind === "EXCHANGE_ACK").slice(-1)[0] || null;
  return {
    schema_version: "DECISION_REPLAY_V2",
    timeline_n: timeline.length,
    counts: {
      decisions_n: Array.isArray(decisions) ? decisions.length : 0,
      intents_n: Array.isArray(intents) ? intents.length : 0,
      intent_mutations_n: Array.isArray(intentEvents) ? intentEvents.length : 0,
      fills_n: Array.isArray(fills) ? fills.length : 0,
      fill_mutations_n: Array.isArray(fillEvents) ? fillEvents.length : 0,
      exchange_ack_n: Array.isArray(exchangeAcks) ? exchangeAcks.length : 0,
      position_mutations_n: Array.isArray(positionEvents) ? positionEvents.length : 0,
    },
    latest_exchange_ack: lastExchangeAck ? safeClone(lastExchangeAck.payload) : null,
    latest_position_summary: lastPositionMutation && lastPositionMutation.payload
      ? lastPositionMutation.payload.after_summary || null
      : null,
    timeline,
  };
}

async function replayDecisionTimelineV2({
  exchange,
  symbol,
  fromMs = null,
  toMs = null,
  limitPerCollection = 500,
  authoritativeEventOnly = null,
} = {}) {
  const eventOnly = authoritativeEventOnly == null
    ? !["0", "false", "off", "no"].includes(String(process.env.DECISION_REPLAY_EVENT_ONLY || "true").trim().toLowerCase())
    : authoritativeEventOnly === true;
  const unifiedRows = await fetchUnifiedEventTimeline({
    exchange,
    symbol,
    fromMs,
    toMs,
    limit: limitPerCollection * 4,
  }).catch(() => []);
  if (eventOnly) {
    const replay = replayUnifiedEventTimelineAuthoritative(unifiedRows, {
      exchange,
      symbol,
      fromMs,
      toMs,
    });
    const strictReady = !["0", "false", "off", "no"].includes(String(process.env.DECISION_REPLAY_STRICT_READY_REQUIRED || "1").trim().toLowerCase());
    if (strictReady && replay.authoritative_ready !== true) {
      const err = new Error(`DECISION_REPLAY_AUTHORITATIVE_NOT_READY ${replay.residual_issues.join(",")}`);
      err.code = "DECISION_REPLAY_AUTHORITATIVE_NOT_READY";
      err.replay = replay;
      throw err;
    }
    return replay;
  }
  return replayUnifiedEventTimelineAuthoritative(unifiedRows, {
    exchange,
    symbol,
    fromMs,
    toMs,
  });
}

module.exports = {
  replayDecisionTimelineV2,
  __test: {
    toTimeMs,
    normalizeDecisionRow,
    normalizeIntentRow,
    normalizeIntentMutationRow,
    normalizeFillRow,
    normalizeFillMutationRow,
    normalizeExchangeAckRow,
    normalizePositionEventRow,
    normalizeUnifiedTimelineRow,
    replayUnifiedEventTimelineAuthoritative,
    replayDecisionTimelineV2FromRows,
    sortTimeline,
    buildTimelineHash,
    buildReplayValidations,
    buildSummaryHash,
  },
};
