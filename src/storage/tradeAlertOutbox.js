"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function trimOrNull(value) {
  const v = String(value || "").trim();
  return v || null;
}

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function compactIdToken(value, fallback = "NA") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .slice(0, 180) || fallback;
}

function buildFallbackDedupeSeed({
  type = null,
  exchange = null,
  symbol = null,
  event = null,
  payload = null,
} = {}) {
  const src = payload && typeof payload === "object" ? payload : {};
  const stable = {
    type: upper(type),
    exchange: upper(exchange),
    symbol: upper(symbol),
    event: upper(event),
    order_id: trimOrNull(src.orderId || src.order_id),
    client_order_id: trimOrNull(src.clientOrderId || src.client_order_id),
    signal_id: trimOrNull(src.signalId || src.signal_id),
    intent_id: trimOrNull(src.intentId || src.intent_id),
    run_id: trimOrNull(src.runId || src.run_id),
    trade_id: trimOrNull(src.tradeId || src.trade_id),
    idempotency_key: trimOrNull(src.idempotencyKey || src.idempotency_key),
    ts: trimOrNull(src.ts || src.created_at),
  };
  return crypto.createHash("sha1").update(JSON.stringify(stable)).digest("hex").slice(0, 20);
}

function resolveOutboxEventKey({
  event = null,
  payload = null,
  dedupeKey = null,
} = {}) {
  const src = payload && typeof payload === "object" ? payload : {};
  const ev = upper(event || src.event);
  const intent = upper(src.intent || src.event_intent || src.action);
  const stableKey = String(dedupeKey || src.tradeAlertDedupeKey || src.trade_alert_dedupe_key || "").trim().toUpperCase();

  if (intent === "ADD" || stableKey.includes("__ADD__")) return "ADD";
  if (
    intent === "ENTRY"
    || stableKey.includes("__ENTRY__")
    || ev === "LONG"
    || ev === "SHORT"
    || (ev && ev.startsWith("ENTRY_"))
    || (ev && ev.startsWith("CORE_"))
    || (ev && ev.startsWith("EARLY_"))
    || (ev && ev.startsWith("PRE_REAL_"))
  ) {
    return "ENTRY";
  }
  return ev;
}

