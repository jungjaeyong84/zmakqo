"use strict";

const assert = require("assert");
const path = require("path");

const tradeAlertOutboxPath = path.resolve(__dirname, "../storage/tradeAlertOutbox.js");
const firestorePath = path.resolve(__dirname, "../storage/firestore.js");

function createFakeDb() {
  const store = new Map();
  return {
    collection() {
      return {
        doc(id) {
          return {
            id,
            async get() {
              const current = store.get(id);
              return {
                exists: !!current,
                data: () => (current ? JSON.parse(JSON.stringify(current)) : undefined),
              };
            },
            set(patch, { merge } = {}) {
              const prev = store.get(id) || {};
              const next = merge ? { ...prev, ...patch } : { ...patch };
              store.set(id, next);
              return Promise.resolve();
            },
          };
        },
      };
    },
    async runTransaction(handler) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, patch, options) {
          return ref.set(patch, options);
        },
      };
      return handler(tx);
    },
    __store: store,
  };
}

function loadTradeAlertOutboxWithDb(fakeDb) {
  delete require.cache[tradeAlertOutboxPath];
  const original = require.cache[firestorePath];
  require.cache[firestorePath] = {
    id: firestorePath,
    filename: firestorePath,
    loaded: true,
    exports: { getFirestore: () => fakeDb },
  };
  const mod = require(tradeAlertOutboxPath);
  if (original) require.cache[firestorePath] = original;
  else delete require.cache[firestorePath];
  return mod;
}

function run() {
  const { __test } = require(tradeAlertOutboxPath);
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.buildTradeAlertOutboxId, "function", "buildTradeAlertOutboxId export missing");

  const first = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    sourceFillId: "fill-123",
  });
  const second = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    sourceFillId: "fill-123",
    payload: { orderId: 1, ts: "2026-04-15T00:00:00.000Z" },
  });
  assert.strictEqual(first, second, "source fill id should dominate outbox id stability");

  const fallbackA = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "LONG",
    payload: {
      signalId: "SIG__1",
      intentId: "INTENT__1",
      runId: "RUN__1",
      ts: "2026-04-15T00:00:00.000Z",
    },
  });
  const fallbackB = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "LONG",
    payload: {
      signalId: "SIG__1",
      intentId: "INTENT__1",
      runId: "RUN__1",
      ts: "2026-04-15T00:00:00.000Z",
    },
  });
  assert.strictEqual(fallbackA, fallbackB, "fallback hash should be stable for identical payload identity");

  const entryLong = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "LONG",
    dedupeKey: "SOLUSDT__ENTRY__SIG__BINANCEFUT__SOLUSDT__15m__1777102200000__LONG",
    payload: {
      intent: "ENTRY",
      signalId: "SIG__BINANCEFUT__SOLUSDT__15m__1777102200000__LONG",
    },
  });
  const entryCanonical = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "ENTRY_LONG",
    dedupeKey: "SOLUSDT__ENTRY__SIG__BINANCEFUT__SOLUSDT__15m__1777102200000__LONG",
    payload: {
      intent: "ENTRY",
      signalId: "SIG__BINANCEFUT__SOLUSDT__15m__1777102200000__LONG",
    },
  });
  const entryTier = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "PRE_REAL_LONG",
    dedupeKey: "SOLUSDT__ENTRY__SIG__BINANCEFUT__SOLUSDT__15m__1777102200000__LONG",
    payload: {
      intent: "ENTRY",
      signalId: "SIG__BINANCEFUT__SOLUSDT__15m__1777102200000__LONG",
    },
  });
  assert.strictEqual(entryLong, entryCanonical, "entry event aliases must share one outbox id");
  assert.strictEqual(entryLong, entryTier, "entry tier aliases must share one outbox id");
  assert.ok(entryLong.includes("__ENTRY__"), "entry outbox id must expose canonical ENTRY event key");

  const exitTp1 = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_2.5P",
    sourceFillId: "FILL__TP1__SOL",
  });
  const exitTrail = __test.buildTradeAlertOutboxId({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "EXIT_TRAIL",
    sourceFillId: "FILL__TP1__SOL",
  });
  assert.notStrictEqual(exitTp1, exitTrail, "exit event keys must remain distinct unless canonical transition dedupe is supplied");

  const evidence = __test.resolveOutboxEvidenceFields({
    payload: {
      event: "EXIT_TP_P0_0.8P",
      sourceFillId: "FILL__TP1__1",
      tradeAlertDedupeKey: "ETHUSDT|EXIT_TP_P1_2.5P|2026-04-16T01:57:11.214Z",
      entryEventId: "ENTRY__ETH__1",
      orderId: 12345,
      clientOrderId: "cid-12345",
      canonicalExitEvent: "EXIT_TP_P1_2.5P",
      canonicalExitStage: "TP1",
      canonicalTransitionEvents: ["TP1_REACHED", "TP1_REACHED"],
      simplifiedExitV2Enabled: true,
    },
  });
  assert.strictEqual(evidence.source_fill_id, "FILL__TP1__1");
  assert.strictEqual(evidence.dedupe_key, "ETHUSDT|EXIT_TP_P1_2.5P|2026-04-16T01:57:11.214Z");
  assert.strictEqual(evidence.entry_event_id, "ENTRY__ETH__1");
  assert.strictEqual(evidence.order_id, "12345");
  assert.strictEqual(evidence.client_order_id, "cid-12345");
  assert.strictEqual(evidence.raw_evidence_event, "EXIT_TP_P0_0.8P");
  assert.strictEqual(evidence.canonical_event, "EXIT_TP_P1_2.5P");
  assert.strictEqual(evidence.canonical_stage, "TP1");
  assert.deepStrictEqual(evidence.canonical_transition_events, ["TP1_REACHED"]);
  assert.strictEqual(evidence.canonical_primary_transition_event, "TP1_REACHED");
  assert.strictEqual(evidence.simplified_exit_v2_enabled, true);

  const preserved = __test.resolveOutboxEvidenceFields({
    payload: { event: "EXIT_TP_P0_0.8P" },
    prev: {
      source_fill_id: "FILL__PREV",
      dedupe_key: "DEDUP__PREV",
      canonical_event: "EXIT_TP_P1_2.5P",
      canonical_stage: "TP1",
      canonical_transition_events: ["TP1_REACHED"],
      canonical_primary_transition_event: "TP1_REACHED",
      simplified_exit_v2_enabled: true,
    },
  });
  assert.strictEqual(preserved.source_fill_id, "FILL__PREV");
  assert.strictEqual(preserved.dedupe_key, "DEDUP__PREV");
  assert.strictEqual(preserved.canonical_event, "EXIT_TP_P1_2.5P");
  assert.deepStrictEqual(preserved.canonical_transition_events, ["TP1_REACHED"]);
  assert.strictEqual(preserved.simplified_exit_v2_enabled, true);

  return __test;
}

