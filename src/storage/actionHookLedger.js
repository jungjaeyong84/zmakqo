"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");

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
}

module.exports = {
  recordActionHookEvent,
};
