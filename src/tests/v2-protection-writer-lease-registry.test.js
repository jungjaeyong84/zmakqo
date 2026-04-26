"use strict";

const assert = require("assert");
const {
  buildFirestoreProtectionWriterLeaseRegistry,
  buildProtectionWriterLeaseDocPath,
} = require("../v2/protectionWriterLeaseRegistry");
const { buildDelegatedRepairExecutor } = require("../v2/repairDelegatedExecutor");
const { buildRepairDelegationEnvelope } = require("../v2/watchdogRepairRuntime");

function makeFakeFirestore() {
  const docs = new Map();
  let chain = Promise.resolve();
  function ref(path) {
    return { path };
  }
  function makeSnap(path) {
    const data = docs.get(path);
    return {
      exists: data !== undefined,
      data: () => ({ ...(data || {}) }),
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
            return makeSnap(docRef.path);
          },
          set(docRef, payload, options = {}) {
            const prev = options && options.merge === true ? (docs.get(docRef.path) || {}) : {};
            docs.set(docRef.path, { ...prev, ...payload });
          },
          delete(docRef) {
            docs.delete(docRef.path);
          },
        };
        return fn(tx);
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

function buildTp1DelegatedRepair() {
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: {
      exit_repair_request_id: "RQRV2__TP1__FIRESTORE_LEASE",
      position_cycle_id: "PCY__FIRESTORE__LEASE",
      stage: "PRE_TP1",
      issue_code: "TP1_ORDER_MISSING",
      requested_action: "ENSURE_TP1_ORDER",
    },
    projection: {
      exit_runtime_projection_id: "ERPv2__PCY__FIRESTORE__LEASE",
      position_cycle_id: "PCY__FIRESTORE__LEASE",
      stage: "PRE_TP1",
      tp1_target_price: 101.68,
      tp1_target_qty_abs: 0.5,
    },
    protectionRuntime: {
      protection_runtime_id: "PRTV2__PCY__FIRESTORE__LEASE",
      position_cycle_id: "PCY__FIRESTORE__LEASE",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      tp1_order_id: null,
    },
    positionCycle: {
      position_cycle_id: "PCY__FIRESTORE__LEASE",
      symbol: "ETHUSDT",
      position_side: "LONG",
    },
  });
  return {
    exit_repair_request_id: "RQRV2__TP1__FIRESTORE_LEASE",
    position_cycle_id: "PCY__FIRESTORE__LEASE",
    issue_code: "TP1_ORDER_MISSING",
    requested_action: "ENSURE_TP1_ORDER",
    envelope,
  };
}

async function firestoreRegistryAcquiresAndReleases() {
  let now = Date.parse("2026-04-26T00:00:00.000Z");
  const db = makeFakeFirestore();
  const registry = buildFirestoreProtectionWriterLeaseRegistry({
    db,
    holderId: "test-holder",
    nowMs: () => now,
    env: {
      DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS: "60000",
      DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS: "0",
    },
  });
  const lease = buildTp1DelegatedRepair().envelope.writer_delegation.writer_lease;
  const first = await registry.acquire("PCY__FIRESTORE__LEASE", { lease });
  assert.strictEqual(first.acquired, true);
  const path = buildProtectionWriterLeaseDocPath("PCY__FIRESTORE__LEASE");
  assert.strictEqual(db.docs.get(path).position_cycle_id, "PCY__FIRESTORE__LEASE");
  assert.strictEqual(db.docs.get(path).lease_holder_instance_id, "test-holder");

  const second = await registry.acquire("PCY__FIRESTORE__LEASE", { lease });
  assert.strictEqual(second.acquired, false);
  assert.strictEqual(second.reason, "PROTECTION_WRITER_LEASE_CONCURRENT_WRITE");

  const released = await registry.release("PCY__FIRESTORE__LEASE", { token: first.token });
  assert.strictEqual(released, true);
  assert.strictEqual(db.docs.has(path), false);

  now += 61000;
  const third = await registry.acquire("PCY__FIRESTORE__LEASE", { lease });
  assert.strictEqual(third.acquired, true);
}

