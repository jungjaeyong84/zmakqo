"use strict";

const crypto = require("crypto");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback, minimum = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(minimum, Number(fallback) || minimum);
  return Math.max(minimum, Math.floor(num));
}

function safeDocId(value) {
  return String(value || "UNKNOWN")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 240) || "UNKNOWN";
}

function randomToken() {
  return crypto.randomBytes(12).toString("hex");
}

function defaultHolderId() {
  return [
    trimOrNull(process.env.K_SERVICE) || "local",
    trimOrNull(process.env.K_REVISION) || "dev",
    process.pid,
  ].join(":");
}

function buildProtectionWriterLeaseDocPath(key) {
  return `runtime_locks/v2_protection_writer_lease__${safeDocId(key)}`;
}

function resolveFirestoreDocRef(db, key) {
  if (!db) throw new Error("PROTECTION_WRITER_LEASE_FIRESTORE_DB_REQUIRED");
  const path = buildProtectionWriterLeaseDocPath(key);
  if (typeof db.doc === "function") return db.doc(path);
  if (typeof db.collection === "function") {
    return db.collection("runtime_locks").doc(`v2_protection_writer_lease__${safeDocId(key)}`);
  }
  throw new Error("PROTECTION_WRITER_LEASE_FIRESTORE_REF_UNAVAILABLE");
}

function buildLeasePayload({
  key,
  token,
  holderId,
  lease,
  nowMs,
  ttlMs,
} = {}) {
  const row = lease && typeof lease === "object" ? lease : {};
  const acquiredAt = new Date(nowMs).toISOString();
  const expiresAtMs = nowMs + ttlMs;
  return Object.freeze({
    lock_type: "V2_PROTECTION_WRITER_LEASE",
    lock_key: key,
    lease_holder_instance_id: holderId,
    lease_token: token,
    position_cycle_id: trimOrNull(row.position_cycle_id),
    placement_attempt_id: trimOrNull(row.placement_attempt_id),
    command_type: trimOrNull(row.command_type),
    lease_scope: trimOrNull(row.lease_scope),
    lease_service: trimOrNull(row.lease_service),
    acquired_by_service: trimOrNull(row.acquired_by_service),
    acquired_at: acquiredAt,
    acquired_at_ms: nowMs,
    heartbeat_at: acquiredAt,
    heartbeat_ms: nowMs,
    expires_at: new Date(expiresAtMs).toISOString(),
    expires_at_ms: expiresAtMs,
    ttl_ms: ttlMs,
    collection_reason: "V2_PROTECTION_WRITER_FIRESTORE_LEASE",
    updated_at: acquiredAt,
  });
}

