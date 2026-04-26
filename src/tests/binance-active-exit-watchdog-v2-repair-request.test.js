"use strict";

const assert = require("assert");
const {
  runBinanceActiveExitWatchdog,
  __test,
} = require("../services/binanceActiveExitWatchdog");

async function run() {
  const docs = __test.buildWatchdogV2RepairRequests({
    symbol: "SOLUSDT",
    position_cycle_id: "PCY__SOL__01",
    stage: "PRE_TP1",
    position_side: "LONG",
    qty_base: 0.17,
    avg_price: 86.35,
    expected_tp_qty_base: 0.085,
    expected_tp1_remaining_ratio: 0.5,
    stop_order_id: "SL1",
    actual_stop_price: 84.93,
    native_refresh_status: "OK",
    actionable_issue_codes: ["TP1_ORDER_MISSING"],
  });
  assert.strictEqual(docs.length, 1);
  assert.ok(docs[0].exit_repair_request_id.startsWith("RQRV2__TP1_ORDER_MISSING__"));
  assert.strictEqual(docs[0].position_cycle_id, "PCY__SOL__01");
  assert.strictEqual(docs[0].issue_code, "TP1_ORDER_MISSING");
  assert.strictEqual(docs[0].requested_action, "ENSURE_TP1_ORDER");
  assert.strictEqual(docs[0].status, "PENDING");
  assert.strictEqual(docs[0].detail.expected_tp_qty_base, 0.085);

  const unsupported = __test.buildWatchdogV2RepairRequests({
    symbol: "SOLUSDT",
    position_cycle_id: "PCY__SOL__01",
    stage: "TRAIL",
    actionable_issue_codes: ["TRAIL_STOP_CHOSEN_SOURCE_MISMATCH"],
  });
  assert.strictEqual(unsupported.length, 0, "unsupported watchdog issues must not create invalid V2 repair docs");

  let legacyRecorded = false;
  const persistedRows = [];
  const result = await runBinanceActiveExitWatchdog({
    apply: true,
    loadSnapshot: async () => ({
      ok: true,
      active_symbol_n: 1,
      target_symbol_n: 1,
      rows: [
        {
          symbol: "SOLUSDT",
          position_cycle_id: "PCY__SOL__01",
          stage: "PRE_TP1",
          actionable_issue_n: 1,
          actionable_issue_codes: ["TP1_ORDER_MISSING"],
        },
      ],
    }),
    recordLegacyRepairRequest: async () => {
      legacyRecorded = true;
      return { exit_repair_request_id: "LEGACY" };
    },
    persistV2RepairRequests: async ({ row }) => {
      persistedRows.push(row);
      return { ok: true, persisted_n: 1, repair_request_ids: ["ERR__PCY__SOL__01__TP1_ORDER_MISSING"] };
    },
  });

  assert.strictEqual(legacyRecorded, true);
  assert.strictEqual(persistedRows.length, 1);
  assert.strictEqual(result.repaired_rows[0].v2_repair_request_ok, true);
  assert.strictEqual(result.repaired_rows[0].v2_repair_request_n, 1);
  assert.deepStrictEqual(result.repaired_rows[0].v2_repair_request_ids, ["ERR__PCY__SOL__01__TP1_ORDER_MISSING"]);

  console.log("BINANCE_ACTIVE_EXIT_WATCHDOG_V2_REPAIR_REQUEST_TEST_OK");
}

run().catch((error) => {
  console.error("BINANCE_ACTIVE_EXIT_WATCHDOG_V2_REPAIR_REQUEST_TEST_FAIL", error && error.stack ? error.stack : error);
  process.exit(1);
});
