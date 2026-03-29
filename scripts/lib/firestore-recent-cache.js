"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../../src/storage/firestore");
const { OPS_DAILY_DIR } = require("./automation-utils");

const CACHE_ROOT = path.join(OPS_DAILY_DIR, "cache", "firestore_recent");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function resolveCreatedMs(doc) {
  return (
    toNum(doc && doc.created_at_ms) ??
    parseIsoMs(doc && doc.created_at) ??
    toNum(doc && doc.updated_at_ms) ??
    parseIsoMs(doc && doc.updated_at) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    parseIsoMs(doc && doc.ts)
  );
}

function resolveCreatedCursor(doc) {
  const candidates = [
    doc && doc.created_at,
    doc && doc.updated_at,
    doc && doc.ts,
  ];
  for (const raw of candidates) {
    const s = String(raw || "").trim();
    if (s) return s;
  }
  return "";
}

function sortDocsDesc(rows = []) {
  return rows.slice().sort((a, b) => {
    const ams = resolveCreatedMs(a);
    const bms = resolveCreatedMs(b);
    if (Number.isFinite(ams) && Number.isFinite(bms) && ams !== bms) return bms - ams;
    const ac = resolveCreatedCursor(a);
    const bc = resolveCreatedCursor(b);
    if (ac && bc && ac !== bc) return bc.localeCompare(ac);
    return String(b && b.id || "").localeCompare(String(a && a.id || ""));
  });
}

function readCacheJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeCacheJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function cacheFilePath(collection) {
  return path.join(CACHE_ROOT, `${String(collection || "").trim()}.json`);
}

async function fetchRecentOverlap(collection, limit) {
  const db = getFirestore();
  const snap = await db.collection(collection)
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fetchAfterCursor(collection, cursor, pageSize) {
  if (!cursor) return [];
  const db = getFirestore();
  const snap = await db.collection(collection)
    .where("created_at", ">", cursor)
    .orderBy("created_at", "asc")
    .limit(pageSize)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fetchAllAfterCursor(collection, cursor, pageSize) {
  const out = [];
  let nextCursor = String(cursor || "").trim();
  let pages = 0;
  while (nextCursor) {
    const page = await fetchAfterCursor(collection, nextCursor, pageSize);
    if (!page.length) break;
    out.push(...page);
    pages += 1;
    const lastCursor = resolveCreatedCursor(page[page.length - 1] || {});
    if (!lastCursor || lastCursor <= nextCursor || page.length < pageSize) break;
    nextCursor = lastCursor;
  }
  return { rows: out, pages };
}

function mergeDocs(existing = [], incoming = []) {
  const map = new Map();
  for (const row of existing) {
    const id = String(row && row.id || "").trim();
    if (!id) continue;
    map.set(id, row);
  }
  for (const row of incoming) {
    const id = String(row && row.id || "").trim();
    if (!id) continue;
    map.set(id, row);
  }
  return sortDocsDesc(Array.from(map.values()));
}

async function getCachedRecentByCreatedAt(collection, {
  limit = 1000,
  maxDocs = limit,
  overlapDocs = 300,
  pageSize = 1000,
  refresh = true,
} = {}) {
  const filePath = cacheFilePath(collection);
  const prev = readCacheJson(filePath) || {};
  const keep = Math.max(Number(limit) || 0, Number(maxDocs) || 0, Number(prev.max_docs) || 0, 1);
  let docs = Array.isArray(prev.docs) ? prev.docs : [];
  let source = docs.length ? "cache" : "bootstrap";
  let fetchedNew = 0;
  let overlapFetched = 0;
  let pages = 0;

  if (refresh) {
    if (!docs.length) {
      docs = await fetchRecentOverlap(collection, keep);
      overlapFetched = docs.length;
      source = "bootstrap";
    } else {
      const latestCursor = resolveCreatedCursor(sortDocsDesc(docs)[0] || {});
      let incoming = [];
      if (latestCursor) {
        const fetched = await fetchAllAfterCursor(collection, latestCursor, pageSize);
        incoming = fetched.rows;
        fetchedNew += incoming.length;
        pages += fetched.pages;
      }
      const overlap = await fetchRecentOverlap(collection, Math.min(keep, Math.max(50, overlapDocs)));
      overlapFetched = overlap.length;
      docs = mergeDocs(docs, incoming.concat(overlap));
      source = "cache+refresh";
    }
    docs = sortDocsDesc(docs).slice(0, keep);
    writeCacheJson(filePath, {
      collection,
      updated_at: new Date().toISOString(),
      max_docs: keep,
      latest_created_at: resolveCreatedCursor(docs[0] || {}),
      docs,
    });
  } else {
    docs = sortDocsDesc(docs).slice(0, keep);
  }

  return {
    rows: docs.slice(0, Math.max(1, Number(limit) || 1)),
    meta: {
      collection,
      filePath,
      source,
      count: docs.length,
      returned: Math.min(docs.length, Math.max(1, Number(limit) || 1)),
      fetched_new: fetchedNew,
      overlap_fetched: overlapFetched,
      pages,
      latest_created_at: resolveCreatedCursor(docs[0] || {}),
    },
  };
}

module.exports = {
  CACHE_ROOT,
  cacheFilePath,
  getCachedRecentByCreatedAt,
  readCacheJson,
  resolveCreatedCursor,
  sortDocsDesc,
  writeCacheJson,
  __test: {
    resolveCreatedMs,
    resolveCreatedCursor,
    sortDocsDesc,
    mergeDocs,
  },
};
