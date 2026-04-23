"use strict";

const assert = require("assert");
const {
  buildDelegatedRepairExecutionLedgerDoc,
  buildSkippedRepairExecutionLedgerDoc,
  buildCompletedRepairExecutionLedgerDoc,
} = require("../v2/repairExecutionLedger");

(function delegatedRepairExecutionLedgerCapturesWriterDelegation() {
  const doc = buildDelegatedRepairExecutionLedgerDoc({
    delegatedRepair: {
      exit_repair_request_id: "RQRV2__TRAIL__1",
      position_cycle_id: "PCY__1",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
      envelope: {
        repair_command: {
          requested_action: "REFRESH_NATIVE_STOP",
        },
        writer_delegation: {
          delegated_to_service: "V2_PROTECTION_WRITER",
          requested_by_service: "V2_REPAIR_EXECUTOR",
          command: {
            command_type: "REFRESH_NATIVE_STOP",
            trigger_price: 2010,
          },
          attempt_meta: {
            placement_attempt_id: "PRATTV2__1",
          },
        },
      },
    },
    recordedAt: "2026-04-21T03:00:00.000Z",
  });
  assert.strictEqual(doc.execution_status, "DELEGATED");
  assert.strictEqual(doc.delegated_to_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(doc.requested_by_service, "V2_REPAIR_EXECUTOR");
  assert.strictEqual(doc.command_type, "REFRESH_NATIVE_STOP");
  assert.strictEqual(doc.command_snapshot.trigger_price, 2010);
})();

(function skippedRepairExecutionLedgerCapturesSkipReason() {
  const doc = buildSkippedRepairExecutionLedgerDoc({
    skippedRepair: {
      exit_repair_request_id: "RQRV2__TP1__2",
      position_cycle_id: "PCY__2",
      issue_code: "TP1_ORDER_MISSING",
      requested_action: "ENSURE_TP1_ORDER",
      skip_reason: "PROJECTION_REQUIRED",
    },
    recordedAt: "2026-04-21T03:00:01.000Z",
  });
  assert.strictEqual(doc.execution_status, "SKIPPED");
  assert.strictEqual(doc.skip_reason, "PROJECTION_REQUIRED");
  assert.strictEqual(doc.delegated_to_service, null);
  assert.strictEqual(doc.command_snapshot, null);
})();

(function completedRepairExecutionLedgerCapturesSuccessfulWriterResult() {
  const doc = buildCompletedRepairExecutionLedgerDoc({
    delegatedRepair: {
      exit_repair_request_id: "RQRV2__TRAIL__3",
      position_cycle_id: "PCY__3",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
      envelope: {
        writer_delegation: {
          delegated_to_service: "V2_PROTECTION_WRITER",
          requested_by_service: "V2_REPAIR_EXECUTOR",
          command: {
            command_type: "REFRESH_NATIVE_STOP",
            trigger_price: 2015,
          },
          attempt_meta: {
            placement_attempt_id: "PRATTV2__3",
          },
        },
      },
    },
    protectionWriteResult: {
      runtimeDoc: {
        native_stop_price: 2015,
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
    recordedAt: "2026-04-21T03:00:02.000Z",
  });
  assert.strictEqual(doc.execution_status, "COMPLETED_SUCCESS");
  assert.strictEqual(doc.result_snapshot.ok, true);
  assert.strictEqual(doc.result_snapshot.runtime_write_reason, "REFRESH_STOP_PROTECTED");
  assert.strictEqual(doc.result_snapshot.runtime_doc.native_stop_price, 2015);
  assert.deepStrictEqual(doc.result_snapshot.runbook_refs, ["RQ_RBK_02"]);
  assert.strictEqual(doc.result_snapshot.repair_evidence_summary.command_type, "REFRESH_NATIVE_STOP");
  assert.strictEqual(doc.result_snapshot.repair_evidence_summary.order_evidence[0].leg, "SL");
})();

(function completedRepairExecutionLedgerCapturesFailedWriterResult() {
  const doc = buildCompletedRepairExecutionLedgerDoc({
    delegatedRepair: {
      exit_repair_request_id: "RQRV2__TRAIL__4",
      position_cycle_id: "PCY__4",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
      envelope: {
        writer_delegation: {
          delegated_to_service: "V2_PROTECTION_WRITER",
          requested_by_service: "V2_REPAIR_EXECUTOR",
          command: {
            command_type: "REFRESH_NATIVE_STOP",
            trigger_price: 1999,
          },
          attempt_meta: {
            placement_attempt_id: "PRATTV2__4",
          },
        },
      },
    },
    protectionWriteResult: {
      runtimeDoc: {
        native_stop_price: null,
      },
      writeDecision: {
        ok: false,
        requires_repair: true,
        runtime_write_reason: "REFRESH_STOP_FAILED",
        native_refresh_status: "ERROR",
        health_status: "DEGRADED_UNPROTECTED",
        placement_issue_codes: ["UNPROTECTED_ACTIVE_POSITION"],
      },
    },
    recordedAt: "2026-04-21T03:00:03.000Z",
  });
  assert.strictEqual(doc.execution_status, "COMPLETED_FAILED");
  assert.strictEqual(doc.result_snapshot.ok, false);
  assert.strictEqual(doc.result_snapshot.requires_repair, true);
  assert.deepStrictEqual(doc.result_snapshot.placement_issue_codes, ["UNPROTECTED_ACTIVE_POSITION"]);
  assert.deepStrictEqual(doc.result_snapshot.runbook_refs, ["RQ_RBK_02"]);
})();

(function completedFullProtectionLedgerCapturesPerLegEvidenceAndRunbook() {
  const doc = buildCompletedRepairExecutionLedgerDoc({
    delegatedRepair: {
      exit_repair_request_id: "RQRV2__FULL__5",
      position_cycle_id: "PCY__5",
      issue_code: "UNPROTECTED_ACTIVE_POSITION",
      requested_action: "ENSURE_FULL_PROTECTION",
      envelope: {
        writer_delegation: {
          delegated_to_service: "V2_PROTECTION_WRITER",
          requested_by_service: "V2_REPAIR_EXECUTOR",
          command: {
            command_type: "PLACE_OR_REPLACE_FULL_PROTECTION",
            include_sl_order: true,
            include_tp1_order: true,
            commands: {
              sl: {
                command_type: "PLACE_OR_REPLACE_SL",
                trigger_price: 98.35,
              },
              tp1: {
                command_type: "PLACE_OR_REPLACE_TP1",
                trigger_price: 101.68,
                quantity_abs: 0.5,
              },
            },
          },
          attempt_meta: {
            placement_attempt_id: "PRATTV2__5",
          },
        },
      },
    },
    protectionWriteResult: {
      runtimeDoc: {
        sl_order_id: "STOP__FULL",
        sl_order_status: "PLACED",
        native_stop_price: 98.35,
        sl_ack_at: "2026-04-21T03:01:00.000Z",
        tp1_order_id: "TP1__FULL",
        tp1_order_status: "PLACED",
        native_tp1_price: 101.68,
        tp1_ack_at: "2026-04-21T03:01:01.000Z",
      },
      writeDecision: {
        ok: true,
        requires_repair: false,
        runtime_write_reason: "FULL_PROTECTION_REPAIRED",
        native_refresh_status: "OK",
        health_status: "HEALTHY",
        placement_issue_codes: [],
      },
    },
    recordedAt: "2026-04-21T03:01:02.000Z",
  });
  assert.deepStrictEqual(doc.result_snapshot.runbook_refs, ["RQ_RBK_03"]);
  assert.strictEqual(doc.result_snapshot.repair_evidence_summary.command_type, "PLACE_OR_REPLACE_FULL_PROTECTION");
  assert.strictEqual(doc.result_snapshot.repair_evidence_summary.order_evidence.length, 2);
  assert.strictEqual(doc.result_snapshot.repair_evidence_summary.order_evidence[0].order_id, "STOP__FULL");
  assert.strictEqual(doc.result_snapshot.repair_evidence_summary.order_evidence[1].order_id, "TP1__FULL");
})();

console.log("V2_REPAIR_EXECUTION_LEDGER_TEST_OK");
