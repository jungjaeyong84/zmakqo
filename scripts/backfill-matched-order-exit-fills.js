#!/usr/bin/env node
require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { reclassifyExternalFillEvent } = require("../src/storage/fillsPaper");

const PAGE_SIZE = Math.max(50, Number(process.env.PAGE_SIZE || 500));
const LOOKBACK_DAYS = Math.max(1, Number(process.env.LOOKBACK_DAYS || 30));
const APPLY = String(process.env.APPLY || "0") === "1";
const LIMIT = Math.max(0, Number(process.env.LIMIT || 0));

function nowIso() {
  return new Date().toISOString();
}

function normalizeSymbol(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function normalizeOrderId(v) {
  return Number.isFinite(Number(v)) ? String(Number(v)) : null;
}

function normalizeEvent(v) {
  return String(v || "").trim().toUpperCase() || null;
}

function parseCsv(raw) {
  return String(raw || "")
    .split(/[,\n]/)
    .map((v) => normalizeSymbol(v))
    .filter(Boolean);
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

function pickFinite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function approxMatches(sumValue, targetValue, { abs = 1e-8, rel = 0.05 } = {}) {
  const left = pickFinite(sumValue);
  const right = pickFinite(targetValue);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  const diff = Math.abs(left - right);
  if (diff <= abs) return true;
  const denom = Math.max(Math.abs(right), abs);
  return (diff / denom) <= rel;
}

async function scanRecentFills(db, { symbolsSet }) {
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
      const symbol = normalizeSymbol(row.symbol || row.symbol_or_pair_id);
      if (symbolsSet.size > 0 && !symbolsSet.has(symbol)) continue;
      rows.push(row);
      if (LIMIT > 0 && rows.length >= LIMIT) return rows;
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function buildOrderGroups(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const exchange = normalizeSymbol(row.exchange);
    const symbol = normalizeSymbol(row.symbol || row.symbol_or_pair_id);
    const orderId = normalizeOrderId(row.live_order_id || row.external_order_id || row.order_id);
    if (!exchange || !symbol || !orderId) continue;
    const key = `${exchange}|${symbol}|${orderId}`;
    const current = groups.get(key) || { exchange, symbol, orderId, internal: [], external: [] };
    if (isExternalFill(row)) current.external.push(row);
    else current.internal.push(row);
    groups.set(key, current);
  }
  return groups;
}

function selectAuthoritativeInternalFill(group) {
  const internalExitRows = (group.internal || [])
    .filter((row) => isExitLikeEvent(row.event))
    .filter((row) => row.intent_id || row.signal_id)
    .sort((a, b) => String(a.updated_at || a.created_at || "").localeCompare(String(b.updated_at || b.created_at || "")));
  if (internalExitRows.length !== 1) return null;
  return internalExitRows[0];
}

function buildCandidates(group) {
  const authoritative = selectAuthoritativeInternalFill(group);
  if (!authoritative) return [];
  const targetEvent = normalizeEvent(authoritative.event);
  const targetIntentId = String(authoritative.intent_id || "").trim() || null;
  const targetSignalId = String(authoritative.signal_id || authoritative.signal_doc_id || "").trim() || null;
  const targetSignalDocId = String(authoritative.signal_doc_id || authoritative.signal_id || "").trim() || null;
  if (!targetEvent || !targetIntentId || !targetSignalId) return [];

  const externalRows = (group.external || []).filter((row) => isExitLikeEvent(row.event));
  if (!externalRows.length) return [];

  const sumExternalQty = externalRows.reduce((acc, row) => acc + (pickFinite(row.exec_qty_base) || 0), 0);
  const sumExternalNotional = externalRows.reduce((acc, row) => acc + (pickFinite(row.notional) || 0), 0);
  const qtySafe = approxMatches(sumExternalQty, authoritative.exec_qty_base);
  const notionalSafe = approxMatches(sumExternalNotional, authoritative.notional);
  if (!qtySafe && !notionalSafe) return [];

  return externalRows
    .filter((row) => {
      const currentEvent = normalizeEvent(row.event);
      const currentIntentId = String(row.intent_id || "").trim() || null;
      const currentSignalId = String(row.signal_id || row.signal_doc_id || "").trim() || null;
      return currentEvent !== targetEvent || currentIntentId !== targetIntentId || currentSignalId !== targetSignalId;
    })
    .map((row) => ({
      fill_id: row.fill_id || row.id,
      exchange: group.exchange,
      symbol: group.symbol,
      order_id: group.orderId,
      from_event: row.event || null,
      to_event: targetEvent,
      from_intent_id: row.intent_id || null,
      to_intent_id: targetIntentId,
      from_signal_id: row.signal_id || row.signal_doc_id || null,
      to_signal_id: targetSignalId,
      qty_base: row.exec_qty_base || null,
      notional: row.notional || null,
      authoritative_fill_id: authoritative.fill_id || authoritative.id || null,
      authoritative_event: targetEvent,
      authoritative_intent_id: targetIntentId,
      authoritative_signal_id: targetSignalId,
      authoritative_signal_doc_id: targetSignalDocId,
      reason: "MATCHED_INTERNAL_BINANCE_ORDER_FILL",
    }));
}

async function main() {
  const db = getFirestore();
  const symbolsSet = new Set(parseCsv(process.env.SYMBOLS));
  const rows = await scanRecentFills(db, { symbolsSet });
  const groups = buildOrderGroups(rows);
  const candidates = [];
  for (const group of groups.values()) {
    candidates.push(...buildCandidates(group));
  }

  let updated = 0;
  if (APPLY) {
    for (const item of candidates) {
      const res = await reclassifyExternalFillEvent({
        fillId: item.fill_id,
        event: item.to_event,
        intentId: item.to_intent_id,
        signalId: item.to_signal_id,
        signalDocId: item.authoritative_signal_doc_id,
        decisionReason: "MATCHED_BINANCE_ORDER_EVENT_RECLASSIFIED",
        reclassifyReason: item.reason,
        reclassifyScript: "scripts/backfill-matched-order-exit-fills.js",
      });
      if (res && res.ok === true && res.skipped !== true) updated += 1;
    }
  }

  const bySymbol = {};
  for (const item of candidates) {
    bySymbol[item.symbol] = (bySymbol[item.symbol] || 0) + 1;
  }

  console.log(JSON.stringify({
    generated_at: nowIso(),
    apply: APPLY,
    lookback_days: LOOKBACK_DAYS,
    scanned_rows: rows.length,
    grouped_orders: groups.size,
    candidate_n: candidates.length,
    updated,
    by_symbol: bySymbol,
    candidates,
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_MATCHED_ORDER_EXIT_FILLS_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
