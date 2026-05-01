#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

function positiveNumberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PAGE_SIZE = Math.max(100, positiveNumberOrDefault(process.env.TRADE_ALERT_OUTBOX_LINEAGE_PAGE_SIZE, 1000));
const DEFAULT_LOOKBACK_HOURS = Math.max(1, positiveNumberOrDefault(process.env.TRADE_ALERT_OUTBOX_LINEAGE_LOOKBACK_HOURS, 24));
const SELECT_FIELDS = Object.freeze([
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
  "entry_event_id",
  "order_id",
  "client_order_id",
  "raw_evidence_event",
  "canonical_event",
  "canonical_stage",
  "canonical_transition_events",
  "canonical_primary_transition_event",
  "simplified_exit_v2_enabled",
  "payload",
]);

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function normalizeBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function resolveObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringList(values = []) {
  const raw = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const value = upper(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function includesAll(actual = [], expected = []) {
  const actualSet = new Set(normalizeStringList(actual));
  return normalizeStringList(expected).every((item) => actualSet.has(item));
}

function resolvePayloadEvidence(row = {}) {
  const payload = resolveObject(row.payload);
  const transitions = normalizeStringList([
    ...(Array.isArray(payload.canonicalTransitionEvents) ? payload.canonicalTransitionEvents : []),
    ...(Array.isArray(payload.canonical_transition_events) ? payload.canonical_transition_events : []),
    payload.canonicalTransitionEvent,
    payload.canonical_primary_transition_event,
  ]);
  return {
    source_fill_id: trimOrNull(payload.sourceFillId || payload.source_fill_id || payload.fillId || payload.fill_id),
    dedupe_key: trimOrNull(
      payload.tradeAlertDedupeKey
      || payload.trade_alert_dedupe_key
      || payload.dedupeKey
      || payload.dedupe_key
      || payload.idempotencyKey
      || payload.idempotency_key
    ),
    entry_event_id: trimOrNull(payload.entryEventId || payload.entry_event_id),
    order_id: trimOrNull(payload.orderId || payload.order_id),
    client_order_id: trimOrNull(payload.clientOrderId || payload.client_order_id),
    raw_evidence_event: upper(payload.rawEvidenceEvent || payload.raw_evidence_event || payload.event),
    canonical_event: upper(payload.canonicalExitEvent || payload.canonical_exit_event || payload.canonicalEvent || payload.canonical_event),
    canonical_stage: upper(payload.canonicalExitStage || payload.canonical_exit_stage || payload.canonicalStage || payload.canonical_stage),
    canonical_transition_events: transitions,
    canonical_primary_transition_event: upper(payload.canonicalTransitionEvent || payload.canonical_primary_transition_event || transitions[0]),
    simplified_exit_v2_enabled: payload.simplifiedExitV2Enabled === true || payload.simplified_exit_v2_enabled === true,
  };
}

function isExitLike(row = {}) {
  const event = upper(row.event);
  const payload = resolvePayloadEvidence(row);
  const rawEvent = payload.raw_evidence_event || upper(row.raw_evidence_event);
  const canonicalEvent = payload.canonical_event || upper(row.canonical_event);
  const stage = payload.canonical_stage || upper(row.canonical_stage);
  return Boolean(
    (event && (event.startsWith("EXIT_") || event === "FORCE_EXIT_ALL" || event === "FORCE_EXIT_HALF"))
    || (rawEvent && (rawEvent.startsWith("EXIT_") || rawEvent === "FORCE_EXIT_ALL" || rawEvent === "FORCE_EXIT_HALF"))
    || (canonicalEvent && canonicalEvent.startsWith("EXIT_"))
    || (stage && !["LONG", "SHORT", "ENTRY"].includes(stage))
    || payload.canonical_transition_events.length > 0
  );
}

function evaluateRow(row = {}) {
  const issues = [];
  const payload = resolvePayloadEvidence(row);
  const topTransitions = normalizeStringList(row.canonical_transition_events);
  const exitLike = isExitLike(row);
  if (exitLike !== true) {
    return {
      ok: true,
      issues,
      exit_like: false,
      id: row.id || row.trade_alert_outbox_id || null,
      symbol: upper(row.symbol || resolveObject(row.payload).symbol),
      event: upper(row.event || resolveObject(row.payload).event),
      status: upper(row.status),
      created_at: row.created_at || null,
      payload_evidence: payload,
      top_level: {
        source_fill_id: trimOrNull(row.source_fill_id),
        canonical_event: upper(row.canonical_event),
        canonical_stage: upper(row.canonical_stage),
        canonical_transition_events: topTransitions,
        canonical_primary_transition_event: upper(row.canonical_primary_transition_event),
        simplified_exit_v2_enabled: row.simplified_exit_v2_enabled === true,
      },
    };
  }

  const checkMirror = (field, topValue, payloadValue) => {
    const expected = trimOrNull(payloadValue);
    if (!expected) return;
    const actual = trimOrNull(topValue);
    if (actual !== expected) issues.push(`MIRROR_MISMATCH:${field}`);
  };

  checkMirror("source_fill_id", row.source_fill_id, payload.source_fill_id);
  checkMirror("dedupe_key", row.dedupe_key, payload.dedupe_key);
  checkMirror("entry_event_id", row.entry_event_id, payload.entry_event_id);
  checkMirror("order_id", row.order_id, payload.order_id);
  checkMirror("client_order_id", row.client_order_id, payload.client_order_id);
  checkMirror("raw_evidence_event", upper(row.raw_evidence_event), payload.raw_evidence_event);
  checkMirror("canonical_event", upper(row.canonical_event), payload.canonical_event);
  checkMirror("canonical_stage", upper(row.canonical_stage), payload.canonical_stage);
  checkMirror("canonical_primary_transition_event", upper(row.canonical_primary_transition_event), payload.canonical_primary_transition_event);

  if (payload.canonical_transition_events.length > 0 && !includesAll(topTransitions, payload.canonical_transition_events)) {
    issues.push("MIRROR_MISMATCH:canonical_transition_events");
  }
  if (payload.simplified_exit_v2_enabled === true && row.simplified_exit_v2_enabled !== true) {
    issues.push("MIRROR_MISMATCH:simplified_exit_v2_enabled");
  }

  if (exitLike && payload.canonical_transition_events.length > 0 && topTransitions.length === 0) {
    issues.push("TOP_LEVEL_MISSING:canonical_transition_events");
  }
  if (exitLike && payload.canonical_event && !upper(row.canonical_event)) {
    issues.push("TOP_LEVEL_MISSING:canonical_event");
  }
  if (exitLike && payload.canonical_stage && !upper(row.canonical_stage)) {
    issues.push("TOP_LEVEL_MISSING:canonical_stage");
  }

  return {
    ok: issues.length === 0,
    issues,
    exit_like: exitLike,
    id: row.id || row.trade_alert_outbox_id || null,
    symbol: upper(row.symbol || resolveObject(row.payload).symbol),
    event: upper(row.event || resolveObject(row.payload).event),
    status: upper(row.status),
    created_at: row.created_at || null,
    payload_evidence: payload,
    top_level: {
      source_fill_id: trimOrNull(row.source_fill_id),
      canonical_event: upper(row.canonical_event),
      canonical_stage: upper(row.canonical_stage),
      canonical_transition_events: topTransitions,
      canonical_primary_transition_event: upper(row.canonical_primary_transition_event),
      simplified_exit_v2_enabled: row.simplified_exit_v2_enabled === true,
    },
  };
}

function buildReport({ rows = [], sinceIso = null, generatedAtIso = nowIso() } = {}) {
  const evaluations = (Array.isArray(rows) ? rows : []).map(evaluateRow);
  const issueRows = evaluations.filter((item) => item.ok !== true);
  const exitRows = evaluations.filter((item) => item.exit_like === true);
  const issueCodeCounts = {};
  for (const item of issueRows) {
    for (const issue of item.issues) issueCodeCounts[issue] = (issueCodeCounts[issue] || 0) + 1;
  }
  const blockers = [];
  if (issueRows.length > 0) blockers.push("TRADE_ALERT_OUTBOX_LINEAGE:TOP_LEVEL_EVIDENCE_MISMATCH");
  return {
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_PASS"
      : "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BLOCKED",
    blockers,
    generated_at_iso: generatedAtIso,
    since_iso: sinceIso,
    checked_row_n: evaluations.length,
    checked_exit_like_row_n: exitRows.length,
    issue_row_n: issueRows.length,
    issue_code_counts: issueCodeCounts,
    issues: issueRows.slice(0, 100).map((item) => ({
      id: item.id,
      symbol: item.symbol,
      event: item.event,
      status: item.status,
      created_at: item.created_at,
      issues: item.issues,
    })),
  };
}

async function fetchRows({ db, sinceIso, limit = PAGE_SIZE } = {}) {
  const rows = [];
  let last = null;
  for (;;) {
    let query = db.collection("trade_alert_outbox")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .select(...SELECT_FIELDS)
      .limit(limit);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...(doc.data() || {}) };
      if (upper(row.type) !== "TRADE_EXECUTION_ALERT") continue;
      rows.push(row);
    }
    if (snap.size < limit) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function resolveSinceIso(env = process.env) {
  const explicit = trimOrNull(env.TRADE_ALERT_OUTBOX_LINEAGE_ENFORCE_AFTER_ISO);
  if (explicit && Number.isFinite(toMs(explicit))) return new Date(toMs(explicit)).toISOString();
  return new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
}

function resolveOutDir(env = process.env) {
  return path.resolve(trimOrNull(env.TRADE_ALERT_OUTBOX_LINEAGE_OUTPUT_DIR) || path.join(process.cwd(), "ops", "daily"));
}

async function main(env = process.env) {
  const sinceIso = resolveSinceIso(env);
  const rows = normalizeBool(env.TRADE_ALERT_OUTBOX_LINEAGE_FIXTURE_EMPTY, false)
    ? []
    : await fetchRows({ db: getFirestore(), sinceIso });
  const report = buildReport({ rows, sinceIso });
  const outDir = resolveOutDir(env);
  fs.mkdirSync(outDir, { recursive: true });
  const latestPath = path.join(outDir, "trade_alert_outbox_lineage_evidence_latest.json");
  const datedPath = path.join(outDir, `${isoDate()}_trade_alert_outbox_lineage_evidence.json`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const line = JSON.stringify({ ...report, output_json: latestPath, output_dated_json: datedPath });
  if (report.ok !== true && normalizeBool(env.TRADE_ALERT_OUTBOX_LINEAGE_SOFT, false) !== true) {
    console.error(line);
    process.exitCode = 1;
    return report;
  }
  console.log(line);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      buildReport,
      evaluateRow,
      resolvePayloadEvidence,
      normalizeStringList,
      includesAll,
      isExitLike,
      resolveSinceIso,
      resolveOutDir,
      SELECT_FIELDS,
    },
  };
}
