"use strict";

const assert = require("assert");
const { buildReferenceNativeMlEvidencePack } = require("../v2/replayFixtureFactory");
const {
  buildNoExchangeKernelResult,
  runV2ProductionEntryRouteCanary,
} = require("../v2/productionEntryRouteCanary");

(function noExchangeKernelEvidenceSatisfiesKernelAudit() {
  const bundle = buildReferenceNativeMlEvidencePack();
  const result = buildNoExchangeKernelResult({ bundle, nowIso: "2026-04-21T07:00:00.000Z" });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_ENTRY_EXECUTION_KERNEL_PROTECTED");
  assert.strictEqual(result.kernelAudit.ok, true);
  assert.strictEqual(result.kernelAudit.fail_n, 0);
  assert.ok(result.kernelAudit.position_cycle_id);
  assert.strictEqual(result.submitterResult.fill.exchange_write_performed, false);
  assert.strictEqual(result.submitterResult.entrySizingDecision.ok, true);
  assert.strictEqual(result.submitterResult.entrySizingDecision.status, "APPROVED");
  assert.strictEqual(result.submitterResult.entrySizingDecision.entry_qty_abs, result.submitterResult.fill.qty_abs);
  assert.strictEqual(result.submitterResult.protectionEvidence.exchange_write_performed, false);
  assert.strictEqual(result.submitterResult.protectionResult.protectionWriteResult.runtimeDoc.health_status, "HEALTHY");
  assert.ok(result.submitterResult.protectionResult.protectionWriteResult.runtimeDoc.sl_order_id);
  assert.ok(result.submitterResult.protectionResult.protectionWriteResult.runtimeDoc.tp1_order_id);
})();

async function canaryRunsProductionRouteWithoutExchangeWrite() {
  const artifact = await runV2ProductionEntryRouteCanary({
    env: {},
    now: () => "2026-04-21T07:05:00.000Z",
  });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS");
  assert.strictEqual(artifact.exchange_write_performed, false);
  assert.strictEqual(artifact.kernel_called, true);
  assert.strictEqual(artifact.persist_called, true);
  assert.strictEqual(artifact.route_result_summary.reason, "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED");
  assert.strictEqual(artifact.route_result_summary.runtime.dry_run, false);
  assert.strictEqual(artifact.route_result_summary.audit_ledger_reason, "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED");
  assert.strictEqual(artifact.route_result_summary.entry_sizing_decision.ok, true);
  assert.strictEqual(artifact.route_result_summary.entry_sizing_decision.status, "APPROVED");
  assert.strictEqual(artifact.route_result_summary.entry_sizing_decision.entry_qty_abs, 0.8);
  assert.ok(artifact.check_ids.includes("V2_PRODUCTION_ROUTE_CANARY_ENTRY_SIZING_APPROVED"));
  assert.ok(artifact.check_ids.includes("V2_PRODUCTION_ROUTE_CANARY_ENTRY_SIZING_QTY_MATCHES_FILL"));
  assert.deepStrictEqual(artifact.failed_check_ids, []);
}

async function routeFailureBlocksCanaryArtifact() {
  const artifact = await runV2ProductionEntryRouteCanary({
    env: {},
    now: () => "2026-04-21T07:06:00.000Z",
    runProductionEntryRoute: async () => ({
      ok: false,
      reason: "V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED",
      runtime: { dry_run: true },
      kernelResult: null,
      openclawExecutionAudit: null,
      auditLedgerResult: null,
    }),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_BLOCKED");
  assert.ok(artifact.failed_check_ids.includes("V2_PRODUCTION_ROUTE_CANARY_ROUTE_OK"));
  assert.ok(artifact.failed_check_ids.includes("V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED"));
  assert.strictEqual(artifact.exchange_write_performed, false);
}

async function main() {
  await canaryRunsProductionRouteWithoutExchangeWrite();
  await routeFailureBlocksCanaryArtifact();
}

main()
  .then(() => {
    console.log("V2_PRODUCTION_ENTRY_ROUTE_CANARY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
