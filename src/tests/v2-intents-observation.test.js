"use strict";

// 2026-04-28 V2 frontend migration audit Step B unit test.

const assert = require("assert");

function reload() {
  delete require.cache[require.resolve("../storage/v2IntentsObservation")];
  return require("../storage/v2IntentsObservation");
}

function withEnv(name, value, fn) {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { return fn(); } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

(function testCollectionNameDefault() {
  withEnv("DONBEOLJA_V2_COLLECTION_PREFIX", undefined, () => {
    const { resolveSignalIntentsCollectionName } = reload();
    assert.strictEqual(
      resolveSignalIntentsCollectionName(process.env),
      "donbeolja_v2__signal_intents_v2",
      "(A) default prefix"
    );
  });
})();

(function testCollectionNameOverride() {
  withEnv("DONBEOLJA_V2_COLLECTION_PREFIX", "v2__", () => {
    const { resolveSignalIntentsCollectionName } = reload();
    assert.strictEqual(
      resolveSignalIntentsCollectionName(process.env),
      "v2__signal_intents_v2",
      "(B) prefix override"
    );
  });
})();

(async function testObserveOk() {
  const { observeRecentV2SignalIntents } = reload();
  const fakeDocs = [
    { data: () => ({ exchange: "BINANCEFUT", symbol: "BTCUSDT", created_at: new Date().toISOString() }) },
    { data: () => ({ exchange: "BINANCEFUT", symbol: "BTCUSDT", created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }) },
  ];
  const fakeSnap = { empty: false, size: 2, forEach(cb) { fakeDocs.forEach(cb); } };
  const fakeCollection = {
    where() { return this; },
    orderBy() { return this; },
    limit() { return this; },
    get() { return Promise.resolve(fakeSnap); },
  };
  const fakeDb = { collection: () => fakeCollection };
  const result = await observeRecentV2SignalIntents({ db: fakeDb });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.count, 2);
  assert.strictEqual(result.recent_n, 1, "(C) only 1 of 2 within 24h");
  assert.ok(Number.isFinite(result.latest_at_ms), "(C) latest_at_ms must be finite");
})();

(async function testObserveBestEffortOnError() {
  const { observeRecentV2SignalIntents } = reload();
  const fakeDb = {
    collection: () => ({
      where() { return this; },
      orderBy() { return this; },
      limit() { return this; },
      get() { return Promise.reject(new Error("FIRESTORE_DOWN")); },
    }),
  };
  let threw = false;
  let result;
  try {
    result = await observeRecentV2SignalIntents({ db: fakeDb });
  } catch (_) { threw = true; }
  assert.strictEqual(threw, false, "(D) helper must never throw — best-effort contract");
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.count, 0);
  assert.ok(result.error && result.error.includes("FIRESTORE_DOWN"));
})();

setTimeout(() => console.log("V2_INTENTS_OBSERVATION_TEST_OK"), 0);
