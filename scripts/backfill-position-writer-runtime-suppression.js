#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.POSITION_WRITER_RUNTIME_SUPPRESSION_LOOKBACK_HOURS || 24));
const PAGE_SIZE = Math.max(50, Number(process.env.POSITION_WRITER_RUNTIME_SUPPRESSION_PAGE_SIZE || 300));
const DRY_RUN = ["1", "true", "yes", "y", "on"].includes(String(process.env.DRY_RUN || "").trim().toLowerCase());
const TARGET_CODES = new Set(
  String(process.env.POSITION_WRITER_RUNTIME_SUPPRESSION_CODES || "POSITION_WRITE_TOKEN_MISMATCH")
    .split(",")
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
);
const TARGET_SOURCES = new Set(
  String(process.env.POSITION_WRITER_RUNTIME_SUPPRESSION_SOURCES || "INTENT_FILL,BINANCE_FUTURES_POSITION_SYNC,BAR_LOOP_OBSERVATION,TP1_SKIP_PROTECT")
    .split(",")
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
);

async function scanTargetEvents(db) {
  const rows = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_HOURS * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("position_writer_authority_events").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const createdAt = String(data.created_at || "");
      if (!createdAt || createdAt < sinceIso) continue;
      const code = String(data.code || "").trim().toUpperCase();
      const source = String(data.source || "").trim().toUpperCase();
      if (!TARGET_CODES.has(code)) continue;
      if (TARGET_SOURCES.size && !TARGET_SOURCES.has(source)) continue;
      if (data.runtime_family_suppressed === true) continue;
      if (data.resolved_at) continue;
      rows.push({
        docId: doc.id,
        created_at: createdAt,
        code,
        source,
        symbol: String(data.symbol || "").trim().toUpperCase() || null,
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function main() {
  const db = getFirestore();
  const rows = await scanTargetEvents(db);
  const nowIso = new Date().toISOString();
  let updated = 0;
  const byCode = {};
  const bySymbol = {};
  for (const row of rows) {
    byCode[row.code] = (byCode[row.code] || 0) + 1;
    if (row.symbol) bySymbol[row.symbol] = (bySymbol[row.symbol] || 0) + 1;
    if (DRY_RUN) continue;
    await db.collection("position_writer_authority_events").doc(row.docId).set({
      runtime_family_suppressed: true,
      runtime_family_suppressed_reason: "TRANSIENT_RETRY_RECOVERED",
      runtime_family_suppressed_at: nowIso,
      updated_at: nowIso,
    }, { merge: true });
    updated += 1;
  }
  console.log(JSON.stringify({
    ok: true,
    dry_run: DRY_RUN,
    lookback_hours: LOOKBACK_HOURS,
    scanned_target_n: rows.length,
    updated,
    target_codes: Array.from(TARGET_CODES.values()),
    target_sources: Array.from(TARGET_SOURCES.values()),
    top_codes: Object.entries(byCode).sort((a, b) => b[1] - a[1]).slice(0, 20),
    top_symbols: Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 20),
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_POSITION_WRITER_RUNTIME_SUPPRESSION_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
