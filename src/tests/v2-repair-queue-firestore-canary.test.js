"use strict";

const assert = require("assert");
const {
  resolveFirestoreCanaryEnv,
  runRepairQueueFirestoreCanary,
} = require("../v2/repairQueueFirestoreCanary");
const { buildMemoryDb } = require("../v2/repairQueueCanary");

(function resolvesIsolatedFirestoreCanaryPrefix() {
  const env = resolveFirestoreCanaryEnv({});
  assert.strictEqual(env.DONBEOLJA_V2_COLLECTION_PREFIX, "paperopcanaryv2__");
  assert.strictEqual(env.DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT, "1");
  assert.strictEqual(env.DONBEOLJA_V2_REPAIR_QUEUE_SCAN_LIMIT, "10");
})();

async function disabledCanaryFailsClosedBeforeFirestoreWrite() {
  const db = buildMemoryDb();
  const output = await runRepairQueueFirestoreCanary({
    db,
    env: {},
    recordedAt: "2026-04-21T09:00:00.000Z",
  });
  assert.strictEqual(output.ok, false);
  assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_WRITE_DISABLED");
  assert.strictEqual(output.firestore_write_performed, false);
  assert.strictEqual(output.exchange_write_performed, false);
  assert.deepStrictEqual(output.blockers, ["FIRESTORE_CANARY_WRITE_DISABLED"]);
  assert.strictEqual(db.__writes.length, 0);
}

async function firestoreBackedCanarySeedsThenConsumesPendingWatchdogRequest() {
  const db = buildMemoryDb();
  const output = await runRepairQueueFirestoreCanary({
    db,
    env: {
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_COLLECTION_PREFIX: "paperopcanarytest__",
    },
    recordedAt: "2026-04-21T09:00:00.000Z",
  });
  assert.strictEqual(output.ok, true);
  assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_HEALTHY");
  assert.strictEqual(output.canary_mode, "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION");
  assert.strictEqual(output.collection_prefix, "paperopcanarytest__");
  assert.strictEqual(output.firestore_write_performed, true);
  assert.strictEqual(output.exchange_write_performed, false);
  assert.strictEqual(output.seed_write_n, 4);
  assert.strictEqual(output.selected_issue_code, "NATIVE_REFRESH_UNHEALTHY");
  assert.strictEqual(output.summary.requested_repair_n, 1);
  assert.strictEqual(output.summary.delegated_repair_n, 1);
  assert.strictEqual(output.summary.completion_success_n, 1);
  assert.strictEqual(output.summary.completion_failed_n, 0);
  assert.strictEqual(output.refresh_call_n, 1);
  assert.strictEqual(output.refresh_calls[0].writerSource, "BINANCE_TICK_EXIT");
  assert.strictEqual(output.refresh_calls[0].liveDryRun, true);
  assert.deepStrictEqual(output.verdict.failed_invariants, []);
  const serialized = JSON.stringify(output);
  assert.strictEqual(serialized.includes("apiKey"), false);
  assert.strictEqual(serialized.includes("apiSecret"), false);
  assert.strictEqual(serialized.includes("canary-secret"), false);
  assert.ok(db.__writes.some((row) => String(row.collection).endsWith("exit_repair_requests_v2")));
  assert.ok(db.__writes.some((row) => String(row.collection).endsWith("repair_execution_ledger_v2")));
}

async function main() {
  await disabledCanaryFailsClosedBeforeFirestoreWrite();
  await firestoreBackedCanarySeedsThenConsumesPendingWatchdogRequest();
  console.log("V2_REPAIR_QUEUE_FIRESTORE_CANARY_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
