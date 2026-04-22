"use strict";

const { getFirestore } = require("../storage/firestore");
const { resolveV2RuntimeConfig } = require("./runtime");

const DOC_ID_FIELDS = Object.freeze({
  POSITION_CYCLES: "position_cycle_id",
  CANONICAL_EXIT_TRANSITIONS: "canonical_transition_id",
  EXIT_RUNTIME_PROJECTIONS: "exit_runtime_projection_id",
  PROTECTION_RUNTIME: "protection_runtime_id",
  TRADE_ALERT_OUTBOX: "alert_outbox_id",
  REPAIR_REQUESTS: "exit_repair_request_id",
  REPAIR_EXECUTION_LEDGER: "repair_execution_ledger_id",
  SIGNAL_INTENTS: "signal_intent_id",
  ML_AI_SIGNAL_PROPOSALS: "ml_ai_signal_proposal_id",
  FEATURE_SNAPSHOTS: "feature_snapshot_id",
  ML_AI_EVIDENCE_LEDGER: "decision_id",
  OPENCLAW_DECISIONS: "openclaw_decision_id",
  OPENCLAW_EXECUTION_AUDITS: "openclaw_execution_audit_id",
  OPENCLAW_WORLD_STATES: "openclaw_world_state_id",
  OPENCLAW_EXECUTION_PERMITS: "openclaw_execution_permit_id",
  OPENCLAW_OUTCOME_ADJUDICATIONS: "openclaw_outcome_adjudication_id",
  OPENCLAW_LEARNER_SHADOW_EVALUATIONS: "openclaw_learner_shadow_evaluation_id",
  TRAIL_OBSERVATIONS: "trail_observation_id",
  PRODUCTION_ENTRY_ROUTE_CANARIES: "production_entry_route_canary_id",
  EXIT_RUNTIME_CANARIES: "exit_runtime_canary_id",
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function resolveV2CollectionName(collectionKey, env = process.env) {
  const cfg = resolveV2RuntimeConfig(env);
  const name = cfg && cfg.collections ? cfg.collections[collectionKey] : null;
  if (!name) throw new Error(`V2_COLLECTION_KEY_INVALID:${collectionKey}`);
  return name;
}

function resolveV2CollectionRef({ db = null, collectionKey, env = process.env } = {}) {
  const firestore = db || getFirestore();
  const collectionName = resolveV2CollectionName(collectionKey, env);
  return {
    db: firestore,
    collectionKey,
    collectionName,
    ref: firestore.collection(collectionName),
  };
}

function resolveV2DocWrite({ db = null, collectionKey, doc, env = process.env, merge = false } = {}) {
  const payload = doc && typeof doc === "object" ? doc : null;
  if (!payload) throw new Error("V2_DOC_REQUIRED");
  const idField = DOC_ID_FIELDS[collectionKey];
  if (!idField) throw new Error(`V2_DOC_ID_FIELD_INVALID:${collectionKey}`);
  const docId = trimOrNull(payload[idField]);
  if (!docId) throw new Error(`V2_DOC_ID_REQUIRED:${idField}`);
  const { collectionName, ref } = resolveV2CollectionRef({ db, collectionKey, env });
  return Object.freeze({
    collectionKey,
    collectionName,
    docId,
    ref: ref.doc(docId),
    payload,
    merge: merge === true,
  });
}

async function putV2Doc({
  db = null,
  collectionKey,
  doc,
  env = process.env,
  merge = false,
} = {}) {
  const payload = doc && typeof doc === "object" ? doc : null;
  const write = resolveV2DocWrite({ db, collectionKey, doc: payload, env, merge });
  await write.ref.set(write.payload, { merge: write.merge });
  return {
    ok: true,
    collectionKey: write.collectionKey,
    collectionName: write.collectionName,
    docId: write.docId,
  };
}

async function putV2DocsBatch({
  db = null,
  writes,
  env = process.env,
} = {}) {
  const firestore = db || getFirestore();
  if (!firestore || typeof firestore.batch !== "function") throw new Error("V2_FIRESTORE_BATCH_REQUIRED");
  const rows = Array.isArray(writes) ? writes : [];
  if (!rows.length) throw new Error("V2_BATCH_WRITES_REQUIRED");
  const resolved = rows.map((row) => resolveV2DocWrite({
    db: firestore,
    env,
    collectionKey: row && row.collectionKey,
    doc: row && row.doc,
    merge: row && row.merge,
  }));
  const batch = firestore.batch();
  resolved.forEach((row) => {
    batch.set(row.ref, row.payload, { merge: row.merge });
  });
  await batch.commit();
  return {
    ok: true,
    write_mode: "BATCH",
    write_n: resolved.length,
    writes: resolved.map((row) => ({
      collectionKey: row.collectionKey,
      collectionName: row.collectionName,
      docId: row.docId,
    })),
  };
}

async function getV2Doc({
  db = null,
  collectionKey,
  docId,
  env = process.env,
} = {}) {
  const resolvedDocId = trimOrNull(docId);
  if (!resolvedDocId) throw new Error("V2_GET_DOC_ID_REQUIRED");
  const { collectionName, ref } = resolveV2CollectionRef({ db, collectionKey, env });
  const snap = await ref.doc(resolvedDocId).get();
  return {
    ok: snap.exists === true,
    collectionKey,
    collectionName,
    docId: resolvedDocId,
    doc: snap.exists ? { ...snap.data() } : null,
  };
}

async function queryV2DocsByField({
  db = null,
  collectionKey,
  field,
  value,
  op = "==",
  limit = 50,
  env = process.env,
} = {}) {
  const resolvedField = trimOrNull(field);
  if (!resolvedField) throw new Error("V2_QUERY_FIELD_REQUIRED");
  const { collectionName, ref } = resolveV2CollectionRef({ db, collectionKey, env });
  const query = ref.where(resolvedField, op, value).limit(Math.max(1, Number(limit) || 1));
  const snap = await query.get();
  return {
    ok: true,
    collectionKey,
    collectionName,
    field: resolvedField,
    op,
    value,
    rows: snap.docs.map((doc) => ({ ...doc.data() })),
  };
}

async function listV2Docs({
  db = null,
  collectionKey,
  limit = 50,
  env = process.env,
} = {}) {
  const { collectionName, ref } = resolveV2CollectionRef({ db, collectionKey, env });
  const boundedLimit = Math.max(1, Number(limit) || 1);
  const snap = await ref.limit(boundedLimit).get();
  return {
    ok: true,
    collectionKey,
    collectionName,
    limit: boundedLimit,
    rows: snap.docs.map((doc) => ({ ...doc.data() })),
  };
}

module.exports = {
  resolveV2CollectionName,
  resolveV2CollectionRef,
  putV2Doc,
  putV2DocsBatch,
  getV2Doc,
  listV2Docs,
  queryV2DocsByField,
  __test: {
    DOC_ID_FIELDS,
    resolveV2DocWrite,
  },
};
