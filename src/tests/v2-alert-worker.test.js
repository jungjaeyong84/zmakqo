"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { prepareExitTransitionAlert, applyAlertDeliveryResult } = require("../v2/alertWorker");

function buildTp1Context() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__A1",
    entryOrderId: "ORDER__ETH__A1",
    entryFillGroupId: "FILL_GROUP__ETH__A1",
    entryIntentId: "EINTV2__eth_a1",
    signalIntentId: "SIGINTV2__eth_a1",
    openclawDecisionId: "OCDV2__eth_a1",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const reduced = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__A1",
      sourceOrderId: "ORDER__TP1__A1",
      fillQtyAbs: 1,
    },
  });
  return {
    positionCycle: base.positionCycle,
    transition: reduced.transition,
    projection: reduced.nextProjection,
  };
}

function buildTerminalSlContext() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__A2",
    entryOrderId: "ORDER__BTC__A2",
    entryFillGroupId: "FILL_GROUP__BTC__A2",
    entryIntentId: "EINTV2__btc_a2",
    signalIntentId: "SIGINTV2__btc_a2",
    openclawDecisionId: "OCDV2__btc_a2",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.01,
  });
  const reduced = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "STOP_EXIT_CONFIRMED",
      sourceFillId: "FILL__SL__A2",
      sourceOrderId: "ORDER__SL__A2",
      fillPrice: 98350,
    },
  });
  return {
    positionCycle: base.positionCycle,
    transition: reduced.transition,
    projection: reduced.nextProjection,
  };
}

(function alertSourceMustBeCanonicalTransition() {
  let err = null;
  try {
    prepareExitTransitionAlert({});
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "CANONICAL_TRANSITION_REQUIRED");
})();

(function tp1TransitionBuildsPendingOutboxAndPayload() {
  const ctx = buildTp1Context();
  const prepared = prepareExitTransitionAlert(ctx);
  assert.strictEqual(prepared.ok, true);
  assert.strictEqual(prepared.outbox.status, "PENDING");
  assert.strictEqual(prepared.outbox.canonical_transition_id, ctx.transition.canonical_transition_id);
  assert.ok(prepared.payload.title.includes("[ETHUSDT] TP_FULL"));
  assert.ok(prepared.payload.body.includes("event=TP1_FULL_EXIT"));
})();

(function prepFailureIsDurableNotSilent() {
  const ctx = buildTp1Context();
  const prepared = prepareExitTransitionAlert({
    ...ctx,
    projection: {
      ...ctx.projection,
      stage: "TRAIL_ACTIVE",
    },
  });
  assert.strictEqual(prepared.ok, false);
  assert.strictEqual(prepared.payload, null);
  assert.strictEqual(prepared.outbox.status, "FAILED");
  assert.strictEqual(prepared.outbox.last_reason, "ALERT_STAGE_MISMATCH");
})();

(function terminalExitIncludesFinalExitQtyInPayload() {
  const ctx = buildTerminalSlContext();
  const prepared = prepareExitTransitionAlert(ctx);
  assert.strictEqual(prepared.ok, true);
  assert.ok(prepared.payload.title.includes("[BTCUSDT] SL"));
  assert.ok(prepared.payload.body.includes("final_exit_qty_abs=0.01"));
})();

(function terminalExitQtyMismatchFailsDurably() {
  const ctx = buildTerminalSlContext();
  const prepared = prepareExitTransitionAlert({
    ...ctx,
    transition: {
      ...ctx.transition,
      ledger_patch: {
        ...ctx.transition.ledger_patch,
        final_exit_qty_abs: 0.005,
      },
    },
  });
  assert.strictEqual(prepared.ok, false);
  assert.strictEqual(prepared.payload, null);
  assert.strictEqual(prepared.outbox.status, "FAILED");
  assert.strictEqual(prepared.outbox.last_reason, "ALERT_TERMINAL_EXIT_QTY_MISMATCH");
})();

(function deliverySuccessMarksOutboxSent() {
  const ctx = buildTp1Context();
  const prepared = prepareExitTransitionAlert(ctx);
  const sent = applyAlertDeliveryResult({
    outbox: prepared.outbox,
    deliveryOk: true,
    sentAt: "2026-04-20T12:00:00.000Z",
  });
  assert.strictEqual(sent.status, "SENT");
  assert.strictEqual(sent.attempt_count, 1);
  assert.strictEqual(sent.sent_at, "2026-04-20T12:00:00.000Z");
})();

(function deliveryFailureStaysDurableAndIncrementsAttempt() {
  const ctx = buildTp1Context();
  const prepared = prepareExitTransitionAlert(ctx);
  const failed = applyAlertDeliveryResult({
    outbox: prepared.outbox,
    deliveryOk: false,
    deliveryReason: "TELEGRAM_TIMEOUT",
  });
  assert.strictEqual(failed.status, "FAILED");
  assert.strictEqual(failed.attempt_count, 1);
  assert.strictEqual(failed.last_reason, "TELEGRAM_TIMEOUT");
})();

console.log("V2_ALERT_WORKER_TEST_OK");
