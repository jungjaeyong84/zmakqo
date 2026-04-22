"use strict";

const assert = require("assert");
const { buildReferenceNativeMlEvidencePack } = require("../v2/replayFixtureFactory");
const { buildV2ProductionEntryLiveRequest } = require("../v2/productionEntryLiveRequest");
const { runV2ProductionEntryRoute } = require("../v2/productionEntryRoute");
const protectedCanary = require("../v2/productionEntryProtectedCanary");
const { buildProtectedActivePositionCycleDoc } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { prepareExitTransitionAlert } = require("../v2/alertWorker");
const { evaluateRuntimeExecutionChain } = require("../v2/runtimeExecutionChain");

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

async function buildOpenClawSizingProtectedEntryExitFixture() {
  const nowIso = "2026-04-22T03:00:00.000Z";
  const bundle = buildReferenceNativeMlEvidencePack();
  const sizing = protectedCanary.__test.buildDefaultSizing();
  const request = buildV2ProductionEntryLiveRequest({
    bundle,
    sizing,
    now: () => nowIso,
  });
  assert.strictEqual(request.ok, true);
  assert.strictEqual(request.entrySizingDecision.ok, true);
  assert.strictEqual(request.entrySizingDecision.status, "APPROVED");

  const firestore = protectedCanary.__test.createMemoryFirestore();
  const exchangeWriteLedger = {
    exchange_write_performed: false,
    entry_submit_called: false,
    initial_sl_called: false,
    initial_tp1_called: false,
  };
  const routeResult = await runV2ProductionEntryRoute({
    db: firestore,
    env: {
      DONBEOLJA_V2_ENABLED: "1",
      DONBEOLJA_V2_DRY_RUN: "0",
      DONBEOLJA_V2_CANARY_ONLY: "1",
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "0",
    },
    bundle: request.body.bundle,
    entryTransport: protectedCanary.__test.buildNoExchangeEntryTransport({
      sizingDecision: request.entrySizingDecision,
      nowIso,
      exchangeWriteLedger,
    }),
    protectionTransports: protectedCanary.__test.buildNoExchangeProtectionTransports({
      nowIso,
      exchangeWriteLedger,
    }),
    persistExecutionAudit: async ({ audit, positionCycleId, source }) => Object.freeze({
      ok: true,
      skipped: true,
      reason: "OPENCLAW_PROTECTED_ENTRY_EXIT_FIXTURE_LEDGER_DISABLED",
      audit_id: audit && audit.audit_id,
      position_cycle_id: positionCycleId,
      source,
      exchange_write_performed: false,
    }),
    now: () => nowIso,
  });

  assert.strictEqual(routeResult.ok, true);
  assert.strictEqual(routeResult.reason, "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED");
  assert.strictEqual(routeResult.openclawExecutionAudit.ok, true);
  assert.strictEqual(exchangeWriteLedger.entry_submit_called, true);
  assert.strictEqual(exchangeWriteLedger.initial_sl_called, true);
  assert.strictEqual(exchangeWriteLedger.initial_tp1_called, true);
  assert.strictEqual(exchangeWriteLedger.exchange_write_performed, false);

  const submitterResult = asObject(routeResult.kernelResult && routeResult.kernelResult.submitterResult);
  const executedEntry = asObject(submitterResult && submitterResult.executedEntry);
  const protectionResult = asObject(submitterResult && submitterResult.protectionResult);
  const protectionWriteResult = asObject(protectionResult && protectionResult.protectionWriteResult);
  const placementRequest = asObject(protectionResult && protectionResult.placementRequest);
  assert.ok(executedEntry);
  assert.ok(protectionWriteResult);
  assert.ok(placementRequest);
  assert.strictEqual(protectionWriteResult.runtimeDoc.health_status, "HEALTHY");
  assert.ok(protectionWriteResult.runtimeDoc.sl_order_id);
  assert.ok(protectionWriteResult.runtimeDoc.tp1_order_id);

  const activeExecutedEntry = Object.freeze({
    ...executedEntry,
    positionCycle: buildProtectedActivePositionCycleDoc({
      positionCycle: executedEntry.positionCycle,
      protectionWriteResult,
      activatedAt: nowIso,
    }),
  });

  const tp1Reduction = reduceCanonicalExit({
    positionCycle: activeExecutedEntry.positionCycle,
    projection: activeExecutedEntry.projection,
    protectionRuntime: protectionWriteResult.runtimeDoc,
    requireProtectionRuntimeGate: true,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__V2_FIXTURE__TP1",
      sourceOrderId: protectionWriteResult.runtimeDoc.tp1_order_id,
      fillQtyAbs: activeExecutedEntry.protectionPlan.tp1_qty_abs,
      fillPrice: activeExecutedEntry.protectionPlan.tp1_trigger_price,
    },
  });
  const tp1Alert = prepareExitTransitionAlert({
    positionCycle: activeExecutedEntry.positionCycle,
    transition: tp1Reduction.transition,
    projection: tp1Reduction.nextProjection,
  });
  const tp1ChainAudit = evaluateRuntimeExecutionChain({
    executedEntry: activeExecutedEntry,
    placementRequest,
    protectionWriteResult,
    reductionResult: tp1Reduction,
    preparedAlert: tp1Alert,
  });
  assert.strictEqual(tp1Reduction.transition.transition_event, "TP1_REACHED");
  assert.strictEqual(tp1Reduction.nextProjection.stage, "TP1_DONE");
  assert.strictEqual(tp1Alert.ok, true);
  assert.strictEqual(tp1ChainAudit.ok, true);

  const trailReduction = reduceCanonicalExit({
    positionCycle: activeExecutedEntry.positionCycle,
    projection: tp1Reduction.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "FILL__V2_FIXTURE__TRAIL_ACTIVATION",
      sourceOrderId: protectionWriteResult.runtimeDoc.sl_order_id,
      nextStopPrice: Number((activeExecutedEntry.entryContract.side === "LONG"
        ? activeExecutedEntry.entryContract.quality_score + activeExecutedEntry.protectionPlan.sl_trigger_price
        : activeExecutedEntry.protectionPlan.sl_trigger_price).toFixed(8)),
    },
  });
  const trailAlert = prepareExitTransitionAlert({
    positionCycle: activeExecutedEntry.positionCycle,
    transition: trailReduction.transition,
    projection: trailReduction.nextProjection,
  });
  assert.strictEqual(trailReduction.transition.transition_event, "TRAIL_ACTIVATED");
  assert.strictEqual(trailReduction.nextProjection.stage, "TRAIL_ACTIVE");
  assert.strictEqual(trailReduction.nextProjection.trail_active, true);
  assert.strictEqual(trailAlert.ok, true);

  const finalExitReduction = reduceCanonicalExit({
    positionCycle: activeExecutedEntry.positionCycle,
    projection: trailReduction.nextProjection,
    evidence: {
      kind: "STOP_EXIT_CONFIRMED",
      sourceFillId: "FILL__V2_FIXTURE__TRAIL_FINAL",
      sourceOrderId: protectionWriteResult.runtimeDoc.sl_order_id,
      fillQtyAbs: trailReduction.nextProjection.runner_remaining_qty_abs,
      fillPrice: trailReduction.nextProjection.final_effective_stop,
    },
  });
  const finalExitAlert = prepareExitTransitionAlert({
    positionCycle: activeExecutedEntry.positionCycle,
    transition: finalExitReduction.transition,
    projection: finalExitReduction.nextProjection,
  });
  const finalExitChainAudit = evaluateRuntimeExecutionChain({
    executedEntry: activeExecutedEntry,
    placementRequest,
    protectionWriteResult,
    reductionResult: finalExitReduction,
    preparedAlert: finalExitAlert,
  });
  assert.strictEqual(finalExitReduction.transition.transition_event, "TRAIL_HIT");
  assert.strictEqual(finalExitReduction.nextProjection.stage, "EXITED_TRAIL");
  assert.strictEqual(finalExitReduction.nextProjection.runner_remaining_qty_abs, 0);
  assert.strictEqual(finalExitAlert.ok, true);
  assert.strictEqual(finalExitChainAudit.ok, true);

  return Object.freeze({
    request,
    routeResult,
    tp1Reduction,
    trailReduction,
    finalExitReduction,
    tp1ChainAudit,
    finalExitChainAudit,
  });
}

buildOpenClawSizingProtectedEntryExitFixture()
  .then((fixture) => {
    assert.strictEqual(fixture.request.entrySizingDecision.entry_qty_abs, 0.8);
    assert.strictEqual(fixture.tp1Reduction.transition.ledger_patch.tp1_filled_qty_abs, 0.4);
    assert.strictEqual(fixture.finalExitReduction.transition.ledger_patch.final_exit_qty_abs, 0.4);
    console.log("V2_OPENCLAW_PROTECTED_ENTRY_EXIT_FIXTURE_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