async function runConcurrencyCase() {
  const fakeDb = createFakeDb();
  const mod = loadTradeAlertOutboxWithDb(fakeDb);
  const first = await mod.prepareTradeAlertOutbox({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "TIAUSDT",
    event: "ENTRY_LONG",
    title: "TIAUSDT 롱 진입",
    body: "body",
    payload: { intent: "ENTRY", signalId: "SIG__1" },
    dedupeKey: "TIAUSDT__ENTRY__SIG__1",
    source: "test.first",
  });
  assert.strictEqual(first.skipSend, false, "first claimant must be allowed to send");
  assert.ok(first.claimToken, "first claimant token missing");

  const replay = await mod.prepareTradeAlertOutbox({
    type: "TRADE_EXECUTION_ALERT",
    exchange: "BINANCEFUT",
    symbol: "TIAUSDT",
    event: "ENTRY_LONG",
    title: "TIAUSDT 롱 진입",
    body: "body",
    payload: { intent: "ENTRY", signalId: "SIG__1" },
    dedupeKey: "TIAUSDT__ENTRY__SIG__1",
    source: "test.second",
  });
  assert.strictEqual(replay.skipSend, true, "second concurrent claimant must be suppressed while claim is active");
  assert.strictEqual(replay.reason, "CLAIM_HELD");
  assert.strictEqual(replay.claimToken, null);

  const mismatch = await mod.markTradeAlertOutboxResult({
    outboxId: first.outboxId,
    claimToken: first.claimToken,
    ok: true,
    reason: "SENT",
  });
  assert.strictEqual(mismatch.status, "SENT");
  const stored = fakeDb.__store.get(first.outboxId);
  assert.strictEqual(stored.status, "SENT");
  assert.strictEqual(stored.dispatch_claim_token, null, "claim token must clear after mark");

  console.log("TRADE_ALERT_OUTBOX_TEST_OK");
}

Promise.resolve()
  .then(() => {
    run();
    return runConcurrencyCase();
  })
  .catch((err) => {
  console.error("TRADE_ALERT_OUTBOX_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
  });
