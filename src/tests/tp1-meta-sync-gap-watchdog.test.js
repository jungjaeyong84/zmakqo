"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

async function run() {
  __test._tp1MetaSyncGapAlertState.clear();

  const payload = __test.buildTp1MetaSyncGapAlertPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: {
      refresh_ok: true,
      refresh_needs_tp: true,
      refresh_tp_order_id: "tp1-order-1",
      after_tp_order_id: null,
      after_tp_status: null,
      issue_codes: ["TP1_META_SYNC_MISSING", "TP1_META_SYNC_STATUS_NOT_OK"],
    },
  });
  assert.strictEqual(payload.title, "[V2 긴급] ETHUSDT TP1 meta sync gap");
  assert.ok(payload.body.includes("reason: TP1_META_SYNC_GAP"));
  assert.ok(payload.body.includes("refresh_tp_order_id: tp1-order-1"));

  const first = __test.shouldSendTp1MetaSyncGapAlert({
    symbol: "ETHUSDT",
    issueCodes: ["TP1_META_SYNC_MISSING"],
  });
  const second = __test.shouldSendTp1MetaSyncGapAlert({
    symbol: "ETHUSDT",
    issueCodes: ["TP1_META_SYNC_MISSING"],
  });
  assert.strictEqual(first, true);
  assert.strictEqual(second, false);

  const repairResult = await __test.requestTp1MetaSyncGapRepair({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: {
      issue_codes: ["TP1_META_SYNC_MISSING"],
      refresh_tp_order_id: "tp1-order-1",
      after_tp_order_id: null,
      after_tp_status: null,
    },
    recordRepairRequest: async (payloadArg) => ({
      exit_repair_request_id: "EXIT_REPAIR_REQUEST__ETHUSDT",
      payload: payloadArg,
    }),
    triggerRepairRun: async () => ({
      ok: true,
      reason: "DISPATCHED",
    }),
  });
  assert.strictEqual(repairResult.reason, "TP1_META_SYNC_REPAIR_REQUESTED");
  assert.strictEqual(repairResult.request_id, "EXIT_REPAIR_REQUEST__ETHUSDT");
  assert.strictEqual(repairResult.dispatch_ok, true);

  let alerted = 0;
  let repaired = 0;
  const handled = await __test.handleTp1MetaSyncGap({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: {
      meta_sync_ok: false,
      issue_codes: ["TP1_META_SYNC_MISSING"],
    },
    sendAlertFn: async () => {
      alerted += 1;
      return { ok: true };
    },
    requestRepairFn: async () => {
      repaired += 1;
      return {
        reason: "TP1_META_SYNC_REPAIR_REQUESTED",
        request_id: "EXIT_REPAIR_REQUEST__1",
        dispatch_ok: true,
      };
    },
  });
  assert.strictEqual(alerted, 1);
  assert.strictEqual(repaired, 1);
  assert.strictEqual(handled.reason, "TP1_META_SYNC_GAP");
  assert.strictEqual(handled.dispatch_ok, true);

  const skipped = await __test.handleTp1MetaSyncGap({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: {
      meta_sync_ok: true,
      issue_codes: [],
    },
    sendAlertFn: async () => {
      throw new Error("should not alert");
    },
    requestRepairFn: async () => {
      throw new Error("should not repair");
    },
  });
  assert.strictEqual(skipped.skipped, true);
  assert.strictEqual(skipped.reason, "NO_META_SYNC_GAP");

  console.log("TP1_META_SYNC_GAP_WATCHDOG_TEST_OK");
}

run().catch((err) => {
  console.error("TP1_META_SYNC_GAP_WATCHDOG_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
