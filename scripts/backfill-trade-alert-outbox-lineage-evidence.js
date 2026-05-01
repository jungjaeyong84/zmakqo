#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { __test: outboxTest } = require("../src/storage/tradeAlertOutbox");

const DEFAULT_LOOKBACK_HOURS = 72;
const PAGE_SIZE = 500;

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function boolFromArg(name, argv = process.argv.slice(2)) {
  return argv.includes(name);
}

function numberFromEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

function sameStringList(a = [], b = []) {
  const aa = normalizeStringList(a);
  const bb = normalizeStringList(b);
  if (aa.length !== bb.length) return false;
  return aa.every((item, idx) => item === bb[idx]);
}

function isExitLike(row = {}) {
  const ev = upper(row.event || (row.payload && row.payload.event));
  const canonical = upper(row.canonical_event || (row.payload && (row.payload.canonicalExitEvent || row.payload.canonical_event)));
  const stage = upper(row.canonical_stage || (row.payload && (row.payload.canonicalExitStage || row.payload.canonical_stage)));
  return Boolean(
    (ev && (ev.startsWith("EXIT_") || ev === "FORCE_EXIT_ALL" || ev === "FORCE_EXIT_HALF"))
    || (canonical && canonical.startsWith("EXIT_"))
    || (stage && !["ENTRY", "LONG", "SHORT"].includes(stage))
  );
}

function buildLineagePatch(row = {}) {
  if (!row || typeof row !== "object") return null;
  if (upper(row.type) !== "TRADE_EXECUTION_ALERT") return null;
  if (isExitLike(row) !== true) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const evidence = outboxTest.resolveOutboxEvidenceFields({
    payload,
    prev: row,
    sourceFillId: row.source_fill_id || payload.sourceFillId || payload.source_fill_id,
    dedupeKey: row.dedupe_key || payload.tradeAlertDedupeKey || payload.trade_alert_dedupe_key,
  });
  const patch = {};
  const assignIfChanged = (field, value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      const next = normalizeStringList(value);
      if (next.length && !sameStringList(row[field], next)) patch[field] = next;
      return;
    }
    const next = trimOrNull(value);
    if (!next) return;
    if (trimOrNull(row[field]) !== next) patch[field] = next;
  };
  assignIfChanged("source_fill_id", evidence.source_fill_id);
  assignIfChanged("dedupe_key", evidence.dedupe_key);
  assignIfChanged("entry_event_id", evidence.entry_event_id);
  assignIfChanged("order_id", evidence.order_id);
  assignIfChanged("client_order_id", evidence.client_order_id);
  assignIfChanged("raw_evidence_event", evidence.raw_evidence_event);
  assignIfChanged("canonical_event", evidence.canonical_event);
  assignIfChanged("canonical_stage", evidence.canonical_stage);
  assignIfChanged("canonical_transition_events", evidence.canonical_transition_events);
  assignIfChanged("canonical_primary_transition_event", evidence.canonical_primary_transition_event);
  if (evidence.simplified_exit_v2_enabled === true && row.simplified_exit_v2_enabled !== true) {
    patch.simplified_exit_v2_enabled = true;
  }
  if (!Object.keys(patch).length) return null;
  patch.lineage_evidence_backfilled_at = new Date().toISOString();
  patch.lineage_evidence_backfill_source = "backfill-trade-alert-outbox-lineage-evidence";
  return patch;
}

async function fetchRows({ db, sinceIso, limit = PAGE_SIZE } = {}) {
  const rows = [];
  let last = null;
  for (;;) {
    let query = db.collection("trade_alert_outbox")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .limit(limit);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) rows.push({ id: doc.id, ref: doc.ref, ...(doc.data() || {}) });
    if (snap.size < limit) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function resolveSinceIso(env = process.env) {
  const explicit = trimOrNull(env.TRADE_ALERT_OUTBOX_LINEAGE_BACKFILL_SINCE_ISO);
  if (explicit && Number.isFinite(toMs(explicit))) return new Date(toMs(explicit)).toISOString();
  const hours = numberFromEnv(env.TRADE_ALERT_OUTBOX_LINEAGE_BACKFILL_LOOKBACK_HOURS, DEFAULT_LOOKBACK_HOURS);
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function main(env = process.env, argv = process.argv.slice(2)) {
  const apply = boolFromArg("--apply", argv);
  const sinceIso = resolveSinceIso(env);
  const db = getFirestore();
  const rows = await fetchRows({ db, sinceIso });
  let candidateN = 0;
  let patchedN = 0;
  const examples = [];
  for (const row of rows) {
    const patch = buildLineagePatch(row);
    if (!patch) continue;
    candidateN += 1;
    if (examples.length < 20) examples.push({ id: row.id, event: row.event, symbol: row.symbol, patch });
    if (apply) {
      await row.ref.set(patch, { merge: true });
      patchedN += 1;
    }
  }
  const report = {
    ok: true,
    reason: apply
      ? "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BACKFILL_APPLIED"
      : "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BACKFILL_DRY_RUN",
    apply,
    since_iso: sinceIso,
    checked_row_n: rows.length,
    candidate_row_n: candidateN,
    patched_row_n: patchedN,
    examples,
  };
  console.log(JSON.stringify(report));
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BACKFILL_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      buildLineagePatch,
      isExitLike,
      normalizeStringList,
      sameStringList,
      resolveSinceIso,
    },
  };
}
