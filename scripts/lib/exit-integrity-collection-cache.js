"use strict";

// C8 — shared read-side cache for the exit integrity cycle.
//
// The integrity cycle historically fans out into 13+ subscripts that each
// open their own Firestore query against the same handful of hot
// collections: `fills_paper`, `positions_paper`, `trade_alert_outbox`, and
// `order_intents_paper`. Each cycle burns thousands of reads on largely
// redundant data.
//
// This module provides a simple two-part protocol:
//
//   1. The cycle driver (`run-binance-exit-integrity-cycle.js`) calls
//      `writeExitIntegrityCollectionCache({db, outDir, lookback})` once,
//      up front, which serialises a snapshot of each hot collection to a
//      tempfile and returns the path.
//
//   2. Subscripts MAY opt in by reading the cache file path from the env
//      `EXIT_INTEGRITY_COLLECTION_CACHE_PATH` and invoking
//      `readExitIntegrityCollectionCache(path)`. If the cache is missing or
//      stale the subscript falls back to its legacy direct Firestore query
//      — this keeps the rollout incremental and safe.
//
// The cache is intentionally simple (a flat JSON blob keyed by collection)
// to avoid introducing a binary format that would break local debugging.

const fs = require("fs");
const path = require("path");
const os = require("os");

const ENV_CACHE_PATH = "EXIT_INTEGRITY_COLLECTION_CACHE_PATH";
const DEFAULT_FILL_LIMIT = 5000;
const DEFAULT_INTENT_LIMIT = 3000;
const DEFAULT_OUTBOX_LIMIT = 3000;
const DEFAULT_POSITION_LIMIT = 500;

function isoNow() {
  return new Date().toISOString();
}

function sinceIso(ms) {
  return new Date(Date.now() - Math.max(0, Number(ms) || 0)).toISOString();
}

async function snapshotCollection(db, name, {
  sinceField = "created_at",
  sinceIso: sinceIsoTs = null,
  limit = 1000,
  orderByDesc = true,
} = {}) {
  if (!db || !name) return { rows: [], truncated: false };
  let query = db.collection(name);
  if (sinceField && sinceIsoTs) {
    query = query.where(sinceField, ">=", sinceIsoTs);
  }
  if (orderByDesc && sinceField) {
    query = query.orderBy(sinceField, "desc");
  }
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    query = query.limit(Math.floor(Number(limit)));
  }
  const snap = await query.get();
  const rows = [];
  snap.forEach((doc) => {
    rows.push({ __id: doc.id, ...(doc.data() || {}) });
  });
  return { rows, truncated: rows.length === Number(limit) };
}

async function buildExitIntegrityCollectionCache({
  db,
  lookbackMs = 6 * 60 * 60 * 1000,
  fillLimit = DEFAULT_FILL_LIMIT,
  intentLimit = DEFAULT_INTENT_LIMIT,
  outboxLimit = DEFAULT_OUTBOX_LIMIT,
  positionLimit = DEFAULT_POSITION_LIMIT,
  exchange = "BINANCEFUT",
} = {}) {
  if (!db) {
    return {
      generated_at: isoNow(),
      lookback_ms: lookbackMs,
      exchange,
      collections: {},
      skipped: true,
      skip_reason: "NO_DB_HANDLE",
    };
  }
  const since = sinceIso(lookbackMs);
  const started = Date.now();
  const [fills, intents, outbox, positions] = await Promise.all([
    snapshotCollection(db, "fills_paper", { sinceIso: since, limit: fillLimit }).catch(() => null),
    snapshotCollection(db, "order_intents_paper", { sinceIso: since, limit: intentLimit }).catch(() => null),
    snapshotCollection(db, "trade_alert_outbox", { sinceIso: since, limit: outboxLimit }).catch(() => null),
    snapshotCollection(db, "positions_paper", {
      sinceField: null,
      sinceIso: null,
      orderByDesc: false,
      limit: positionLimit,
    }).catch(() => null),
  ]);
  return {
    generated_at: isoNow(),
    exchange,
    lookback_ms: lookbackMs,
    duration_ms: Date.now() - started,
    collections: {
      fills_paper: fills || { rows: [], truncated: false, skipped: true },
      order_intents_paper: intents || { rows: [], truncated: false, skipped: true },
      trade_alert_outbox: outbox || { rows: [], truncated: false, skipped: true },
      positions_paper: positions || { rows: [], truncated: false, skipped: true },
    },
  };
}

function resolveCachePath(outDir) {
  const base = outDir && fs.existsSync(outDir) ? outDir : os.tmpdir();
  return path.join(base, `exit_integrity_collection_cache_${process.pid}.json`);
}

async function writeExitIntegrityCollectionCache({
  db,
  outDir = null,
  ...buildOpts
} = {}) {
  const filePath = resolveCachePath(outDir);
  const payload = await buildExitIntegrityCollectionCache({ db, ...buildOpts });
  fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  return { path: filePath, payload };
}

function readExitIntegrityCollectionCache(filePath = process.env[ENV_CACHE_PATH]) {
  const resolved = String(filePath || "").trim();
  if (!resolved) return null;
  try {
    const stats = fs.statSync(resolved);
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return {
      ...parsed,
      __path: resolved,
      __mtime_ms: stats.mtimeMs || (stats.mtime && stats.mtime.getTime && stats.mtime.getTime()) || null,
    };
  } catch (_err) {
    return null;
  }
}

function getCachedCollectionRows(cache, collection) {
  if (!cache || !cache.collections) return null;
  const entry = cache.collections[collection];
  if (!entry || !Array.isArray(entry.rows)) return null;
  return entry.rows;
}

function removeCacheFile(filePath) {
  const resolved = String(filePath || "").trim();
  if (!resolved) return;
  try {
    fs.unlinkSync(resolved);
  } catch (_err) {
    // ignore
  }
}

module.exports = {
  ENV_CACHE_PATH,
  buildExitIntegrityCollectionCache,
  writeExitIntegrityCollectionCache,
  readExitIntegrityCollectionCache,
  getCachedCollectionRows,
  removeCacheFile,
};
