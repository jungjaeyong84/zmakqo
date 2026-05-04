"use strict";

const assert = require("assert");
const { fetchRepairQueueInputs, runRepairQueueWorker } = require("../v2/repairQueueWorker");

function buildFakeDb() {
  const writes = [];
  const repairRequests = [
    {
      exit_repair_request_id: "RQRV2__TP1__1",
      position_cycle_id: "PCY__1",
      issue_code: "TP1_ORDER_MISSING",
      requested_action: "ENSURE_TP1_ORDER",
      status: "PENDING",
      created_at: "2026-04-21T02:00:00.000Z",
    },
    {
      exit_repair_request_id: "RQRV2__STALE__0",
      position_cycle_id: "PCY__STALE",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
      status: "COMPLETED",
      created_at: "2026-04-21T01:00:00.000Z",
    },
    {
      exit_repair_request_id: "RQRV2__TRAIL__2",
      position_cycle_id: "PCY__2",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
      status: "PENDING",
      created_at: "2026-04-21T02:00:05.000Z",
    },
  ];
  const docs = {
    POSITION_CYCLES: {
      PCY__1: {
        position_cycle_id: "PCY__1",
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        position_side: "LONG",
        entry_price: 100000,
      },
      PCY__2: {
        position_cycle_id: "PCY__2",
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        position_side: "LONG",
        entry_price: 2000,
      },
    },
    EXIT_RUNTIME_PROJECTIONS: {
      ERPv2__PCY__1: {
        exit_runtime_projection_id: "ERPv2__PCY__1",
        position_cycle_id: "PCY__1",
        stage: "PRE_TP1",
        tp1_target_price: 101680,
        tp1_target_qty_abs: 0.5,
      },
      ERPv2__PCY__2: {
        exit_runtime_projection_id: "ERPv2__PCY__2",
        position_cycle_id: "PCY__2",
        stage: "TRAIL_ACTIVE",
        final_effective_stop: 2010,
        chosen_stop_source: "TRAIL",
      },
    },
    PROTECTION_RUNTIME: {
      PRTV2__PCY__1: {
        protection_runtime_id: "PRTV2__PCY__1",
        position_cycle_id: "PCY__1",
        tp1_order_id: null,
      },
      PRTV2__PCY__2: {
        protection_runtime_id: "PRTV2__PCY__2",
        position_cycle_id: "PCY__2",
        native_stop_price: null,
        tp1_order_id: "TP1__ok",
        tp1_order_status: "PLACED",
      },
    },
  };
  return {
    __writes: writes,
    collection(name) {
      return {
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  if (name.endsWith("exit_repair_requests_v2")) {
                    return {
                      docs: repairRequests
                        .filter((row) => op === "==" && row[field] === value)
                        .slice(0, limit)
                        .map((row) => ({ data: () => row })),
                    };
                  }
                  return { docs: [] };
                },
              };
            },
          };
        },
        limit(limit) {
          return {
            async get() {
              if (name.endsWith("exit_repair_requests_v2")) {
                return {
                  docs: repairRequests.slice(0, limit).map((row) => ({ data: () => row })),
                };
              }
              return { docs: [] };
            },
          };
        },
        doc(id) {
          return {
            async set(payload, options) {
              writes.push({ collection: name, docId: id, payload, options });
            },
            async get() {
              const collectionKey = name.endsWith("exit_runtime_projection_v2")
                ? "EXIT_RUNTIME_PROJECTIONS"
                : (name.endsWith("protection_runtime_v2")
                    ? "PROTECTION_RUNTIME"
                    : (name.endsWith("position_cycles_v2") ? "POSITION_CYCLES" : null));
              const doc = collectionKey ? docs[collectionKey][id] : null;
              return {
                exists: !!doc,
                data() {
                  return doc;
                },
              };
            },
          };
        },
      };
    },
  };
}

