"use strict";

// V2 Alert Escalation Router (P2-3).
//
// Routes alerts by severity to the appropriate channel and, for CRITICAL
// severity, persists Firestore-backed escalation state so that the same
// CRITICAL incident is re-sent every `repeat_interval_ms` until the
// operator acknowledges or the underlying condition recovers.
//
// Design constraints:
// - Default OFF behind `DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED`
//   so existing alert paths keep working until the router is opted-in.
// - Pure state computation is separated from Firestore I/O so the same
//   logic is testable without a live Firestore.
// - All Firestore reads/writes go through `runtime_locks/v2_alert_escalation__*`
//   so they share the same lifecycle pattern as
//   `runtime_locks/v2_protection_writer_lease__*` and
//   `runtime_locks/v2_algo_endpoint_degradation__*`.
// - Repeat suppression is per-fingerprint, not per-title. Caller is
//   responsible for providing a stable fingerprint when one is available.

const crypto = require("crypto");

const SEVERITY_CANARY = "CANARY";
const SEVERITY_OPS = "OPS";
const SEVERITY_CRITICAL = "CRITICAL";

const DEFAULT_REPEAT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_REPEAT_N = 12 * 24; // 12 per hour for 24 hours
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const FIRST_SEEN_GRACE_MS = 1000;

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
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
  return String(value == null ? "UNKNOWN" : value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 200) || "UNKNOWN";
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function normalizeSeverityRoute(severity) {
  const raw = String(severity == null ? "" : severity).trim().toUpperCase();
  if (raw === "CRIT" || raw === "CRITICAL" || raw === "FATAL" || raw === "P0") return SEVERITY_CRITICAL;
  if (raw === "ERROR" || raw === "ERR") return SEVERITY_OPS;
  if (raw === "WARN" || raw === "WARNING") return SEVERITY_CANARY;
  return SEVERITY_CANARY;
}

function resolveAlertEscalationPolicy(env = process.env) {
  return Object.freeze({
    enabled: parseBool(env && env.DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED, false),
    repeat_interval_ms: parsePositiveInt(
      env && env.DONBEOLJA_V2_ALERT_ESCALATION_REPEAT_INTERVAL_MS,
      DEFAULT_REPEAT_INTERVAL_MS,
      1000
    ),
    max_repeat_n: parsePositiveInt(
      env && env.DONBEOLJA_V2_ALERT_ESCALATION_MAX_REPEAT_N,
      DEFAULT_MAX_REPEAT_N,
      1
    ),
    state_ttl_ms: parsePositiveInt(
      env && env.DONBEOLJA_V2_ALERT_ESCALATION_STATE_TTL_MS,
      DEFAULT_TTL_MS,
      60_000
    ),
  });
}

function resolveAlertChannelMap(env = process.env) {
  const source = env && typeof env === "object" ? env : {};
  const canary = trimOrNull(source.DONBEOLJA_V2_ALERT_CANARY_CHANNEL);
  const ops = trimOrNull(source.DONBEOLJA_V2_ALERT_OPS_CHANNEL);
  const critical = trimOrNull(source.DONBEOLJA_V2_ALERT_CRITICAL_CHANNEL) || ops;
  return Object.freeze({
    [SEVERITY_CANARY]: canary,
    [SEVERITY_OPS]: ops,
    [SEVERITY_CRITICAL]: critical,
  });
}

function resolveTargetChannel({ route, channelMap, fallbackChannel }) {
  const cmap = channelMap && typeof channelMap === "object" ? channelMap : {};
  const target = trimOrNull(cmap[route]);
  if (target) return target;
  return trimOrNull(fallbackChannel) || null;
}

function buildEscalationFingerprint({ fingerprint = null, severity = null, title = null, body = null } = {}) {
  const explicit = trimOrNull(fingerprint);
  if (explicit) return explicit;
  const composite = [
    String(severity || "").trim().toUpperCase(),
    String(title || "").trim(),
    String(body || "").trim(),
  ].join("\u241F");
  return shortHash(composite);
}

function buildEscalationDocPath(fp) {
  return `runtime_locks/v2_alert_escalation__${safeDocId(fp)}`;
}

function resolveFirestoreDocRef(db, fp) {
  if (!db) throw new Error("ALERT_ESCALATION_FIRESTORE_DB_REQUIRED");
  const path = buildEscalationDocPath(fp);
  if (typeof db.doc === "function") return db.doc(path);
  if (typeof db.collection === "function") {
    return db.collection("runtime_locks").doc(path.split("/").pop());
  }
  throw new Error("ALERT_ESCALATION_FIRESTORE_REF_UNAVAILABLE");
}

function readSnapData(snap) {
  if (!snap || snap.exists !== true || typeof snap.data !== "function") return null;
  const data = snap.data();
  return data && typeof data === "object" ? data : null;
}

