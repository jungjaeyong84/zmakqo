#!/usr/bin/env node
require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { __test: fillsSyncTest } = require("../src/services/binanceFuturesFillsSync");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.LOOKBACK_DAYS || 7));
const PAGE_SIZE = Math.max(50, Number(process.env.PAGE_SIZE || 500));
const DRY_RUN = ["1", "true", "yes", "y", "on"].includes(String(process.env.DRY_RUN || "").trim().toLowerCase());

function nowIso() {
  return new Date().toISOString();
}

function normalizeOrderId(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function normalizeSymbol(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function isExitLikeEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  return ev.startsWith("EXIT_") || ev === "FORCE_EXIT_ALL" || ev === "FORCE_EXIT_HALF";
}

function isExternalFill(row) {
  const fillId = String(row && (row.fill_id || row.id) || "").trim().toUpperCase();
  return fillId.startsWith("EXT__");
}

async function scanRecentExternalExitFills(db) {
  const rows = [];
  const sinceMs = Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const sinceIso = new Date(sinceMs).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...doc.data() };
      if (String(row.created_at || "") < sinceIso) continue;
      if (!isExternalFill(row)) continue;
      if (!isExitLikeEvent(row.event)) continue;
      rows.push(row);
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function buildDuplicateGroups(rows = []) {
  const byKey = new Map();
  for (const row of rows) {
    const key = fillsSyncTest.buildFillSyncAlertCooldownKey({
      symbol: row.symbol || row.symbol_or_pair_id,
      event: row.event,
      intent: "EXIT",
      side: row.side,
      orderMeta: {
        orderId: normalizeOrderId(row.live_order_id || row.external_order_id || row.order_id),
        clientOrderId: row.client_order_id || null,
      },
      payload: {
        entryEventId: row.entry_event_id || null,
        positionSideBefore: row.position_side_before || row.position_side || null,
      },
    });
    const current = byKey.get(key) || [];
    current.push(row);
    byKey.set(key, current);
  }
  return Array.from(byKey.entries())
    .map(([groupKey, groupRows]) => ({
      groupKey,
      rows: groupRows
        .slice()
        .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id || "").localeCompare(String(b.id || ""))),
    }))
    .filter((item) => item.rows.length > 1);
}

async function applyBackfill(db, duplicateGroups = []) {
  let updated = 0;
  const touchedSymbols = new Set();
  const backfilledAt = nowIso();
  for (const group of duplicateGroups) {
    const batch = db.batch();
    const primary = group.rows[0] || null;
    group.rows.forEach((row, index) => {
      const ref = db.collection("fills_paper").doc(String(row.id));
      batch.set(ref, {
        extra: {
          alert_duplication_group_key: group.groupKey,
          alert_duplication_fill_count: group.rows.length,
          alert_duplication_rank: index + 1,
          alert_duplication_primary: index === 0,
          alert_duplication_duplicate: index > 0,
          alert_duplication_primary_fill_id: primary ? String(primary.fill_id || primary.id || "") : null,
          alert_duplication_backfilled_at: backfilledAt,
        },
      }, { merge: true });
      updated += 1;
      const symbol = normalizeSymbol(row.symbol || row.symbol_or_pair_id);
      if (symbol) touchedSymbols.add(symbol);
    });
    if (!DRY_RUN) await batch.commit();
  }
  return {
    updated,
    touched_symbol_n: touchedSymbols.size,
    touched_symbols: Array.from(touchedSymbols.values()).sort(),
    backfilled_at: backfilledAt,
  };
}

async function main() {
  const db = getFirestore();
  const rows = await scanRecentExternalExitFills(db);
  const duplicateGroups = buildDuplicateGroups(rows);
  const applied = await applyBackfill(db, duplicateGroups);
  console.log(JSON.stringify({
    ok: true,
    dry_run: DRY_RUN,
    lookback_days: LOOKBACK_DAYS,
    scanned_rows: rows.length,
    duplicate_group_n: duplicateGroups.length,
    ...applied,
    sample_groups: duplicateGroups.slice(0, 20).map((group) => ({
      group_key: group.groupKey,
      symbol: normalizeSymbol(group.rows[0] && (group.rows[0].symbol || group.rows[0].symbol_or_pair_id)),
      event: String(group.rows[0] && group.rows[0].event || "").trim().toUpperCase() || null,
      fill_count: group.rows.length,
      fill_ids: group.rows.map((row) => row.fill_id || row.id),
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_FILL_SYNC_ALERT_DUPLICATION_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
