"use strict";

// 2026-04-19 ROOT-CAUSE REGRESSION:
//
// Production saw `10 ABORTED: cross-transaction contention` on the BTCUSDT
// BE-raise path. The root cause was that BOTH lease-heartbeat primitives
// (`heartbeatBinanceNativeRefreshLease` and `heartbeatPositionWriterLease`)
// wrapped their ownership check + TTL extension in `db.runTransaction`,
// and the enclosing runner fired those heartbeats from a `setInterval`
// concurrent with its own synchronous heartbeat and eventual release
// — all targeting the SAME Firestore lease doc. Two concurrent
// transactions on one doc exhaust the SDK's built-in 5-attempt ABORTED
// retry under any network pressure and surface `10 ABORTED` to the
// caller.
//
// The fix: heartbeat does NOT need transactional semantics. Read the
// doc, verify we still own it, then unconditionally update TTL. Races
// are self-healing (the new owner's own heartbeat overwrites within
// ~2s; our next heartbeat check returns ok:false and the caller aborts).
//
// This test locks in both required properties of the new implementation:
//   1. Heartbeat does NOT call `db.runTransaction` — so it can never
//      surface cross-transaction contention.
//   2. Functional contract unchanged: ok:true on owner match, ok:false
//      on owner mismatch or missing doc, TTL extended only on success.

const assert = require("assert");
const Module = require("module");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;

// Build a fake Firestore that tracks whether `runTransaction` is ever
// called. We reset the tracker between sub-tests.
function buildFakeDb({ docData = null } = {}) {
  const state = {
    runTransactionCalled: false,
    updateCalls: [],
    setCalls: [],
    getCalls: 0,
    docData,
    exists: docData != null,
  };
  const ref = {
    get: async () => {
      state.getCalls += 1;
      return {
        exists: state.exists,
        data: () => state.docData,
      };
    },
    update: async (patch) => {
      state.updateCalls.push({ ...patch });
      state.docData = { ...(state.docData || {}), ...patch };
      return {};
    },
    set: async (patch, opts) => {
      state.setCalls.push({ patch: { ...patch }, opts });
      state.docData = { ...(state.docData || {}), ...patch };
      state.exists = true;
      return {};
    },
  };
  const db = {
    doc: () => ref,
    collection: () => ({ doc: () => ref }),
    runTransaction: async (_fn) => {
      state.runTransactionCalled = true;
      throw new Error("runTransaction MUST NOT be called by heartbeat — this is the regression guard");
    },
    settings: () => {},
  };
  return { db, state };
}

// Inject our fake Firestore via module cache before the target modules
// require it.
function withFakeFirestore(fakeDb, fn) {
  const firestoreModulePath = require.resolve("../storage/firestore");
  const originalFirestoreExports = require.cache[firestoreModulePath]
    ? require.cache[firestoreModulePath].exports
    : null;
  // Stub out getFirestore to return our fake.
  require("../storage/firestore"); // ensure loaded
  const realMod = require.cache[firestoreModulePath];
  const originalGetFirestore = realMod.exports.getFirestore;
  realMod.exports.getFirestore = () => fakeDb;
  try {
    return fn();
  } finally {
    realMod.exports.getFirestore = originalGetFirestore;
    if (originalFirestoreExports) {
      realMod.exports = originalFirestoreExports;
    }
  }
}

