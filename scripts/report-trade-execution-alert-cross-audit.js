#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_LOOKBACK_HOURS || 24));
const PAGE_SIZE = Math.max(100, Number(process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_PAGE_SIZE || 1000));
const MATCH_WINDOW_MS = Math.max(60_000, Number(process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_MATCH_WINDOW_MS || 15 * 60 * 1000));

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function trimOrNull(value) {
  return String(value || "").trim() || null;
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

function classifyEvent(event) {
  const ev = upper(event);
  if (!ev) return "UNKNOWN";
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "EXIT_EXTERNAL_SYNC") return "EXTERNAL_SYNC";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev === "LONG" || ev === "SHORT") return ev;
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return "OTHER";
}

function isEntryStage(stage) {
  const value = upper(stage);
  return value === "LONG" || value === "SHORT";
}

function isUnverifiedEvent(event) {
  return upper(event).endsWith("_UNVERIFIED");
}

function normalizeComparableEvent(event) {
  const value = upper(event);
  if (!value) return null;
  return value.endsWith("_UNVERIFIED") ? value.slice(0, -"_UNVERIFIED".length) : value;
}

function isVerifiedExitFill(fill = {}) {
  return !isEntryStage(fill.stage) && !isUnverifiedEvent(fill.event);
}

function parseTelegramTradeAlertRows(logText = "", sinceMs = 0) {
  const rows = [];
  for (const line of String(logText || "").split(/\r?\n/)) {
    const m = line.match(/^\[(.*?)\]\s+rc=\d+\s+(\{.*\})$/);
    if (!m) continue;
    const tsText = String(m[1] || "").trim();
    const tsMs = Date.parse(tsText.replace(" ", "T"));
    if (!Number.isFinite(tsMs) || tsMs < sinceMs) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(m[2]);
    } catch (_) {
      continue;
    }
    const text = String(parsed && parsed.result && parsed.result.text ? parsed.result.text : "");
    if (!text.includes("이벤트:")) continue;
    if (!/(청산|진입|추가진입|외부 동기화 청산)/.test(text)) continue;
    rows.push({
      ts: new Date(tsMs).toISOString(),
      text,
      source: "telegram_send.log",
    });
  }
  return rows;
}

