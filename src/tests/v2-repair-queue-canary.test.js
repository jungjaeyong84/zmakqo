"use strict";

const assert = require("assert");
const {
  buildRepairQueueCanaryFixture,
  buildMemoryDb,
  runRepairQueueCanary,
  __test,
} = require("../v2/repairQueueCanary");

(function fixtureContainsSingleRepairableTrailStopGap() {
  const fixture = buildRepairQueueCanaryFixture({
    recordedAt: "2026-04-21T07:30:00.000Z",
  });
  assert.strictEqual(fixture.expectedStopPrice, 2445);
  assert.ok(fixture.positionCycleId.startsWith("PCY__"));
  assert.strictEqual(Object.keys(fixture.docsByCollectionKey.POSITION_CYCLES).length, 1);
  assert.strictEqual(Object.keys(fixture.docsByCollectionKey.EXIT_RUNTIME_PROJECTIONS).length, 1);
  assert.strictEqual(Object.keys(fixture.docsByCollectionKey.PROTECTION_RUNTIME).length, 1);
  assert.strictEqual(Object.keys(fixture.docsByCollectionKey.REPAIR_REQUESTS).length, 1);
})();

async function canaryRunsFullQueueToCompletionWithoutExchangeWrite() {
  const output = await runRepairQueueCanary({
    env: {},
    recordedAt: "2026-04-21T07:30:00.000Z",
  });
  assert.strictEqual(output.ok, true);
  assert.strictEqual(output.canary_mode, "DRY_RUN_FIXTURE");
  assert.strictEqual(output.exchange_write_performed, false);
  assert.strictEqual(output.service_status, "HEALTHY");
  assert.strictEqual(output.summary.requested_repair_n, 1);
  assert.strictEqual(output.summary.delegated_repair_n, 1);
  assert.strictEqual(output.summary.completion_success_n, 1);
  assert.strictEqual(output.summary.completion_failed_n, 0);
  assert.strictEqual(output.refresh_call_n, 1);
  assert.strictEqual(output.refresh_calls[0].writerSource, "BINANCE_TICK_EXIT");
  assert.strictEqual(output.refresh_calls[0].liveDryRun, true);
  assert.strictEqual(output.refresh_calls[0].symbol, "ETHUSDT");
  assert.strictEqual(output.refresh_calls[0].fallbackSide, "BUY");
  assert.strictEqual(output.verdict.ledger_write_n, 2);
  assert.deepStrictEqual(output.verdict.failed_invariants, []);
  assert.strictEqual(output.verdict.invariants.delegated_and_completion_ledgers_written, true);
  assert.strictEqual(output.completion_attempts[0].completion_ledger.execution_status, "COMPLETED_SUCCESS");
}

async function canaryArtifactDoesNotLeakLiveCredentials() {
  const output = await runRepairQueueCanary({
    env: {},
    recordedAt: "2026-04-21T07:30:00.000Z",
  });
  const serialized = JSON.stringify(output);
  assert.strictEqual(serialized.includes("canary-key"), false);
  assert.strictEqual(serialized.includes("canary-secret"), false);
  assert.strictEqual(serialized.includes("apiKey"), false);
  assert.strictEqual(serialized.includes("apiSecret"), false);
}

(function memoryDbRecordsLedgerWritesByCollectionSuffix() {
  const fixture = buildRepairQueueCanaryFixture({
    recordedAt: "2026-04-21T07:30:00.000Z",
  });
  const db = buildMemoryDb({
    docsByCollectionKey: fixture.docsByCollectionKey,
  });
  assert.strictEqual(Array.isArray(db.__writes), true);
})();

(function sanitizeRefreshCallDropsSecretMaterial() {
  const sanitized = __test.sanitizeRefreshCall({
    liveCfg: {
      apiKey: "raw-key",
      apiSecret: "raw-secret",
      liveDryRun: true,
    },
    symbol: "ETHUSDT",
    writerSource: "BINANCE_TICK_EXIT",
  });
  assert.strictEqual(sanitized.credentialKeyPresent, true);
  assert.strictEqual(sanitized.credentialSecretPresent, true);
  assert.strictEqual(JSON.stringify(sanitized).includes("raw-secret"), false);
})();

async function main() {
  await canaryRunsFullQueueToCompletionWithoutExchangeWrite();
  await canaryArtifactDoesNotLeakLiveCredentials();
  console.log("V2_REPAIR_QUEUE_CANARY_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
