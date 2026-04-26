"use strict";

const { getFirestore } = require("../storage/firestore");

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

function parseNonNegativeInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.floor(num));
}

function safeDocId(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 220) || "UNKNOWN";
}

function buildAlgoEndpointDegradationDocPath({ exchange = "BINANCEFUT", symbol } = {}) {
  return `runtime_locks/v2_algo_endpoint_degradation__${safeDocId(exchange)}__${safeDocId(symbol)}`;
}

function resolveFirestoreDocRef(db, key) {
  if (!db) throw new Error("ALGO_ENDPOINT_DEGRADATION_FIRESTORE_DB_REQUIRED");
  const path = buildAlgoEndpointDegradationDocPath(key);
  if (typeof db.doc === "function") return db.doc(path);
  if (typeof db.collection === "function") {
    return db.collection("runtime_locks").doc(path.split("/").pop());
  }
  throw new Error("ALGO_ENDPOINT_DEGRADATION_FIRESTORE_REF_UNAVAILABLE");
}

function resolveAlgoEndpointDegradationPolicy(env = process.env) {
  return Object.freeze({
    enabled: parseBool(env && env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_STATE_ENABLED, true),
    crit_after_ms: parseNonNegativeInt(
      env && env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADED_CRIT_AFTER_MS,
      600000
    ),
  });
}

function readSnapData(snap) {
  if (!snap || snap.exists !== true || typeof snap.data !== "function") return {};
  const data = snap.data();
  return data && typeof data === "object" ? data : {};
}

function buildUnavailableUpdate({ previous, exchange, symbol, now, policy, note } = {}) {
  const prev = previous && typeof previous === "object" ? previous : {};
  const prevFirstSeen = Number(prev.first_seen_ms);
  const wasDegraded = String(prev.status || "").toUpperCase() === "DEGRADED"
    && Number.isFinite(prevFirstSeen)
    && prevFirstSeen > 0;
  const firstSeenMs = wasDegraded ? prevFirstSeen : now;
  const firstSeenAt = wasDegraded && trimOrNull(prev.first_seen_at)
    ? trimOrNull(prev.first_seen_at)
    : new Date(firstSeenMs).toISOString();
  const consecutiveSeenN = wasDegraded ? Math.max(0, Number(prev.consecutive_seen_n) || 0) + 1 : 1;
  const durationMs = Math.max(0, now - firstSeenMs);
  const escalated = durationMs >= policy.crit_after_ms;
  const payload = {
    state_type: "V2_ALGO_ENDPOINT_DEGRADATION",
    exchange: safeDocId(exchange),
    symbol: safeDocId(symbol),
    status: "DEGRADED",
    first_seen_at: firstSeenAt,
    first_seen_ms: firstSeenMs,
    last_seen_at: new Date(now).toISOString(),
    last_seen_ms: now,
    duration_ms: durationMs,
    consecutive_seen_n: consecutiveSeenN,
    crit_after_ms: policy.crit_after_ms,
    escalated,
    note: trimOrNull(note),
    updated_at: new Date(now).toISOString(),
  };
  return {
    ok: true,
    enabled: true,
    endpoint_unavailable: true,
    status: "DEGRADED",
    severity: escalated ? "CRIT" : "WARN",
    first_seen_at: firstSeenAt,
    first_seen_ms: firstSeenMs,
    duration_ms: durationMs,
    consecutive_seen_n: consecutiveSeenN,
    crit_after_ms: policy.crit_after_ms,
    escalated,
    payload,
  };
}

function buildRecoveryUpdate({ previous, exchange, symbol, now, policy } = {}) {
  const prev = previous && typeof previous === "object" ? previous : {};
  const wasDegraded = String(prev.status || "").toUpperCase() === "DEGRADED";
  if (!wasDegraded) {
    return {
      ok: true,
      enabled: true,
      endpoint_unavailable: false,
      status: "HEALTHY",
      recovered: false,
      wrote: false,
      duration_ms: 0,
      escalated: false,
      crit_after_ms: policy.crit_after_ms,
      payload: null,
    };
  }
  const firstSeenMs = Number(prev.first_seen_ms);
  const durationMs = Number.isFinite(firstSeenMs) && firstSeenMs > 0 ? Math.max(0, now - firstSeenMs) : 0;
  const payload = {
    state_type: "V2_ALGO_ENDPOINT_DEGRADATION",
    exchange: safeDocId(exchange),
    symbol: safeDocId(symbol),
    status: "RECOVERED",
    first_seen_at: trimOrNull(prev.first_seen_at),
    first_seen_ms: Number.isFinite(firstSeenMs) ? firstSeenMs : null,
    last_seen_at: trimOrNull(prev.last_seen_at),
    last_seen_ms: Number.isFinite(Number(prev.last_seen_ms)) ? Number(prev.last_seen_ms) : null,
    recovered_at: new Date(now).toISOString(),
    recovered_ms: now,
    duration_ms: durationMs,
    consecutive_seen_n: Number(prev.consecutive_seen_n) || 0,
    crit_after_ms: policy.crit_after_ms,
    escalated: false,
    updated_at: new Date(now).toISOString(),
  };
  return {
    ok: true,
    enabled: true,
    endpoint_unavailable: false,
    status: "RECOVERED",
    recovered: true,
    wrote: true,
    duration_ms: durationMs,
    escalated: false,
    crit_after_ms: policy.crit_after_ms,
    payload,
  };
}