function buildStaleRepairQueueFakeDb() {
  const writes = [];
  const repairRequests = [
    {
      exit_repair_request_id: "RQRV2__LINK__STALE",
      position_cycle_id: "PCY__LINK__OLD",
      issue_code: "TP1_ORDER_MISSING",
      requested_action: "ENSURE_TP1_ORDER",
      status: "PENDING",
      created_at: "2026-04-21T01:00:00.000Z",
    },
    {
      exit_repair_request_id: "RQRV2__DOGE__CURRENT",
      position_cycle_id: "PCY__DOGE__LIVE",
      issue_code: "TP1_ORDER_QTY_MISMATCH",
      requested_action: "ENSURE_TP1_ORDER",
      status: "PENDING",
      created_at: "2026-04-21T01:01:00.000Z",
    },
  ];
  const docs = {
    POSITION_CYCLES: {
      PCY__LINK__OLD: {
        position_cycle_id: "PCY__LINK__OLD",
        exchange: "BINANCEFUT",
        symbol: "LINKUSDT",
        position_side: "SHORT",
        entry_price: 9.2,
      },
      PCY__DOGE__LIVE: {
        position_cycle_id: "PCY__DOGE__LIVE",
        exchange: "BINANCEFUT",
        symbol: "DOGEUSDT",
        position_side: "LONG",
        entry_price: 0.112,
      },
    },
    EXIT_RUNTIME_PROJECTIONS: {
      ERPv2__PCY__LINK__OLD: {
        exit_runtime_projection_id: "ERPv2__PCY__LINK__OLD",
        position_cycle_id: "PCY__LINK__OLD",
        stage: "PRE_TP1",
        tp1_target_price: 9.0,
        tp1_target_qty_abs: 10,
      },
      ERPv2__PCY__DOGE__LIVE: {
        exit_runtime_projection_id: "ERPv2__PCY__DOGE__LIVE",
        position_cycle_id: "PCY__DOGE__LIVE",
        stage: "PRE_TP1",
        tp1_target_price: 0.115,
        tp1_target_qty_abs: 1070,
      },
    },
    PROTECTION_RUNTIME: {
      PRTV2__PCY__LINK__OLD: {
        protection_runtime_id: "PRTV2__PCY__LINK__OLD",
        position_cycle_id: "PCY__LINK__OLD",
        tp1_order_id: null,
      },
      PRTV2__PCY__DOGE__LIVE: {
        protection_runtime_id: "PRTV2__PCY__DOGE__LIVE",
        position_cycle_id: "PCY__DOGE__LIVE",
        tp1_order_id: "TP1__BAD_QTY",
        tp1_order_status: "PLACED",
      },
    },
    position_read_model_latest: {
      POSITION_READ_MODEL_LATEST__BINANCEFUT__LINKUSDT: {
        read_model_id: "POSITION_READ_MODEL_LATEST__BINANCEFUT__LINKUSDT",
        exchange: "BINANCEFUT",
        symbol: "LINKUSDT",
        after_summary: {
          symbol: "LINKUSDT",
          state: "FLAT",
          position_cycle_id: "PCY__LINK__OLD",
          qty_base: 0,
        },
      },
      POSITION_READ_MODEL_LATEST__BINANCEFUT__DOGEUSDT: {
        read_model_id: "POSITION_READ_MODEL_LATEST__BINANCEFUT__DOGEUSDT",
        exchange: "BINANCEFUT",
        symbol: "DOGEUSDT",
        after_summary: {
          symbol: "DOGEUSDT",
          state: "ACTIVE",
          position_cycle_id: "PCY__DOGE__LIVE",
          qty_base: 1070,
        },
      },
    },
  };
  return {
    __writes: writes,
    collection(name) {
      return {
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  if (name.endsWith("exit_repair_requests_v2")) {
                    return {
                      docs: repairRequests
                        .filter((row) => op === "==" && row[field] === value)
                        .slice(0, limit)
                        .map((row) => ({ data: () => row })),
                    };
                  }
                  return { docs: [] };
                },
              };
            },
          };
        },
        doc(id) {
          return {
            async set(payload, options) {
              writes.push({ collection: name, docId: id, payload, options });
            },
            async get() {
              if (name === "position_read_model_latest") {
                const doc = docs.position_read_model_latest[id] || null;
                return {
                  exists: !!doc,
                  data() {
                    return doc;
                  },
                };
              }
              const collectionKey = name.endsWith("exit_runtime_projection_v2")
                ? "EXIT_RUNTIME_PROJECTIONS"
                : (name.endsWith("protection_runtime_v2")
                    ? "PROTECTION_RUNTIME"
                    : (name.endsWith("position_cycles_v2") ? "POSITION_CYCLES" : null));
              const doc = collectionKey ? docs[collectionKey][id] : null;
              return {
                exists: !!doc,
                data() {
                  return doc;
                },
              };
            },
          };
        },
      };
    },
  };
}

async function fetchRepairQueueInputsLoadsBoundedQueueAndCycleContext() {
  const inputs = await fetchRepairQueueInputs({
    db: buildFakeDb(),
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "2",
    },
  });
  assert.strictEqual(inputs.repair_request_limit, 2);
  assert.strictEqual(inputs.pending_only, true);
  assert.strictEqual(inputs.repair_request_scan_limit, 10);
  assert.strictEqual(inputs.repair_requests.length, 2);
  assert.deepStrictEqual(inputs.requested_position_cycle_ids, ["PCY__1", "PCY__2"]);
  assert.strictEqual(inputs.position_cycles.length, 2);
  assert.strictEqual(inputs.projections.length, 2);
  assert.strictEqual(inputs.protection_runtimes.length, 2);
  assert.deepStrictEqual(inputs.missing_position_cycle_ids, []);
  assert.deepStrictEqual(inputs.missing_projection_cycle_ids, []);
  assert.deepStrictEqual(inputs.missing_protection_runtime_cycle_ids, []);
}

