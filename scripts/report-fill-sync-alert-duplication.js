#!/usr/bin/env node
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { __test: fillsSyncTest } = require("../src/services/binanceFuturesFillsSync");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.LOOKBACK_DAYS || 7));
const PAGE_SIZE = Math.max(50, Number(process.env.PAGE_SIZE || 500));
const OUT_DIR = path.join(process.cwd(), "ops", "daily");

function nowIso() {
  return new Date().toISOString();
}

function normalizeSymbol(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function normalizeEvent(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function normalizeOrderId(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function isExitLikeEvent(event) {
  const ev = normalizeEvent(event);
  if (!ev) return false;
  return ev.startsWith("EXIT_") || ev === "FORCE_EXIT_ALL" || ev === "FORCE_EXIT_HALF";
}

function isExternalFill(row) {
  const fillId = String(row && (row.fill_id || row.id) || "").trim().toUpperCase();
  return fillId.startsWith("EXT__");
}

function isBackfilledAlertDuplication(row) {
  return !!(row && row.extra && row.extra.alert_duplication_backfilled_at);
}

function buildDuplicateGroups(rows = []) {
  const byKey = new Map();
  const bySymbol = new Map();
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
    const symbol = normalizeSymbol(row.symbol || row.symbol_or_pair_id) || "UNKNOWN";
    const current = byKey.get(key) || {
      key,
      symbol,
      event: normalizeEvent(row.event),
      order_id: normalizeOrderId(row.live_order_id || row.external_order_id || row.order_id),
      fill_count: 0,
      fill_ids: [],
      total_notional: 0,
      total_realized_pnl: 0,
      first_at: row.created_at || null,
      last_at: row.created_at || null,
      backfilled: true,
    };
    current.fill_count += 1;
    current.fill_ids.push(row.fill_id || row.id);
    current.total_notional += Number(row.notional || 0) || 0;
    current.total_realized_pnl += Number(row.realized_pnl || 0) || 0;
    current.first_at = !current.first_at || String(row.created_at || "") < String(current.first_at) ? row.created_at : current.first_at;
    current.last_at = !current.last_at || String(row.created_at || "") > String(current.last_at) ? row.created_at : current.last_at;
    current.backfilled = current.backfilled && isBackfilledAlertDuplication(row);
    byKey.set(key, current);
    bySymbol.set(symbol, (bySymbol.get(symbol) || 0) + 1);
  }

  const duplicateGroups = Array.from(byKey.values())
    .filter((row) => row.fill_count > 1)
    .sort((a, b) => b.fill_count - a.fill_count || String(a.symbol).localeCompare(String(b.symbol)));
  const unresolvedDuplicateGroups = duplicateGroups.filter((row) => !row.backfilled);
  const historicalBackfilledDuplicateGroups = duplicateGroups.filter((row) => row.backfilled);
  const suppressedEstimate = unresolvedDuplicateGroups.reduce((acc, row) => acc + Math.max(0, row.fill_count - 1), 0);

  return {
    bySymbol,
    duplicateGroups,
    unresolvedDuplicateGroups,
    historicalBackfilledDuplicateGroups,
    suppressedEstimate,
  };
}

function buildDuplicationReport(rows = []) {
  const {
    bySymbol,
    duplicateGroups,
    unresolvedDuplicateGroups,
    historicalBackfilledDuplicateGroups,
    suppressedEstimate,
  } = buildDuplicateGroups(rows);
  return {
    generated_at: nowIso(),
    lookback_days: LOOKBACK_DAYS,
    raw_external_exit_fill_n: rows.length,
    unique_alert_group_n: new Set(
      rows.map((row) => fillsSyncTest.buildFillSyncAlertCooldownKey({
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
      }))
    ).size,
    duplicate_group_total_n: duplicateGroups.length,
    duplicate_group_n: unresolvedDuplicateGroups.length,
    historical_backfilled_duplicate_group_n: historicalBackfilledDuplicateGroups.length,
    suppressed_alert_estimate_n: suppressedEstimate,
    by_symbol_raw_fill_n: Object.fromEntries(Array.from(bySymbol.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    top_duplicate_groups: unresolvedDuplicateGroups.slice(0, 30),
    top_duplicate_groups_all: duplicateGroups.slice(0, 100),
    historical_backfilled_duplicate_groups: historicalBackfilledDuplicateGroups.slice(0, 100),
  };
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

async function main() {
  const db = getFirestore();
  const rows = await scanRecentExternalExitFills(db);
  const report = buildDuplicationReport(rows);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "fill_sync_alert_duplication_latest.json");
  const mdPath = path.join(OUT_DIR, `${new Date().toISOString().slice(0, 10)}_fill_sync_alert_duplication.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    "# Fill Sync Alert Duplication Report",
    "",
    `- generated_at: ${report.generated_at}`,
    `- lookback_days: ${report.lookback_days}`,
    `- raw_external_exit_fill_n: ${report.raw_external_exit_fill_n}`,
    `- unique_alert_group_n: ${report.unique_alert_group_n}`,
    `- duplicate_group_total_n: ${report.duplicate_group_total_n}`,
    `- duplicate_group_n: ${report.duplicate_group_n}`,
    `- suppressed_alert_estimate_n: ${report.suppressed_alert_estimate_n}`,
    "",
    "## Top Duplicate Groups",
    "",
    ...report.top_duplicate_groups.map((row) =>
      `- ${row.symbol} ${row.event} order_id=${row.order_id || "NA"} fill_count=${row.fill_count} notional=${row.total_notional.toFixed(4)} pnl=${row.total_realized_pnl.toFixed(4)}`
    ),
    "",
  ].join("\n");
  fs.writeFileSync(mdPath, md);

  console.log(JSON.stringify({ ok: true, json: jsonPath, md: mdPath, report }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_FILL_SYNC_ALERT_DUPLICATION_FAILED:", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      buildDuplicateGroups,
      buildDuplicationReport,
    },
  };
}