(async function heartbeatPositionWriterLeaseNonTransactional() {
  const { db, state } = buildFakeDb({
    docData: {
      owner: "positions_paper_writer__test__1",
      lease_until_ms: Date.now() + 10_000,
    },
  });
  await withFakeFirestore(db, async () => {
    // Fresh require to pick up the stubbed getFirestore.
    delete require.cache[require.resolve("../storage/positionsPaper")];
    const positionsPaper = require("../storage/positionsPaper");
    // Exposed via __test per the module's own export surface.
    // If the module doesn't expose the heartbeat, we reach in through
    // the internal map of lease helpers by requiring the lease key
    // helper indirectly — but it's exported in full at the top.
    // Actually the function is exported via module.exports.__test in
    // positionsPaper? Let me check: the regular exports include
    // `runWithPositionWriterLease`. The heartbeat is internal and used
    // by that function. Test via `runWithPositionWriterLease` would be
    // integration. For unit-level we invoke heartbeatPositionWriterLease
    // directly via the module's __test surface.
    const heartbeat = positionsPaper.__test && positionsPaper.__test.heartbeatPositionWriterLease
      ? positionsPaper.__test.heartbeatPositionWriterLease
      : null;
    assert.ok(heartbeat, "heartbeatPositionWriterLease must be exposed via __test for this regression");
    const res = await heartbeat({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      ttlMs: 15_000,
      holderId: "positions_paper_writer__test__1",
    });
    assert.strictEqual(res.ok, true, "heartbeat must report ok when owner matches");
    assert.strictEqual(state.runTransactionCalled, false,
      "heartbeat must NOT use db.runTransaction — that was the contention source");
    assert.strictEqual(state.updateCalls.length, 1,
      "heartbeat must issue exactly one ref.update()");
    const patch = state.updateCalls[0];
    assert.ok(Number.isFinite(patch.lease_until_ms) && patch.lease_until_ms > Date.now(),
      "lease_until_ms must be advanced forward");
    assert.ok(Number.isFinite(patch.heartbeat_ms),
      "heartbeat_ms must be stamped");
  });
})();

(async function heartbeatReturnsOkFalseOnOwnerMismatch() {
  const { db, state } = buildFakeDb({
    docData: {
      owner: "positions_paper_writer__other__1",
      lease_until_ms: Date.now() + 10_000,
    },
  });
  await withFakeFirestore(db, async () => {
    delete require.cache[require.resolve("../storage/positionsPaper")];
    const positionsPaper = require("../storage/positionsPaper");
    const heartbeat = positionsPaper.__test.heartbeatPositionWriterLease;
    const res = await heartbeat({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      ttlMs: 15_000,
      holderId: "positions_paper_writer__mine__1",
    });
    assert.strictEqual(res.ok, false, "heartbeat must report ok:false when owner mismatches");
    assert.strictEqual(res.holder, "positions_paper_writer__other__1",
      "heartbeat must surface the current holder on mismatch");
    assert.strictEqual(state.updateCalls.length, 0,
      "heartbeat must NOT write TTL when we don't own the lease");
    assert.strictEqual(state.runTransactionCalled, false);
  });
})();

(async function heartbeatReturnsOkFalseOnMissingDoc() {
  const { db, state } = buildFakeDb({ docData: null });
  await withFakeFirestore(db, async () => {
    delete require.cache[require.resolve("../storage/positionsPaper")];
    const positionsPaper = require("../storage/positionsPaper");
    const heartbeat = positionsPaper.__test.heartbeatPositionWriterLease;
    const res = await heartbeat({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      ttlMs: 15_000,
      holderId: "positions_paper_writer__mine__1",
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(state.updateCalls.length, 0);
    assert.strictEqual(state.runTransactionCalled, false);
  });
})();

(async function binanceNativeRefreshHeartbeatNonTransactional() {
  const { db, state } = buildFakeDb({
    docData: {
      owner: "native_refresh__test__1",
      lease_until_ms: Date.now() + 5_000,
    },
  });
  await withFakeFirestore(db, async () => {
    delete require.cache[require.resolve("../engine/paperBinanceRunner")];
    const paperBinanceRunner = require("../engine/paperBinanceRunner");
    const heartbeat = paperBinanceRunner.__test && paperBinanceRunner.__test.heartbeatBinanceNativeRefreshLease
      ? paperBinanceRunner.__test.heartbeatBinanceNativeRefreshLease
      : null;
    assert.ok(heartbeat,
      "heartbeatBinanceNativeRefreshLease must be exposed via __test for this regression");
    const res = await heartbeat({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      ttlMs: 8_000,
      holderId: "native_refresh__test__1",
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(state.runTransactionCalled, false,
      "binance native refresh heartbeat must NOT call db.runTransaction");
    assert.strictEqual(state.updateCalls.length, 1);
  });
})();

// Reset module cache for downstream tests — they'll re-require with the
// real getFirestore resolved.
delete require.cache[require.resolve("../storage/positionsPaper")];
delete require.cache[require.resolve("../engine/paperBinanceRunner")];

console.log("LEASE_HEARTBEAT_NONTRANSACTIONAL_TEST_OK");
