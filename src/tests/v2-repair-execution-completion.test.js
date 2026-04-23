"use strict";

const assert = require("assert");
const { persistCompletedRepairExecution } = require("../v2/repairExecutionCompletion");

function buildFakeDb(writes) {
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async set(payload, options) {
              writes.push({ name, id, payload, options });
            },
          };
        },
      };
    },
  };
}

(async function completionPersistenceWritesLedgerDoc() {
  const writes = [];
  const result = await persistCompletedRepairExecution({
    db: buildFakeDb(writes),
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    },
    delegatedRepair: {
      exit_repair_request_id: "RQRV2__TRAIL__5",
      position_cycle_id: "PCY__5",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
      envelope: {
        writer_delegation: {
          delegated_to_service: "V2_PROTECTION_WRITER",
          requested_by_service: "V2_REPAIR_EXECUTOR",
          command: {
            command_type: "REFRESH_NATIVE_STOP",
            trigger_price: 2020,
          },
          attempt_meta: {
            placement_attempt_id: "PRATTV2__5",
          },
        },
      },
    },
    protectionWriteResult: {
      runtimeDoc: {
        native_stop_price: 2020,
      },
      writeDecision: {
        ok: true,
        requires_repair: false,
        runtime_write_reason: "REFRESH_STOP_PROTECTED",
        native_refresh_status: "OK",
        health_status: "HEALTHY",
        placement_issue_codes: [],
      },
    },
    recordedAt: "2026-04-21T03:10:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ledger_doc.execution_status, "COMPLETED_SUCCESS");
  assert.strictEqual(result.persisted.collectionName, "dbjv2__repair_execution_ledger_v2");
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].payload.execution_status, "COMPLETED_SUCCESS");
})();

console.log("V2_REPAIR_EXECUTION_COMPLETION_TEST_OK");
