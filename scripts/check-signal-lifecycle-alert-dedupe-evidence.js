#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const SELECT_FIELDS = Object.freeze([
  "created_at",
  "updated_at",
  "sent_at",
  "type",
  "status",
  "exchange",
  "symbol",
  "tf",
  "event",
  "signal_id",
  "reason",
  "dedupe_key",
  "payload",
]);

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function parseBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function positiveNumberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function resolveObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveSignalId(row = {}) {
  const payload = resolveObject(row.payload);
  return trimOrNull(
    row.signal_id
    || row.signalId
    || row.signal_doc_id
    || payload.signal_id
    || payload.signalId
    || payload.signal_doc_id
  );
}

function normalizeRow(row = {}) {
  const payload = resolveObject(row.payload);
  return {
    id: trimOrNull(row.id || row.signal_lifecycle_alert_outbox_id),
    type: upper(row.type || payload.type),
    status: upper(row.status),
    exchange: upper(row.exchange || payload.exchange || "BINANCEFUT"),
    symbol: upper(row.symbol || payload.symbol),
    tf: trimOrNull(row.tf || payload.tf),
    event: upper(row.event || payload.event),
    signal_id: resolveSignalId(row),
    reason: upper(row.reason || payload.reason || payload.decisionReason || payload.decision_reason),
    dedupe_key: trimOrNull(row.dedupe_key || payload.dedupeKey || payload.dedupe_key),
    created_at: trimOrNull(row.created_at),
    sent_at: trimOrNull(row.sent_at),
  };
}

function semanticAlertKey(row = {}) {
  const r = normalizeRow(row);
  return [
    r.signal_id || "NO_SIGNAL_ID",
    r.type || "NO_TYPE",
    r.exchange || "NO_EXCHANGE",
    r.symbol || "NO_SYMBOL",
    r.tf || "NO_TF",
    r.event || "NO_EVENT",
    r.reason || "NO_REASON",
  ].join("__");
}

function compactIssueRows(groups = []) {
  return groups.slice(0, 100).map((group) => ({
    issue: group.issue,
    key: group.key,
    signal_id: group.signal_id || null,
    sent_n: group.sent_n,
    row_n: group.rows.length,
    rows: group.rows.slice(0, 8).map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      symbol: row.symbol,
      tf: row.tf,
      event: row.event,
      reason: row.reason,
      sent_at: row.sent_at,
      created_at: row.created_at,
    })),
  }));
}

function buildReport({ rows = [], sinceIso = null, generatedAtIso = nowIso() } = {}) {
  const normalized = (Array.isArray(rows) ? rows : []).map(normalizeRow);
  const sentRows = normalized.filter((row) => row.status === "SENT");
  const exactGroups = new Map();
  const signalGroups = new Map();

  for (const row of sentRows) {
    const key = semanticAlertKey(row);
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key).push(row);

    if (row.signal_id) {
      if (!signalGroups.has(row.signal_id)) signalGroups.set(row.signal_id, []);
      signalGroups.get(row.signal_id).push(row);
    }
  }

  const issueGroups = [];
  for (const [key, groupRows] of exactGroups.entries()) {
    if (groupRows.length <= 1) continue;
    issueGroups.push({
      issue: "SIGNAL_LIFECYCLE_ALERT_DUPLICATE_SENT",
      key,
      signal_id: groupRows[0] && groupRows[0].signal_id,
      sent_n: groupRows.length,
      rows: groupRows,
    });
  }

  for (const [signalId, groupRows] of signalGroups.entries()) {
    const sentTypes = new Set(groupRows.map((row) => row.type).filter(Boolean));
    if (sentTypes.has("DROPPED") && sentTypes.has("PROGRESSED")) {
      issueGroups.push({
        issue: "SIGNAL_LIFECYCLE_ALERT_CONFLICT_DROPPED_AND_PROGRESSED",
        key: signalId,
        signal_id: signalId,
        sent_n: groupRows.length,
        rows: groupRows,
      });
    }
  }

  const issueCodeCounts = {};
  for (const group of issueGroups) {
    issueCodeCounts[group.issue] = (issueCodeCounts[group.issue] || 0) + 1;
  }
  const blockers = [];
  if (issueGroups.length > 0) blockers.push("SIGNAL_LIFECYCLE_ALERT:DEDUP_OR_CONFLICT_EVIDENCE");

  return {
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "SIGNAL_LIFECYCLE_ALERT_DEDUPE_EVIDENCE_PASS"
      : "SIGNAL_LIFECYCLE_ALERT_DEDUPE_EVIDENCE_BLOCKED",
    blockers,
    generated_at_iso: generatedAtIso,
    since_iso: sinceIso,
    checked_row_n: normalized.length,
    checked_sent_row_n: sentRows.length,
    issue_row_n: issueGroups.length,
    issue_code_counts: issueCodeCounts,
    issues: compactIssueRows(issueGroups),
  };
}

function resolveSinceIso(env = process.env) {
  const explicit = trimOrNull(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_ENFORCE_AFTER_ISO);
  if (explicit) {
    const parsed = Date.parse(explicit);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const lookbackHours = positiveNumberOrDefault(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_LOOKBACK_HOURS, 24);
  return new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
}

function resolveOutDir(env = process.env) {
  return path.resolve(trimOrNull(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_OUTPUT_DIR) || path.join(process.cwd(), "ops", "daily"));
}

async function fetchRows({ db, sinceIso, limit = 1000 } = {}) {
  const rows = [];
  let last = null;
  for (;;) {
    let query = db.collection("signal_lifecycle_alert_outbox")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .select(...SELECT_FIELDS)
      .limit(limit);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) rows.push({ id: doc.id, ...(doc.data() || {}) });
    if (snap.size < limit) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function main(env = process.env) {
  const sinceIso = resolveSinceIso(env);
  const pageSize = Math.max(100, positiveNumberOrDefault(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_PAGE_SIZE, 1000));
  const rows = parseBool(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_FIXTURE_EMPTY, false)
    ? []
    : await fetchRows({ db: getFirestore(), sinceIso, limit: pageSize });
  const report = buildReport({ rows, sinceIso });
  const outDir = resolveOutDir(env);
  fs.mkdirSync(outDir, { recursive: true });
  const latestPath = path.join(outDir, "signal_lifecycle_alert_dedupe_evidence_latest.json");
  const datedPath = path.join(outDir, `${isoDate()}_signal_lifecycle_alert_dedupe_evidence.json`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const line = JSON.stringify({ ...report, output_json: latestPath, output_dated_json: datedPath });
  if (report.ok !== true && parseBool(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_SOFT, false) !== true) {
    if (parseBool(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_QUIET, false) !== true) console.error(line);
    process.exitCode = 1;
    return report;
  }
  if (parseBool(env.SIGNAL_LIFECYCLE_ALERT_DEDUPE_QUIET, false) !== true) console.log(line);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "SIGNAL_LIFECYCLE_ALERT_DEDUPE_EVIDENCE_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      buildReport,
      normalizeRow,
      semanticAlertKey,
      resolveSinceIso,
      resolveOutDir,
      SELECT_FIELDS,
    },
  };
}
