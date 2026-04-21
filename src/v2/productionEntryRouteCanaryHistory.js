"use strict";

const crypto = require("crypto");
const { putV2Doc, resolveV2CollectionRef } = require("./storage");

const COLLECTION_KEY = "PRODUCTION_ENTRY_ROUTE_CANARIES";
const SECRET_PATTERNS = Object.freeze([
  "apiKey",
  "apiSecret",
  "BINANCE_SECRET",
  "BINANCE_API",
  "SECRET_KEY",
  "PRIVATE_KEY",
]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
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

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function assertNoSecretLeak(payload) {
  const text = JSON.stringify(payload || {});
  const leaked = SECRET_PATTERNS.find((pattern) => text.includes(pattern));
  if (leaked) throw new Error(`PRODUCTION_ENTRY_ROUTE_CANARY_SECRET_LEAK_GUARD:${leaked}`);
}

function toMs(value) {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

function buildProductionEntryRouteCanaryHistoryDoc({
  artifact,
  recordedAt = new Date().toISOString(),
} = {}) {
  const source = artifact && typeof artifact === "object" ? artifact : null;
  if (!source) throw new Error("PRODUCTION_ENTRY_ROUTE_CANARY_ARTIFACT_REQUIRED");
  assertNoSecretLeak(source);
  const routeSummary = source.route_result_summary && typeof source.route_result_summary === "object"
    ? source.route_result_summary
    : {};
  const generatedAt = trimOrNull(source.generated_at) || trimOrNull(recordedAt) || new Date().toISOString();
  const recordedAtIso = trimOrNull(recordedAt) || new Date().toISOString();
  const generatedMs = toMs(generatedAt);
  const recordedMs = toMs(recordedAtIso);
  const idSeed = [
    generatedAt,
    source.reason,
    routeSummary.position_cycle_id,
    routeSummary.entry_event_id,
    routeSummary.protection_runtime_id,
  ].map((value) => trimOrNull(value) || "-").join("|");
  const snapshot = clonePlain(source);
  assertNoSecretLeak(snapshot);
  return Object.freeze({
    production_entry_route_canary_id: `PERCHV2__${hash12(idSeed)}`,
    generated_at: generatedAt,
    generated_at_ms: generatedMs,
    recorded_at: recordedAtIso,
    recorded_at_ms: recordedMs,
    scope: trimOrNull(source.scope),
    canary_mode: trimOrNull(source.canary_mode),
    ok: source.ok === true,
    reason: trimOrNull(source.reason),
    exchange_write_performed: source.exchange_write_performed === true,
    route_called: source.route_called === true,
    kernel_called: source.kernel_called === true,
    persist_called: source.persist_called === true,
    fail_n: Number(source.fail_n) || 0,
    failed_check_ids: Object.freeze(Array.isArray(source.failed_check_ids)
      ? source.failed_check_ids.map(trimOrNull).filter(Boolean)
      : []),
    route_reason: trimOrNull(routeSummary.reason),
    audit_ledger_reason: trimOrNull(routeSummary.audit_ledger_reason),
    position_cycle_id: trimOrNull(routeSummary.position_cycle_id),
    entry_event_id: trimOrNull(routeSummary.entry_event_id),
    protection_runtime_id: trimOrNull(routeSummary.protection_runtime_id),
    artifact_snapshot: Object.freeze(snapshot),
  });
}

function isProductionEntryRouteCanaryFirestoreWriteEnabled(env = process.env) {
  return parseBool(env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, false);
}

function isProductionEntryRouteCanaryFirestoreReadEnabled(env = process.env) {
  return parseBool(env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, false);
}

async function persistProductionEntryRouteCanaryHistory({
  artifact,
  db = null,
  env = process.env,
  recordedAt = new Date().toISOString(),
} = {}) {
  if (!isProductionEntryRouteCanaryFirestoreWriteEnabled(env)) {
    return Object.freeze({
      ok: true,
      skipped: true,
      reason: "PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_DISABLED",
      doc: null,
      persisted: null,
    });
  }
  const doc = buildProductionEntryRouteCanaryHistoryDoc({ artifact, recordedAt });
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
    reason: "PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITTEN",
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
    doc_id: trimOrNull(data.production_entry_route_canary_id),
  });
}

async function loadProductionEntryRouteCanaryHistoryRows({
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
  buildProductionEntryRouteCanaryHistoryDoc,
  isProductionEntryRouteCanaryFirestoreWriteEnabled,
  isProductionEntryRouteCanaryFirestoreReadEnabled,
  persistProductionEntryRouteCanaryHistory,
  loadProductionEntryRouteCanaryHistoryRows,
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
