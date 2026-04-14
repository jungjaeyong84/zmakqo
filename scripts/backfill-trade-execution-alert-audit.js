#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { __test: tradeAlertTest } = require("../src/services/tradeExecutionAlert");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.TRADE_EXEC_ALERT_AUDIT_BACKFILL_LOOKBACK_HOURS || 24));
const PAGE_SIZE = Math.max(100, Number(process.env.TRADE_EXEC_ALERT_AUDIT_BACKFILL_PAGE_SIZE || 1000));

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return String(fs.readFileSync(filePath, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

async function fetchRecentFills(db, sinceIso) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...(doc.data() || {}) };
      if (upper(row.exchange) !== "BINANCEFUT") continue;
      if (String(row.created_at || "") < sinceIso) continue;
      const event = upper(row.event);
      if (!event || event === "SYNC_FILL") continue;
      const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
      if (extra.alert_duplication_duplicate === true) continue;
      rows.push(row);
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function buildKey({ symbol, event, ts }) {
  return `${upper(symbol)}|${upper(event)}|${String(ts || "").trim()}`;
}

function buildAuditEntry(fill) {
  const payload = {
    exchange: upper(fill.exchange) || "BINANCEFUT",
    symbol: upper(fill.symbol) || "UNKNOWN",
    event: upper(fill.event),
    side: upper(fill.side),
    intent: String(fill.event || "").toUpperCase().startsWith("EXIT_") ? "EXIT" : "ENTRY",
    executionMode: fill.execution_mode || "LIVE",
    notional: Number(fill.notional ?? fill.notional_krw),
    execPrice: Number(fill.exec_price),
    positionSideBefore: upper(fill.position_side || fill.position_side_before),
    positionSideAfter: upper(fill.position_side_after),
    closeRatio: Number(fill.qty_fraction ?? fill.qty_pct),
    qtyPct: Number(fill.qty_pct),
    fullExit: Number(fill.qty_fraction ?? fill.qty_pct) >= 0.999,
    realizedPnl: fill.extra && Number.isFinite(Number(fill.extra.external_realized_pnl))
      ? Number(fill.extra.external_realized_pnl)
      : null,
    appliedLeverage: Number(fill.leverage_applied ?? fill.applied_leverage),
    leverageReason: fill.leverage_reason || "BACKFILL_TRADE_EXECUTION_ALERT_AUDIT",
    exitRules: fill.exit_rules || fill.exitRules || null,
    reason: fill.decision_reason || null,
  };
  const built = tradeAlertTest.buildMessage(payload);
  return {
    ts: fill.created_at || nowIso(),
    type: "TRADE_EXECUTION_ALERT",
    exchange: payload.exchange,
    symbol: payload.symbol,
    event: payload.event,
    intent: payload.intent,
    execution_mode: payload.executionMode,
    channel: "BACKFILL_TRADE_EXECUTION_ALERT_AUDIT",
    title: built && built.title ? built.title : `${payload.symbol} ${payload.event}`,
    body: built && built.body ? built.body : null,
    ok: true,
    skipped: false,
    source: "backfill-trade-execution-alert-audit",
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const auditPath = path.join(repoRoot, "ops", "runtime", "trade_execution_alert_audit.jsonl");
  const db = getFirestore();
  const sinceIso = new Date(Date.now() - (LOOKBACK_HOURS * 60 * 60 * 1000)).toISOString();
  const existingRows = readJsonl(auditPath).filter((row) => upper(row.type) === "TRADE_EXECUTION_ALERT");
  const existingKeys = new Set(existingRows.map((row) => buildKey({ symbol: row.symbol, event: row.event, ts: row.ts })));
  const fills = await fetchRecentFills(db, sinceIso);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  let inserted = 0;
  const insertedRows = [];
  for (const fill of fills) {
    const key = buildKey({ symbol: fill.symbol, event: fill.event, ts: fill.created_at });
    if (existingKeys.has(key)) continue;
    const auditEntry = buildAuditEntry(fill);
    fs.appendFileSync(auditPath, `${JSON.stringify(auditEntry)}\n`, "utf8");
    existingKeys.add(key);
    inserted += 1;
    insertedRows.push({
      fill_id: fill.fill_id || fill.id,
      symbol: upper(fill.symbol),
      event: upper(fill.event),
      ts: fill.created_at || null,
      title: auditEntry.title,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    lookback_hours: LOOKBACK_HOURS,
    fill_n: fills.length,
    inserted_n: inserted,
    audit_path: auditPath,
    rows: insertedRows.slice(0, 100),
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_TRADE_EXECUTION_ALERT_AUDIT_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
