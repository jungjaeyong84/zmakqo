"use strict";

const assert = require("assert");
const {
  buildRepairQueueOperationalCanaryFixture,
  runRepairQueueOperationalCanary,
} = require("../v2/repairQueueOperationalCanary");

(function fixtureGeneratesRepairRequestFromWatchdog() {
  const fixture = buildRepairQueueOperationalCanaryFixture({
    recordedAt: "2026-04-21T08:00:00.000Z",
  });
  assert.ok(fixture.watchdog.issueCodes.includes("TRAIL_STOP_MISSING"));
  assert.ok(fixture.watchdog.repairRequests.length >= 1);
  assert.strictEqual(fixture.selectedRepairRequest.issue_code, "TRAIL_STOP_MISSING");
  assert.strictEqual(
    fixture.docsByCollectionKey.REPAIR_REQUESTS[fixture.selectedRepairRequest.exit_repair_request_id],
    fixture.selectedRepairRequest
  );
})();

async function operationalCanaryCompletesWatchdogGeneratedRepair() {
  const output = await runRepairQueueOperationalCanary({
    env: {},
    recordedAt: "2026-04-21T08:00:00.000Z",
  });
  assert.strictEqual(output.ok, true);
  assert.strictEqual(output.canary_mode, "SHADOW_REPAIR_REQUEST_GENERATION");
  assert.strictEqual(output.exchange_write_performed, false);
  assert.strictEqual(output.service_status, "HEALTHY");
  assert.ok(output.watchdog_issue_codes.includes("TRAIL_STOP_MISSING"));
  assert.strictEqual(output.selected_issue_code, "TRAIL_STOP_MISSING");
  assert.strictEqual(output.summary.requested_repair_n, 1);
  assert.strictEqual(output.summary.delegated_repair_n, 1);
  assert.strictEqual(output.summary.completion_success_n, 1);
  assert.strictEqual(output.summary.completion_failed_n, 0);
  assert.strictEqual(output.refresh_call_n, 1);
  assert.strictEqual(output.refresh_calls[0].writerSource, "BINANCE_TICK_EXIT");
  assert.strictEqual(output.refresh_calls[0].liveDryRun, true);
  assert.deepStrictEqual(output.verdict.failed_invariants, []);
  assert.strictEqual(output.verdict.invariants.selected_request_generated_by_watchdog, true);
  const serialized = JSON.stringify(output);
  assert.strictEqual(serialized.includes("apiKey"), false);
  assert.strictEqual(serialized.includes("apiSecret"), false);
  assert.strictEqual(serialized.includes("canary-secret"), false);
}

async function main() {
  await operationalCanaryCompletesWatchdogGeneratedRepair();
  console.log("V2_REPAIR_QUEUE_OPERATIONAL_CANARY_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