function normalizeStringList(values = []) {
  const raw = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const value = upper(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function resolvePayloadObject(payload = null) {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function resolveOutboxEvidenceFields({
  payload = null,
  prev = null,
  sourceFillId = null,
  dedupeKey = null,
} = {}) {
  const src = resolvePayloadObject(payload);
  const previous = resolvePayloadObject(prev);
  const transitionEvents = normalizeStringList([
    ...(Array.isArray(src.canonicalTransitionEvents) ? src.canonicalTransitionEvents : []),
    ...(Array.isArray(src.canonical_transition_events) ? src.canonical_transition_events : []),
    src.canonicalTransitionEvent,
    src.canonical_primary_transition_event,
  ]);
  const previousTransitionEvents = normalizeStringList(previous.canonical_transition_events);
  const resolvedTransitionEvents = transitionEvents.length ? transitionEvents : previousTransitionEvents;
  const primaryTransition = upper(
    src.canonicalTransitionEvent
      || src.canonical_primary_transition_event
      || resolvedTransitionEvents[0]
      || previous.canonical_primary_transition_event
  );
  return {
    source_fill_id: trimOrNull(
      sourceFillId
        || src.sourceFillId
        || src.source_fill_id
        || src.fillId
        || src.fill_id
        || previous.source_fill_id
    ),
    dedupe_key: trimOrNull(
      dedupeKey
        || src.tradeAlertDedupeKey
        || src.trade_alert_dedupe_key
        || src.dedupeKey
        || src.dedupe_key
        || src.idempotencyKey
        || src.idempotency_key
        || previous.dedupe_key
    ),
    entry_event_id: trimOrNull(src.entryEventId || src.entry_event_id || previous.entry_event_id),
    order_id: trimOrNull(src.orderId || src.order_id || previous.order_id),
    client_order_id: trimOrNull(src.clientOrderId || src.client_order_id || previous.client_order_id),
    raw_evidence_event: upper(src.rawEvidenceEvent || src.raw_evidence_event || src.event || previous.raw_evidence_event),
    canonical_event: upper(
      src.canonicalExitEvent
        || src.canonical_exit_event
        || src.canonicalEvent
        || src.canonical_event
        || previous.canonical_event
    ),
    canonical_stage: upper(
      src.canonicalExitStage
        || src.canonical_exit_stage
        || src.canonicalStage
        || src.canonical_stage
        || previous.canonical_stage
    ),
    canonical_transition_events: resolvedTransitionEvents,
    canonical_primary_transition_event: primaryTransition,
    simplified_exit_v2_enabled: (
      src.simplifiedExitV2Enabled === true
        || src.simplified_exit_v2_enabled === true
        || previous.simplified_exit_v2_enabled === true
    ),
  };
}

function buildTradeAlertOutboxId({
  type = null,
  exchange = null,
  symbol = null,
  event = null,
  sourceFillId = null,
  dedupeKey = null,
  payload = null,
} = {}) {
  const stableSeed = trimOrNull(dedupeKey)
    || trimOrNull(sourceFillId)
    || buildFallbackDedupeSeed({ type, exchange, symbol, event, payload });
  const eventKey = resolveOutboxEventKey({ event, payload, dedupeKey: stableSeed });
  return [
    "TRADE_ALERT_OUTBOX",
    compactIdToken(upper(type), "TRADE_EXECUTION_ALERT"),
    compactIdToken(upper(exchange), "BINANCEFUT"),
    compactIdToken(upper(symbol), "UNKNOWN"),
    compactIdToken(eventKey, "UNKNOWN"),
    compactIdToken(stableSeed, "NA"),
  ].join("__");
}

async function prepareTradeAlertOutbox({
  type = "TRADE_EXECUTION_ALERT",
  exchange = null,
  symbol = null,
  event = null,
  title = null,
  body = null,
  channel = null,
  payload = null,
  sourceFillId = null,
  dedupeKey = null,
  allowResend = false,
  source = null,
} = {}) {
  const outboxId = buildTradeAlertOutboxId({
    type,
    exchange,
    symbol,
    event,
    sourceFillId,
    dedupeKey,
    payload,
  });
  const db = getFirestore();
  const ref = db.collection("trade_alert_outbox").doc(outboxId);
  const claimToken = crypto.randomUUID();
  const transactionResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() || {}) : null;
    if (prev && upper(prev.status) === "SENT" && allowResend !== true) {
      return { outboxId, ref, doc: prev, skipSend: true, claimed: false, claimToken: null };
    }
    const prevClaimToken = trimOrNull(prev && prev.dispatch_claim_token);
    const prevClaimExpiry = Number(prev && prev.dispatch_claim_expires_at_ms);
    if (
      prev
      && upper(prev.status) === "PENDING"
      && prevClaimToken
      && Number.isFinite(prevClaimExpiry)
      && prevClaimExpiry > nowMs()
    ) {
      return {
        outboxId,
        ref,
        doc: prev,
        skipSend: true,
        claimed: false,
        claimToken: null,
        reason: "CLAIM_HELD",
      };
    }

    const now = nowIso();
    const payloadEvidence = resolveOutboxEvidenceFields({
      payload,
      prev,
      sourceFillId,
      dedupeKey,
    });
    const doc = {
      trade_alert_outbox_id: outboxId,
      type: upper(type),
      exchange: upper(exchange),
      symbol: upper(symbol),
      event: upper(event),
      status: "PENDING",
      created_at: String(prev && prev.created_at || "").trim() || now,
      updated_at: now,
      last_attempt_at: now,
      attempt_count: Math.max(0, Number(prev && prev.attempt_count) || 0) + 1,
      source_fill_id: payloadEvidence.source_fill_id,
      dedupe_key: payloadEvidence.dedupe_key,
      entry_event_id: payloadEvidence.entry_event_id,
      order_id: payloadEvidence.order_id,
      client_order_id: payloadEvidence.client_order_id,
      raw_evidence_event: payloadEvidence.raw_evidence_event,
      canonical_event: payloadEvidence.canonical_event,
      canonical_stage: payloadEvidence.canonical_stage,
      canonical_transition_events: payloadEvidence.canonical_transition_events,
      canonical_primary_transition_event: payloadEvidence.canonical_primary_transition_event,
      simplified_exit_v2_enabled: payloadEvidence.simplified_exit_v2_enabled,
      last_channel: trimOrNull(channel) || trimOrNull(prev && prev.last_channel),
      last_title: trimOrNull(title) || trimOrNull(prev && prev.last_title),
      last_body: trimOrNull(body) || trimOrNull(prev && prev.last_body),
      last_reason: null,
      last_error: null,
      last_result: null,
      source: trimOrNull(source) || trimOrNull(prev && prev.source),
      payload: cloneJson(payload) || cloneJson(prev && prev.payload),
      dispatch_claim_token: claimToken,
      dispatch_claimed_at: now,
      dispatch_claim_expires_at_ms: nowMs() + 300000,
    };
    tx.set(ref, doc, { merge: true });
    return { outboxId, ref, doc, skipSend: false, claimed: true, claimToken };
  });
  return transactionResult;
}

