"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runner = require("../../scripts/run-v2-repair-queue-service");

(async function disabledModeWritesArtifactAndPasses() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-service-disabled-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_FILE: "v2_repair_queue_service_latest.json",
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "0",
    }, {
      runRepairQueueLiveServiceFn: async () => ({
        ok: true,
        service_name: "V2_REPAIR_EXECUTOR",
        status: "DISABLED",
        fail_closed_triggered: false,
        summary: {
          service_name: "V2_REPAIR_EXECUTOR",
          status: "DISABLED",
          blocker_reason_n: 0,
          blocker_reasons: [],
        },
      }),
    });
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_SERVICE_DISABLED");
    assert.strictEqual(output.output_filename, "v2_repair_queue_service_latest.json");
    assert.ok(fs.existsSync(path.join(dir, "v2_repair_queue_service_latest.json")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function enabledModeFailsClosedWhenExecutorIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-service-blocked-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
    });
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_EXECUTOR_NOT_IMPLEMENTED");
    assert.strictEqual(output.status, "BLOCKED");
    assert.deepStrictEqual(output.summary.blocker_reasons, ["EXECUTOR_NOT_IMPLEMENTED"]);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function binanceTransportModeRequiresCanaryPreflightBeforeExecutor() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-service-preflight-block-"));
  let executorResolved = false;
  let preflightEnv = null;
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED: "1",
    }, {
      runCanaryPreflightFn: (env) => {
        preflightEnv = env;
        return {
          ok: false,
          blockers: ["REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_04"],
        };
      },
      resolveDelegatedRepairExecutorFn: () => {
        executorResolved = true;
        return async () => ({ writeDecision: { ok: true } });
      },
    });
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_CANARY_PREFLIGHT_BLOCKED");
    assert.strictEqual(output.status, "BLOCKED");
    assert.strictEqual(executorResolved, false);
    assert.strictEqual(preflightEnv.DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED, "1");
    assert.strictEqual(preflightEnv.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED, "1");
    assert.deepStrictEqual(output.summary.blocker_reasons, ["CANARY_PREFLIGHT_BLOCKED"]);
    assert.deepStrictEqual(output.summary.canary_preflight_blockers, ["REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_04"]);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function binanceTransportModeRunsAfterCanaryPreflightPasses() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-service-preflight-pass-"));
  let preflightEnv = null;
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED: "1",
    }, {
      runCanaryPreflightFn: (env) => {
        preflightEnv = env;
        return {
          ok: true,
          check_n: 18,
          fail_n: 0,
        };
      },
      resolveDelegatedRepairExecutorFn: () => async () => ({ writeDecision: { ok: true } }),
      runRepairQueueLiveServiceFn: async () => ({
        ok: true,
        service_name: "V2_REPAIR_EXECUTOR",
        status: "HEALTHY",
        fail_closed_triggered: false,
        summary: {
          service_name: "V2_REPAIR_EXECUTOR",
          status: "HEALTHY",
          blocker_reason_n: 0,
          blocker_reasons: [],
        },
      }),
    });
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_SERVICE_HEALTHY");
    assert.strictEqual(output.status, "HEALTHY");
    assert.strictEqual(preflightEnv.DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED, "1");
    assert.strictEqual(preflightEnv.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED, "1");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function bindingFlagResolvesAdapterExecutor() {
  const executor = runner.__test.resolveDelegatedRepairExecutor({
    env: {
      DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED: "1",
    },
  });
  assert.strictEqual(typeof executor, "function");
})();

(async function healthyModePassesThroughServiceVerdict() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-service-healthy-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
    }, {
      resolveDelegatedRepairExecutorFn: () => async () => ({ writeDecision: { ok: true } }),
      runRepairQueueLiveServiceFn: async () => ({
        ok: true,
        service_name: "V2_REPAIR_EXECUTOR",
        status: "HEALTHY",
        fail_closed_triggered: false,
        summary: {
          service_name: "V2_REPAIR_EXECUTOR",
          status: "HEALTHY",
          blocker_reason_n: 0,
          blocker_reasons: [],
        },
      }),
    });
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_SERVICE_HEALTHY");
    assert.strictEqual(output.status, "HEALTHY");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function degradedNonFailClosedModeStaysNonBlocking() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-service-attn-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
    }, {
      resolveDelegatedRepairExecutorFn: () => async () => ({ writeDecision: { ok: true } }),
      runRepairQueueLiveServiceFn: async () => ({
        ok: true,
        service_name: "V2_REPAIR_EXECUTOR",
        status: "DEGRADED",
        fail_closed_triggered: false,
        summary: {
          service_name: "V2_REPAIR_EXECUTOR",
          status: "DEGRADED",
          blocker_reason_n: 1,
          blocker_reasons: ["SKIPPED_REPAIR_LIMIT_EXCEEDED"],
        },
      }),
    });
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_SERVICE_ATTENTION");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function degradedFailClosedModeBlocks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-service-degraded-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
    }, {
      resolveDelegatedRepairExecutorFn: () => async () => ({ writeDecision: { ok: true } }),
      runRepairQueueLiveServiceFn: async () => ({
        ok: false,
        service_name: "V2_REPAIR_EXECUTOR",
        status: "DEGRADED",
        fail_closed_triggered: true,
        summary: {
          service_name: "V2_REPAIR_EXECUTOR",
          status: "DEGRADED",
          blocker_reason_n: 1,
          blocker_reasons: ["COMPLETION_FAILURE_LIMIT_EXCEEDED"],
        },
      }),
    });
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_SERVICE_FAIL_CLOSED");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function artifactFilenameDefaultsToStableLocalName() {
  assert.strictEqual(runner.__test.resolveOutputFilename({}), runner.__test.OUTPUT_FILENAME);
  assert.strictEqual(
    runner.__test.resolveOutputFilename({ DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_FILE: "custom.json" }),
    "custom.json"
  );
})();

(function canaryPreflightRequirementDefaultsToBinanceTransportBindingOnly() {
  assert.strictEqual(runner.__test.resolveCanaryPreflightRequired({}), false);
  assert.strictEqual(runner.__test.resolveCanaryPreflightRequired({
    DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED: "1",
    DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED: "1",
  }), true);
  assert.strictEqual(runner.__test.resolveCanaryPreflightRequired({
    DONBEOLJA_V2_REPAIR_CANARY_PREFLIGHT_REQUIRED: "0",
    DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED: "1",
    DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED: "1",
  }), false);
  const preflightEnv = runner.__test.resolveCanaryPreflightEnv({
    DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED: "1",
    DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED: "1",
  });
  assert.strictEqual(preflightEnv.DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED, "1");
  assert.strictEqual(preflightEnv.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED, "1");
})();

console.log("RUN_V2_REPAIR_QUEUE_SERVICE_TEST_OK");