async function runRepairQueueWorkerBuildsDelegationBatch() {
  const db = buildFakeDb();
  const result = await runRepairQueueWorker({
    db,
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "2",
    },
    placementStartedAt: "2026-04-21T02:10:00.000Z",
    placementRetryIdPrefix: "RQW",
    persistExecutionLedger: true,
    recordedAt: "2026-04-21T02:10:10.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.requested_repair_n, 2);
  assert.deepStrictEqual(result.missing_position_cycle_ids, []);
  assert.strictEqual(result.batch.delegated_n, 2);
  assert.strictEqual(result.batch.skipped_n, 0);
  assert.strictEqual(result.batch.delegated_repairs[0].envelope.writer_delegation.delegated_to_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(result.execution_ledger_docs.length, 2);
  assert.strictEqual(result.persisted_execution_ledger.length, 2);
  assert.strictEqual(db.__writes.length, 2);
  assert.ok(db.__writes.every((row) => row.collection.endsWith("repair_execution_ledger_v2")));
}

async function runRepairQueueWorkerReportsMissingProjectionContext() {
  const db = buildFakeDb();
  db.collection = function collection(name) {
    const base = buildFakeDb().collection(name);
    if (!name.endsWith("exit_runtime_projection_v2")) return base;
    return {
      doc(id) {
        return {
          async get() {
            return {
              exists: id !== "ERPv2__PCY__2",
              data() {
                if (id === "ERPv2__PCY__2") return null;
                return {
                  exit_runtime_projection_id: id,
                  position_cycle_id: "PCY__1",
                  stage: "PRE_TP1",
                  tp1_target_price: 101680,
                  tp1_target_qty_abs: 0.5,
                };
              },
            };
          },
        };
      },
      limit: base.limit,
    };
  };
  const result = await runRepairQueueWorker({
    db,
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "2",
    },
  });
  assert.ok(result.missing_projection_cycle_ids.includes("PCY__2"));
  assert.strictEqual(result.batch.skipped_n >= 1, true);
}

async function runRepairQueueWorkerReportsMissingPositionCycleContext() {
  const db = buildFakeDb();
  db.collection = function collection(name) {
    const base = buildFakeDb().collection(name);
    if (!name.endsWith("position_cycles_v2")) return base;
    return {
      doc(id) {
        return {
          async get() {
            return {
              exists: id !== "PCY__2",
              data() {
                if (id === "PCY__2") return null;
                return {
                  position_cycle_id: "PCY__1",
                  exchange: "BINANCEFUT",
                  symbol: "BTCUSDT",
                  position_side: "LONG",
                  entry_price: 100000,
                };
              },
            };
          },
        };
      },
      limit: base.limit,
    };
  };
  const result = await runRepairQueueWorker({
    db,
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "2",
    },
  });
  assert.ok(result.missing_position_cycle_ids.includes("PCY__2"));
  assert.strictEqual(result.batch.delegated_n, 1);
  assert.ok(result.batch.skipped_repairs.some((row) => row.skip_reason === "POSITION_CYCLE_REQUIRED"));
}

async function runRepairQueueWorkerSkipsStaleReadModelBeforeBatchLimit() {
  const db = buildStaleRepairQueueFakeDb();
  const result = await runRepairQueueWorker({
    db,
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "1",
      DONBEOLJA_V2_REPAIR_QUEUE_SCAN_LIMIT: "5",
      DONBEOLJA_V2_REPAIR_QUEUE_REQUIRE_LATEST_ACTIVE_READ_MODEL: "1",
    },
    placementStartedAt: "2026-04-21T02:10:00.000Z",
    placementRetryIdPrefix: "RQW",
    persistExecutionLedger: true,
    recordedAt: "2026-04-21T02:10:10.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.repair_requests_scanned_n, 2);
  assert.strictEqual(result.latest_active_read_model_required, true);
  assert.strictEqual(result.latest_active_read_model_skipped_n, 1);
  assert.strictEqual(result.latest_active_read_model_skipped_repairs[0].exit_repair_request_id, "RQRV2__LINK__STALE");
  assert.strictEqual(result.latest_active_read_model_skipped_repairs[0].skip_reason, "STALE_REPAIR_REQUEST_NOT_LATEST_ACTIVE_POSITION");
  assert.strictEqual(result.requested_repair_n, 1);
  assert.deepStrictEqual(result.requested_position_cycle_ids, ["PCY__DOGE__LIVE"]);
  assert.strictEqual(result.batch.delegated_n, 1);
  assert.strictEqual(result.batch.delegated_repairs[0].exit_repair_request_id, "RQRV2__DOGE__CURRENT");
  assert.strictEqual(result.execution_ledger_docs.length, 2);
  assert.ok(result.execution_ledger_docs.some((row) => row.execution_status === "SKIPPED"));
  assert.ok(result.execution_ledger_docs.some((row) => row.execution_status === "DELEGATED"));
}

async function main() {
  await fetchRepairQueueInputsLoadsBoundedQueueAndCycleContext();
  await runRepairQueueWorkerBuildsDelegationBatch();
  await runRepairQueueWorkerReportsMissingProjectionContext();
  await runRepairQueueWorkerReportsMissingPositionCycleContext();
  await runRepairQueueWorkerSkipsStaleReadModelBeforeBatchLimit();
  console.log("V2_REPAIR_QUEUE_WORKER_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
