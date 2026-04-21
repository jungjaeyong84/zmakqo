"use strict";

const assert = require("assert");
const { resolveV2CollectionName, putV2Doc, putV2DocsBatch, getV2Doc, listV2Docs, queryV2DocsByField } = require("../v2/storage");

function buildFakeDb(calls) {
  return {
    batch() {
      const writes = [];
      return {
        set(ref, payload, options = {}) {
          writes.push({ ref, payload, options });
        },
        async commit() {
          calls.push({ type: "batch-commit", write_n: writes.length });
          for (const write of writes) {
            await write.ref.set(write.payload, write.options);
          }
        },
      };
    },
    collection(name) {
      calls.push({ type: "collection", name });
      return {
        doc(id) {
          calls.push({ type: "doc", id });
          return {
            async set(payload, options) {
              calls.push({ type: "set", payload, options });
            },
            async get() {
              calls.push({ type: "get-doc", id });
              return {
                exists: true,
                data() {
                  return { position_cycle_id: id, entry_event_id: "ENTRY__1" };
                },
              };
            },
          };
        },
        where(field, op, value) {
          calls.push({ type: "where", field, op, value });
          return {
            limit(limit) {
              calls.push({ type: "limit", limit });
              return {
                async get() {
                  calls.push({ type: "get-query" });
                  return {
                    docs: [{
                      data() {
                        return { position_cycle_id: "PCY__1", issue_code: "TRAIL_STOP_MISSING" };
                      },
                    }],
                  };
                },
              };
            },
          };
        },
        limit(limit) {
          calls.push({ type: "limit-no-where", limit });
          return {
            async get() {
              calls.push({ type: "get-list" });
              return {
                docs: [{
                  data() {
                    return { exit_repair_request_id: "RQRV2__1", position_cycle_id: "PCY__1" };
                  },
                }],
              };
            },
          };
        },
      };
    },
  };
}

(function collectionNamesStayPrefixed() {
  const collection = resolveV2CollectionName("POSITION_CYCLES", {
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
  });
  assert.strictEqual(collection, "dbjv2__position_cycles_v2");
})();

(async function putDocNeverTouchesV1Collections() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await putV2Doc({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "POSITION_CYCLES",
    doc: {
      position_cycle_id: "PCY__1",
      entry_event_id: "ENTRY__1",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.collectionName, "dbjv2__position_cycles_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__position_cycles_v2" });
  assert.deepStrictEqual(calls[1], { type: "doc", id: "PCY__1" });
})();

(async function putDocsBatchUsesFirestoreBatch() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await putV2DocsBatch({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    writes: [{
      collectionKey: "CANONICAL_EXIT_TRANSITIONS",
      doc: {
        canonical_transition_id: "CXT__1",
        position_cycle_id: "PCY__1",
      },
    }, {
      collectionKey: "EXIT_RUNTIME_PROJECTIONS",
      doc: {
        exit_runtime_projection_id: "ERPv2__PCY__1",
        position_cycle_id: "PCY__1",
      },
      merge: true,
    }],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.write_mode, "BATCH");
  assert.strictEqual(result.write_n, 2);
  assert.deepStrictEqual(result.writes.map((row) => row.docId), ["CXT__1", "ERPv2__PCY__1"]);
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__canonical_exit_transitions_v2" });
  assert.deepStrictEqual(calls[1], { type: "doc", id: "CXT__1" });
  assert.deepStrictEqual(calls[2], { type: "collection", name: "dbjv2__exit_runtime_projection_v2" });
  assert.deepStrictEqual(calls[3], { type: "doc", id: "ERPv2__PCY__1" });
  assert.deepStrictEqual(calls[4], { type: "batch-commit", write_n: 2 });
  assert.strictEqual(calls[6].options.merge, true);
})();