function isAcknowledgedState(state) {
  if (!state || typeof state !== "object") return false;
  const status = String(state.status || "").trim().toUpperCase();
  return status === "ACKNOWLEDGED" || status === "RECOVERED";
}

function evaluateCriticalDecision({
  state,
  nowMs,
  policy,
}) {
  const repeatIntervalMs = policy.repeat_interval_ms;
  const maxRepeatN = policy.max_repeat_n;
  if (!state) {
    return Object.freeze({
      action: "SEND_FIRST",
      reason: "FIRST_SIGHTING",
      next_repeat_n: 1,
    });
  }
  if (isAcknowledgedState(state)) {
    return Object.freeze({
      action: "SUPPRESS",
      reason: "ACKNOWLEDGED",
      status: String(state.status || "").trim().toUpperCase(),
    });
  }
  const repeatN = Math.max(0, Number(state.repeat_n) || 0);
  if (repeatN >= maxRepeatN) {
    return Object.freeze({
      action: "SUPPRESS",
      reason: "MAX_REPEAT_REACHED",
      repeat_n: repeatN,
      max_repeat_n: maxRepeatN,
    });
  }
  const lastSentMs = Number(state.last_sent_ms);
  if (Number.isFinite(lastSentMs) && nowMs - lastSentMs < repeatIntervalMs) {
    return Object.freeze({
      action: "SUPPRESS",
      reason: "REPEAT_INTERVAL_NOT_ELAPSED",
      repeat_n: repeatN,
      last_sent_ms: lastSentMs,
      next_due_ms: lastSentMs + repeatIntervalMs,
    });
  }
  return Object.freeze({
    action: "SEND_REPEAT",
    reason: "REPEAT_DUE",
    repeat_n: repeatN,
    next_repeat_n: repeatN + 1,
  });
}

function buildPersistedState({
  previous,
  fingerprint,
  severity,
  title,
  channel,
  nowMs,
  decision,
}) {
  const prev = previous && typeof previous === "object" ? previous : null;
  const repeatN = decision.action === "SEND_FIRST"
    ? 1
    : decision.next_repeat_n;
  const firstSeenMs = (prev && Number.isFinite(Number(prev.first_seen_ms)))
    ? Number(prev.first_seen_ms)
    : nowMs;
  const firstSeenAt = (prev && trimOrNull(prev.first_seen_at))
    ? trimOrNull(prev.first_seen_at)
    : new Date(firstSeenMs).toISOString();
  return Object.freeze({
    state_type: "V2_ALERT_ESCALATION",
    fingerprint,
    severity_route: severity,
    target_channel: channel,
    title: trimOrNull(title),
    status: "ACTIVE",
    repeat_n: repeatN,
    first_seen_at: firstSeenAt,
    first_seen_ms: firstSeenMs,
    last_sent_at: new Date(nowMs).toISOString(),
    last_sent_ms: nowMs,
    updated_at: new Date(nowMs).toISOString(),
  });
}

async function readEscalationState({ db, fingerprint }) {
  if (!db) return null;
  try {
    const ref = resolveFirestoreDocRef(db, fingerprint);
    const snap = await ref.get();
    return readSnapData(snap);
  } catch (_) {
    return null;
  }
}

async function persistEscalationState({ db, fingerprint, state }) {
  if (!db) return false;
  try {
    const ref = resolveFirestoreDocRef(db, fingerprint);
    await ref.set(state, { merge: true });
    return true;
  } catch (_) {
    return false;
  }
}

async function ackEscalation({ db, fingerprint, ackReason = null, source = "OPERATOR_ACK" } = {}) {
  if (!db) {
    return Object.freeze({ ok: false, reason: "FIRESTORE_DB_REQUIRED" });
  }
  if (!trimOrNull(fingerprint)) {
    return Object.freeze({ ok: false, reason: "FINGERPRINT_REQUIRED" });
  }
  try {
    const ref = resolveFirestoreDocRef(db, fingerprint);
    const nowIso = new Date().toISOString();
    await ref.set({
      status: "ACKNOWLEDGED",
      acknowledged_at: nowIso,
      acknowledged_reason: trimOrNull(ackReason),
      acknowledged_source: trimOrNull(source) || "OPERATOR_ACK",
      updated_at: nowIso,
    }, { merge: true });
    return Object.freeze({ ok: true, fingerprint, status: "ACKNOWLEDGED" });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: trimOrNull(error && error.message) || "ESCALATION_ACK_WRITE_FAILED",
    });
  }
}

