"use strict";

const assert = require("assert");
const {
  buildAlgoEndpointDegradationDocPath,
  updateAlgoEndpointDegradationState,
} = require("../v2/algoEndpointDegradationState");

function makeFakeFirestore() {
  const docs = new Map();
  let chain = Promise.resolve();
  function ref(path) {
    return {
      path,
      async get() {
        const data = docs.get(path);
        return {
          exists: data !== undefined,
          data: () => ({ ...(data || {}) }),
        };
      },
      async set(payload, options = {}) {
        const prev = options && options.merge === true ? (docs.get(path) || {}) : {};
        docs.set(path, { ...prev, ...payload });
      },
    };
  }
  return {
    docs,
    doc(path) {
      return ref(path);
    },
    collection(name) {
      return {
        doc(id) {
          return ref(`${name}/${id}`);
        },
      };
    },
    runTransaction(fn) {
      const run = chain.then(async () => {
        const tx = {
          async get(docRef) {
            const data = docs.get(docRef.path);
            return {
              exists: data !== undefined,
              data: () => ({ ...(data || {}) }),
            };
          },
          set(docRef, payload, options = {}) {
            const prev = options && options.merge === true ? (docs.get(docRef.path) || {}) : {};
            docs.set(docRef.path, { ...prev, ...payload });
          },
        };
        return fn(tx);
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

async function firstUnavailableWritesWarnState() {
  const db = makeFakeFirestore();
  const now = Date.parse("2026-04-26T00:00:00.000Z");
  const result = await updateAlgoEndpointDegradationState({
    db,
    env: { DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADED_CRIT_AFTER_MS: "600000" },
    symbol: "BNBUSDT",
    endpointUnavailable: true,
    nowMs: () => now,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "DEGRADED");
  assert.strictEqual(result.severity, "WARN");
  assert.strictEqual(result.duration_ms, 0);
  assert.strictEqual(result.escalated, false);
  const path = buildAlgoEndpointDegradationDocPath({ exchange: "BINANCEFUT", symbol: "BNBUSDT" });
  assert.strictEqual(db.docs.get(path).status, "DEGRADED");
  assert.strictEqual(db.docs.get(path).first_seen_at, "2026-04-26T00:00:00.000Z");
}

async function persistentUnavailableEscalatesToCrit() {
  const db = makeFakeFirestore();
  let now = Date.parse("2026-04-26T00:00:00.000Z");
  const env = { DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADED_CRIT_AFTER_MS: "600000" };
  await updateAlgoEndpointDegradationState({
    db,
    env,
    symbol: "LINKUSDT",
    endpointUnavailable: true,
    nowMs: () => now,
  });
  now += 601000;
  const result = await updateAlgoEndpointDegradationState({
    db,
    env,
    symbol: "LINKUSDT",
    endpointUnavailable: true,
    nowMs: () => now,
  });
  assert.strictEqual(result.severity, "CRIT");
  assert.strictEqual(result.escalated, true);
  assert.strictEqual(result.duration_ms, 601000);
  const path = buildAlgoEndpointDegradationDocPath({ exchange: "BINANCEFUT", symbol: "LINKUSDT" });
  assert.strictEqual(db.docs.get(path).escalated, true);
  assert.strictEqual(db.docs.get(path).consecutive_seen_n, 2);
}

async function recoveryMarksRecoveredWithoutDeletingEvidence() {
  const db = makeFakeFirestore();
  let now = Date.parse("2026-04-26T00:00:00.000Z");
  await updateAlgoEndpointDegradationState({
    db,
    symbol: "XRPUSDT",
    endpointUnavailable: true,
    nowMs: () => now,
  });
  now += 30000;
  const result = await updateAlgoEndpointDegradationState({
    db,
    symbol: "XRPUSDT",
    endpointUnavailable: false,
    nowMs: () => now,
  });
  assert.strictEqual(result.status, "RECOVERED");
  assert.strictEqual(result.recovered, true);
  assert.strictEqual(result.duration_ms, 30000);
  const path = buildAlgoEndpointDegradationDocPath({ exchange: "BINANCEFUT", symbol: "XRPUSDT" });
  assert.strictEqual(db.docs.get(path).status, "RECOVERED");
  assert.strictEqual(db.docs.get(path).recovered_at, "2026-04-26T00:00:30.000Z");
}

async function disabledPolicyDoesNotWrite() {
  const db = makeFakeFirestore();
  const result = await updateAlgoEndpointDegradationState({
    db,
    env: { DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_STATE_ENABLED: "0" },
    symbol: "DOGEUSDT",
    endpointUnavailable: true,
  });
  assert.strictEqual(result.enabled, false);
  assert.strictEqual(db.docs.size, 0);
}

(async function run() {
  await firstUnavailableWritesWarnState();
  await persistentUnavailableEscalatesToCrit();
  await recoveryMarksRecoveredWithoutDeletingEvidence();
  await disabledPolicyDoesNotWrite();
  console.log("V2_ALGO_ENDPOINT_DEGRADATION_STATE_TEST_OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
