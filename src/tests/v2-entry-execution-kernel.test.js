"use strict";

const assert = require("assert");
const {
  evaluateEntryExecutionKernelResult,
  runV2EntryExecutionKernel,
} = require("../v2/entryExecutionKernel");

function buildSubmitterResult(overrides = {}) {
  const positionCycleId = overrides.position_cycle_id || "PCV2__ETH__KERNEL";
  const entryEventId = overrides.entry_event_id || "ENTRY__ETH__KERNEL";
  const runtimeDoc = {
    protection_runtime_id: `PRTV2__${positionCycleId}`,
    position_cycle_id: positionCycleId,
    health_status: "HEALTHY",
    sl_order_id: "STOP__KERNEL",
    tp1_order_id: "TP1__KERNEL",
    ...(overrides.runtimeDoc || {}),
  };
  const positionCycle = {
    position_cycle_id: positionCycleId,
    entry_event_id: entryEventId,
    status: "PROTECTION_PENDING",
    ...(overrides.positionCycle || {}),
  };
  return {
    ok: true,
    reason: "ENTRY_SUBMITTED_AND_PROTECTED",
    fill: {
      status: "FILLED",
      entry_event_id: entryEventId,
      entry_order_id: "ORDER__KERNEL",
      entry_fill_group_id: "FILL_GROUP__KERNEL",
      entry_price: 2500,
      entry_qty_abs: 0.8,
      ...(overrides.fill || {}),
    },
    executedEntry: {
      positionCycle,
      protectionPlan: {
        tp1_qty_abs: 0.4,
      },
      ...(overrides.executedEntry || {}),
    },
    protectionEvidence: {
      ok: true,
      reason: "ENTRY_PROTECTION_ACTIVATION_EVIDENCE_OK",
      failed_check_ids: [],
      ...(overrides.protectionEvidence || {}),
    },
    protectionResult: {
      ok: true,
      reason: "ENTRY_PROTECTION_ACTIVE",
      activationCommit: {
        ok: true,
        position_cycle_id: positionCycleId,
        position_cycle_status: "ACTIVE_PROTECTED",
        protection_runtime_id: runtimeDoc.protection_runtime_id,
        chainAudit: {
          ok: true,
          fail_n: 0,
          failed_check_ids: [],
          ...(overrides.chainAudit || {}),
        },
        ...(overrides.activationCommit || {}),
      },
      protectionWriteResult: {
        writeDecision: {
          ok: true,
          ...(overrides.writeDecision || {}),
        },
        runtimeDoc,
        ...(overrides.protectionWriteResult || {}),
      },
      ...(overrides.protectionResult || {}),
    },
    ...(overrides.root || {}),
  };
}

(function validSubmitterEvidencePassesKernelAudit() {
  const audit = evaluateEntryExecutionKernelResult(buildSubmitterResult());
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.reason, "ENTRY_EXECUTION_KERNEL_EVIDENCE_OK");
  assert.strictEqual(audit.fail_n, 0);
  assert.ok(audit.passed_check_ids.includes("ENTRY_KERNEL_RUNTIME_HEALTHY"));
  assert.ok(audit.passed_check_ids.includes("ENTRY_KERNEL_TP1_ORDER_PRESENT"));
})();

(function fakeSubmitterOkWithoutProtectionEvidenceFailsClosed() {
  const audit = evaluateEntryExecutionKernelResult({
    ok: true,
    reason: "ENTRY_SUBMITTED_AND_PROTECTED",
    fill: {
      status: "FILLED",
      entry_event_id: "ENTRY__FAKE_OK",
    },
    executedEntry: {
      positionCycle: {
        position_cycle_id: "PCV2__FAKE_OK",
        entry_event_id: "ENTRY__FAKE_OK",
        status: "PROTECTION_PENDING",
      },
    },
    protectionEvidence: {
      ok: true,
    },
    protectionResult: {
      ok: true,
    },
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("ENTRY_KERNEL_ACTIVATION_COMMIT_OK"));
  assert.ok(audit.failed_check_ids.includes("ENTRY_KERNEL_RUNTIME_HEALTHY"));
  assert.ok(audit.failed_check_ids.includes("ENTRY_KERNEL_SL_ORDER_PRESENT"));
  assert.ok(audit.failed_check_ids.includes("ENTRY_KERNEL_TP1_ORDER_PRESENT"));
})();

(function dryRunOrPartialSubmitterResultIsNotExecutableSuccess() {
  const audit = evaluateEntryExecutionKernelResult(buildSubmitterResult({
    fill: {
      status: "DRY_RUN",
    },
  }));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("ENTRY_KERNEL_FILL_FILLED"));
})();

(function runtimePositionCycleDriftFailsClosed() {
  const audit = evaluateEntryExecutionKernelResult(buildSubmitterResult({
    runtimeDoc: {
      position_cycle_id: "PCV2__OTHER",
    },
  }));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("ENTRY_KERNEL_RUNTIME_POSITION_CYCLE_MATCH"));
})();

async function kernelAcceptsOnlyFullyProtectedSubmitterResult() {
  const result = await runV2EntryExecutionKernel({
    runEntrySubmitter: async () => buildSubmitterResult(),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_ENTRY_EXECUTION_KERNEL_PROTECTED");
  assert.strictEqual(result.kernelAudit.position_cycle_id, "PCV2__ETH__KERNEL");
}

async function kernelBlocksFakeSubmitterSuccess() {
  const result = await runV2EntryExecutionKernel({
    runEntrySubmitter: async () => ({
      ok: true,
      reason: "ENTRY_SUBMITTED_AND_PROTECTED",
    }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_ENTRY_EXECUTION_KERNEL_BLOCKED");
  assert.ok(result.kernelAudit.failed_check_ids.includes("ENTRY_KERNEL_FILL_FILLED"));
  assert.ok(result.kernelAudit.failed_check_ids.includes("ENTRY_KERNEL_TP1_ORDER_PRESENT"));
}

async function kernelReturnsStructuredFailureWhenSubmitterThrows() {
  const result = await runV2EntryExecutionKernel({
    runEntrySubmitter: async () => {
      throw new Error("entry transport timeout");
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_ENTRY_EXECUTION_KERNEL_THROWN");
  assert.strictEqual(result.error_code, "ENTRY_TRANSPORT_TIMEOUT");
  assert.deepStrictEqual(result.kernelAudit.failed_check_ids, ["ENTRY_KERNEL_SUBMITTER_RETURNED"]);
}

async function main() {
  await kernelAcceptsOnlyFullyProtectedSubmitterResult();
  await kernelBlocksFakeSubmitterSuccess();
  await kernelReturnsStructuredFailureWhenSubmitterThrows();
}

main()
  .then(() => {
    console.log("V2_ENTRY_EXECUTION_KERNEL_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