async function firestoreRegistryReacquiresExpiredLease() {
  let now = Date.parse("2026-04-26T00:00:00.000Z");
  const db = makeFakeFirestore();
  const registry = buildFirestoreProtectionWriterLeaseRegistry({
    db,
    holderId: "test-holder",
    nowMs: () => now,
    env: {
      DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS: "3000",
      DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS: "0",
    },
  });
  const lease = buildTp1DelegatedRepair().envelope.writer_delegation.writer_lease;
  const first = await registry.acquire("PCY__FIRESTORE__LEASE", { lease });
  assert.strictEqual(first.acquired, true);
  now += 4000;
  const second = await registry.acquire("PCY__FIRESTORE__LEASE", { lease });
  assert.strictEqual(second.acquired, true);
  assert.notStrictEqual(second.token, first.token);
  const staleRelease = await registry.release("PCY__FIRESTORE__LEASE", { token: first.token });
  assert.strictEqual(staleRelease, false);
  assert.strictEqual(db.docs.get(buildProtectionWriterLeaseDocPath("PCY__FIRESTORE__LEASE")).lease_token, second.token);
}

async function executorUsesFirestoreLeaseAcrossInstances() {
  const db = makeFakeFirestore();
  const delegatedRepair = buildTp1DelegatedRepair();
  const env = {
    DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED: "1",
    DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS: "60000",
    DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS: "0",
  };
  function buildExecutor() {
    return buildDelegatedRepairExecutor({
      db,
      env,
      recordedAt: "2026-04-26T00:00:02.000Z",
      transports: {
        placeOrReplaceTp1: async ({ command }) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            status: "PLACED",
            order_id: `TP1__${command.placement_attempt_id}`,
            trigger_price: command.trigger_price,
            ack_at: "2026-04-26T00:00:01.000Z",
          };
        },
      },
    });
  }
  const results = await Promise.all([
    buildExecutor()({ delegatedRepair }),
    buildExecutor()({ delegatedRepair }),
  ]);
  const reasons = results.map((row) => row.writeDecision.runtime_write_reason).sort();
  assert.deepStrictEqual(reasons, [
    "PROTECTION_WRITER_LEASE_CONCURRENT_WRITE",
    "TP1_REPAIRED",
  ]);
  assert.strictEqual(db.docs.has(buildProtectionWriterLeaseDocPath("PCY__FIRESTORE__LEASE")), false);
}

async function releaseFailureDoesNotOverrideSuccessfulRepair() {
  const delegatedRepair = buildTp1DelegatedRepair();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const executor = buildDelegatedRepairExecutor({
      writerLeaseRegistry: {
        acquire: () => true,
        release: () => {
          throw new Error("LEASE_RELEASE_NETWORK_ERROR");
        },
      },
      recordedAt: "2026-04-26T00:00:02.000Z",
      transports: {
        placeOrReplaceTp1: async ({ command }) => ({
          status: "PLACED",
          order_id: `TP1__${command.placement_attempt_id}`,
          trigger_price: command.trigger_price,
          ack_at: "2026-04-26T00:00:01.000Z",
        }),
      },
    });
    const result = await executor({ delegatedRepair });
    assert.strictEqual(result.writeDecision.ok, true);
    assert.strictEqual(result.writeDecision.runtime_write_reason, "TP1_REPAIRED");
    assert.ok(warnings.some((line) => line.includes("V2_PROTECTION_WRITER_LEASE_RELEASE_FAILED")));
  } finally {
    console.warn = originalWarn;
  }
}

(async function run() {
  await firestoreRegistryAcquiresAndReleases();
  await firestoreRegistryReacquiresExpiredLease();
  await executorUsesFirestoreLeaseAcrossInstances();
  await releaseFailureDoesNotOverrideSuccessfulRepair();
  console.log("V2_PROTECTION_WRITER_LEASE_REGISTRY_TEST_OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