async function recoverEscalation({ db, fingerprint, recoverReason = null } = {}) {
  if (!db) {
    return Object.freeze({ ok: false, reason: "FIRESTORE_DB_REQUIRED" });
  }
  if (!trimOrNull(fingerprint)) {
    return Object.freeze({ ok: false, reason: "FINGERPRINT_REQUIRED" });
  }
  try {
    const ref = resolveFirestoreDocRef(db, fingerprint);
    const nowIso = new Date().toISOString();
    await ref.set({
      status: "RECOVERED",
      recovered_at: nowIso,
      recovered_reason: trimOrNull(recoverReason),
      updated_at: nowIso,
    }, { merge: true });
    return Object.freeze({ ok: true, fingerprint, status: "RECOVERED" });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: trimOrNull(error && error.message) || "ESCALATION_RECOVER_WRITE_FAILED",
    });
  }
}

async function routeEscalatedAlert({
  severity,
  title,
  body,
  fingerprint = null,
  fallbackChannel = null,
  env = process.env,
  db = null,
  policy = null,
  channelMap = null,
  sendAlertFn,
  now = () => Date.now(),
} = {}) {
  if (typeof sendAlertFn !== "function") {
    throw new Error("ALERT_ESCALATION_SEND_ALERT_FN_REQUIRED");
  }
  const resolvedPolicy = policy || resolveAlertEscalationPolicy(env);
  const route = normalizeSeverityRoute(severity);
  const fp = buildEscalationFingerprint({ fingerprint, severity: route, title, body });

  if (!resolvedPolicy.enabled) {
    const result = await sendAlertFn({
      channel: fallbackChannel,
      title,
      body,
      severity,
    });
    return Object.freeze({
      ok: !!(result && result.ok === true),
      route,
      reason: "ROUTER_DISABLED_PASSTHROUGH",
      fingerprint: fp,
      target_channel: trimOrNull(fallbackChannel),
      result,
    });
  }

  const cmap = channelMap || resolveAlertChannelMap(env);
  const targetChannel = resolveTargetChannel({ route, channelMap: cmap, fallbackChannel });
  if (!targetChannel) {
    return Object.freeze({
      ok: false,
      route,
      reason: "NO_CHANNEL_RESOLVED",
      fingerprint: fp,
      target_channel: null,
    });
  }

  if (route !== SEVERITY_CRITICAL) {
    const result = await sendAlertFn({
      channel: targetChannel,
      title,
      body,
      severity,
    });
    return Object.freeze({
      ok: !!(result && result.ok === true),
      route,
      reason: "DIRECT_DELIVERY",
      fingerprint: fp,
      target_channel: targetChannel,
      result,
    });
  }

  // CRITICAL path
  const nowMs = Number(now());
  const previous = await readEscalationState({ db, fingerprint: fp });
  const decision = evaluateCriticalDecision({ state: previous, nowMs, policy: resolvedPolicy });

  if (decision.action === "SUPPRESS") {
    return Object.freeze({
      ok: true,
      route,
      reason: decision.reason,
      fingerprint: fp,
      target_channel: targetChannel,
      decision,
      suppressed: true,
    });
  }

  const repeatLabel = decision.action === "SEND_REPEAT" && decision.next_repeat_n
    ? ` (재알림 ${decision.next_repeat_n})`
    : "";
  const sendResult = await sendAlertFn({
    channel: targetChannel,
    title: `${title || "[V2 CRITICAL]"}${repeatLabel}`,
    body,
    severity,
  });
  const persisted = buildPersistedState({
    previous,
    fingerprint: fp,
    severity: route,
    title,
    channel: targetChannel,
    nowMs,
    decision,
  });
  const persistOk = await persistEscalationState({ db, fingerprint: fp, state: persisted });

  return Object.freeze({
    ok: !!(sendResult && sendResult.ok === true),
    route,
    reason: decision.action === "SEND_FIRST" ? "FIRST_SIGHTING_SENT" : "REPEAT_SENT",
    fingerprint: fp,
    target_channel: targetChannel,
    decision,
    persisted_state: persistOk ? persisted : null,
    persist_ok: persistOk,
    result: sendResult,
  });
}

module.exports = {
  SEVERITY_CANARY,
  SEVERITY_OPS,
  SEVERITY_CRITICAL,
  DEFAULT_REPEAT_INTERVAL_MS,
  DEFAULT_MAX_REPEAT_N,
  resolveAlertEscalationPolicy,
  resolveAlertChannelMap,
  resolveTargetChannel,
  normalizeSeverityRoute,
  buildEscalationFingerprint,
  buildEscalationDocPath,
  evaluateCriticalDecision,
  buildPersistedState,
  routeEscalatedAlert,
  ackEscalation,
  recoverEscalation,
  __test: {
    trimOrNull,
    parseBool,
    parsePositiveInt,
    safeDocId,
    shortHash,
    isAcknowledgedState,
    readEscalationState,
    persistEscalationState,
    resolveFirestoreDocRef,
  },
};
