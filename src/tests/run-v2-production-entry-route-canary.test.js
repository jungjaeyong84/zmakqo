"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main, __test } = require("../../scripts/run-v2-production-entry-route-canary");
const protectedCanary = require("../v2/productionEntryProtectedCanary");

async function writesArtifactAndKeepsExchangeWriteDisabled() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-prod-route-canary-"));
  const db = protectedCanary.__test.createMemoryFirestore();
  const outputFile = path.join(dir, "canary.json");
  const historyFile = path.join(dir, "history.jsonl");
  assert.strictEqual(__test.resolveOutputFile({ DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FILE: outputFile }), outputFile);
  assert.strictEqual(__test.resolveHistoryFile({ DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_HISTORY_FILE: historyFile }), historyFile);
  const result = await main({
    db,
    env: {
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FILE: outputFile,
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_HISTORY_FILE: historyFile,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.output_file, outputFile);
  assert.strictEqual(result.history_file, historyFile);
  assert.strictEqual(result.exchange_write_performed, false);
  assert.strictEqual(result.firestore_history_result.reason, "PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_DISABLED");
  assert.strictEqual(result.firestore_history_result.skipped, true);
  assert.ok(fs.existsSync(outputFile));
  assert.ok(fs.existsSync(historyFile));
  const artifact = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.strictEqual(artifact.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS");
  assert.strictEqual(artifact.prerequisite_ledgers.ok, true);
  assert.strictEqual(artifact.route_result_summary.reason, "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED");
  assert.strictEqual(artifact.route_result_summary.audit_ledger_reason, "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED");
  assert.strictEqual(artifact.route_result_summary.entry_sizing_decision.ok, true);
  assert.strictEqual(artifact.route_result_summary.entry_sizing_decision.status, "APPROVED");
  assert.strictEqual(artifact.route_result_summary.entry_sizing_decision.entry_qty_abs, 0.5);
  const historyRows = fs.readFileSync(historyFile, "utf8").trim().split(/\r?\n/);
  assert.strictEqual(historyRows.length, 1);
}

async function writesFirestoreHistoryWhenExplicitlyEnabled() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-prod-route-canary-fs-"));
  const db = protectedCanary.__test.createMemoryFirestore();
  const result = await main({
    db,
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "1",
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FILE: path.join(dir, "canary.json"),
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_HISTORY_FILE: path.join(dir, "history.jsonl"),
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.firestore_history_result.reason, "PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITTEN");
  assert.strictEqual(result.firestore_history_result.skipped, false);
  assert.ok(result.firestore_history_result.docId);
  assert.ok(db.__v2_canary_writes.some((row) => row.ref.collectionName === "dbjv2__production_entry_route_canaries_v2"));
}

async function mainTest() {
  await writesArtifactAndKeepsExchangeWriteDisabled();
  await writesFirestoreHistoryWhenExplicitlyEnabled();
}

mainTest()
  .then(() => {
    console.log("RUN_V2_PRODUCTION_ENTRY_ROUTE_CANARY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
