"use strict";

const crypto = require("crypto");
const { putV2Doc, resolveV2CollectionRef } = require("./storage");

const COLLECTION_KEY = "ACTIVE_PROTECTION_RECONCILIATIONS";
const SECRET_PATTERNS = Object.freeze([
  "apiKey",
  "apiSecret",
  "BINANCE_SECRET",
  "BINANCE_API",
  "SECRET_KEY",
  "PRIVATE_KEY",
]);

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

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.floor(num);
  return Math.floor(Number(fallback) || 1);
}

function hash12(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12).toUpperCase();
}

function toMs(value) {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function assertNoSecretLeak(payload) {
  const text = JSON.stringify(payload || {});
  const leaked = SECRET_PATTERNS.find((pattern) => text.includes(pattern));
  if (leaked) throw new Error(`ACTIVE_PROTECTION_RECONCILIATION_SECRET_LEAK_GUARD:${leaked}`);
}

function normalizeSymbols(value) {
  return Object.freeze((Array.isArray(value) ? value : [])
    .map((symbol) => trimOrNull(symbol))
    .filter(Boolean)
    .map((symbol) => symbol.toUpperCase())
    .sort());
}

function buildActiveProtectionReconciliationHistoryDoc({
  artifact,
  recordedAt = new Date().toISOString(),
} = {}) {
  const source = artifact && typeof artifact === "object" ? artifact : null;
  if (!source) throw new Error("ACTIVE_PROTECTION_RECONCILIATION_ARTIFACT_REQUIRED");
  assertNoSecretLeak(source);
  const generatedAt = trimOrNull(source.generated_at) || trimOrNull(recordedAt) || new Date().toISOString();
  const recordedAtIso = trimOrNull(recordedAt) || new Date().toISOString();
  const generatedMs = toMs(generatedAt);
  const recordedMs = toMs(recordedAtIso);
  const activeSymbols = normalizeSymbols(source.active_symbols);
  const unprotectedSymbols = normalizeSymbols(source.unprotected_symbols);
  const idSeed = [
    generatedAt,
    source.reason,
    activeSymbols.join(","),
    unprotectedSymbols.join(","),
  ].map((value) => trimOrNull(value) || "-").join("|");
  const snapshot = clonePlain(source);
  assertNoSecretLeak(snapshot);
  return Object.freeze({
    active_protection_reconciliation_id: `APRCV2__${hash12(idSeed)}`,
    generated_at: generatedAt,
    generated_at_ms: generatedMs,
    recorded_at: recordedAtIso,
    recorded_at_ms: recordedMs,
    ok: source.ok === true,
    reason: trimOrNull(source.reason),
    exchange: trimOrNull(source.exchange) || "BINANCEFUT",
    cadence: trimOrNull(source.cadence) || "HOURLY",
    scheduler_job_id: trimOrNull(source.scheduler_job_id),
    producer_script: trimOrNull(source.producer_script),
    active_position_n: Number(source.active_position_n) || 0,
    protected_position_n: Number(source.protected_position_n) || 0,
    unprotected_position_n: Number(source.unprotected_position_n) || 0,
    issue_count: Number(source.issue_count) || 0,
    critical_issue_n: Number(source.critical_issue_n) || 0,
    active_symbols: activeSymbols,
    unprotected_symbols: unprotectedSymbols,
    issue_fingerprint: trimOrNull(source.issue_fingerprint),
    artifact_snapshot: Object.freeze(snapshot),
  });
}

function isActiveProtectionReconciliationFirestoreWriteEnabled(env = process.env) {
  return parseBool(env.DONBEOLJA_V2_ACTIVE_PROTECTION_RECONCILIATION_FIRESTORE_WRITE_ENABLED, false);
}

function isActiveProtectionReconciliationFirestoreReadEnabled(env = process.env) {
  return parseBool(env.DONBEOLJA_V2_ACTIVE_PROTECTION_RECONCILIATION_FIRESTORE_READ_ENABLED, false);
}

async function persistActiveProtectionReconciliationHistory({
  artifact,
  db = null,
  env = process.env,
  recordedAt = new Date().toISOString(),
} = {}) {
  if (!isActiveProtectionReconciliationFirestoreWriteEnabled(env)) {
    return Object.freeze({
      ok: true,
      skipped: true,
      reason: "ACTIVE_PROTECTION_RECONCILIATION_FIRESTORE_WRITE_DISABLED",
      doc: null,
      persisted: null,
    });
  }
  const doc = buildActiveProtectionReconciliationHistoryDoc({ artifact, recordedAt });
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: COLLECTION_KEY,
    doc,
    merge: true,
  });
  return Object.freeze({
    ok: true,
    skipped: false,
    reason: "ACTIVE_PROTECTION_RECONCILIATION_FIRESTORE_WRITTEN",
    doc,
    persisted,
  });
}

function docData(row) {
  if (!row) return {};
  if (typeof row.data === "function") return row.data() || {};
  return row;
}

function rowToHistory(row, index) {
  const data = docData(row);
  const payload = data.artifact_snapshot && typeof data.artifact_snapshot === "object"
    ? data.artifact_snapshot
    : data;
  return Object.freeze({
    line_no: index + 1,
    raw: JSON.stringify(payload),
    payload,
    generated_ms: Number(data.generated_at_ms) || toMs(payload && payload.generated_at),
    doc_id: trimOrNull(data.active_protection_reconciliation_id),
  });
}

async function loadActiveProtectionReconciliationHistoryRows({
  db = null,
  env = process.env,
  sinceMs,
  limit = 200,
} = {}) {
  const boundedLimit = Math.max(1, parsePositiveInt(limit, 200));
  const resolvedSinceMs = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : Date.now() - 24 * 60 * 60 * 1000;
  const { collectionName, ref } = resolveV2CollectionRef({ db, env, collectionKey: COLLECTION_KEY });
  const query = ref.where("generated_at_ms", ">=", resolvedSinceMs).limit(boundedLimit);
  const snap = await query.get();
  const rows = (snap && Array.isArray(snap.docs) ? snap.docs : [])
    .map(rowToHistory)
    .filter((row) => row.generated_ms == null || row.generated_ms >= resolvedSinceMs)
    .sort((left, right) => (Number(left.generated_ms) || 0) - (Number(right.generated_ms) || 0));
  return Object.freeze({
    ok: true,
    collectionKey: COLLECTION_KEY,
    collectionName,
    since_ms: resolvedSinceMs,
    limit: boundedLimit,
    rows: Object.freeze(rows),
    invalid_lines: Object.freeze([]),
  });
}

module.exports = {
  buildActiveProtectionReconciliationHistoryDoc,
  isActiveProtectionReconciliationFirestoreWriteEnabled,
  isActiveProtectionReconciliationFirestoreReadEnabled,
  persistActiveProtectionReconciliationHistory,
  loadActiveProtectionReconciliationHistoryRows,
  __test: {
    COLLECTION_KEY,
    SECRET_PATTERNS,
    trimOrNull,
    parseBool,
    parsePositiveInt,
    hash12,
    toMs,
    assertNoSecretLeak,
    rowToHistory,
  },
};
