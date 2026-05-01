#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_LOOKBACK_HOURS || 24));
const PAGE_SIZE = Math.max(100, Number(process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_PAGE_SIZE || 1000));
const MATCH_WINDOW_MS = Math.max(60_000, Number(process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_MATCH_WINDOW_MS || 15 * 60 * 1000));
const FILL_SELECT_FIELDS = Object.freeze([
  "fill_id",
  "exchange",
  "symbol",
  "event",
  "created_at",
  "canonical_primary_transition_event",
  "canonical_transition_events",
  "canonical_event",
  "canonical_exit_event",
  "canonical_stage",
  "canonical_exit_stage",
  "simplified_exit_v2_enabled",
  "simplifiedExitV2Enabled",
  "extra",
]);
const OUTBOX_SELECT_FIELDS = Object.freeze([
  "created_at",
  "updated_at",
  "sent_at",
  "type",
  "status",
  "exchange",
  "symbol",
  "event",
  "source_fill_id",
  "dedupe_key",
  "last_title",
  "last_body",
  "canonical_transition_events",
  "canonical_primary_transition_event",
  "canonical_event",
  "canonical_stage",
  "simplified_exit_v2_enabled",
  "payload",
]);

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

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function classifyEvent(event) {
  const ev = upper(event);
  if (!ev) return "UNKNOWN";
  if (ev.startsWith("EXIT_TP_P0")) return "TP1";
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

function isSimplifiedExitV2Row(row = {}) {
  return row.simplified_exit_v2_enabled === true || row.simplifiedExitV2Enabled === true;
}

function resolveCanonicalTransitionEvents(row = {}) {
  const items = [];
  if (Array.isArray(row.canonicalTransitionEvents)) items.push(...row.canonicalTransitionEvents);
  if (Array.isArray(row.canonical_transition_events)) items.push(...row.canonical_transition_events);
  const primary = trimOrNull(row.canonicalTransitionEvent || row.canonical_primary_transition_event);
  if (primary) items.unshift(primary);
  const seen = new Set();
  return items
    .map((item) => upper(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function resolveObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveOutboxPayload(row = {}) {
  return resolveObject(row.payload);
}

function resolveOutboxCanonicalTransitionEvents(row = {}) {
  const payload = resolveOutboxPayload(row);
  return resolveCanonicalTransitionEvents({
    canonicalTransitionEvents: row.canonicalTransitionEvents
      || row.canonical_transition_events
      || payload.canonicalTransitionEvents
      || payload.canonical_transition_events,
    canonical_transition_events: row.canonical_transition_events
      || payload.canonical_transition_events
      || payload.canonicalTransitionEvents,
    canonicalTransitionEvent: row.canonicalTransitionEvent
      || row.canonical_primary_transition_event
      || payload.canonicalTransitionEvent
      || payload.canonical_transition_event
      || payload.canonical_primary_transition_event,
    canonical_primary_transition_event: row.canonical_primary_transition_event
      || payload.canonical_primary_transition_event
      || payload.canonicalTransitionEvent
      || payload.canonical_transition_event,
  });
}

function normalizeOutboxAlertRow(row = {}, { id = null } = {}) {
  const payload = resolveOutboxPayload(row);
  const ts = row.sent_at || row.updated_at || row.created_at || payload.sent_at || payload.updated_at || payload.created_at || null;
  return {
    id: id || row.id || null,
    ts,
    symbol: upper(row.symbol || payload.symbol),
    event: upper(row.event || payload.event),
    canonical_event: upper(
      row.canonical_event
        || payload.canonical_event
        || payload.canonicalExitEvent
        || payload.canonical_exit_event
    ),
    canonical_stage: upper(
      row.canonical_stage
        || payload.canonical_stage
        || payload.canonicalExitStage
        || payload.canonical_exit_stage
    ),
    canonical_transition_events: resolveOutboxCanonicalTransitionEvents(row),
    simplified_exit_v2_enabled: row.simplified_exit_v2_enabled === true
      || row.simplifiedExitV2Enabled === true
      || payload.simplified_exit_v2_enabled === true
      || payload.simplifiedExitV2Enabled === true,
    source_fill_id: trimOrNull(
      row.source_fill_id
        || payload.sourceFillId
        || payload.source_fill_id
        || payload.fillId
        || payload.fill_id
    ),
    dedupe_key: trimOrNull(
      row.dedupe_key
        || payload.tradeAlertDedupeKey
        || payload.trade_alert_dedupe_key
        || payload.dedupeKey
        || payload.dedupe_key
        || payload.idempotencyKey
        || payload.idempotency_key
    ),
    title: row.last_title || payload.title || null,
    body: row.last_body || payload.body || null,
    source: "trade_alert_outbox",
  };
}

function hasForbiddenSimplifiedExitV2Transition(row = {}) {
  if (isSimplifiedExitV2Row(row) !== true) return false;
  return resolveCanonicalTransitionEvents(row).some((item) => item === "TRAIL_PARTIAL");
}

function resolveComparableAuditEvent(row = {}) {
  const canonicalEvent = normalizeComparableEvent(row.canonical_event || row.canonicalExitEvent || row.canonical_exit_event);
  if (isSimplifiedExitV2Row(row) === true && canonicalEvent && resolveCanonicalTransitionEvents(row).length > 0) {
    return canonicalEvent;
  }
  return normalizeComparableEvent(row.event);
}

function buildFillGroupKey(fill = {}) {
  const symbol = upper(fill.symbol);
  const event = resolveComparableAuditEvent(fill);
  const createdAt = trimOrNull(fill.created_at || fill.fill_created_at);
  if (!symbol || !event || !createdAt) return null;
  return [symbol, event, createdAt].join("|");
}

function isVerifiedExitFill(fill = {}) {
  return !isEntryStage(fill.stage) && !isUnverifiedEvent(fill.event);
}

function hasCanonicalExitTransition(fill = {}) {
  return resolveCanonicalTransitionEvents(fill).length > 0;
}

function isActionableVerifiedExitFill(fill = {}) {
  return isVerifiedExitFill(fill)
    && hasCanonicalExitTransition(fill)
    && hasForbiddenSimplifiedExitV2Transition(fill) !== true;
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
    let q = db.collection("fills_paper")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .select(...FILL_SELECT_FIELDS)
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...(doc.data() || {}) };
      if (upper(row.exchange) !== "BINANCEFUT") continue;
      const stage = classifyEvent(row.event);
      if (stage === "OTHER" || stage === "UNKNOWN") continue;
      rows.push({
        fill_id: row.fill_id || doc.id,
        symbol: upper(row.symbol) || "UNKNOWN",
        event: upper(row.event),
        stage,
        created_at: row.created_at || null,
        created_ms: Date.parse(String(row.created_at || "")),
        canonicalTransitionEvent: row.canonical_primary_transition_event
          || (row.extra && row.extra.canonical_primary_transition_event)
          || null,
        canonicalTransitionEvents: Array.isArray(row.canonical_transition_events)
          ? row.canonical_transition_events
          : (Array.isArray(row.extra && row.extra.canonical_transition_events) ? row.extra.canonical_transition_events : []),
        canonical_event: upper(row.canonical_exit_event || (row.extra && row.extra.canonical_exit_event)),
        canonical_stage: upper(row.canonical_exit_stage || (row.extra && row.extra.canonical_exit_stage)),
        simplified_exit_v2_enabled: row.simplified_exit_v2_enabled === true
          || row.simplifiedExitV2Enabled === true
          || (row.extra && (row.extra.simplified_exit_v2_enabled === true || row.extra.simplifiedExitV2Enabled === true)),
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function fetchRecentOutboxAlertRows(db, sinceMs) {
  const rows = [];
  let last = null;
  const sinceIso = new Date(sinceMs).toISOString();
  for (;;) {
    let q = db.collection("trade_alert_outbox")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .select(...OUTBOX_SELECT_FIELDS)
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...(doc.data() || {}) };
      if (upper(row.type) !== "TRADE_EXECUTION_ALERT") continue;
      if (upper(row.status) !== "SENT") continue;
      const ts = row.sent_at || row.updated_at || row.created_at || null;
      const tsMs = toMs(ts);
      if (!Number.isFinite(tsMs) || tsMs < sinceMs) continue;
      rows.push({
        ...normalizeOutboxAlertRow(row, { id: doc.id }),
        ts: new Date(tsMs).toISOString(),
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function dedupeAlertAuditRows(rows = []) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = [
      trimOrNull(row && row.ts),
      upper(row && row.symbol),
      upper(row && row.event),
      trimOrNull(row && row.source_fill_id),
      trimOrNull(row && row.title),
      trimOrNull(row && row.source),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
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
  const fillGroupKey = buildFillGroupKey(fill);
  if (fillGroupKey) {
    const byDedupeKey = alerts.filter((alert) => trimOrNull(alert && alert.dedupe_key) === fillGroupKey);
    if (byDedupeKey.length) {
      byDedupeKey.sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
      return byDedupeKey[0];
    }
  }
  const fillMs = Number(fill && fill.created_ms);
  if (!Number.isFinite(fillMs)) return null;
  const normalizedFillEvent = resolveComparableAuditEvent(fill);
  let best = null;
  let bestDelta = Infinity;
  for (const alert of alerts) {
    if (upper(alert.symbol) !== fill.symbol) continue;
    if (resolveComparableAuditEvent(alert) !== normalizedFillEvent) continue;
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
      else if (isActionableVerifiedExitFill(fill)) missingVerifiedExit.push(issue);
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
  const missingNonActionable = Math.max(
    0,
    missing.length - missingVerifiedExit.length
  );
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
    missing_non_actionable_alert_fill_n: missingNonActionable,
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
  lines.push(`- missing_non_actionable_alert_fill_n: ${report.missing_non_actionable_alert_fill_n || 0}`);
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
  const ciNoExchangeIo = String(process.env.EXIT_INTEGRITY_CI_NO_EXCHANGE_IO || "").trim() === "1";
  if (ciNoExchangeIo) {
    const report = buildReport({
      fills: [],
      alertAuditRows: [],
      telegramTradeRows: [],
      coverageReady: false,
      auditWindowStartIso: null,
    });
    const outDir = path.join(repoRoot, "ops", "daily");
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, "trade_execution_alert_cross_audit_latest.json");
    const mdPath = path.join(outDir, `${isoDate()}_trade_execution_alert_cross_audit.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(mdPath, buildMarkdown(report), "utf8");
    console.log(JSON.stringify({
      ok: true,
      coverage_ready: false,
      audit_window_start_iso: null,
      fill_n: 0,
      matched_fill_n: 0,
      missing_alert_fill_n: 0,
      missing_verified_exit_alert_fill_n: 0,
      missing_non_actionable_alert_fill_n: 0,
      missing_entry_alert_fill_n: 0,
      missing_unverified_alert_fill_n: 0,
      unmatched_alert_n: 0,
      telegram_trade_alert_row_n: 0,
      audit_trade_alert_row_n: 0,
      outbox_trade_alert_row_n: 0,
      output_json: jsonPath,
      output_md: mdPath,
      mode: "CI_NO_EXCHANGE_IO",
    }, null, 2));
    return;
  }
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
      canonical_event: upper(row.canonical_event),
      canonical_stage: upper(row.canonical_stage),
      canonical_transition_events: Array.isArray(row.canonical_transition_events) ? row.canonical_transition_events : [],
      simplified_exit_v2_enabled: row.simplified_exit_v2_enabled === true,
      source_fill_id: trimOrNull(row.source_fill_id || row.sourceFillId || row.fill_id || row.fillId),
      dedupe_key: trimOrNull(row.dedupe_key || row.dedupeKey),
      title: row.title || null,
      body: row.body || null,
      source: "trade_execution_alert_audit",
    }));
  const outboxAlertRows = await fetchRecentOutboxAlertRows(db, sinceMs);
  const telegramTradeRows = parseTelegramTradeAlertRows(
    fs.existsSync(telegramLogPath) ? fs.readFileSync(telegramLogPath, "utf8") : "",
    sinceMs
  );
  const mergedAlertAuditRows = dedupeAlertAuditRows(alertAuditRows.concat(outboxAlertRows));
  const earliestAuditMs = alertAuditRows.reduce((min, row) => {
    const tsMs = Date.parse(String(row.ts || ""));
    if (!Number.isFinite(tsMs)) return min;
    return min == null ? tsMs : Math.min(min, tsMs);
  }, null);
  const earliestMergedAuditMs = mergedAlertAuditRows.reduce((min, row) => {
    const tsMs = Date.parse(String(row.ts || ""));
    if (!Number.isFinite(tsMs)) return min;
    return min == null ? tsMs : Math.min(min, tsMs);
  }, null);
  const coverageReady = Number.isFinite(earliestMergedAuditMs) || telegramTradeRows.length > 0;
  const scopedFills = Number.isFinite(earliestMergedAuditMs)
    ? fills.filter((row) => Number.isFinite(row.created_ms) && row.created_ms >= (earliestMergedAuditMs - MATCH_WINDOW_MS))
    : [];
  const report = buildReport({
    fills: coverageReady ? scopedFills : [],
    alertAuditRows: mergedAlertAuditRows,
    telegramTradeRows,
    coverageReady,
    auditWindowStartIso: Number.isFinite(earliestMergedAuditMs) ? new Date(earliestMergedAuditMs).toISOString() : null,
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
    missing_non_actionable_alert_fill_n: report.missing_non_actionable_alert_fill_n,
    missing_entry_alert_fill_n: report.missing_entry_alert_fill_n,
    missing_unverified_alert_fill_n: report.missing_unverified_alert_fill_n,
    unmatched_alert_n: report.unmatched_alert_n,
    telegram_trade_alert_row_n: report.telegram_trade_alert_row_n,
    audit_trade_alert_row_n: report.audit_trade_alert_row_n,
    outbox_trade_alert_row_n: outboxAlertRows.length,
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
      resolveComparableAuditEvent,
      parseTelegramTradeAlertRows,
      pickMatchingAlert,
      buildReport,
      dedupeAlertAuditRows,
      hasCanonicalExitTransition,
      hasForbiddenSimplifiedExitV2Transition,
      isActionableVerifiedExitFill,
      normalizeOutboxAlertRow,
      resolveOutboxCanonicalTransitionEvents,
      FILL_SELECT_FIELDS,
      OUTBOX_SELECT_FIELDS,
    },
  };
}
