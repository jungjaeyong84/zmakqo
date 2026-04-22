"use strict";

const assert = require("assert");
const {
  buildExitRuntimeCanaryHistoryDoc,
  persistExitRuntimeCanaryHistory,
  loadExitRuntimeCanaryHistoryRows,
} = require("../v2/exitRuntimeCanaryHistory");

function buildHealthyArtifact(generatedAt = "2026-04-21T07:00:00.000Z") {
  return {
    ok: true,
    reason: "V2_EXIT_RUNTIME_CANARY_PASS",
    scope: "exit_runtime_canary",
    canary_mode: "LIVE_EXIT_RUNTIME_OBSERVATION",
    exchange_write_performed: false,
    generated_at: generatedAt,
    active_position_n: 1,
    fail_n: 0,
    tp1_missing_n: 0,
    native_refresh_unhealthy_n: 0,
    unprotected_window_violation_n: 0,
    alert_silent_drop_n: 0,
    alert_retry_unresolved_n: 0,
    trail_activation_evidence_gap_n: 0,
    blockers: [],
    query_budget: {
      active_position_limit: 25,
      active_query_limit_reached: false,
    },
  };
}

function buildFakeDb() {
  const writes = [];
  const docsByCollection = new Map();
  function ensure(name) {
    if (!docsByCollection.has(name)) docsByCollection.set(name, new Map());
    return docsByCollection.get(name);
  }
  return {
    __writes: writes,
    __docsByCollection: docsByCollection,
    collection(name) {
      const collectionDocs = ensure(name);
      return {
        doc(id) {
          return {
            async set(payload, options = {}) {
              const next = options.merge === true
                ? { ...(collectionDocs.get(id) || {}), ...payload }
                : { ...payload };
              collectionDocs.set(id, next);
              writes.push({ collection: name, id, payload: next, options });
            },
          };
        },
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  const rows = Array.from(collectionDocs.values())
                    .filter((doc) => {
                      if (op === ">=") return Number(doc[field]) >= Number(value);
                      return doc[field] === value;
                    })
                    .slice(0, limit)
                    .map((doc) => ({ data: () => ({ ...doc }) }));
                  return { docs: rows };
                },
              };
            },
          };
        },
      };
    },
  };
}

(function buildsStableFirestoreDocWithoutExchangeWrite() {
  const doc = buildExitRuntimeCanaryHistoryDoc({
    artifact: buildHealthyArtifact(),
    recordedAt: "2026-04-21T07:00:01.000Z",
  });
  assert.ok(doc.exit_runtime_canary_id.startsWith("ERTCHV2__"));
  assert.strictEqual(doc.ok, true);
  assert.strictEqual(doc.scope, "exit_runtime_canary");
  assert.strictEqual(doc.canary_mode, "LIVE_EXIT_RUNTIME_OBSERVATION");
  assert.strictEqual(doc.active_position_n, 1);
  assert.strictEqual(doc.tp1_missing_n, 0);
  assert.strictEqual(doc.native_refresh_unhealthy_n, 0);
  assert.strictEqual(doc.unprotected_window_violation_n, 0);
  assert.strictEqual(doc.alert_silent_drop_n, 0);
  assert.strictEqual(doc.alert_retry_unresolved_n, 0);
  assert.strictEqual(doc.trail_activation_evidence_gap_n, 0);
  assert.strictEqual(doc.generated_at_ms, Date.parse("2026-04-21T07:00:00.000Z"));
  assert.strictEqual(doc.artifact_snapshot.exchange_write_performed, false);
})();

async function disabledWriteSkipsWithoutTouchingFirestore() {
  const db = buildFakeDb();
  const result = await persistExitRuntimeCanaryHistory({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    artifact: buildHealthyArtifact(),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_DISABLED");
  assert.strictEqual(db.__writes.length, 0);
}

async function enabledWriteUsesV2PrefixedCollectionAndCanBeLoaded() {
  const db = buildFakeDb();
  const env = {
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "1",
  };
  const older = buildHealthyArtifact("2026-04-21T06:00:00.000Z");
  const newer = buildHealthyArtifact("2026-04-21T08:00:00.000Z");
  await persistExitRuntimeCanaryHistory({ db, env, artifact: newer, recordedAt: newer.generated_at });
  await persistExitRuntimeCanaryHistory({ db, env, artifact: older, recordedAt: older.generated_at });
  assert.strictEqual(db.__writes.length, 2);
  assert.ok(db.__writes.every((row) => row.collection === "dbjv2__exit_runtime_canaries_v2"));
  const loaded = await loadExitRuntimeCanaryHistoryRows({
    db,
    env,
    sinceMs: Date.parse("2026-04-21T05:00:00.000Z"),
    limit: 10,
  });
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.collectionName, "dbjv2__exit_runtime_canaries_v2");
  assert.deepStrictEqual(loaded.rows.map((row) => row.payload.generated_at), [
    "2026-04-21T06:00:00.000Z",
    "2026-04-21T08:00:00.000Z",
  ]);
  assert.ok(loaded.rows.every((row) => row.payload.exchange_write_performed === false));
}

(function secretLeakGuardRejectsSuspiciousArtifacts() {
  assert.throws(() => buildExitRuntimeCanaryHistoryDoc({
    artifact: {
      ...buildHealthyArtifact(),
      apiSecret: "do-not-store",
    },
  }), /EXIT_RUNTIME_CANARY_SECRET_LEAK_GUARD:apiSecret/);
})();

async function main() {
  await disabledWriteSkipsWithoutTouchingFirestore();
  await enabledWriteUsesV2PrefixedCollectionAndCanBeLoaded();
}

main()
  .then(() => {
    console.log("V2_EXIT_RUNTIME_CANARY_HISTORY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