function isLeaseActive(data, nowMs) {
  const row = data && typeof data === "object" ? data : {};
  const expiresAtMs = Number(row.expires_at_ms);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

function buildFirestoreProtectionWriterLeaseRegistry({
  db,
  env = process.env,
  holderId = null,
  nowMs = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!db || typeof db.runTransaction !== "function") {
    throw new Error("PROTECTION_WRITER_LEASE_FIRESTORE_TRANSACTION_REQUIRED");
  }
  const resolvedHolderId = trimOrNull(holderId)
    || trimOrNull(env && env.DONBEOLJA_V2_REPAIR_WRITER_LEASE_HOLDER_ID)
    || defaultHolderId();
  const ttlMs = parsePositiveInt(
    env && env.DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS,
    60000,
    3000
  );
  const heartbeatMs = parsePositiveInt(
    env && env.DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS,
    10000,
    0
  );
  const timers = new Map();

  async function heartbeat(key, token) {
    const now = Number(nowMs()) || Date.now();
    const ref = resolveFirestoreDocRef(db, key);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap || snap.exists !== true) return false;
      const data = snap.data ? (snap.data() || {}) : {};
      if (trimOrNull(data.lease_token) !== token) return false;
      tx.set(ref, {
        heartbeat_at: new Date(now).toISOString(),
        heartbeat_ms: now,
        expires_at: new Date(now + ttlMs).toISOString(),
        expires_at_ms: now + ttlMs,
        updated_at: new Date(now).toISOString(),
      }, { merge: true });
      return true;
    });
  }

  function startHeartbeat(key, token) {
    if (!heartbeatMs || heartbeatMs <= 0 || typeof setIntervalFn !== "function") return;
    const timer = setIntervalFn(() => {
      heartbeat(key, token).catch((error) => {
        console.warn("[V2_PROTECTION_WRITER_LEASE_HEARTBEAT_FAILED]", error && error.message ? error.message : error);
      });
    }, heartbeatMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    timers.set(token, timer);
  }

  function stopHeartbeat(token) {
    const timer = timers.get(token);
    if (timer && typeof clearIntervalFn === "function") clearIntervalFn(timer);
    timers.delete(token);
  }

  return Object.freeze({
    async acquire(key, context = {}) {
      const lockKey = trimOrNull(key);
      if (!lockKey) throw new Error("PROTECTION_WRITER_LEASE_CONCURRENCY_KEY_INVALID");
      const token = randomToken();
      const now = Number(nowMs()) || Date.now();
      const ref = resolveFirestoreDocRef(db, lockKey);
      let acquired = false;
      let currentHolder = null;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap && snap.exists === true && snap.data ? (snap.data() || {}) : {};
        if (isLeaseActive(data, now)) {
          currentHolder = trimOrNull(data.lease_holder_instance_id) || "UNKNOWN";
          return;
        }
        const payload = buildLeasePayload({
          key: lockKey,
          token,
          holderId: resolvedHolderId,
          lease: context.lease || context.writerLease || {},
          nowMs: now,
          ttlMs,
        });
        tx.set(ref, payload, { merge: true });
        acquired = true;
      });
      if (acquired !== true) {
        return Object.freeze({
          ok: false,
          acquired: false,
          reason: "PROTECTION_WRITER_LEASE_CONCURRENT_WRITE",
          current_holder: currentHolder,
        });
      }
      startHeartbeat(lockKey, token);
      return Object.freeze({
        ok: true,
        acquired: true,
        reason: "PROTECTION_WRITER_LEASE_ACQUIRED",
        key: lockKey,
        token,
        holder_id: resolvedHolderId,
        expires_at_ms: now + ttlMs,
      });
    },

    async release(key, context = {}) {
      const lockKey = trimOrNull(key);
      const token = trimOrNull(context.token);
      if (!lockKey || !token) return false;
      stopHeartbeat(token);
      const ref = resolveFirestoreDocRef(db, lockKey);
      let released = false;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap || snap.exists !== true) return;
        const data = snap.data ? (snap.data() || {}) : {};
        if (trimOrNull(data.lease_token) !== token) return;
        if (typeof tx.delete === "function") {
          tx.delete(ref);
        } else {
          tx.set(ref, {
            released_at: new Date(Number(nowMs()) || Date.now()).toISOString(),
            released: true,
            expires_at_ms: 0,
            updated_at: new Date(Number(nowMs()) || Date.now()).toISOString(),
          }, { merge: true });
        }
        released = true;
      });
      return released;
    },

    _kind: "FIRESTORE_PROTECTION_WRITER_LEASE_REGISTRY",
  });
}

function shouldUseFirestoreProtectionWriterLease({ db, env = process.env } = {}) {
  if (!parseBool(env && env.DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED, true)) return false;
  return !!(db && typeof db.runTransaction === "function");
}

module.exports = {
  buildFirestoreProtectionWriterLeaseRegistry,
  buildProtectionWriterLeaseDocPath,
  shouldUseFirestoreProtectionWriterLease,
  __test: {
    trimOrNull,
    parseBool,
    parsePositiveInt,
    safeDocId,
    randomToken,
    defaultHolderId,
    resolveFirestoreDocRef,
    buildLeasePayload,
    isLeaseActive,
  },
};
