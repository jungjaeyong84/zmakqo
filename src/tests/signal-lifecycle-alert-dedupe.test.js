"use strict";

const assert = require("assert");
const { __test } = require("../services/signalLifecycleAlert");

function makeFakeDb() {
  const store = new Map();
  return {
    store,
    async runTransaction(fn) {
      return fn({
        async get(ref) { return ref.get(); },
        set(ref, payload, options = {}) { return ref.set(payload, options); },
      });
    },
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() {
              return {
                exists: store.has(key),
                data: () => store.get(key),
              };
            },
            async set(payload, options = {}) {
              if (options.merge === true && store.has(key)) {
                store.set(key, { ...store.get(key), ...payload });
              } else {
                store.set(key, payload);
              }
            },
          };
        },
      };
    },
  };
}

async function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.resolveSignalLifecycleAlertDedupeKey, "function");
  assert.strictEqual(typeof __test.prepareSignalLifecycleAlertOutbox, "function");

  const dropped = {
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    event: "SHORT",
    side: "SELL",
    tf: "15m",
    executionMode: "LIVE",
    source: "SERVER",
    authoritative: true,
    signalId: "SIG__BINANCEFUT__LINKUSDT__15m__1777165200000__SHORT",
    dropReasonCode: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
    runId: "RUN_A",
  };
  const firstKey = __test.resolveSignalLifecycleAlertDedupeKey({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    payload: dropped,
  });
  const replayKey = __test.resolveSignalLifecycleAlertDedupeKey({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    payload: {
      ...dropped,
      runId: "RUN_B",
      qtyFinalPct: 0,
      note: "producer-specific replay noise must not change dedupe",
    },
  });
  assert.strictEqual(firstKey, replayKey, "same dropped signal_id + reason must dedupe across producers/runs");
  const casingReplayKey = __test.resolveSignalLifecycleAlertDedupeKey({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    payload: {
      ...dropped,
      tf: "15M",
      side: "SHORT",
    },
  });
  assert.strictEqual(firstKey, casingReplayKey, "tf casing drift must not fork lifecycle dedupe keys");
  assert.ok(firstKey.includes("LINKUSDT"), "dedupe key must bind to symbol");
  assert.ok(firstKey.includes("DROPPED"), "dedupe key must bind to lifecycle type");
  assert.ok(firstKey.includes("V2_PRODUCTION_ENTRY_KERNEL_BLOCKED"), "dedupe key must bind to drop reason");
  assert.ok(firstKey.includes(dropped.signalId), "dedupe key must bind to signal id");

  const differentReason = __test.resolveSignalLifecycleAlertDedupeKey({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    payload: { ...dropped, dropReasonCode: "V2_RISK_GOVERNOR_BLOCKED" },
  });
  assert.notStrictEqual(firstKey, differentReason, "different drop reasons for same signal should remain distinguishable");

  const progressKey = __test.resolveSignalLifecycleAlertDedupeKey({
    type: "PROGRESSED",
    exchange: "BINANCEFUT",
    payload: {
      ...dropped,
      progressReason: "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE",
    },
  });
  assert.notStrictEqual(firstKey, progressKey, "progress and drop alerts must not share an outbox key");

  const noIdentity = __test.resolveSignalLifecycleAlertDedupeKey({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    payload: {
      exchange: "BINANCEFUT",
      symbol: "LINKUSDT",
      event: "SHORT",
      tf: "15m",
      dropReasonCode: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
    },
  });
  assert.strictEqual(noIdentity, null, "weak drops without signal/bar identity must not invent durable dedupe");

  const db = makeFakeDb();
  const prepared = await __test.prepareSignalLifecycleAlertOutbox({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    event: "SHORT",
    title: "LINKUSDT 서버 신호 드롭",
    body: "drop body",
    channel: "telegram:ops",
    payload: dropped,
    dedupeKey: firstKey,
    db,
  });
  assert.strictEqual(prepared.skipSend, false, "first outbox prepare must allow send");
  await prepared.ref.set({ status: "SENT", sent_at: "2026-05-01T00:00:00.000Z" }, { merge: true });
  const replay = await __test.prepareSignalLifecycleAlertOutbox({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    event: "SHORT",
    title: "LINKUSDT 서버 신호 드롭",
    body: "drop body replay",
    channel: "telegram:ops",
    payload: { ...dropped, runId: "RUN_B" },
    dedupeKey: firstKey,
    db,
  });
  assert.strictEqual(replay.skipSend, true, "already SENT lifecycle outbox row must suppress duplicate Telegram send");

  const pendingDb = makeFakeDb();
  const firstPending = await __test.prepareSignalLifecycleAlertOutbox({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    event: "SHORT",
    title: "LINKUSDT 서버 신호 드롭",
    body: "drop body",
    channel: "telegram:ops",
    payload: dropped,
    dedupeKey: firstKey,
    db: pendingDb,
  });
  assert.strictEqual(firstPending.skipSend, false);
  const secondPending = await __test.prepareSignalLifecycleAlertOutbox({
    type: "DROPPED",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    event: "SHORT",
    title: "LINKUSDT 서버 신호 드롭",
    body: "drop body",
    channel: "telegram:ops",
    payload: dropped,
    dedupeKey: firstKey,
    db: pendingDb,
  });
  assert.strictEqual(secondPending.skipSend, true, "active PENDING claim must suppress duplicate sender");
  assert.strictEqual(secondPending.reason, "CLAIM_HELD");

  console.log("SIGNAL_LIFECYCLE_ALERT_DEDUPE_TEST_OK");
}

run().catch((err) => {
  console.error("SIGNAL_LIFECYCLE_ALERT_DEDUPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
