"use strict";

// Phase A of the OpenClaw Decision Agent (2026-04-17).
// Writes an audit record for every agent decision so the calibration cycle
// can later reconcile prediction vs realized outcome. Designed to be safe
// to call before we have a real agent — today it is a pure append path with
// zero effect on live execution.
//
// Storage:
//   - In-memory ring buffer (last N decisions, default 200) for unit tests
//     and offline reasoning without Firestore.
//   - Firestore collection `openclaw_evidence_ledger` when
//     `OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1` and a getFirestore() handle is
//     reachable. Failures are silent (fail-open on Firestore; in-memory
//     copy still accumulates).
//
// Schema:
//   {
//     decision_id,
//     kind: SIGNAL_DECIDER | POSITION_CONDUCTOR | RETROSPECT,
//     at,                     // ISO 8601 timestamp
//     exchange, symbol, market, intent, stage,
//     inputs,                 // canonicalised feature hash / regime / allocator snapshot id
//     predictions: {
//       rule: { accept, scale, reasons },
//       ml:   { tp1_probability, version_id },
//       narrative: { accept, confidence, thesis_hash, model, prompt_hash }
//     },
//     composite: { accept, scale, reason_trace },
//     outcome: null           // linked later by an outcome-cycle
//   }

const crypto = require("crypto");

const COLLECTION = "openclaw_evidence_ledger";
const KINDS = Object.freeze({
  SIGNAL_DECIDER: "SIGNAL_DECIDER",
  POSITION_CONDUCTOR: "POSITION_CONDUCTOR",
  RETROSPECT: "RETROSPECT",
});
const MAX_BUFFER = 200;

const buffer = [];

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function firestoreEnabled() {
  return String(process.env.OPENCLAW_EVIDENCE_LEDGER_FIRESTORE || "").trim() === "1";
}

function hashJson(value) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  } catch (_) {
    return null;
  }
}

function buildDecisionId({ kind = "AGENT", symbol = null, at = Date.now() } = {}) {
  const rnd = crypto.randomBytes(3).toString("hex");
  const sym = upper(symbol) || "UNKNOWN";
  return `DEC__${kind}__${sym}__${Number(at)}__${rnd}`;
}

function normalizeRecord({
  decision_id = null,
  kind = null,
  at = null,
  exchange = null,
  symbol = null,
  market = null,
  intent = null,
  stage = null,
  inputs = null,
  predictions = null,
  composite = null,
  outcome = null,
} = {}) {
  const resolvedKind = upper(kind) || "AGENT";
  const resolvedAt = at || nowIso();
  const resolvedSymbol = upper(symbol) || upper(market);
  const id = decision_id || buildDecisionId({
    kind: resolvedKind,
    symbol: resolvedSymbol,
    at: Date.parse(resolvedAt) || Date.now(),
  });
  return {
    decision_id: id,
    kind: resolvedKind,
    at: resolvedAt,
    exchange: upper(exchange),
    symbol: resolvedSymbol,
    market: upper(market) || resolvedSymbol,
    intent: upper(intent),
    stage: upper(stage),
    inputs: inputs && typeof inputs === "object" ? inputs : {},
    predictions: predictions && typeof predictions === "object" ? predictions : {},
    composite: composite && typeof composite === "object" ? composite : {},
    outcome: outcome && typeof outcome === "object" ? outcome : null,
    schema_version: 1,
  };
}

async function persistToFirestore(record) {
  if (!firestoreEnabled()) return { persisted: false, reason: "FIRESTORE_DISABLED" };
  try {
    // Lazy require — test environments do not need the Firestore handle.
    const { getFirestore } = require("../storage/firestore");
    const db = getFirestore();
    await db.collection(COLLECTION).doc(record.decision_id).set(record, { merge: true });
    return { persisted: true };
  } catch (err) {
    return { persisted: false, error: err && err.message ? err.message : String(err) };
  }
}

async function writeEvidenceRecord(partial) {
  const record = normalizeRecord(partial || {});
  // In-memory ring buffer is unconditional so tests and offline reasoning
  // can inspect recent decisions.
  buffer.push(record);
  while (buffer.length > MAX_BUFFER) buffer.shift();
  const persist = await persistToFirestore(record);
  return {
    ok: true,
    record,
    persistence: persist,
  };
}

function getRecentEvidence({ kind = null, limit = 50 } = {}) {
  const filterKind = upper(kind);
  const snapshot = [...buffer];
  snapshot.reverse();
  const filtered = filterKind ? snapshot.filter((r) => r.kind === filterKind) : snapshot;
  return filtered.slice(0, Math.max(1, Math.min(MAX_BUFFER, Number(limit) || 50)));
}

function resetLedgerForTest() {
  buffer.length = 0;
}

module.exports = {
  COLLECTION,
  KINDS,
  MAX_BUFFER,
  buildDecisionId,
  normalizeRecord,
  writeEvidenceRecord,
  getRecentEvidence,
  hashJson,
  __test: {
    resetLedgerForTest,
    firestoreEnabled,
  },
};