async function loadCurrentDoc(ref) {
  if (!ref || typeof ref.get !== "function") return {};
  return readSnapData(await ref.get());
}

async function writeDoc(ref, payload) {
  if (!payload) return;
  if (typeof ref.set === "function") {
    await ref.set(payload, { merge: true });
  }
}

async function updateAlgoEndpointDegradationState({
  db = null,
  env = process.env,
  exchange = "BINANCEFUT",
  symbol,
  endpointUnavailable,
  note = null,
  nowMs = () => Date.now(),
} = {}) {
  const policy = resolveAlgoEndpointDegradationPolicy(env);
  if (!policy.enabled) {
    return {
      ok: true,
      enabled: false,
      endpoint_unavailable: endpointUnavailable === true,
      status: "DISABLED",
      severity: endpointUnavailable === true ? "WARN" : "OK",
      duration_ms: 0,
      escalated: false,
      crit_after_ms: policy.crit_after_ms,
    };
  }
  const resolvedSymbol = trimOrNull(symbol);
  if (!resolvedSymbol) {
    return {
      ok: false,
      enabled: true,
      endpoint_unavailable: endpointUnavailable === true,
      status: "STATE_SKIPPED",
      reason: "ALGO_ENDPOINT_DEGRADATION_SYMBOL_REQUIRED",
      duration_ms: 0,
      escalated: false,
      crit_after_ms: policy.crit_after_ms,
    };
  }
  let firestore = db;
  if (!firestore) {
    try {
      firestore = getFirestore();
    } catch (error) {
      return {
        ok: false,
        enabled: true,
        endpoint_unavailable: endpointUnavailable === true,
        status: "STATE_UNAVAILABLE",
        reason: "ALGO_ENDPOINT_DEGRADATION_FIRESTORE_UNAVAILABLE",
        error: error && error.message ? error.message : String(error),
        duration_ms: 0,
        escalated: false,
        crit_after_ms: policy.crit_after_ms,
      };
    }
  }
  const now = Number(nowMs()) || Date.now();
  const ref = resolveFirestoreDocRef(firestore, { exchange, symbol: resolvedSymbol });
  let result = null;
  if (typeof firestore.runTransaction === "function") {
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const previous = readSnapData(snap);
      result = endpointUnavailable === true
        ? buildUnavailableUpdate({ previous, exchange, symbol: resolvedSymbol, now, policy, note })
        : buildRecoveryUpdate({ previous, exchange, symbol: resolvedSymbol, now, policy });
      if (result.payload) tx.set(ref, result.payload, { merge: true });
    });
  } else {
    const previous = await loadCurrentDoc(ref);
    result = endpointUnavailable === true
      ? buildUnavailableUpdate({ previous, exchange, symbol: resolvedSymbol, now, policy, note })
      : buildRecoveryUpdate({ previous, exchange, symbol: resolvedSymbol, now, policy });
    await writeDoc(ref, result.payload);
  }
  return {
    ...result,
    wrote: !!(result && result.payload),
    doc_path: buildAlgoEndpointDegradationDocPath({ exchange, symbol: resolvedSymbol }),
  };
}

module.exports = {
  buildAlgoEndpointDegradationDocPath,
  resolveAlgoEndpointDegradationPolicy,
  updateAlgoEndpointDegradationState,
  __test: {
    trimOrNull,
    parseBool,
    parseNonNegativeInt,
    safeDocId,
    resolveFirestoreDocRef,
    readSnapData,
    buildUnavailableUpdate,
    buildRecoveryUpdate,
  },
};
