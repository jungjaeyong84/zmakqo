#!/usr/bin/env node
require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { reclassifyExternalFillEvent } = require("../src/storage/fillsPaper");
const { __test: fillsSyncTest } = require("../src/services/binanceFuturesFillsSync");

const PAGE_SIZE = Math.max(1, Number(process.env.PAGE_SIZE || 300));
const APPLY = String(process.env.APPLY || "0") === "1";
const LOOKBACK_DAYS = Math.max(1, Number(process.env.LOOKBACK_DAYS || 14));
const LIMIT = Math.max(0, Number(process.env.LIMIT || 0));

function parseCsv(raw) {
  return String(raw || "")
    .split(/[,\n]/)
    .map((v) => String(v || "").trim().toUpperCase())
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function isForcedEvent(event) {
  if (fillsSyncTest && typeof fillsSyncTest.isAuthoritativeForcedExitIntentEvent === "function") {
    return fillsSyncTest.isAuthoritativeForcedExitIntentEvent(event);
  }
  const ev = String(event || "").trim().toUpperCase();
  return ev === "FORCE_EXIT_ALL" || ev === "FORCE_EXIT_HALF" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL";
}

function isExternalFillCandidate(row, symbolsSet) {
  if (!row || typeof row !== "object") return false;
  if (symbolsSet && symbolsSet.size > 0 && !symbolsSet.has(String(row.symbol || "").trim().toUpperCase())) return false;
  const fillId = String(row.fill_id || "").trim().toUpperCase();
  const event = String(row.event || "").trim().toUpperCase();
  if (!fillId.startsWith("EXT__")) return false;
  if (!row.intent_id) return false;
  if (isForcedEvent(event)) return false;
  if (!event.startsWith("EXIT_")) return false;
  return true;
}

async function loadIntentEvent(db, intentId, cache) {
  const key = String(intentId || "").trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const snap = await db.collection("order_intents_paper").doc(key).get();
  const event = snap.exists ? String((snap.data() || {}).event || "").trim().toUpperCase() || null : null;
  cache.set(key, event);
  return event;
}

async function main() {
  const db = getFirestore();
  const symbolsSet = new Set(parseCsv(process.env.SYMBOLS));
  const fillIds = parseCsv(process.env.FILL_IDS);
  const intentCache = new Map();
  const ts = nowIso();
  const scannedRows = [];

  if (fillIds.length > 0) {
    for (const fillId of fillIds) {
      const snap = await db.collection("fills_paper").doc(fillId).get();
      if (snap.exists) scannedRows.push({ id: snap.id, ...snap.data() });
    }
  } else {
    const sinceMs = Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const sinceIso = new Date(sinceMs).toISOString();
    let last = null;
    let scanned = 0;
    for (;;) {
      let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const row = { id: doc.id, ...doc.data() };
        scanned += 1;
        if (String(row.created_at || "") < sinceIso) {
          last = doc;
          continue;
        }
        scannedRows.push(row);
        if (LIMIT > 0 && scannedRows.length >= LIMIT) break;
      }
      if ((LIMIT > 0 && scannedRows.length >= LIMIT) || snap.size < PAGE_SIZE) break;
      last = snap.docs[snap.docs.length - 1];
    }
  }

  let scanned = 0;
  let matched = 0;
  let updated = 0;
  const results = [];
  const bySymbol = {};

  for (const row of scannedRows) {
    scanned += 1;
    if (!isExternalFillCandidate(row, symbolsSet)) continue;
    const intentEvent = await loadIntentEvent(db, row.intent_id, intentCache);
    if (!isForcedEvent(intentEvent)) continue;
    matched += 1;
    const symbol = String(row.symbol || "UNKNOWN").toUpperCase();
    bySymbol[symbol] = (bySymbol[symbol] || 0) + 1;
    const item = {
      fill_id: row.fill_id || row.id,
      symbol,
      from_event: row.event || null,
      to_event: intentEvent,
      intent_id: row.intent_id || null,
      live_order_id: row.live_order_id || row.external_order_id || null,
      created_at: row.created_at || null,
    };
    results.push(item);
    if (!APPLY) continue;
    const reclassified = await reclassifyExternalFillEvent({
      fillId: row.fill_id || row.id,
      event: intentEvent,
      decisionReason: "MATCHED_FORCED_INTENT_RECLASSIFIED",
      reclassifyReason: "MATCHED_FORCED_INTENT",
      reclassifyScript: "scripts/backfill-authoritative-forced-exit-fills.js",
    });
    if (reclassified && reclassified.ok === true && reclassified.skipped !== true) {
      updated += 1;
    }
  }

  console.log(JSON.stringify({
    apply: APPLY,
    scanned,
    matched,
    updated,
    lookback_days: LOOKBACK_DAYS,
    generated_at: ts,
    by_symbol: bySymbol,
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_AUTHORITATIVE_FORCED_EXIT_FILLS_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
