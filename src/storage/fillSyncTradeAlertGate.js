"use strict";

const crypto = require("crypto");
const firestoreStorage = require("./firestore");

const fallbackGateState = new Map();
const CLAIM_TTL_MS = 5 * 60 * 1000;

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeGateKey(key) {
  return String(key || "").trim().toUpperCase() || null;
}

function buildGateId(key) {
  const normalized = normalizeGateKey(key) || "NA";
  const digest = crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 24);
  return `FILL_SYNC_TRADE_ALERT_GATE__${digest}`;
}

function buildFallbackClaimToken() {
  return crypto.randomUUID();
}

async function prepareFillSyncTradeAlertGate({
  key,
  cooldownMs,
  nowMs = Date.now(),
  source = null,
} = {}) {
  const normalizedKey = normalizeGateKey(key);
  if (!normalizedKey) {
    return { send: false, key: null, gateId: null, reason: "MISSING_KEY" };
  }
  const ttlMs = Math.max(1000, Number(cooldownMs) || 0);
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const gateId = buildGateId(normalizedKey);
  const claimToken = buildFallbackClaimToken();
  const db = typeof firestoreStorage.getFirestore === "function" ? firestoreStorage.getFirestore() : null;

  if (!db || typeof db.runTransaction !== "function" || typeof db.collection !== "function") {
    const prev = fallbackGateState.get(gateId) || null;
    if (prev && Number.isFinite(Number(prev.last_sent_at_ms)) && (now - Number(prev.last_sent_at_ms)) < ttlMs) {
      return { send: false, key: normalizedKey, gateId, reason: "COOLDOWN_ACTIVE", lastSentAtMs: Number(prev.last_sent_at_ms) };
    }
    if (
      prev
      && String(prev.status || "").trim().toUpperCase() === "PENDING"
      && trimOrNull(prev.dispatch_claim_token)
      && Number.isFinite(Number(prev.dispatch_claim_expires_at_ms))
      && Number(prev.dispatch_claim_expires_at_ms) > now
    ) {
      return { send: false, key: normalizedKey, gateId, reason: "CLAIM_HELD", lastSentAtMs: Number(prev.last_sent_at_ms) || null };
    }
    fallbackGateState.set(gateId, {
      fill_sync_trade_alert_gate_id: gateId,
      dedupe_key: normalizedKey,
      status: "PENDING",
      source: trimOrNull(source),
      created_at: String(prev && prev.created_at || "").trim() || nowIso(),
      updated_at: nowIso(),
      last_attempt_at: nowIso(),
      last_sent_at_ms: Number(prev && prev.last_sent_at_ms) || null,
      attempt_count: Math.max(0, Number(prev && prev.attempt_count) || 0) + 1,
      dispatch_claim_token: claimToken,
      dispatch_claimed_at: nowIso(),
      dispatch_claim_expires_at_ms: now + CLAIM_TTL_MS,
    });
    return { send: true, key: normalizedKey, gateId, claimToken, lastSentAtMs: now };
  }

  const ref = db.collection("fill_sync_trade_alert_gate").doc(gateId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() || {}) : null;
    const prevSentAtMs = Number(prev && prev.last_sent_at_ms);
    if (Number.isFinite(prevSentAtMs) && (now - prevSentAtMs) < ttlMs) {
      return { send: false, key: normalizedKey, gateId, reason: "COOLDOWN_ACTIVE", lastSentAtMs: prevSentAtMs };
    }
    if (
      prev
      && String(prev.status || "").trim().toUpperCase() === "PENDING"
      && trimOrNull(prev.dispatch_claim_token)
      && Number.isFinite(Number(prev.dispatch_claim_expires_at_ms))
      && Number(prev.dispatch_claim_expires_at_ms) > now
    ) {
      return { send: false, key: normalizedKey, gateId, reason: "CLAIM_HELD", lastSentAtMs: prevSentAtMs };
    }
    const doc = {
      fill_sync_trade_alert_gate_id: gateId,
      dedupe_key: normalizedKey,
      status: "PENDING",
      source: trimOrNull(source) || trimOrNull(prev && prev.source),
      created_at: String(prev && prev.created_at || "").trim() || nowIso(),
      updated_at: nowIso(),
      last_attempt_at: nowIso(),
      last_sent_at_ms: Number.isFinite(prevSentAtMs) ? prevSentAtMs : null,
      attempt_count: Math.max(0, Number(prev && prev.attempt_count) || 0) + 1,
      dispatch_claim_token: claimToken,
      dispatch_claimed_at: nowIso(),
      dispatch_claim_expires_at_ms: now + CLAIM_TTL_MS,
    };
    tx.set(ref, doc, { merge: true });
    return { send: true, key: normalizedKey, gateId, claimToken, lastSentAtMs: now };
  });
}

async function markFillSyncTradeAlertGateResult({
  gateId,
  claimToken = null,
  ok = false,
  skipped = false,
  reason = null,
  nowMs = Date.now(),
} = {}) {
  if (!gateId) return { ok: false, skipped: true, reason: "MISSING_GATE_ID" };
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const db = typeof firestoreStorage.getFirestore === "function" ? firestoreStorage.getFirestore() : null;

  if (!db || typeof db.runTransaction !== "function" || typeof db.collection !== "function") {
    const prev = fallbackGateState.get(gateId) || null;
    if (!prev) return { ok: false, skipped: true, reason: "OUTBOX_MISSING" };
    if (claimToken && trimOrNull(prev.dispatch_claim_token) && trimOrNull(prev.dispatch_claim_token) !== trimOrNull(claimToken)) {
      return { ok: false, skipped: true, reason: "CLAIM_MISMATCH" };
    }
    fallbackGateState.set(gateId, {
      ...prev,
      status: (ok || skipped) ? "SENT" : "FAILED",
      updated_at: nowIso(),
      last_result: (ok || skipped) ? "SENT" : "FAILED",
      last_reason: trimOrNull(reason),
      last_sent_at_ms: (ok || skipped) ? now : (Number(prev.last_sent_at_ms) || null),
      dispatch_claim_token: null,
      dispatch_claimed_at: null,
      dispatch_claim_expires_at_ms: null,
    });
    return { ok: true };
  }

  const ref = db.collection("fill_sync_trade_alert_gate").doc(gateId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() || {}) : null;
    if (!prev) return { ok: false, skipped: true, reason: "OUTBOX_MISSING" };
    if (claimToken && trimOrNull(prev.dispatch_claim_token) && trimOrNull(prev.dispatch_claim_token) !== trimOrNull(claimToken)) {
      return { ok: false, skipped: true, reason: "CLAIM_MISMATCH" };
    }
    tx.set(ref, {
      status: (ok || skipped) ? "SENT" : "FAILED",
      updated_at: nowIso(),
      last_result: (ok || skipped) ? "SENT" : "FAILED",
      last_reason: trimOrNull(reason),
      last_sent_at_ms: (ok || skipped) ? now : (Number(prev.last_sent_at_ms) || null),
      dispatch_claim_token: null,
      dispatch_claimed_at: null,
      dispatch_claim_expires_at_ms: null,
    }, { merge: true });
    return { ok: true };
  });
}

module.exports = {
  prepareFillSyncTradeAlertGate,
  markFillSyncTradeAlertGateResult,
  __test: {
    buildGateId,
    normalizeGateKey,
    fallbackGateState,
  },
};