(async function putDocsBatchRequiresBatchSupport() {
  let err = null;
  try {
    await putV2DocsBatch({
      db: { collection: buildFakeDb([]).collection },
      collectionKey: "CANONICAL_EXIT_TRANSITIONS",
      writes: [{
        collectionKey: "CANONICAL_EXIT_TRANSITIONS",
        doc: { canonical_transition_id: "CXT__1" },
      }],
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_FIRESTORE_BATCH_REQUIRED");
})();

(async function putDocRequiresCanonicalIds() {
  let err = null;
  try {
    await putV2Doc({
      db: buildFakeDb([]),
      collectionKey: "CANONICAL_EXIT_TRANSITIONS",
      doc: { source_fill_id: "FILL__1" },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_DOC_ID_REQUIRED:canonical_transition_id");
})();

(async function putSignalIntentUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await putV2Doc({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "SIGNAL_INTENTS",
    doc: {
      signal_intent_id: "SIGINTV2__1",
      signal_lineage_id: "LINEAGE__1",
    },
  });
  assert.strictEqual(result.collectionName, "dbjv2__signal_intents_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__signal_intents_v2" });
})();

(async function putMlAiSignalProposalUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await putV2Doc({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "ML_AI_SIGNAL_PROPOSALS",
    doc: {
      ml_ai_signal_proposal_id: "MSPV2__1",
      signal_intent_id: "SIGINTV2__1",
    },
  });
  assert.strictEqual(result.collectionName, "dbjv2__ml_ai_signal_proposals_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__ml_ai_signal_proposals_v2" });
})();

(async function putFeatureSnapshotUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await putV2Doc({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "FEATURE_SNAPSHOTS",
    doc: {
      feature_snapshot_id: "FSV2__1",
      signal_intent_id: "SIGINTV2__1",
    },
  });
  assert.strictEqual(result.collectionName, "dbjv2__feature_snapshots_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__feature_snapshots_v2" });
})();

(async function putTrailObservationUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await putV2Doc({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "TRAIL_OBSERVATIONS",
    doc: {
      trail_observation_id: "TROBSV2__1",
      position_cycle_id: "PCY__1",
    },
  });
  assert.strictEqual(result.collectionName, "dbjv2__trail_observations_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__trail_observations_v2" });
})();

(async function putOpenClawExecutionAuditUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await putV2Doc({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "OPENCLAW_EXECUTION_AUDITS",
    doc: {
      openclaw_execution_audit_id: "OCEXSEPAUDV2__1",
      signal_intent_id: "SIGINTV2__1",
    },
  });
  assert.strictEqual(result.collectionName, "dbjv2__openclaw_execution_audits_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__openclaw_execution_audits_v2" });
})();

(async function getDocUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await getV2Doc({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "POSITION_CYCLES",
    docId: "PCY__1",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.collectionName, "dbjv2__position_cycles_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__position_cycles_v2" });
})();

(async function queryDocsByFieldUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await queryV2DocsByField({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "REPAIR_REQUESTS",
    field: "position_cycle_id",
    value: "PCY__1",
    limit: 5,
  });
  assert.strictEqual(result.collectionName, "dbjv2__exit_repair_requests_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__exit_repair_requests_v2" });
  assert.deepStrictEqual(calls[1], { type: "where", field: "position_cycle_id", op: "==", value: "PCY__1" });
  assert.deepStrictEqual(calls[2], { type: "limit", limit: 5 });
  assert.strictEqual(result.rows.length, 1);
})();

(async function listDocsUsesDedicatedCollection() {
  const calls = [];
  const db = buildFakeDb(calls);
  const result = await listV2Docs({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    collectionKey: "REPAIR_REQUESTS",
    limit: 3,
  });
  assert.strictEqual(result.collectionName, "dbjv2__exit_repair_requests_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__exit_repair_requests_v2" });
  assert.deepStrictEqual(calls[1], { type: "limit-no-where", limit: 3 });
  assert.strictEqual(result.rows.length, 1);
})();

console.log("V2_STORAGE_TEST_OK");
