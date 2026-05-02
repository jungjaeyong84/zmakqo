"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

function buildBatchShadowWrite(overrides = {}) {
  return {
    ok: true,
    written: true,
    skipped: false,
    write_mode: "BATCH",
    writes: [
      { collectionKey: "CANONICAL_EXIT_TRANSITIONS", docId: "CXT__1" },
      { collectionKey: "EXIT_RUNTIME_PROJECTIONS", docId: "ERPv2__1" },
      { collectionKey: "TRADE_ALERT_OUTBOX", docId: "TAOv2__1" },
    ],
    ...overrides,
  };
}

async function run() {
  const authorityMap = new Map();
  const rules = {
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P1: 0.0165,
    TP_P1_QTY: 0.5,
  };

  const blocked = __test.resolveCanonicalExternalExitEvent({
    authorityMap,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    entryEventId: null,
    signalDocId: "SIG__ETH",
    orderMeta: { orderId: 12345 },
    positionCtx: {
      state: "ACTIVE",
      qty_base: 0.75,
      entry_qty_base: 1,
      meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false },
    },
    rules,
  });
  assert.strictEqual(blocked.stage, null);
  assert.strictEqual(blocked.event, null);
  assert.strictEqual(blocked.reason, "ENTRY_LINEAGE_REQUIRED");
  assert.strictEqual(blocked.entryLineageMissing, true);
  assert.strictEqual(__test.shouldPromoteCanonicalExternalExit(blocked), false);

  const allowed = __test.resolveCanonicalExternalExitEvent({
    authorityMap,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    entryEventId: "ENTRY__ETH",
    signalDocId: "SIG__ETH",
    orderMeta: { orderId: 12345 },
    positionCtx: {
      state: "ACTIVE",
      qty_base: 1,
      entry_qty_base: 1,
      meta: { entry_event_id: "ENTRY__ETH", tp_p0_done: false, tp_p1_done: false, trail_active: false },
    },
    rules,
  });
  assert.strictEqual(allowed.stage, "TP1");
  assert.strictEqual(allowed.event, "EXIT_TP_P1_2.5P");
  assert.strictEqual(allowed.entryLineageMissing, false);
  assert.strictEqual(__test.shouldPromoteCanonicalExternalExit(allowed), true);

  const simplifiedV2Tp1 = __test.resolveCanonicalExternalExitEvent({
    authorityMap,
    exchange: "BINANCEFUT",
    symbol: "ARBUSDT",
    event: "EXIT_TP_P1_1.65P",
    entryEventId: "ENTRYV2__ARBUSDT__SHORT__15530666104",
    signalDocId: "SIG__ARB__TP1",
    orderMeta: { orderId: 15531075054, clientOrderId: "TP1__PRATTV2__1368b04bf2" },
    positionCtx: {
      executionMode: "LIVE",
      state: "ACTIVE",
      qty_base: 972.4,
      entry_qty_base: 972.4,
      simplifiedExitV2Enabled: true,
      meta: {
        entry_event_id: "ENTRYV2__ARBUSDT__SHORT__15530666104",
        execution_mode: "LIVE",
        simplified_exit_v2_enabled: true,
        tp_p1_done: false,
        trail_active: false,
      },
    },
    rules,
    observedQtyRatio: 0.5,
    fullExit: false,
  });
  assert.strictEqual(simplifiedV2Tp1.stage, "TP1");
  assert.strictEqual(simplifiedV2Tp1.event, "EXIT_TP_P1_2.5P");
  assert.deepStrictEqual(simplifiedV2Tp1.transitionEvents, ["TP1_REACHED", "TRAIL_ACTIVATED"]);
  assert.strictEqual(simplifiedV2Tp1.primaryTransitionEvent, "TP1_REACHED");

  assert.strictEqual(
    __test.normalizeExitEventForRules("EXIT_TP_P1_1.65P", rules, {
      executionMode: "LIVE",
      simplifiedExitV2Enabled: true,
      meta: { simplified_exit_v2_enabled: true },
    }),
    "EXIT_TP_P1_2.5P",
    "V2 simplified TP1 persistence must normalize legacy 1.65 labels at the source",
  );

  const externalFullClose = __test.resolveCanonicalExternalExitEvent({
    authorityMap,
    exchange: "BINANCEFUT",
    symbol: "ARBUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    entryEventId: "ENTRYV2__ARBUSDT__SHORT__15530666104",
    signalDocId: "SIG__ARB__TRAIL",
    orderMeta: { orderId: 15531136931, closePosition: true },
    positionCtx: {
      state: "ACTIVE",
      qty_base: 486.2,
      entry_qty_base: 972.4,
      meta: {
        entry_event_id: "ENTRYV2__ARBUSDT__SHORT__15530666104",
        tp_p1_done: true,
        trail_active: true,
        simplified_exit_v2_enabled: true,
      },
    },
    recentTp1: {
      event: "EXIT_TP_P1_1.65P",
      entryEventId: "ENTRYV2__ARBUSDT__SHORT__15530666104",
    },
    rules,
    fullExit: true,
  });
  assert.strictEqual(externalFullClose.entryLineageMissing, false);
  assert.strictEqual(externalFullClose.event, "EXIT_EXTERNAL_SYNC");
  assert.ok(
    externalFullClose.transitionEvents.includes("EXTERNAL_CLOSE_SYNC"),
    "full EXIT_EXTERNAL_SYNC must produce a canonical close transition",
  );
  assert.strictEqual(__test.shouldPromoteCanonicalExternalExit(externalFullClose), true);

  const recoveredRecentTp1 = __test.buildRecentExitHintFromCanonicalTransition({
    canonical_transition_event: "TP1_REACHED",
    canonical_event: "EXIT_TP_P1_1.65P",
    entry_event_id: "ENTRYV2__ARBUSDT__SHORT__15530666104",
    external_order_id: 15531075054,
    external_client_order_id: "TP1__PRATTV2__1368b04bf2",
    ts_ms: 1777697255081,
  });
  assert.strictEqual(recoveredRecentTp1.entryEventId, "ENTRYV2__ARBUSDT__SHORT__15530666104");
  assert.strictEqual(recoveredRecentTp1.event, "EXIT_TP_P1_1.65P");

  const recoveredEntryContext = __test.pickExitEntryContext({
    intentEntryCtx: {
      entryEventId: "SYN|BINANCEFUT|ARBUSDT|NA|1777690082417|OPENING_SHORT|OPENING_SHORT",
      entrySignalType: "SYNC_FILL",
    },
    inferredEntryCtx: {
      entryEventId: "SYN|BINANCEFUT|ARBUSDT|NA|1777690082417|OPENING_SHORT|OPENING_SHORT",
      entrySignalType: "SYNC_FILL",
    },
    recentTp1: recoveredRecentTp1,
  });
  assert.strictEqual(
    recoveredEntryContext.entryEventId,
    "ENTRYV2__ARBUSDT__SHORT__15530666104",
    "authoritative TP1 lineage must beat SYN fallback on runner/full-exit sync",
  );
  assert.strictEqual(recoveredEntryContext.source, "RECENT_TP1");

  const nonTp1ShadowWrite = await __test.maybeWriteV2ShadowTp1Transition({
    symbol: "ETHUSDT",
    event: "EXIT_SL",
    transitionEvents: ["SL_HIT"],
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    fillId: "FILL__SL",
    execQtyBase: 0.5,
    writeTp1Transition: async () => {
      throw new Error("WRITER_MUST_NOT_BE_CALLED");
    },
  });
  assert.strictEqual(nonTp1ShadowWrite.skipped, true);
  assert.strictEqual(nonTp1ShadowWrite.reason, "V2_SHADOW_TP1_EVENT_NOT_APPLICABLE");

  const remappedTp0ShadowWrite = await __test.maybeWriteV2ShadowTp1Transition({
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    transitionEvents: ["TP1_REACHED"],
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    orderMeta: { orderId: "TP1__ETH__ORDER" },
    fillId: "FILL__TP1_FROM_LEGACY_TP0",
    execQtyBase: 0.5,
    writeTp1Transition: async (request) => {
      throw new Error(`WRITER_MUST_NOT_BE_CALLED:${request && request.sourceFillId}`);
    },
  });
  assert.strictEqual(remappedTp0ShadowWrite.ok, false);
  assert.strictEqual(remappedTp0ShadowWrite.written, false);
  assert.strictEqual(remappedTp0ShadowWrite.reason, "V2_EXIT_FILL_UNSUPPORTED_LEGACY_PARTIAL");

  const degradedProtectionShadowWrite = await __test.maybeWriteV2ShadowTp1Transition({
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_2.5P",
    transitionEvents: ["TP1_REACHED"],
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    orderMeta: { orderId: "TP1__ETH__ORDER" },
    fillId: "FILL__TP1",
    execQtyBase: 0.5,
    execPrice: 2500,
    stageHintPosition: {
      meta: {
        native_protection_refresh_status: "FAILED",
        native_protection_tp_order_id: null,
      },
    },
    writeTp1Transition: async (request) => {
      assert.strictEqual(request.sourceOrderId, "TP1__ETH__ORDER");
      assert.strictEqual(request.positionMeta.native_protection_refresh_status, "FAILED");
      return {
        ok: true,
        written: false,
        skipped: true,
        reason: "V2_SHADOW_TP1_PROTECTION_RUNTIME_NOT_HEALTHY",
        issue_codes: ["PROTECTION_RUNTIME_NOT_HEALTHY", "TP1_ORDER_MISSING"],
      };
    },
  });
  assert.strictEqual(degradedProtectionShadowWrite.ok, true);
  assert.strictEqual(degradedProtectionShadowWrite.written, false);
  assert.strictEqual(degradedProtectionShadowWrite.skipped, true);
  assert.strictEqual(degradedProtectionShadowWrite.reason, "V2_SHADOW_TP1_PROTECTION_RUNTIME_NOT_HEALTHY");
  assert.ok(degradedProtectionShadowWrite.issue_codes.includes("TP1_ORDER_MISSING"));

  const nonTp1LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_SL",
    transitionEvents: ["SL_HIT"],
    shadowTp1Write: nonTp1ShadowWrite,
  });
  assert.strictEqual(nonTp1LegacyGate.ok, true);
  assert.strictEqual(nonTp1LegacyGate.reason, "TP1_GATE_NOT_APPLICABLE");

  const writtenTp1LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_TP_P1_2.5P",
    transitionEvents: ["TP1_REACHED"],
    shadowTp1Write: buildBatchShadowWrite({ reason: "V2_SHADOW_TP1_TRANSITION_OK" }),
  });
  assert.strictEqual(writtenTp1LegacyGate.ok, true);
  assert.strictEqual(writtenTp1LegacyGate.reason, "V2_SHADOW_TP1_BATCH_WRITTEN");

  const missingBatchTp1LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_TP_P1_2.5P",
    transitionEvents: ["TP1_REACHED"],
    shadowTp1Write: {
      ok: true,
      written: true,
      skipped: false,
      reason: "V2_SHADOW_TP1_TRANSITION_OK",
    },
  });
  assert.strictEqual(missingBatchTp1LegacyGate.ok, false);
  assert.strictEqual(missingBatchTp1LegacyGate.reason, "V2_SHADOW_CANONICAL_BATCH_EVIDENCE_MISSING");

  const incompleteBatchTp1LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_TP_P1_2.5P",
    transitionEvents: ["TP1_REACHED"],
    shadowTp1Write: buildBatchShadowWrite({
      writes: [
        { collectionKey: "CANONICAL_EXIT_TRANSITIONS", docId: "CXT__1" },
        { collectionKey: "EXIT_RUNTIME_PROJECTIONS", docId: "ERPv2__1" },
      ],
    }),
  });
  assert.strictEqual(incompleteBatchTp1LegacyGate.ok, false);
  assert.strictEqual(incompleteBatchTp1LegacyGate.reason, "V2_SHADOW_CANONICAL_BATCH_WRITES_INCOMPLETE");
  assert.ok(incompleteBatchTp1LegacyGate.issue_codes.includes("MISSING_TRADE_ALERT_OUTBOX"));

  const remappedTp0LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_TP_P0_0.8P",
    transitionEvents: ["TP1_REACHED"],
    shadowTp1Write: remappedTp0ShadowWrite,
  });
  assert.strictEqual(remappedTp0LegacyGate.ok, false);
  assert.strictEqual(remappedTp0LegacyGate.reason, "V2_EXIT_FILL_UNSUPPORTED_LEGACY_PARTIAL");

  const disabledTp1LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_TP_P1_2.5P",
    transitionEvents: ["TP1_REACHED"],
    shadowTp1Write: {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_EXIT_WRITE_DISABLED",
    },
  });
  assert.strictEqual(disabledTp1LegacyGate.ok, true);
  assert.strictEqual(disabledTp1LegacyGate.reason, "V2_SHADOW_EXIT_WRITE_DISABLED");

  const blockedTp1LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_TP_P1_2.5P",
    transitionEvents: ["TP1_REACHED"],
    shadowTp1Write: degradedProtectionShadowWrite,
  });
  assert.strictEqual(blockedTp1LegacyGate.ok, false);
  assert.strictEqual(blockedTp1LegacyGate.reason, "V2_SHADOW_TP1_PROTECTION_RUNTIME_NOT_HEALTHY");
  assert.ok(blockedTp1LegacyGate.issue_codes.includes("TP1_ORDER_MISSING"));

  const missingTp1LegacyGate = __test.resolveLegacyCanonicalTp1WriteGate({
    event: "EXIT_TP_P1_2.5P",
    transitionEvents: ["TP1_REACHED"],
  });
  assert.strictEqual(missingTp1LegacyGate.ok, false);
  assert.strictEqual(missingTp1LegacyGate.reason, "V2_SHADOW_TP1_GATE_RESULT_MISSING");

  const nonStopShadowWrite = await __test.maybeWriteV2ShadowStopExit({
    symbol: "ETHUSDT",
    event: "EXIT_TP_P1_2.5P",
    fullExit: false,
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    fillId: "FILL__TP1",
    execPrice: 2500,
    writeStopExit: async () => {
      throw new Error("STOP_WRITER_MUST_NOT_BE_CALLED");
    },
  });
  assert.strictEqual(nonStopShadowWrite.skipped, true);
  assert.strictEqual(nonStopShadowWrite.reason, "V2_SHADOW_STOP_EXIT_NOT_FULL_EXIT");

  const writtenStopShadowWrite = await __test.maybeWriteV2ShadowStopExit({
    symbol: "ETHUSDT",
    event: "EXIT_SL_1.65P",
    fullExit: true,
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    orderMeta: {
      orderId: "STOP__ETH__ORDER",
      orderType: "STOP_MARKET",
      status: "FILLED",
      closePosition: true,
      reduceOnly: true,
      stopPrice: 2300,
      avgPrice: 2300,
      clientOrderId: "dbj_eth_sl",
    },
    fillId: "FILL__SL",
    execPrice: 2300,
    tradeMs: 1776026600000,
    writeStopExit: async (request) => {
      assert.strictEqual(request.sourceOrderId, "STOP__ETH__ORDER");
      assert.strictEqual(request.fillPrice, 2300);
      assert.strictEqual(request.fullExit, true);
      assert.strictEqual(request.exchangeEvidence.execution_type, "TRADE");
      assert.strictEqual(request.exchangeEvidence.order_type, "STOP_MARKET");
      assert.strictEqual(request.exchangeEvidence.order_status, "FILLED");
      assert.strictEqual(request.exchangeEvidence.close_position, true);
      assert.strictEqual(request.exchangeEvidence.reduce_only, true);
      assert.strictEqual(request.exchangeEvidence.stop_price, 2300);
      assert.strictEqual(request.exchangeEvidence.avg_price, 2300);
      assert.strictEqual(request.exchangeEvidence.full_exit, true);
      return buildBatchShadowWrite({ reason: "V2_SHADOW_STOP_EXIT_OK" });
    },
  });
  assert.strictEqual(writtenStopShadowWrite.ok, true);
  assert.strictEqual(writtenStopShadowWrite.written, true);

  const missingStopPriceShadowWrite = await __test.maybeWriteV2ShadowStopExit({
    symbol: "ETHUSDT",
    event: "EXIT_SL_1.65P",
    fullExit: true,
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    orderMeta: { orderId: "STOP__ETH__ORDER" },
    fillId: "FILL__SL_NO_PRICE",
    writeStopExit: async () => {
      throw new Error("STOP_WRITER_MUST_NOT_BE_CALLED_WITHOUT_PRICE");
    },
  });
  assert.strictEqual(missingStopPriceShadowWrite.ok, false);
  assert.strictEqual(missingStopPriceShadowWrite.reason, "EXIT_FILL_STOP_PRICE_REQUIRED");

  const nonStopLegacyGate = __test.resolveLegacyCanonicalStopWriteGate({
    transitionEvents: ["TP1_REACHED"],
    shadowStopWrite: nonStopShadowWrite,
  });
  assert.strictEqual(nonStopLegacyGate.ok, true);
  assert.strictEqual(nonStopLegacyGate.reason, "STOP_GATE_NOT_APPLICABLE");

  const writtenStopLegacyGate = __test.resolveLegacyCanonicalStopWriteGate({
    transitionEvents: ["SL_HIT"],
    shadowStopWrite: writtenStopShadowWrite,
  });
  assert.strictEqual(writtenStopLegacyGate.ok, true);
  assert.strictEqual(writtenStopLegacyGate.reason, "V2_SHADOW_STOP_EXIT_BATCH_WRITTEN");

  const disabledStopLegacyGate = __test.resolveLegacyCanonicalStopWriteGate({
    transitionEvents: ["TRAIL_HIT"],
    shadowStopWrite: {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_DRY_RUN",
    },
  });
  assert.strictEqual(disabledStopLegacyGate.ok, true);
  assert.strictEqual(disabledStopLegacyGate.reason, "V2_DRY_RUN");

  const blockedStopLegacyGate = __test.resolveLegacyCanonicalStopWriteGate({
    transitionEvents: ["SL_HIT"],
    shadowStopWrite: {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_STOP_EXIT_POSITION_CONTEXT_MISSING",
    },
  });
  assert.strictEqual(blockedStopLegacyGate.ok, false);
  assert.strictEqual(blockedStopLegacyGate.reason, "V2_SHADOW_STOP_EXIT_POSITION_CONTEXT_MISSING");

  const missingStopLegacyGate = __test.resolveLegacyCanonicalStopWriteGate({
    transitionEvents: ["TRAIL_HIT"],
  });
  assert.strictEqual(missingStopLegacyGate.ok, false);
  assert.strictEqual(missingStopLegacyGate.reason, "V2_SHADOW_STOP_EXIT_GATE_RESULT_MISSING");

  const nonExternalCloseShadowWrite = await __test.maybeWriteV2ShadowExternalClose({
    symbol: "ETHUSDT",
    event: "EXIT_SL_1.65P",
    transitionEvents: ["SL_HIT"],
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    fillId: "FILL__SL",
    writeExternalClose: async () => {
      throw new Error("EXTERNAL_CLOSE_WRITER_MUST_NOT_BE_CALLED");
    },
  });
  assert.strictEqual(nonExternalCloseShadowWrite.skipped, true);
  assert.strictEqual(nonExternalCloseShadowWrite.reason, "V2_SHADOW_EXTERNAL_CLOSE_EVENT_NOT_APPLICABLE");

  const writtenExternalCloseShadowWrite = await __test.maybeWriteV2ShadowExternalClose({
    symbol: "ETHUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    transitionEvents: ["EXTERNAL_CLOSE_SYNC"],
    fullExit: true,
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    orderMeta: {
      orderId: "EXT__ETH__ORDER",
      orderType: "MARKET",
      status: "FILLED",
      closePosition: true,
      reduceOnly: true,
      clientOrderId: "manual_ext_close",
    },
    fillId: "FILL__EXT",
    tradeMs: 1776026600000,
    writeExternalClose: async (request) => {
      assert.strictEqual(request.sourceOrderId, "EXT__ETH__ORDER");
      assert.strictEqual(request.closeKind, "EXTERNAL");
      assert.strictEqual(request.fullExit, true);
      assert.strictEqual(request.exchangeEvidence.execution_type, "TRADE");
      assert.strictEqual(request.exchangeEvidence.order_type, "MARKET");
      assert.strictEqual(request.exchangeEvidence.order_status, "FILLED");
      assert.strictEqual(request.exchangeEvidence.close_position, true);
      assert.strictEqual(request.exchangeEvidence.reduce_only, true);
      assert.strictEqual(request.exchangeEvidence.full_exit, true);
      return buildBatchShadowWrite({ reason: "V2_SHADOW_EXTERNAL_CLOSE_OK" });
    },
  });
  assert.strictEqual(writtenExternalCloseShadowWrite.ok, true);
  assert.strictEqual(writtenExternalCloseShadowWrite.written, true);

  const partialExternalCloseShadowWrite = await __test.maybeWriteV2ShadowExternalClose({
    symbol: "ETHUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    transitionEvents: ["EXTERNAL_CLOSE_SYNC"],
    fullExit: false,
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    orderMeta: { orderId: "EXT__ETH__PARTIAL" },
    fillId: "FILL__EXT_PARTIAL",
    writeExternalClose: async () => {
      throw new Error("EXTERNAL_CLOSE_WRITER_MUST_NOT_BE_CALLED_FOR_PARTIAL");
    },
  });
  assert.strictEqual(partialExternalCloseShadowWrite.skipped, true);
  assert.strictEqual(partialExternalCloseShadowWrite.reason, "V2_SHADOW_EXTERNAL_CLOSE_NOT_FULL_EXIT");

  const writtenManualCloseShadowWrite = await __test.maybeWriteV2ShadowExternalClose({
    symbol: "ETHUSDT",
    event: "EXIT_EXTERNAL_SYNC",
    transitionEvents: ["MANUAL_CLOSE_SYNC"],
    fullExit: true,
    entryEventId: "ENTRY__ETH",
    positionSide: "LONG",
    fillId: "FILL__MANUAL",
    writeExternalClose: async (request) => {
      assert.strictEqual(request.closeKind, "MANUAL");
      return buildBatchShadowWrite({ reason: "V2_SHADOW_EXTERNAL_CLOSE_OK" });
    },
  });
  assert.strictEqual(writtenManualCloseShadowWrite.written, true);

  const nonExternalCloseLegacyGate = __test.resolveLegacyCanonicalExternalCloseWriteGate({
    transitionEvents: ["SL_HIT"],
    shadowExternalCloseWrite: nonExternalCloseShadowWrite,
  });
  assert.strictEqual(nonExternalCloseLegacyGate.ok, true);
  assert.strictEqual(nonExternalCloseLegacyGate.reason, "EXTERNAL_CLOSE_GATE_NOT_APPLICABLE");

  const writtenExternalCloseLegacyGate = __test.resolveLegacyCanonicalExternalCloseWriteGate({
    transitionEvents: ["EXTERNAL_CLOSE_SYNC"],
    shadowExternalCloseWrite: writtenExternalCloseShadowWrite,
  });
  assert.strictEqual(writtenExternalCloseLegacyGate.ok, true);
  assert.strictEqual(writtenExternalCloseLegacyGate.reason, "V2_SHADOW_EXTERNAL_CLOSE_BATCH_WRITTEN");

  const disabledExternalCloseLegacyGate = __test.resolveLegacyCanonicalExternalCloseWriteGate({
    transitionEvents: ["MANUAL_CLOSE_SYNC"],
    shadowExternalCloseWrite: {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_EXIT_WRITE_DISABLED",
    },
  });
  assert.strictEqual(disabledExternalCloseLegacyGate.ok, true);
  assert.strictEqual(disabledExternalCloseLegacyGate.reason, "V2_SHADOW_EXIT_WRITE_DISABLED");

  const blockedExternalCloseLegacyGate = __test.resolveLegacyCanonicalExternalCloseWriteGate({
    transitionEvents: ["EXTERNAL_CLOSE_SYNC"],
    shadowExternalCloseWrite: {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_EXTERNAL_CLOSE_POSITION_CONTEXT_MISSING",
    },
  });
  assert.strictEqual(blockedExternalCloseLegacyGate.ok, false);
  assert.strictEqual(blockedExternalCloseLegacyGate.reason, "V2_SHADOW_EXTERNAL_CLOSE_POSITION_CONTEXT_MISSING");

  const missingExternalCloseLegacyGate = __test.resolveLegacyCanonicalExternalCloseWriteGate({
    transitionEvents: ["MANUAL_CLOSE_SYNC"],
  });
  assert.strictEqual(missingExternalCloseLegacyGate.ok, false);
  assert.strictEqual(missingExternalCloseLegacyGate.reason, "V2_SHADOW_EXTERNAL_CLOSE_GATE_RESULT_MISSING");

  const v2OwnedLegacyWriteDecision = __test.resolveLegacyCanonicalWriteDecision({
    canonicalExitMutationAllowed: true,
    legacyCanonicalTp1Gate: writtenTp1LegacyGate,
    legacyCanonicalStopGate: nonStopLegacyGate,
    legacyCanonicalExternalCloseGate: nonExternalCloseLegacyGate,
    env: {},
  });
  assert.strictEqual(v2OwnedLegacyWriteDecision.ok, true);
  assert.strictEqual(v2OwnedLegacyWriteDecision.write, false);
  assert.strictEqual(v2OwnedLegacyWriteDecision.reason, "V2_BATCH_CANONICAL_ALREADY_WRITTEN");
  assert.strictEqual(v2OwnedLegacyWriteDecision.v2_batch_written, true);

  const explicitBackfillLegacyWriteDecision = __test.resolveLegacyCanonicalWriteDecision({
    canonicalExitMutationAllowed: true,
    legacyCanonicalTp1Gate: writtenTp1LegacyGate,
    legacyCanonicalStopGate: nonStopLegacyGate,
    legacyCanonicalExternalCloseGate: nonExternalCloseLegacyGate,
    env: {
      DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED: "1",
    },
  });
  assert.strictEqual(explicitBackfillLegacyWriteDecision.ok, true);
  assert.strictEqual(explicitBackfillLegacyWriteDecision.write, false);
  assert.strictEqual(explicitBackfillLegacyWriteDecision.reason, "V2_BATCH_CANONICAL_ALREADY_WRITTEN");
  assert.strictEqual(explicitBackfillLegacyWriteDecision.legacy_backfill_enabled, true);

  const v2DisabledLegacyWriteDecision = __test.resolveLegacyCanonicalWriteDecision({
    canonicalExitMutationAllowed: true,
    legacyCanonicalTp1Gate: disabledTp1LegacyGate,
    legacyCanonicalStopGate: nonStopLegacyGate,
    legacyCanonicalExternalCloseGate: nonExternalCloseLegacyGate,
    env: {},
  });
  assert.strictEqual(v2DisabledLegacyWriteDecision.ok, true);
  assert.strictEqual(v2DisabledLegacyWriteDecision.write, true);
  assert.strictEqual(v2DisabledLegacyWriteDecision.reason, "LEGACY_CANONICAL_WRITE_ALLOWED");

  const blockedLegacyWriteDecision = __test.resolveLegacyCanonicalWriteDecision({
    canonicalExitMutationAllowed: true,
    legacyCanonicalTp1Gate: blockedTp1LegacyGate,
    legacyCanonicalStopGate: nonStopLegacyGate,
    legacyCanonicalExternalCloseGate: nonExternalCloseLegacyGate,
    env: {},
  });
  assert.strictEqual(blockedLegacyWriteDecision.ok, false);
  assert.strictEqual(blockedLegacyWriteDecision.write, false);
  assert.strictEqual(blockedLegacyWriteDecision.reason, "V2_SHADOW_TP1_PROTECTION_RUNTIME_NOT_HEALTHY");

  console.log("BINANCE_FILLS_CANONICAL_LINEAGE_GUARD_TEST_OK");
}

run().catch((err) => {
  console.error("BINANCE_FILLS_CANONICAL_LINEAGE_GUARD_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
