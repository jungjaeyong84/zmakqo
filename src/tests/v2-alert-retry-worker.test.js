"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { prepareExitTransitionAlert } = require("../v2/alertWorker");
const {
  buildPersistedPreparedAlertOutbox,
  retryStoredExitTransitionAlert,
} = require("../v2/alertDeliveryWorker");
const { retryFailedExitTransitionAlerts, __test } = require("../v2/alertRetryWorker");

function buildFakeDb(store, calls = []) {
  return {
    collection(name) {
      if (!store[name]) store[name] = {};
      return {
        doc(id) {
          return {
            async set(payload) {
              calls.push({ type: "set", collection: name, docId: id });
              store[name][id] = payload;
            },
          };
        },
        where(field, op, value) {
          return {
            limit(max) {
              return {
                async get() {
                  const docs = Object.values(store[name] || {})
                    .filter((row) => row && row[field] === value)
                    .slice(0, max)
                    .map((row) => ({
                      data() {
                        return row;
                      },
                    }));
                  return { docs };
                },
              };
            },
          };
        },
      };
    },
  };
}

function buildStoredOutbox() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__RETRY",
    entryOrderId: "ORDER__ETH__RETRY",
    entryFillGroupId: "FILL_GROUP__ETH__RETRY",
    entryIntentId: "EINTV2__eth_retry",
    signalIntentId: "SIGINTV2__eth_retry",
    openclawDecisionId: "OCDV2__eth_retry",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const reduced = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__RETRY",
      sourceOrderId: "ORDER__TP1__RETRY",
      fillQtyAbs: 0.5,
    },
  });
  const prepared = prepareExitTransitionAlert({
    positionCycle: base.positionCycle,
    transition: reduced.transition,
    projection: reduced.nextProjection,
  });
  return buildPersistedPreparedAlertOutbox({
    preparedAlert: prepared,
  });
}

(function persistedOutboxKeepsPreparedPayloadAndRequest() {
  const outbox = buildStoredOutbox();
  assert.ok(outbox.prepared_payload);
  assert.ok(outbox.delivery_request);
  assert.strictEqual(outbox.delivery_request.title, "[ETHUSDT] TP1");
})();

(async function storedRetryUsesPersistedRequestOnly() {
  const store = {};
  const outbox = {
    ...buildStoredOutbox(),
    status: "FAILED",
  };
  const result = await retryStoredExitTransitionAlert({
    outbox,
    db: buildFakeDb(store),
    env: {
      DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED: "1",
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    },
    sendSummary: async (request) => ({
      ok: true,
      echoed: request.title,
    }),
    sentAt: "2026-04-21T03:00:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updatedOutbox.status, "SENT");
  assert.strictEqual(store["dbjv2__trade_alert_outbox_v2"][outbox.alert_outbox_id].status, "SENT");
})();

(async function boundedRetryWorkerOnlyTouchesFailedRows() {
  const store = {
    "dbjv2__trade_alert_outbox_v2": {},
  };
  const failed = {
    ...buildStoredOutbox(),
    status: "FAILED",
  };
  const sent = {
    ...buildStoredOutbox(),
    alert_outbox_id: "TAOV2__EXIT_TRANSITION_ALERT__SENT_ROW",
    status: "SENT",
  };
  store["dbjv2__trade_alert_outbox_v2"][failed.alert_outbox_id] = failed;
  store["dbjv2__trade_alert_outbox_v2"][sent.alert_outbox_id] = sent;
  const result = await retryFailedExitTransitionAlerts({
    db: buildFakeDb(store),
    env: {
      DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED: "1",
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    },
    limit: 5,
    statuses: ["FAILED"],
    sendSummary: async () => ({ ok: true }),
    sentAt: "2026-04-21T03:05:00.000Z",
  });
  assert.strictEqual(result.fetched_n, 1);
  assert.strictEqual(result.sent_n, 1);
  assert.strictEqual(store["dbjv2__trade_alert_outbox_v2"][failed.alert_outbox_id].status, "SENT");
  assert.strictEqual(store["dbjv2__trade_alert_outbox_v2"][sent.alert_outbox_id].status, "SENT");
})();

(function retryEligibilityBlocksMaxAttemptAndCooldownAndTerminalReason() {
  const base = buildStoredOutbox();
  const maxAttempt = __test.evaluateRetryEligibility({
    outbox: {
      ...base,
      status: "FAILED",
      attempt_count: 3,
      last_attempt_at: "2026-04-21T03:05:00.000Z",
    },
    maxAttempt: 3,
    cooldownSec: 300,
    nowMs: Date.parse("2026-04-21T03:20:00.000Z"),
  });
  assert.strictEqual(maxAttempt.ok, false);
  assert.strictEqual(maxAttempt.reason, "RETRY_MAX_ATTEMPT_EXCEEDED");
  assert.strictEqual(maxAttempt.family, "RETRY_GOVERNANCE");
  assert.deepStrictEqual(maxAttempt.runbook_refs, ["ALERT_RBK_05"]);

  const cooldown = __test.evaluateRetryEligibility({
    outbox: {
      ...base,
      status: "FAILED",
      attempt_count: 1,
      last_attempt_at: "2026-04-21T03:05:00.000Z",
    },
    maxAttempt: 3,
    cooldownSec: 300,
    nowMs: Date.parse("2026-04-21T03:06:00.000Z"),
  });
  assert.strictEqual(cooldown.ok, false);
  assert.strictEqual(cooldown.reason, "RETRY_COOLDOWN_ACTIVE");
  assert.strictEqual(cooldown.family, "RETRY_GOVERNANCE");
  assert.deepStrictEqual(cooldown.runbook_refs, ["ALERT_RBK_05"]);

  const terminal = __test.evaluateRetryEligibility({
    outbox: {
      ...base,
      status: "FAILED",
      attempt_count: 1,
      last_reason: "V2_SHADOW_ALERT_DELIVERY_DISABLED",
      last_attempt_at: "2026-04-21T03:05:00.000Z",
    },
    maxAttempt: 3,
    cooldownSec: 0,
    nowMs: Date.parse("2026-04-21T03:20:00.000Z"),
  });
  assert.strictEqual(terminal.ok, false);
  assert.strictEqual(terminal.reason, "RETRY_TERMINAL_REASON");
  assert.strictEqual(terminal.family, "OPERATOR_CONFIG");
  assert.deepStrictEqual(terminal.runbook_refs, ["ALERT_RBK_01"]);
})();

console.log("V2_ALERT_RETRY_WORKER_TEST_OK");
