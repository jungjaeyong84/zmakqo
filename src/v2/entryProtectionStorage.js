"use strict";

const { getFirestore } = require("../storage/firestore");
const { resolveV2CollectionName } = require("./storage");
const { buildProtectedActivePositionCycleDoc } = require("./entryBootstrap");
const { assertRuntimeExecutionChain } = require("./runtimeChainAudit");
const { buildEntryProtectionRepairRequests } = require("./entryProtectionRepairRequests");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function validateRequiredObject(name, value) {
  if (!value || typeof value !== "object") throw new Error(`${name}_REQUIRED`);
  return value;
}

function resolveDb(db = null) {
  const firestore = db || getFirestore();
  if (!firestore || typeof firestore.collection !== "function") throw new Error("V2_FIRESTORE_REQUIRED");
  if (typeof firestore.batch !== "function") throw new Error("V2_FIRESTORE_BATCH_REQUIRED");
  return firestore;
}

function docRef({ firestore, env, collectionKey, docId }) {
  const resolvedDocId = trimOrNull(docId);
  if (!resolvedDocId) throw new Error(`V2_DOC_ID_REQUIRED:${collectionKey}`);
  const collectionName = resolveV2CollectionName(collectionKey, env);
  return Object.freeze({
    collectionKey,
    collectionName,
    docId: resolvedDocId,
    ref: firestore.collection(collectionName).doc(resolvedDocId),
  });
}