async function fetchRecentFillRows(db, sinceIso) {
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
      const stage = classifyEvent(row.event);
      if (stage === "OTHER" || stage === "UNKNOWN") continue;
      rows.push({
        fill_id: row.fill_id || doc.id,
        symbol: upper(row.symbol) || "UNKNOWN",
        event: upper(row.event),
        stage,
        created_at: row.created_at || null,
        created_ms: Date.parse(String(row.created_at || "")),
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function pickMatchingAlert(fill, alerts = []) {
  const fillId = trimOrNull(fill && fill.fill_id);
  if (fillId) {
    const bySourceFillId = alerts.filter((alert) => trimOrNull(alert && alert.source_fill_id) === fillId);
    if (bySourceFillId.length) {
      bySourceFillId.sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
      return bySourceFillId[0];
    }
  }
  const fillMs = Number(fill && fill.created_ms);
  if (!Number.isFinite(fillMs)) return null;
  const normalizedFillEvent = normalizeComparableEvent(fill && fill.event);
  let best = null;
  let bestDelta = Infinity;
  for (const alert of alerts) {
    if (upper(alert.symbol) !== fill.symbol) continue;
    if (normalizeComparableEvent(alert.event) !== normalizedFillEvent) continue;
    const tsMs = Date.parse(String(alert.ts || ""));
    if (!Number.isFinite(tsMs)) continue;
    const delta = Math.abs(tsMs - fillMs);
    if (delta > MATCH_WINDOW_MS) continue;
    if (delta < bestDelta) {
      best = alert;
      bestDelta = delta;
    }
  }
  return best;
}

function buildReport({ fills = [], alertAuditRows = [], telegramTradeRows = [], coverageReady = false, auditWindowStartIso = null } = {}) {
  const matched = [];
  const missing = [];
  const missingVerifiedExit = [];
  const missingEntry = [];
  const missingUnverified = [];
  const unmatchedAlerts = [];
  const usedAlertKeys = new Set();
  for (const fill of fills) {
    const match = pickMatchingAlert(fill, alertAuditRows);
    if (match) {
      const key = `${match.ts}|${match.symbol}|${match.event}|${match.title}`;
      usedAlertKeys.add(key);
      matched.push({
        fill_id: fill.fill_id,
        symbol: fill.symbol,
        event: fill.event,
        fill_created_at: fill.created_at,
        alert_ts: match.ts,
        source_fill_id: match.source_fill_id || null,
        title: match.title,
      });
    } else {
      const issue = {
        fill_id: fill.fill_id,
        symbol: fill.symbol,
        event: fill.event,
        fill_created_at: fill.created_at,
      };
      missing.push(issue);
      if (isEntryStage(fill.stage)) missingEntry.push(issue);
      else if (isUnverifiedEvent(fill.event)) missingUnverified.push(issue);
      else if (isVerifiedExitFill(fill)) missingVerifiedExit.push(issue);
    }
  }
  for (const alert of alertAuditRows) {
    const key = `${alert.ts}|${alert.symbol}|${alert.event}|${alert.title}`;
    if (!usedAlertKeys.has(key)) {
      unmatchedAlerts.push({
        ts: alert.ts,
        symbol: alert.symbol,
        event: alert.event,
        source_fill_id: alert.source_fill_id || null,
        title: alert.title,
      });
    }
  }
  return {
    generated_at_iso: nowIso(),
    lookback_hours: LOOKBACK_HOURS,
    match_window_ms: MATCH_WINDOW_MS,
    coverage_ready: coverageReady,
    audit_window_start_iso: auditWindowStartIso,
    fill_n: fills.length,
    matched_fill_n: matched.length,
    missing_alert_fill_n: missing.length,
    missing_verified_exit_alert_fill_n: missingVerifiedExit.length,
    missing_entry_alert_fill_n: missingEntry.length,
    missing_unverified_alert_fill_n: missingUnverified.length,
    unmatched_alert_n: unmatchedAlerts.length,
    telegram_trade_alert_row_n: telegramTradeRows.length,
    audit_trade_alert_row_n: alertAuditRows.length,
    issues: missing.slice(0, 100),
    actionable_issues: missingVerifiedExit.slice(0, 100),
    unmatched_alerts: unmatchedAlerts.slice(0, 100),
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Trade Execution Alert Cross Audit");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- lookback_hours: ${report.lookback_hours || 0}`);
  lines.push(`- coverage_ready: ${report.coverage_ready === true ? "yes" : "no"}`);
  lines.push(`- audit_window_start_iso: ${report.audit_window_start_iso || "N/A"}`);
  lines.push(`- fill_n: ${report.fill_n || 0}`);
  lines.push(`- matched_fill_n: ${report.matched_fill_n || 0}`);
  lines.push(`- missing_alert_fill_n: ${report.missing_alert_fill_n || 0}`);
  lines.push(`- missing_verified_exit_alert_fill_n: ${report.missing_verified_exit_alert_fill_n || 0}`);
  lines.push(`- missing_entry_alert_fill_n: ${report.missing_entry_alert_fill_n || 0}`);
  lines.push(`- missing_unverified_alert_fill_n: ${report.missing_unverified_alert_fill_n || 0}`);
  lines.push(`- unmatched_alert_n: ${report.unmatched_alert_n || 0}`);
  lines.push(`- telegram_trade_alert_row_n: ${report.telegram_trade_alert_row_n || 0}`);
  lines.push(`- audit_trade_alert_row_n: ${report.audit_trade_alert_row_n || 0}`);
  lines.push("");
  lines.push("## Missing Alerts");
  if (!Array.isArray(report.issues) || !report.issues.length) {
    lines.push("- none");
  } else {
    for (const row of report.issues.slice(0, 50)) {
      lines.push(`- ${row.symbol} | ${row.event} | fill=${row.fill_id} | at=${row.fill_created_at || "N/A"}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const db = getFirestore();
  const sinceMs = Date.now() - (LOOKBACK_HOURS * 60 * 60 * 1000);
  const sinceIso = new Date(sinceMs).toISOString();
  const fills = await fetchRecentFillRows(db, sinceIso);
  const auditPath = path.join(repoRoot, "ops", "runtime", "trade_execution_alert_audit.jsonl");
  const telegramLogPath = path.join(repoRoot, "noye", "telegram_send.log");
  const alertAuditRows = readJsonl(auditPath)
    .filter((row) => upper(row.type) === "TRADE_EXECUTION_ALERT")
    .filter((row) => Date.parse(String(row.ts || "")) >= sinceMs)
    .map((row) => ({
      ts: row.ts,
      symbol: upper(row.symbol),
      event: upper(row.event),
      source_fill_id: trimOrNull(row.source_fill_id || row.sourceFillId || row.fill_id || row.fillId),
      title: row.title || null,
      body: row.body || null,
      source: "trade_execution_alert_audit",
    }));
  const telegramTradeRows = parseTelegramTradeAlertRows(
    fs.existsSync(telegramLogPath) ? fs.readFileSync(telegramLogPath, "utf8") : "",
    sinceMs
  );
  const earliestAuditMs = alertAuditRows.reduce((min, row) => {
    const tsMs = Date.parse(String(row.ts || ""));
    if (!Number.isFinite(tsMs)) return min;
    return min == null ? tsMs : Math.min(min, tsMs);
  }, null);
  const coverageReady = Number.isFinite(earliestAuditMs) || telegramTradeRows.length > 0;
  const scopedFills = Number.isFinite(earliestAuditMs)
    ? fills.filter((row) => Number.isFinite(row.created_ms) && row.created_ms >= (earliestAuditMs - MATCH_WINDOW_MS))
    : [];
  const report = buildReport({
    fills: coverageReady ? scopedFills : [],
    alertAuditRows,
    telegramTradeRows,
    coverageReady,
    auditWindowStartIso: Number.isFinite(earliestAuditMs) ? new Date(earliestAuditMs).toISOString() : null,
  });
  const outDir = path.join(repoRoot, "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "trade_execution_alert_cross_audit_latest.json");
  const mdPath = path.join(outDir, `${isoDate()}_trade_execution_alert_cross_audit.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({
    ok: true,
    coverage_ready: report.coverage_ready,
    audit_window_start_iso: report.audit_window_start_iso,
    fill_n: report.fill_n,
    matched_fill_n: report.matched_fill_n,
    missing_alert_fill_n: report.missing_alert_fill_n,
    missing_verified_exit_alert_fill_n: report.missing_verified_exit_alert_fill_n,
    missing_entry_alert_fill_n: report.missing_entry_alert_fill_n,
    missing_unverified_alert_fill_n: report.missing_unverified_alert_fill_n,
    unmatched_alert_n: report.unmatched_alert_n,
    telegram_trade_alert_row_n: report.telegram_trade_alert_row_n,
    audit_trade_alert_row_n: report.audit_trade_alert_row_n,
    output_json: jsonPath,
    output_md: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_TRADE_EXECUTION_ALERT_CROSS_AUDIT_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      classifyEvent,
      normalizeComparableEvent,
      parseTelegramTradeAlertRows,
      pickMatchingAlert,
      buildReport,
    },
  };
}
