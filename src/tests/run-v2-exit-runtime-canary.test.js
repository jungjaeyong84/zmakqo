"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main, __test } = require("../../scripts/run-v2-exit-runtime-canary");
const { buildExitRuntimeProjectionId, buildProtectionRuntimeId } = require("../v2/contracts");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-exit-runtime-canary-"));
}

function outputEnv(dir) {
  return {
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FILE: path.join(dir, "latest.json"),
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_HISTORY_FILE: path.join(dir, "history.jsonl"),
  };
}

function buildFakeDb() {
  const cycleId = "PCY__BINANCEFUT__ETHUSDT__LONG__ABC";
  const collections = {
    dbjv2__position_cycles_v2: [{ position_cycle_id: cycleId, symbol: "ETHUSDT", status: "ACTIVE_PROTECTED" }],
    dbjv2__exit_runtime_projection_v2: [{
      exit_runtime_projection_id: buildExitRuntimeProjectionId({ positionCycleId: cycleId }),
      position_cycle_id: cycleId,
      stage: "PRE_TP1",
      health_status: "HEALTHY",
      chosen_stop_source: "SL",
      chosen_stop_price: 2400,
      native_stop_price: 2400,
    }],
    dbjv2__protection_runtime_v2: [{
      protection_runtime_id: buildProtectionRuntimeId({ positionCycleId: cycleId }),
      position_cycle_id: cycleId,
      sl_order_id: "SL__1",
      sl_order_status: "PLACED",
      tp1_order_id: "TP1__1",
      tp1_order_status: "PLACED",
      native_stop_price: 2400,
      native_refresh_status: "OK",
      health_status: "HEALTHY",
      last_gap_ms: 0,
    }],
    dbjv2__canonical_exit_transitions_v2: [],
    dbjv2__trade_alert_outbox_v2: [],
  };
  const writes = [];
  return {
    __writes: writes,
    collection(collectionName) {
      return {
        doc(id) {
          return {
            async get() {
              const rows = collections[collectionName] || [];
              const doc = rows.find((row) => row.position_cycle_id === id || row.exit_runtime_projection_id === id || row.protection_runtime_id === id || row.exit_runtime_canary_id === id);
              return { exists: !!doc, data: () => ({ ...doc }) };
            },
            async set(payload, options = {}) {
              if (!collections[collectionName]) collections[collectionName] = [];
              collections[collectionName].push({ ...payload });
              writes.push({ collectionName, id, payload, options });
            },
          };
        },
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  const rows = (collections[collectionName] || [])
                    .filter((row) => {
                      if (op === "==") return row[field] === value;
                      if (op === ">=") return Number(row[field]) >= Number(value);
                      return false;
                    })
                    .slice(0, limit)
                    .map((row) => ({ data: () => ({ ...row }) }));
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

async function scriptWritesLatestHistoryAndOptionalFirestoreHistory() {
  const dir = makeTempDir();
  const env = {
    ...outputEnv(dir),
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "1",
  };
  const db = buildFakeDb();
  const artifact = await main({ env, db, setProcessExitCode: false });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.reason, "V2_EXIT_RUNTIME_CANARY_PASS");
  assert.strictEqual(artifact.exchange_write_performed, false);
  assert.strictEqual(artifact.output_file, env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FILE);
  assert.strictEqual(artifact.history_file, env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_HISTORY_FILE);
  assert.strictEqual(artifact.firestore_history_result.skipped, false);
  assert.ok(db.__writes.some((row) => row.collectionName === "dbjv2__exit_runtime_canaries_v2"));
  const latest = JSON.parse(fs.readFileSync(artifact.output_file, "utf8"));
  const historyLines = fs.readFileSync(artifact.history_file, "utf8").trim().split("\n");
  assert.strictEqual(latest.reason, "V2_EXIT_RUNTIME_CANARY_PASS");
  assert.strictEqual(historyLines.length, 1);
  assert.strictEqual(JSON.parse(historyLines[0]).scope, "exit_runtime_canary");
}

function resolvesDefaultPaths() {
  assert.ok(__test.resolveOutputFile({}).endsWith("v2_exit_runtime_canary_latest.json"));
  assert.ok(__test.resolveHistoryFile({}).endsWith("v2_exit_runtime_canary_history.jsonl"));
}

async function mainTest() {
  resolvesDefaultPaths();
  await scriptWritesLatestHistoryAndOptionalFirestoreHistory();
}

mainTest()
  .then(() => {
    console.log("RUN_V2_EXIT_RUNTIME_CANARY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
