"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { recordUnifiedEvent } = require("./unifiedEventTimeline");

function nowIso() {
  return new Date().toISOString();
}

function clipString(v, max = 2000) {
  if (v == null) return null;
  const s = String(v);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(truncated:${s.length - max})`;
}

function safePayload(payload) {
  if (payload == null) return null;
  let cloned = null;
  try {
    cloned = JSON.parse(JSON.stringify(payload));
  } catch (_) {
    return { _raw: clipString(payload, 4000) };
  }
  if (!cloned || typeof cloned !== "object") return cloned;
  const out = {};
  const entries = Object.entries(cloned);
  for (const [k, v] of entries.slice(0, 120)) {
    out[k] = typeof v === "string" ? clipString(v, 2000) : v;
  }
  if (entries.length > 120) out._truncated_keys = entries.length - 120;
  return out;
}

async function recordActionHookEvent(event, payload = {}) {
  const db = getFirestore();
  const id = [
    String(payload.run_id || payload.intent_id || payload.signal_id || "UNKNOWN"),
    Date.now(),
    String(event || "EVENT"),
    crypto.randomBytes(3).toString("hex"),
  ].join("__");
  const doc = {
    event: String(event || "").trim() || null,
    created_at: nowIso(),
    ...safePayload(payload),
  };
  await db.collection("action_hook_ledger").doc(id).set(doc, { merge: false });
  try {
    await recordUnifiedEvent({
      eventKind: "DECISION",
      eventSource: "ACTION_HOOK_LEDGER",
      sourceDocumentId: id,
      exchange: doc.exchange,
      symbol: doc.symbol,
      event: doc.event,
      traceId: doc.idempotency_key || doc.trace_id || null,
      requestId: doc.request_id || null,
      runId: doc.run_id || null,
      signalId: doc.signal_id || null,
      intentId: doc.intent_id || null,
      createdAt: doc.created_at,
      payload: {
        hook: doc.hook || null,
        policy_stage: doc.policy_stage || null,
        policy_reason: doc.policy_reason || null,
        qty_pct_final: Number.isFinite(Number(doc.qty_pct_final)) ? Number(doc.qty_pct_final) : null,
        action: doc.action || null,
        intent: doc.intent || null,
      },
      raw: doc,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_DECISION_FAIL]", msg);
  }
}

module.exports = {
  recordActionHookEvent,
};
