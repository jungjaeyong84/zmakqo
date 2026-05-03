"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { prepareExitTransitionAlert } = require("../v2/alertWorker");
const { deliverPreparedExitTransitionAlert, buildExitTransitionDeliveryRequest } = require("../v2/alertDeliveryWorker");

function buildFakeDb(store) {
  return {
    collection(name) {
      if (!store[name]) store[name] = {};
      return {
        doc(id) {
          return {
            async set(payload) {
              store[name][id] = payload;
            },
          };
        },
      };
    },
  };
}

function buildPreparedAlert() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__DELIVERY",
    entryOrderId: "ORDER__ETH__DELIVERY",
    entryFillGroupId: "FILL_GROUP__ETH__DELIVERY",
    entryIntentId: "EINTV2__eth_delivery",
    signalIntentId: "SIGINTV2__eth_delivery",
    openclawDecisionId: "OCDV2__eth_delivery",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const reduced = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__DELIVERY",
      sourceOrderId: "ORDER__TP1__DELIVERY",
      fillQtyAbs: 1,
    },
  });
  return prepareExitTransitionAlert({
    positionCycle: base.positionCycle,
    transition: reduced.transition,
    projection: reduced.nextProjection,
  });
}

(function deliveryRequestUsesPreparedPayloadOnly() {
  const prepared = buildPreparedAlert();
  const request = buildExitTransitionDeliveryRequest({ preparedAlert: prepared });
  assert.strictEqual(request.title, "[ETHUSDT] TP_FULL");
  assert.strictEqual(request.severity, "INFO");
  assert.strictEqual(request.sections.length, 1);
  assert.ok(request.sections[0].lines.includes("event=TP1_FULL_EXIT"));
})();

(async function disabledDeliveryPersistsFailedOutboxNotSilentDrop() {
  const store = {};
  const prepared = buildPreparedAlert();
  const result = await deliverPreparedExitTransitionAlert({
    preparedAlert: prepared,
    db: buildFakeDb(store),
    env: {
      DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED: "0",
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    },
    sendSummary: async () => {
      throw new Error("SHOULD_NOT_SEND");
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.deliveryEnabled, false);
  assert.strictEqual(result.updatedOutbox.status, "FAILED");
  assert.strictEqual(result.updatedOutbox.last_reason, "V2_SHADOW_ALERT_DELIVERY_DISABLED");
  assert.ok(result.updatedOutbox.last_attempt_at);
  assert.strictEqual(result.updatedOutbox.last_reason_family, "OPERATOR_CONFIG");
  assert.strictEqual(result.updatedOutbox.retry_policy_code, "ALERT_CFG_TERMINAL");
  assert.deepStrictEqual(result.updatedOutbox.runbook_refs, ["ALERT_RBK_01"]);
  assert.ok(store["dbjv2__trade_alert_outbox_v2"][prepared.outbox.alert_outbox_id]);
})();

(async function enabledDeliveryPersistsSentOutbox() {
  const store = {};
  const prepared = buildPreparedAlert();
  const result = await deliverPreparedExitTransitionAlert({
    preparedAlert: prepared,
    db: buildFakeDb(store),
    env: {
      DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED: "1",
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    },
    sendSummary: async (request) => ({
      ok: true,
      requestEcho: request.title,
    }),
    sentAt: "2026-04-21T02:00:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.deliveryEnabled, true);
  assert.strictEqual(result.updatedOutbox.status, "SENT");
  assert.strictEqual(result.updatedOutbox.sent_at, "2026-04-21T02:00:00.000Z");
  assert.strictEqual(result.updatedOutbox.last_attempt_at, "2026-04-21T02:00:00.000Z");
  assert.strictEqual(result.updatedOutbox.last_reason_family, null);
  assert.strictEqual(result.updatedOutbox.retry_policy_code, "DELIVERED");
  assert.deepStrictEqual(result.updatedOutbox.runbook_refs, []);
  assert.strictEqual(store["dbjv2__trade_alert_outbox_v2"][prepared.outbox.alert_outbox_id].status, "SENT");
})();

console.log("V2_ALERT_DELIVERY_WORKER_TEST_OK");
