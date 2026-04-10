const assert = require("assert");
const { __test } = require("../storage/fillsPaper");
const { __test: fillsSyncTest } = require("../services/binanceFuturesFillsSync");

function run() {
  const buildExternalFillUnverifiedPatch = __test && __test.buildExternalFillUnverifiedPatch;
  assert.strictEqual(
    typeof buildExternalFillUnverifiedPatch,
    "function",
    "buildExternalFillUnverifiedPatch export missing"
  );

  const patch = buildExternalFillUnverifiedPatch({
    current: {
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      tf: "15m",
      exec_bar_close_time_utc_ms: 1710000000000,
      signal_bar_close_time_utc_ms: 1710000000000,
      side: "SELL",
      event: "EXIT_TRAIL_1P",
    },
    issues: ["TRAIL_FILL_PROJECTION_INACTIVE"],
  });
  assert.strictEqual(patch.event, "EXIT_TRAIL_1P_UNVERIFIED");
  assert.strictEqual(patch.decision_reason, "PROJECTION_MISMATCH_UNVERIFIED");
  assert.strictEqual(patch.classification_verified, false);
  assert.deepStrictEqual(patch.classification_issues, ["TRAIL_FILL_PROJECTION_INACTIVE"]);
  assert.ok(
    String(patch.canonical_event_id || "").includes("EXIT_TRAIL_1P_UNVERIFIED"),
    "canonical_event_id should reflect unverified event"
  );

  const existingUnverified = buildExternalFillUnverifiedPatch({
    current: {
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      tf: "15m",
      exec_bar_close_time_utc_ms: 1710000000000,
      side: "BUY",
      event: "EXIT_SL_1.5P_UNVERIFIED",
    },
    event: "EXIT_SL_1.5P_UNVERIFIED",
    issues: ["NATIVE_PROTECTION_FAILED"],
    decisionReason: "MANUAL_AUDIT",
  });
  assert.strictEqual(existingUnverified.event, "EXIT_SL_1.5P_UNVERIFIED");
  assert.strictEqual(existingUnverified.decision_reason, "MANUAL_AUDIT");
  assert.deepStrictEqual(existingUnverified.classification_issues, ["NATIVE_PROTECTION_FAILED"]);

  const auditImmediateProjectionEvents = fillsSyncTest && fillsSyncTest.auditImmediateProjectionEvents;
  assert.strictEqual(typeof auditImmediateProjectionEvents, "function", "auditImmediateProjectionEvents export missing");
  return auditImmediateProjectionEvents({
    events: [
      { fillId: "fill-1", symbol: "SOLUSDT", event: "EXIT_TP_P0_0.8P", tradeMs: 101 },
      { fillId: "fill-2", symbol: "SOLUSDT", event: "EXIT_TRAIL_1P", tradeMs: 102 },
    ],
    position: {
      state: "ACTIVE",
      qty_base: 1,
      meta: {
        tp_p0_done: false,
        tp_p1_done: false,
        trail_active: false,
      },
    },
    markUnverified: async (args) => args,
    sendAlert: async (args) => args,
  }).then((auditResult) => {
    assert.strictEqual(auditResult.unverified_n, 2);
    assert.deepStrictEqual(
      auditResult.results.filter((row) => row.unverified).map((row) => row.fillId),
      ["fill-1", "fill-2"]
    );
    console.log("FILLS_PAPER_TEST_OK");
  });
}

Promise.resolve(run()).catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
