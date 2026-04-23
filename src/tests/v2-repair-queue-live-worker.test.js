"use strict";

const assert = require("assert");
const { executeRepairQueueLiveWorker } = require("../v2/repairQueueLiveWorker");

function buildFakeDb() {
  const writes = [];
  const repairRequests = [
    {
      exit_repair_request_id: "RQRV2__TP1__1",
      position_cycle_id: "PCY__1",
      issue_code: "TP1_ORDER_MISSING",
      requested_action: "ENSURE_TP1_ORDER",
      status: "PENDING",
      created_at: "2026-04-21T04:00:00.000Z",
    },
    {
      exit_repair_request_id: "RQRV2__TRAIL__2",
      position_cycle_id: "PCY__2",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
      status: "PENDING",
      created_at: "2026-04-21T04:00:05.000Z",
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
              writes.push({ name, id, payload, options });
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

async function liveWorkerCompletesDelegatedRepairsAndPersistsLedgers() {
  const db = buildFakeDb();
  const result = await executeRepairQueueLiveWorker({
    db,
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "2",
    },
    recordedAt: "2026-04-21T04:10:00.000Z",
    executeDelegatedRepair: async ({ delegatedRepair }) => ({
      runtimeDoc: {
        position_cycle_id: delegatedRepair.position_cycle_id,
      },
      writeDecision: {
        ok: delegatedRepair.issue_code === "TP1_ORDER_MISSING",
        requires_repair: delegatedRepair.issue_code !== "TP1_ORDER_MISSING",
        runtime_write_reason: delegatedRepair.issue_code === "TP1_ORDER_MISSING"
          ? "TP1_REPAIRED"
          : "REFRESH_STOP_FAILED",
        native_refresh_status: delegatedRepair.issue_code === "TP1_ORDER_MISSING" ? "OK" : "ERROR",
        health_status: delegatedRepair.issue_code === "TP1_ORDER_MISSING" ? "HEALTHY" : "DEGRADED_UNPROTECTED",
        placement_issue_codes: delegatedRepair.issue_code === "TP1_ORDER_MISSING" ? [] : ["UNPROTECTED_ACTIVE_POSITION"],
      },
    }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.queue_run.batch.delegated_n, 2);
  assert.strictEqual(result.completion_attempt_n, 2);
  assert.strictEqual(result.completion_success_n, 1);
  assert.strictEqual(result.completion_failed_n, 1);
  assert.ok(result.completion_attempts.some((row) => row.completion_ledger.execution_status === "COMPLETED_SUCCESS"));
  assert.ok(result.completion_attempts.some((row) => row.completion_ledger.execution_status === "COMPLETED_FAILED"));
  assert.strictEqual(
    db.__writes.filter((row) => row.name.endsWith("repair_execution_ledger_v2")).length,
    4
  );
}

async function liveWorkerPersistsFailedCompletionWhenExecutorThrows() {
  const db = buildFakeDb();
  const result = await executeRepairQueueLiveWorker({
    db,
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "1",
    },
    recordedAt: "2026-04-21T04:20:00.000Z",
    executeDelegatedRepair: async () => {
      throw new Error("REPAIR_EXECUTOR_CRASHED");
    },
  });
  assert.strictEqual(result.completion_attempt_n, 1);
  assert.strictEqual(result.completion_failed_n, 1);
  assert.strictEqual(result.completion_attempts[0].execution_error, "REPAIR_EXECUTOR_CRASHED");
  assert.strictEqual(result.completion_attempts[0].completion_ledger.execution_status, "COMPLETED_FAILED");
  assert.strictEqual(result.completion_attempts[0].completion_ledger.result_snapshot.runtime_write_reason, "REPAIR_EXECUTION_EXCEPTION");
}

async function main() {
  await liveWorkerCompletesDelegatedRepairsAndPersistsLedgers();
  await liveWorkerPersistsFailedCompletionWhenExecutorThrows();
  console.log("V2_REPAIR_QUEUE_LIVE_WORKER_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
