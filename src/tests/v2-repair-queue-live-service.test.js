"use strict";

const assert = require("assert");
const {
  resolveRepairQueueLiveServiceConfig,
  buildRepairQueueLiveServiceSummary,
  runRepairQueueLiveService,
  __test,
} = require("../v2/repairQueueLiveService");

(function configUsesFailClosedDefaults() {
  const cfg = resolveRepairQueueLiveServiceConfig({});
  assert.strictEqual(cfg.service_name, "V2_REPAIR_EXECUTOR");
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.failClosed, true);
  assert.strictEqual(cfg.batchLimit, 10);
  assert.strictEqual(cfg.maxCompletionFailureCount, 0);
  assert.strictEqual(cfg.maxSkippedRepairCount, 0);
  assert.strictEqual(cfg.maxMissingContextCount, 0);
})();

(function summaryMarksHealthyWhenRunIsClean() {
  const summary = buildRepairQueueLiveServiceSummary({
    config: {
      service_name: "V2_REPAIR_EXECUTOR",
      maxCompletionFailureCount: 0,
      maxSkippedRepairCount: 0,
      maxMissingContextCount: 0,
    },
    liveWorkerRun: {
      queue_run: {
        requested_repair_n: 2,
        missing_projection_cycle_ids: [],
        missing_protection_runtime_cycle_ids: [],
        batch: {
          delegated_n: 2,
          skipped_n: 0,
        },
      },
      completion_attempt_n: 2,
      completion_success_n: 2,
      completion_failed_n: 0,
    },
  });
  assert.strictEqual(summary.status, "HEALTHY");
  assert.strictEqual(summary.blocker_reason_n, 0);
})();

(function summaryMarksIdleRunAsHealthyWithIdleFlag() {
  const summary = buildRepairQueueLiveServiceSummary({
    config: {
      service_name: "V2_REPAIR_EXECUTOR",
      maxCompletionFailureCount: 0,
      maxSkippedRepairCount: 0,
      maxMissingContextCount: 0,
    },
    liveWorkerRun: {
      queue_run: {
        requested_repair_n: 0,
        missing_projection_cycle_ids: [],
        missing_protection_runtime_cycle_ids: [],
        batch: {
          delegated_n: 0,
          skipped_n: 0,
        },
      },
      completion_attempt_n: 0,
      completion_success_n: 0,
      completion_failed_n: 0,
    },
  });
  assert.strictEqual(summary.status, "HEALTHY");
  assert.strictEqual(summary.idle, true);
  assert.strictEqual(summary.blocker_reason_n, 0);
})();

(function summaryMarksDegradedWhenFailureThresholdIsExceeded() {
  const summary = buildRepairQueueLiveServiceSummary({
    config: {
      service_name: "V2_REPAIR_EXECUTOR",
      maxCompletionFailureCount: 0,
      maxSkippedRepairCount: 0,
      maxMissingContextCount: 0,
    },
    liveWorkerRun: {
      queue_run: {
        requested_repair_n: 2,
        missing_projection_cycle_ids: ["PCY__MISS"],
        missing_protection_runtime_cycle_ids: [],
        batch: {
          delegated_n: 1,
          skipped_n: 1,
        },
      },
      completion_attempt_n: 1,
      completion_success_n: 0,
      completion_failed_n: 1,
    },
  });
  assert.strictEqual(summary.status, "DEGRADED");
  assert.deepStrictEqual(summary.blocker_reasons, [
    "COMPLETION_FAILURE_LIMIT_EXCEEDED",
    "SKIPPED_REPAIR_LIMIT_EXCEEDED",
    "MISSING_CONTEXT_LIMIT_EXCEEDED",
  ]);
})();

(async function disabledServiceReturnsWithoutCallingWorker() {
  let called = false;
  const result = await runRepairQueueLiveService({
    env: {
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "0",
    },
    executeRepairQueueLiveWorkerFn: async () => {
      called = true;
      return {};
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "DISABLED");
  assert.strictEqual(called, false);
})();

(async function failClosedServiceRejectsDegradedRun() {
  const result = await runRepairQueueLiveService({
    env: {
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_FAIL_CLOSED: "1",
    },
    executeDelegatedRepair: async () => ({ writeDecision: { ok: true } }),
    executeRepairQueueLiveWorkerFn: async () => ({
      queue_run: {
        requested_repair_n: 1,
        missing_projection_cycle_ids: [],
        missing_protection_runtime_cycle_ids: [],
        batch: {
          delegated_n: 1,
          skipped_n: 0,
        },
      },
      completion_attempt_n: 1,
      completion_success_n: 0,
      completion_failed_n: 1,
    }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, "DEGRADED");
  assert.strictEqual(result.fail_closed_triggered, true);
  assert.deepStrictEqual(result.summary.blocker_reasons, ["COMPLETION_FAILURE_LIMIT_EXCEEDED"]);
})();

(async function nonFailClosedServiceSurfacesDegradedWithoutBlocking() {
  const result = await runRepairQueueLiveService({
    env: {
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_FAIL_CLOSED: "0",
      DONBEOLJA_V2_REPAIR_QUEUE_MAX_SKIPPED_REPAIR_COUNT: "1",
    },
    executeDelegatedRepair: async () => ({ writeDecision: { ok: true } }),
    executeRepairQueueLiveWorkerFn: async () => ({
      queue_run: {
        requested_repair_n: 2,
        missing_projection_cycle_ids: [],
        missing_protection_runtime_cycle_ids: [],
        batch: {
          delegated_n: 1,
          skipped_n: 2,
        },
      },
      completion_attempt_n: 1,
      completion_success_n: 1,
      completion_failed_n: 0,
    }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "DEGRADED");
  assert.strictEqual(result.fail_closed_triggered, false);
  assert.deepStrictEqual(result.summary.blocker_reasons, ["SKIPPED_REPAIR_LIMIT_EXCEEDED"]);
})();

(function helperParsersStayStable() {
  assert.strictEqual(__test.parseBool("yes", false), true);
  assert.strictEqual(__test.parseBool("off", true), false);
  assert.strictEqual(__test.parseNonNegativeInt("-3", 4, 0), 0);
  assert.deepStrictEqual(__test.freezeArray(["A", "B"]), ["A", "B"]);
})();

console.log("V2_REPAIR_QUEUE_LIVE_SERVICE_TEST_OK");