async function markTradeAlertOutboxResult({
  outboxId,
  claimToken = null,
  ok = false,
  skipped = false,
  // 2026-04-20 senior-audit P3: explicit BLOCKED status for the canonical-
  // exit gate skip path. Previously, resolveCanonicalExitAlertRequirement
  // failures caused tradeExecutionAlert.sendTradeExecutionAlert to return
  // { skipped: true, reason: "MISSING_CANONICAL_EXIT_TRANSITION" } BEFORE
  // the outbox prep, so there was no durable Firestore evidence. Ops could
  // only find these via audit log scan — no symbol/event-indexable trail.
  // The BLOCKED status is distinct from SKIPPED (which covers legitimate
  // no-op paths like OUTBOX_ALREADY_SENT / NON_LIVE_MODE) and from FAILED
  // (which implies the send was attempted and errored). BLOCKED means the
  // alert was intentionally withheld despite the underlying event being
  // real — the most ops-important case to make queryable.
  blocked = false,
  reason = null,
  error = null,
  result = null,
  channel = null,
  title = null,
  body = null,
  source = null,
} = {}) {
  const id = trimOrNull(outboxId);
  if (!id) return null;
  const db = getFirestore();
  const ref = db.collection("trade_alert_outbox").doc(id);
  const now = nowIso();
  const normalizedReason = trimOrNull(reason);
  const normalizedError = trimOrNull(error);
  let status;
  if (blocked === true) status = "BLOCKED";
  else if (skipped === true) status = "SKIPPED";
  else if (ok === true) status = "SENT";
  else status = "FAILED";
  const patch = {
    status,
    updated_at: now,
    last_reason: normalizedReason,
    last_error: status === "SENT" ? null : (normalizedError || normalizedReason),
    last_result: cloneJson(result),
    last_channel: trimOrNull(channel),
    last_title: trimOrNull(title),
    last_body: trimOrNull(body),
    source: trimOrNull(source),
  };
  if (status === "SENT") patch.sent_at = now;
  else if (status === "SKIPPED") patch.skipped_at = now;
  else if (status === "BLOCKED") patch.blocked_at = now;
  else patch.failed_at = now;
  const normalizedClaimToken = trimOrNull(claimToken);
  const resultValue = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() || {}) : null;
    const currentClaimToken = trimOrNull(prev && prev.dispatch_claim_token);
    if (normalizedClaimToken && currentClaimToken && normalizedClaimToken !== currentClaimToken) {
      return {
        outboxId: id,
        status: upper(prev && prev.status) || null,
        skipped: true,
        reason: "CLAIM_TOKEN_MISMATCH",
      };
    }
    const writePatch = { ...patch };
    writePatch.dispatch_claim_token = null;
    writePatch.dispatch_claimed_at = null;
    writePatch.dispatch_claim_expires_at_ms = null;
    tx.set(ref, writePatch, { merge: true });
    return { outboxId: id, status };
  });
  return resultValue;
}

async function fetchTradeAlertOutboxItems({
  // BLOCKED included by default so ops dashboards surface canonical-exit
  // gate rejections alongside FAILED/SKIPPED — otherwise BLOCKED rows are
  // invisible to existing tooling.
  statuses = ["FAILED", "SKIPPED", "BLOCKED", "PENDING"],
  limit = 50,
} = {}) {
  const db = getFirestore();
  const normalizedStatuses = Array.from(new Set(
    (Array.isArray(statuses) ? statuses : [statuses])
      .map((value) => upper(value))
      .filter(Boolean)
  ));
  const effectiveLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = [];
  for (const status of normalizedStatuses) {
    const snap = await db.collection("trade_alert_outbox")
      .where("status", "==", status)
      .limit(effectiveLimit)
      .get();
    for (const doc of snap.docs) rows.push({ id: doc.id, ...(doc.data() || {}) });
  }
  rows.sort((a, b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")));
  return rows.slice(0, effectiveLimit);
}

module.exports = {
  prepareTradeAlertOutbox,
  markTradeAlertOutboxResult,
  fetchTradeAlertOutboxItems,
  __test: {
    buildTradeAlertOutboxId,
    buildFallbackDedupeSeed,
    resolveOutboxEventKey,
    resolveOutboxEvidenceFields,
  },
};