async function commitEntryProtectionPendingBootstrap({
  db = null,
  executedEntry,
  env = process.env,
  committedAt = null,
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const positionCycle = validateRequiredObject("POSITION_CYCLE", executed.positionCycle);
  const projection = validateRequiredObject("EXIT_RUNTIME_PROJECTION", executed.projection);
  if (upper(positionCycle.status) !== "PROTECTION_PENDING") {
    throw new Error("ENTRY_BOOTSTRAP_PROTECTION_PENDING_REQUIRED");
  }
  if (trimOrNull(projection.position_cycle_id) !== trimOrNull(positionCycle.position_cycle_id)) {
    throw new Error("ENTRY_BOOTSTRAP_PROJECTION_CYCLE_MISMATCH");
  }

  const firestore = resolveDb(db);
  const cycleRef = docRef({
    firestore,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: positionCycle.position_cycle_id,
  });
  const projectionRef = docRef({
    firestore,
    env,
    collectionKey: "EXIT_RUNTIME_PROJECTIONS",
    docId: projection.exit_runtime_projection_id,
  });
  const batch = firestore.batch();
  const at = trimOrNull(committedAt) || new Date().toISOString();
  batch.set(cycleRef.ref, {
    ...positionCycle,
    entry_bootstrap_committed_at: at,
  }, { merge: false });
  batch.set(projectionRef.ref, {
    ...projection,
    entry_bootstrap_committed_at: at,
  }, { merge: false });
  await batch.commit();
  return Object.freeze({
    ok: true,
    write_mode: "BATCH",
    committed_at: at,
    position_cycle_id: positionCycle.position_cycle_id,
    position_cycle_status: positionCycle.status,
    writes: Object.freeze([
      Object.freeze({
        collectionKey: cycleRef.collectionKey,
        collectionName: cycleRef.collectionName,
        docId: cycleRef.docId,
      }),
      Object.freeze({
        collectionKey: projectionRef.collectionKey,
        collectionName: projectionRef.collectionName,
        docId: projectionRef.docId,
      }),
    ]),
  });
}

async function commitProtectedEntryActivation({
  db = null,
  executedEntry,
  placementRequest,
  protectionWriteResult,
  env = process.env,
  activatedAt = null,
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const protection = validateRequiredObject("PROTECTION_WRITE_RESULT", protectionWriteResult);
  const request = validateRequiredObject("PLACEMENT_REQUEST", placementRequest);
  const runtimeDoc = validateRequiredObject("PROTECTION_RUNTIME_DOC", protection.runtimeDoc);
  const activatedPositionCycle = buildProtectedActivePositionCycleDoc({
    positionCycle: executed.positionCycle,
    protectionWriteResult: protection,
    activatedAt,
  });
  const chainAudit = assertRuntimeExecutionChain({
    executedEntry: {
      ...executed,
      positionCycle: activatedPositionCycle,
    },
    placementRequest: request,
    protectionWriteResult: protection,
  });

  const firestore = resolveDb(db);
  const cycleRef = docRef({
    firestore,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: activatedPositionCycle.position_cycle_id,
  });
  const runtimeRef = docRef({
    firestore,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    docId: runtimeDoc.protection_runtime_id,
  });
  const batch = firestore.batch();
  const at = trimOrNull(activatedAt) || trimOrNull(activatedPositionCycle.protection_activated_at) || new Date().toISOString();
  batch.set(cycleRef.ref, {
    ...activatedPositionCycle,
    protection_activated_at: at,
  }, { merge: true });
  batch.set(runtimeRef.ref, {
    ...runtimeDoc,
    protection_activated_at: at,
  }, { merge: true });
  await batch.commit();
  return Object.freeze({
    ok: true,
    write_mode: "BATCH",
    activated_at: at,
    position_cycle_id: activatedPositionCycle.position_cycle_id,
    position_cycle_status: activatedPositionCycle.status,
    protection_runtime_id: runtimeDoc.protection_runtime_id,
    chainAudit,
    writes: Object.freeze([
      Object.freeze({
        collectionKey: cycleRef.collectionKey,
        collectionName: cycleRef.collectionName,
        docId: cycleRef.docId,
      }),
      Object.freeze({
        collectionKey: runtimeRef.collectionKey,
        collectionName: runtimeRef.collectionName,
        docId: runtimeRef.docId,
      }),
    ]),
  });
}

async function commitEntryProtectionRepairQueue({
  db = null,
  executedEntry,
  placementRequest,
  protectionWriteResult,
  slAck = null,
  tp1Ack = null,
  env = process.env,
  committedAt = null,
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const protection = validateRequiredObject("PROTECTION_WRITE_RESULT", protectionWriteResult);
  const runtimeDoc = validateRequiredObject("PROTECTION_RUNTIME_DOC", protection.runtimeDoc);
  const at = trimOrNull(committedAt) || new Date().toISOString();
  const requestBuild = buildEntryProtectionRepairRequests({
    executedEntry: executed,
    placementRequest,
    protectionWriteResult: protection,
    slAck,
    tp1Ack,
    createdAt: at,
  });

  if (requestBuild.enqueue_required !== true) {
    return Object.freeze({
      ok: true,
      write_mode: "SKIPPED",
      committed_at: at,
      skip_reason: requestBuild.skip_reason,
      position_cycle_id: runtimeDoc.position_cycle_id,
      protection_runtime_id: runtimeDoc.protection_runtime_id,
      repair_request_n: 0,
      repair_requests: Object.freeze([]),
      writes: Object.freeze([]),
    });
  }

  const firestore = resolveDb(db);
  const runtimeRef = docRef({
    firestore,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    docId: runtimeDoc.protection_runtime_id,
  });
  const repairRefs = requestBuild.repair_requests.map((repairRequest) => docRef({
    firestore,
    env,
    collectionKey: "REPAIR_REQUESTS",
    docId: repairRequest.exit_repair_request_id,
  }));
  const batch = firestore.batch();
  batch.set(runtimeRef.ref, {
    ...runtimeDoc,
    repair_enqueue_committed_at: at,
  }, { merge: true });
  requestBuild.repair_requests.forEach((repairRequest, index) => {
    batch.set(repairRefs[index].ref, repairRequest, { merge: true });
  });
  await batch.commit();

  return Object.freeze({
    ok: true,
    write_mode: "BATCH",
    committed_at: at,
    position_cycle_id: runtimeDoc.position_cycle_id,
    protection_runtime_id: runtimeDoc.protection_runtime_id,
    repair_request_n: requestBuild.repair_requests.length,
    repair_requests: requestBuild.repair_requests,
    writes: Object.freeze([
      Object.freeze({
        collectionKey: runtimeRef.collectionKey,
        collectionName: runtimeRef.collectionName,
        docId: runtimeRef.docId,
      }),
      ...repairRefs.map((ref) => Object.freeze({
        collectionKey: ref.collectionKey,
        collectionName: ref.collectionName,
        docId: ref.docId,
      })),
    ]),
  });
}

module.exports = {
  commitEntryProtectionPendingBootstrap,
  commitProtectedEntryActivation,
  commitEntryProtectionRepairQueue,
  __test: {
    trimOrNull,
    upper,
    validateRequiredObject,
    resolveDb,
    docRef,
  },
};
