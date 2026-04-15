"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
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
  return [
    "TRADE_ALERT_OUTBOX",
    compactIdToken(upper(type), "TRADE_EXECUTION_ALERT"),
    compactIdToken(upper(exchange), "BINANCEFUT"),
    compactIdToken(upper(symbol), "UNKNOWN"),
    compactIdToken(upper(event), "UNKNOWN"),
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
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data() || {}) : null;
  if (prev && upper(prev.status) === "SENT" && allowResend !== true) {
    return { outboxId, ref, doc: prev, skipSend: true };
  }

  const now = nowIso();
  const attemptCount = Math.max(0, Number(prev && prev.attempt_count) || 0) + 1;
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
    attempt_count: attemptCount,
    source_fill_id: trimOrNull(sourceFillId) || trimOrNull(prev && prev.source_fill_id),
    dedupe_key: trimOrNull(dedupeKey) || trimOrNull(prev && prev.dedupe_key),
    last_channel: trimOrNull(channel) || trimOrNull(prev && prev.last_channel),
    last_title: trimOrNull(title) || trimOrNull(prev && prev.last_title),
    last_body: trimOrNull(body) || trimOrNull(prev && prev.last_body),
    last_reason: null,
    last_error: null,
    last_result: null,
    source: trimOrNull(source) || trimOrNull(prev && prev.source),
    payload: cloneJson(payload) || cloneJson(prev && prev.payload),
  };
  await ref.set(doc, { merge: true });
  return { outboxId, ref, doc, skipSend: false };
}

async function markTradeAlertOutboxResult({
  outboxId,
  ok = false,
  skipped = false,
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
  const status = skipped === true ? "SKIPPED" : (ok === true ? "SENT" : "FAILED");
  const patch = {
    status,
    updated_at: now,
    last_reason: normalizedReason,
    last_error: ok === true ? null : (normalizedError || normalizedReason),
    last_result: cloneJson(result),
    last_channel: trimOrNull(channel),
    last_title: trimOrNull(title),
    last_body: trimOrNull(body),
    source: trimOrNull(source),
  };
  if (ok === true) patch.sent_at = now;
  if (skipped === true) patch.skipped_at = now;
  if (ok !== true && skipped !== true) patch.failed_at = now;
  await ref.set(patch, { merge: true });
  return { outboxId: id, status };
}

async function fetchTradeAlertOutboxItems({
  statuses = ["FAILED", "SKIPPED", "PENDING"],
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
  },
};
