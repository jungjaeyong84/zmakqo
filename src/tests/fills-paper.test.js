const assert = require("assert");
const { __test } = require("../storage/fillsPaper");
const { __test: fillsSyncTest } = require("../services/binanceFuturesFillsSync");

function run() {
  const buildExternalFillUnverifiedPatch = __test && __test.buildExternalFillUnverifiedPatch;
  const buildExternalFillEventReclassificationPatch = __test && __test.buildExternalFillEventReclassificationPatch;
  const normalizeFeaturesJson = __test && __test.normalizeFeaturesJson;
  const canFinalizeIntentFromExternalFill = fillsSyncTest && fillsSyncTest.canFinalizeIntentFromExternalFill;
  const applyAuthoritativeExitContractOverride = fillsSyncTest && fillsSyncTest.applyAuthoritativeExitContractOverride;
  const applyAuthoritativeIntentEventOverride = fillsSyncTest && fillsSyncTest.applyAuthoritativeIntentEventOverride;
  assert.strictEqual(
    typeof buildExternalFillUnverifiedPatch,
    "function",
    "buildExternalFillUnverifiedPatch export missing"
  );
  assert.strictEqual(
    typeof buildExternalFillEventReclassificationPatch,
    "function",
    "buildExternalFillEventReclassificationPatch export missing"
  );
  assert.strictEqual(
    typeof normalizeFeaturesJson,
    "function",
    "normalizeFeaturesJson export missing"
  );
  assert.strictEqual(
    typeof canFinalizeIntentFromExternalFill,
    "function",
    "canFinalizeIntentFromExternalFill export missing"
  );
  assert.strictEqual(
    typeof applyAuthoritativeExitContractOverride,
    "function",
    "applyAuthoritativeExitContractOverride export missing"
  );
  assert.strictEqual(
    typeof applyAuthoritativeIntentEventOverride,
    "function",
    "applyAuthoritativeIntentEventOverride export missing"
  );

  const normalizedFeatures = normalizeFeaturesJson({
    pro_regime_state: "t\rend",
    signal_id: "SIG__ETH",
  });
  assert.strictEqual(normalizedFeatures.pro_regime_state, "trend");
  assert.strictEqual(normalizedFeatures.market_regime, "trend");

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

  const reclassified = buildExternalFillEventReclassificationPatch({
    current: {
      fill_id: "fill-doge-1",
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      tf: "15m",
      exec_bar_close_time_utc_ms: 1775894564598,
      signal_bar_close_time_utc_ms: 1775894400000,
      side: "SELL",
      event: "EXIT_TRAIL",
      intent_id: "INTENT__OLD",
      signal_id: "SIG__OLD",
      signal_doc_id: "SIG__OLD",
      run_id: "RUN_1",
      request_id: "REQ_1",
    },
    event: "FORCE_EXIT_ALL",
    intentId: "INTENT__FORCE_EXIT",
    signalId: "SIG__BINANCEFUT__DOGEUSDT__15m__1775894400000__FORCE_EXIT_ALL",
    signalDocId: "SIG__BINANCEFUT__DOGEUSDT__15m__1775894400000__FORCE_EXIT_ALL",
    decisionReason: "MATCHED_FORCED_INTENT_RECLASSIFIED",
    reclassifyReason: "MATCHED_FORCED_INTENT",
    reclassifyScript: "scripts/backfill-authoritative-forced-exit-fills.js",
  });
  assert.strictEqual(reclassified.event, "FORCE_EXIT_ALL");
  assert.strictEqual(reclassified.action, "FORCE_EXIT_ALL");
  assert.strictEqual(reclassified.intent, "FORCE_EXIT_ALL");
  assert.strictEqual(reclassified.intent_id, "INTENT__FORCE_EXIT");
  assert.strictEqual(reclassified.signal_id, "SIG__BINANCEFUT__DOGEUSDT__15m__1775894400000__FORCE_EXIT_ALL");
  assert.strictEqual(reclassified.signal_doc_id, "SIG__BINANCEFUT__DOGEUSDT__15m__1775894400000__FORCE_EXIT_ALL");
  assert.strictEqual(reclassified.decision_reason, "MATCHED_FORCED_INTENT_RECLASSIFIED");
  assert.strictEqual(reclassified.reclassify_reason, "MATCHED_FORCED_INTENT");
  assert.strictEqual(reclassified.reclassify_script, "scripts/backfill-authoritative-forced-exit-fills.js");
  assert.ok(
    String(reclassified.trace_meta || "").includes("intent:INTENT__FORCE_EXIT"),
    "trace_meta should reflect relinked intent"
  );
  assert.ok(
    String(reclassified.canonical_event_id || "").includes("FORCE_EXIT_ALL"),
    "canonical_event_id should reflect reclassified event"
  );
  assert.strictEqual(reclassified.classification_verified, true);
  assert.deepStrictEqual(reclassified.classification_issues, []);

  const reclassifiedFromUnverified = buildExternalFillEventReclassificationPatch({
    current: {
      fill_id: "fill-eth-1",
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      tf: "15m",
      exec_bar_close_time_utc_ms: 1776026600000,
      signal_bar_close_time_utc_ms: 1776026500000,
      side: "SELL",
      event: "EXIT_TP_P1_1.65P_UNVERIFIED",
      classification_verified: false,
      classification_issues: ["TP1_FILL_PROJECTION_MISSING"],
    },
    event: "EXIT_TP_P1_1.65P",
    decisionReason: "POST_SYNC_PROJECTION_CONFIRMED",
    reclassifyReason: "TP1_PROJECTION_CONFIRMED_AFTER_SYNC",
  });
  assert.strictEqual(reclassifiedFromUnverified.classification_verified, true);
  assert.deepStrictEqual(reclassifiedFromUnverified.classification_issues, []);
  assert.strictEqual(reclassifiedFromUnverified.event, "EXIT_TP_P1_1.65P");

  const relinkOnly = buildExternalFillEventReclassificationPatch({
    current: {
      fill_id: "fill-bnb-1",
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      tf: "15m",
      exec_bar_close_time_utc_ms: 1775857500000,
      signal_bar_close_time_utc_ms: 1775857500000,
      side: "SELL",
      event: "EXIT_OPPOSITE_SIGNAL",
      intent_id: "INTENT__OLD",
      signal_id: "SIG__OLD",
      signal_doc_id: "SIG__OLD",
    },
    event: "EXIT_OPPOSITE_SIGNAL",
    intentId: "INTENT__NEW",
    signalId: "SIG__NEW",
    signalDocId: "SIG__NEW",
    decisionReason: "MATCHED_BINANCE_ORDER_EVENT_RECLASSIFIED",
    reclassifyReason: "MATCHED_INTERNAL_BINANCE_ORDER_FILL",
    reclassifyScript: "scripts/backfill-matched-order-exit-fills.js",
  });
  assert.strictEqual(relinkOnly.event, "EXIT_OPPOSITE_SIGNAL");
  assert.strictEqual(relinkOnly.intent_id, "INTENT__NEW");
  assert.strictEqual(relinkOnly.signal_id, "SIG__NEW");
  assert.strictEqual(relinkOnly.signal_doc_id, "SIG__NEW");

  const auditImmediateProjectionEvents = fillsSyncTest && fillsSyncTest.auditImmediateProjectionEvents;
  assert.strictEqual(typeof auditImmediateProjectionEvents, "function", "auditImmediateProjectionEvents export missing");
  const auditProjectionEventImmediately = fillsSyncTest && fillsSyncTest.auditProjectionEventImmediately;
  assert.strictEqual(typeof auditProjectionEventImmediately, "function", "auditProjectionEventImmediately export missing");
  const resolveExternalExitEvent = fillsSyncTest && fillsSyncTest.resolveExternalExitEvent;
  assert.strictEqual(typeof resolveExternalExitEvent, "function", "resolveExternalExitEvent export missing");
  const shouldLogFillSyncOverride = fillsSyncTest && fillsSyncTest.shouldLogFillSyncOverride;
  assert.strictEqual(typeof shouldLogFillSyncOverride, "function", "shouldLogFillSyncOverride export missing");
  const shouldSuppressMatchedExternalFillAlert = fillsSyncTest && fillsSyncTest.shouldSuppressMatchedExternalFillAlert;
  assert.strictEqual(typeof shouldSuppressMatchedExternalFillAlert, "function", "shouldSuppressMatchedExternalFillAlert export missing");
  const isAuthoritativeForcedExitIntentEvent = fillsSyncTest && fillsSyncTest.isAuthoritativeForcedExitIntentEvent;
  assert.strictEqual(typeof isAuthoritativeForcedExitIntentEvent, "function", "isAuthoritativeForcedExitIntentEvent export missing");
  assert.strictEqual(typeof fillsSyncTest.buildFillsSyncLeaseDocPath, "function", "buildFillsSyncLeaseDocPath export missing");
  assert.strictEqual(typeof fillsSyncTest.runDistributedFillsSync, "function", "runDistributedFillsSync export missing");
  assert.strictEqual(
    fillsSyncTest.buildFillsSyncLeaseDocPath("ethusdt"),
    "runtime_locks/fills_sync__BINANCEFUT__ETHUSDT"
  );
  const overrideLogFirst = shouldLogFillSyncOverride({
    prefix: "[FILL_SYNC_EVENT_OVERRIDE]",
    symbol: "DOGEUSDT",
    orderId: 123,
    clientOrderId: "abc",
    detail: "closePosition=true -> EXIT_EXTERNAL_SYNC",
    ttlMs: 60_000,
  });
  const overrideLogSecond = shouldLogFillSyncOverride({
    prefix: "[FILL_SYNC_EVENT_OVERRIDE]",
    symbol: "DOGEUSDT",
    orderId: 123,
    clientOrderId: "abc",
    detail: "closePosition=true -> EXIT_EXTERNAL_SYNC",
    ttlMs: 60_000,
  });
  assert.strictEqual(overrideLogFirst.log, true);
  assert.strictEqual(overrideLogSecond.log, false);
  assert.strictEqual(overrideLogSecond.repeatCount, 2);
  assert.strictEqual(isAuthoritativeForcedExitIntentEvent("FORCE_EXIT_ALL"), true);
  assert.strictEqual(isAuthoritativeForcedExitIntentEvent("FORCE_EXIT_HALF"), true);
  assert.strictEqual(isAuthoritativeForcedExitIntentEvent("EXIT_TP_P0_0.8P"), false);
  assert.strictEqual(canFinalizeIntentFromExternalFill({ status: "PENDING" }), true);
  assert.strictEqual(
    canFinalizeIntentFromExternalFill({ status: "CANCELED", cancel_reason: "LIVE_FAILED" }),
    true
  );
  assert.strictEqual(canFinalizeIntentFromExternalFill({ status: "FILLED" }), false);
  assert.strictEqual(
    applyAuthoritativeExitContractOverride("EXIT_TP_P0_0.8P", { event: "FORCE_EXIT_ALL" }),
    "FORCE_EXIT_ALL"
  );
  assert.strictEqual(
    applyAuthoritativeIntentEventOverride("EXIT_TP_P0_0.8P", { event: "FORCE_EXIT_ALL" }),
    "FORCE_EXIT_ALL"
  );
  assert.strictEqual(
    applyAuthoritativeIntentEventOverride("EXIT_TP_P0_0.8P", { event: "EXIT_TP_P0_0.8P" }),
    "EXIT_TP_P0_0.8P"
  );
  assert.strictEqual(
    shouldSuppressMatchedExternalFillAlert({
      event: "FORCE_EXIT_ALL",
      intentId: "force-intent",
      matchedIntentEvent: "FORCE_EXIT_ALL",
    }),
    true
  );
  assert.strictEqual(
    shouldSuppressMatchedExternalFillAlert({
      event: "EXIT_TRAIL",
      intentId: "force-intent",
      matchedIntentEvent: "FORCE_EXIT_ALL",
    }),
    false
  );
  return resolveExternalExitEvent({
    intent: { event: "FORCE_EXIT_ALL", intent_id: "force-intent" },
    trade: { realizedPnl: 2.1402, qty: 2.46, time: 1775894552817, symbol: "BNBUSDT" },
    orderMeta: {
      orderId: 88650015133,
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
      clientOrderId: "dbj_force_exit",
      status: "FILLED",
    },
    positionCtx: {
      qtyBase: 2.46,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
    },
    recentTp1: null,
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
    qtyPct: 1,
  }).then((forcedEvent) => {
    assert.strictEqual(forcedEvent, "FORCE_EXIT_ALL");
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
      const perEventAuditStates = [];
      let fallbackReads = 0;
      return fillsSyncTest.runDistributedFillsSync({
        symbol: "SOLUSDT",
        acquireLease: async () => ({ acquired: true, holderId: "test-holder" }),
        heartbeatLease: async () => ({ ok: true, holderId: "test-holder" }),
        releaseLease: async () => ({ ok: true }),
        runner: async () => ({ ok: true, locked: true }),
      }).then((leaseResult) => {
        assert.strictEqual(leaseResult.locked, true);
        return auditProjectionEventImmediately({
          exchange: "BINANCEFUT",
          symbol: "SOLUSDT",
          eventRow: { fillId: "fill-3", symbol: "SOLUSDT", event: "EXIT_TP_P0_0.8P", tradeMs: 103 },
          syncPosition: async () => ({
            ok: true,
            position: {
              state: "ACTIVE",
              qty_base: 1,
              meta: {
                tp_p0_done: false,
                tp_p1_done: false,
                trail_active: false,
              },
            },
          }),
          getPositionFn: async () => {
            fallbackReads += 1;
            return {
              state: "ACTIVE",
              qty_base: 1,
              meta: {
                tp_p0_done: false,
                tp_p1_done: false,
                trail_active: false,
              },
            };
          },
          auditProjectionEvents: async ({ events, position }) => {
            perEventAuditStates.push({ events, position });
            return { ok: true, events, position };
          },
        });
      }).then(() => {
        assert.strictEqual(perEventAuditStates.length, 1);
        assert.strictEqual(fallbackReads, 1, "per-event audit should reload the persisted snapshot after sync");
        assert.strictEqual(perEventAuditStates[0].events[0].fillId, "fill-3");
        assert.strictEqual(perEventAuditStates[0].position.state, "ACTIVE");
        console.log("FILLS_PAPER_TEST_OK");
      });
    });
  });
}

Promise.resolve(run()).catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
