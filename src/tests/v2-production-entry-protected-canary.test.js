"use strict";

const assert = require("assert");
const { runV2ProductionEntryProtectedCanary } = require("../v2/productionEntryProtectedCanary");
const { buildReferenceNativeMlEvidencePack } = require("../v2/replayFixtureFactory");

async function protectedCanaryUsesRealRouteKernelAndProtectionActivation() {
  const artifact = await runV2ProductionEntryProtectedCanary({
    now: () => "2026-04-22T00:00:00.000Z",
  });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.reason, "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS");
  assert.strictEqual(artifact.exchange_write_performed, false);
  assert.strictEqual(artifact.route_called, true);
  assert.strictEqual(artifact.kernel_called, true);
  assert.strictEqual(artifact.entry_transport_called, true);
  assert.strictEqual(artifact.initial_sl_transport_called, true);
  assert.strictEqual(artifact.initial_tp1_transport_called, true);
  assert.strictEqual(artifact.memory_firestore_batch_commit_n, 2);
  assert.strictEqual(artifact.memory_firestore_write_n, 4);
  assert.deepStrictEqual(artifact.failed_check_ids, []);
  assert.ok(artifact.check_ids.includes("V2_PROTECTED_ENTRY_CANARY_BATCH_WRITES_PRESENT"));
  assert.ok(artifact.check_ids.includes("V2_PROTECTED_ENTRY_CANARY_SL_ORDER_PRESENT"));
  assert.ok(artifact.check_ids.includes("V2_PROTECTED_ENTRY_CANARY_TP1_ORDER_PRESENT"));
  assert.ok(artifact.check_ids.includes("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_PROBE_OK"));
  assert.ok(artifact.check_ids.includes("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_ROUTE_CALLED"));
  assert.ok(artifact.check_ids.includes("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_TRANSPORTS_READY"));
  assert.ok(artifact.check_ids.includes("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_NO_EXCHANGE_WRITE"));
  assert.strictEqual(artifact.live_endpoint_probe_summary.ok, true);
  assert.strictEqual(artifact.live_endpoint_probe_summary.reason, "V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED");
  assert.strictEqual(artifact.live_endpoint_probe_summary.endpoint_enabled, true);
  assert.strictEqual(artifact.live_endpoint_probe_summary.route_called, true);
  assert.strictEqual(artifact.live_endpoint_probe_summary.transport_resolution_ok, true);
  assert.strictEqual(artifact.live_endpoint_probe_summary.transport_reason, "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY");
  assert.strictEqual(artifact.live_endpoint_probe_summary.exchange_write_performed, false);
  assert.strictEqual(artifact.live_endpoint_probe_summary.decision_mode, "LIVE");
  assert.strictEqual(artifact.live_endpoint_probe_summary.runtime_enabled, true);
  assert.strictEqual(artifact.live_endpoint_probe_summary.runtime_dry_run, false);
  assert.strictEqual(artifact.live_endpoint_probe_summary.runtime_canary_only, false);
  assert.strictEqual(artifact.route_result_summary.reason, "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED");
  assert.strictEqual(artifact.route_result_summary.runtime_health_status, "HEALTHY");
  assert.ok(artifact.route_result_summary.sl_order_id.startsWith("SL__NO_EXCHANGE__"));
  assert.ok(artifact.route_result_summary.tp1_order_id.startsWith("TP1__NO_EXCHANGE__"));
}

async function blockedSizingDoesNotCallRouteOrTransports() {
  let routeCalled = false;
  const artifact = await runV2ProductionEntryProtectedCanary({
    bundle: buildReferenceNativeMlEvidencePack(),
    sizing: {
      referencePrice: 2500,
      requestedNotionalQuote: 3000,
      maxNotionalQuote: 2500,
      minNotionalQuote: 5,
      minQtyAbs: 0.001,
      stepSize: 0.001,
    },
    runProductionEntryRoute: async () => {
      routeCalled = true;
      return { ok: true };
    },
  });
  assert.strictEqual(routeCalled, false);
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.reason, "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_REQUEST_BLOCKED");
  assert.strictEqual(artifact.request_reason, "V2_PRODUCTION_ENTRY_LIVE_SIZING_NOT_APPROVED");
  assert.ok(artifact.failed_check_ids.includes("V2_PROTECTED_ENTRY_CANARY_REQUEST_READY"));
}

async function routeFailureIsNotMasked() {
  const artifact = await runV2ProductionEntryProtectedCanary({
    runProductionEntryRoute: async () => ({
      ok: false,
      reason: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
      kernelResult: {
        kernelAudit: {
          ok: false,
          fail_n: 1,
          failed_check_ids: ["ENTRY_KERNEL_TP1_ORDER_PRESENT"],
        },
      },
      openclawExecutionAudit: {
        failed_check_ids: [],
      },
      auditLedgerResult: null,
    }),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.reason, "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_BLOCKED");
  assert.ok(artifact.failed_check_ids.includes("V2_PROTECTED_ENTRY_CANARY_ROUTE_OK"));
  assert.ok(artifact.failed_check_ids.includes("ENTRY_KERNEL_TP1_ORDER_PRESENT"));
  assert.ok(artifact.failed_check_ids.includes("V2_PRODUCTION_ENTRY_KERNEL_BLOCKED"));
}

async function main() {
  await protectedCanaryUsesRealRouteKernelAndProtectionActivation();
  await blockedSizingDoesNotCallRouteOrTransports();
  await routeFailureIsNotMasked();
}

main()
  .then(() => {
    console.log("V2_PRODUCTION_ENTRY_PROTECTED_CANARY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
