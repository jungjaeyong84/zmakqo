"use strict";

const assert = require("assert");
const {
  buildProductionEntryRouteCanaryHistoryDoc,
  persistProductionEntryRouteCanaryHistory,
  loadProductionEntryRouteCanaryHistoryRows,
} = require("../v2/productionEntryRouteCanaryHistory");

function buildHealthyArtifact(generatedAt = "2026-04-21T07:00:00.000Z") {
  return {
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS",
    scope: "production_entry_route_canary",
    canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
    exchange_write_performed: false,
    route_called: true,
    kernel_called: true,
    persist_called: true,
    generated_at: generatedAt,
    fail_n: 0,
    failed_check_ids: [],
    route_result_summary: {
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
      position_cycle_id: "PCYV2__ETHUSDT__ENTRY__CANARY",
      entry_event_id: "ENTRY__V2_PRODUCTION_ROUTE_CANARY",
      protection_runtime_id: "PCYV2__ETHUSDT__ENTRY__CANARY__PROTECTION_RUNTIME__CANARY",
      audit_ledger_reason: "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED",
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
  const doc = buildProductionEntryRouteCanaryHistoryDoc({
    artifact: buildHealthyArtifact(),
    recordedAt: "2026-04-21T07:00:01.000Z",
  });
  assert.ok(doc.production_entry_route_canary_id.startsWith("PERCHV2__"));
  assert.strictEqual(doc.ok, true);
  assert.strictEqual(doc.exchange_write_performed, false);
  assert.strictEqual(doc.audit_ledger_reason, "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED");
  assert.strictEqual(doc.generated_at_ms, Date.parse("2026-04-21T07:00:00.000Z"));
  assert.strictEqual(doc.artifact_snapshot.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS");
})();

async function disabledWriteSkipsWithoutTouchingFirestore() {
  const db = buildFakeDb();
  const result = await persistProductionEntryRouteCanaryHistory({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    artifact: buildHealthyArtifact(),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_DISABLED");
  assert.strictEqual(db.__writes.length, 0);
}

async function enabledWriteUsesV2PrefixedCollectionAndCanBeLoaded() {
  const db = buildFakeDb();
  const env = {
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "1",
  };
  const older = buildHealthyArtifact("2026-04-21T06:00:00.000Z");
  const newer = buildHealthyArtifact("2026-04-21T08:00:00.000Z");
  await persistProductionEntryRouteCanaryHistory({ db, env, artifact: newer, recordedAt: newer.generated_at });
  await persistProductionEntryRouteCanaryHistory({ db, env, artifact: older, recordedAt: older.generated_at });
  assert.strictEqual(db.__writes.length, 2);
  assert.ok(db.__writes.every((row) => row.collection === "dbjv2__production_entry_route_canaries_v2"));
  const loaded = await loadProductionEntryRouteCanaryHistoryRows({
    db,
    env,
    sinceMs: Date.parse("2026-04-21T05:00:00.000Z"),
    limit: 10,
  });
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.collectionName, "dbjv2__production_entry_route_canaries_v2");
  assert.deepStrictEqual(loaded.rows.map((row) => row.payload.generated_at), [
    "2026-04-21T06:00:00.000Z",
    "2026-04-21T08:00:00.000Z",
  ]);
}

(function secretLeakGuardRejectsSuspiciousArtifacts() {
  assert.throws(() => buildProductionEntryRouteCanaryHistoryDoc({
    artifact: {
      ...buildHealthyArtifact(),
      apiKey: "do-not-store",
    },
  }), /PRODUCTION_ENTRY_ROUTE_CANARY_SECRET_LEAK_GUARD:apiKey/);
})();

async function main() {
  await disabledWriteSkipsWithoutTouchingFirestore();
  await enabledWriteUsesV2PrefixedCollectionAndCanBeLoaded();
}

main()
  .then(() => {
    console.log("V2_PRODUCTION_ENTRY_ROUTE_CANARY_HISTORY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
