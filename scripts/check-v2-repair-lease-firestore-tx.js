#!/usr/bin/env node
"use strict";

const {
  buildFirestoreProtectionWriterLeaseRegistry,
  buildProtectionWriterLeaseDocPath,
  shouldUseFirestoreProtectionWriterLease,
} = require("../src/v2/protectionWriterLeaseRegistry");

function createMemoryFirestore() {
  const docs = new Map();
  let chain = Promise.resolve();
  function ref(path) {
    return { path };
  }
  function snap(path) {
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
            return snap(docRef.path);
          },
          set(docRef, payload, options = {}) {
            const previous = options && options.merge === true ? (docs.get(docRef.path) || {}) : {};
            docs.set(docRef.path, { ...previous, ...payload });
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

function sampleLease() {
  return Object.freeze({
    lease_scope: "V2_PROTECTION_WRITER_EXCHANGE_WRITE",
    lease_service: "PROTECTION_WRITER",
    acquired_by_service: "REPAIR_EXECUTOR",
    position_cycle_id: "PCY__P1_GATE__LEASE",
    placement_attempt_id: "ATT__P1_GATE__LEASE",
    command_type: "PLACE_OR_REPLACE_TP1",
  });
}

async function evaluateRepairLeaseFirestoreTx({ env = process.env, nowStartMs = Date.parse("2026-04-26T00:00:00.000Z") } = {}) {
  const blockers = [];
  const checks = [];
  let now = nowStartMs;
  const db = createMemoryFirestore();
  const lease = sampleLease();
  const registry = buildFirestoreProtectionWriterLeaseRegistry({
    db,
    holderId: "p1-gate-holder",
    nowMs: () => now,
    env: {
      DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS: "60000",
      DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS: "0",
      ...env,
    },
  });

  const shouldUse = shouldUseFirestoreProtectionWriterLease({ db, env: { DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED: "1", ...env } });
  checks.push(Object.freeze({ id: "firestore_registry_selected", ok: shouldUse === true }));
  if (shouldUse !== true) blockers.push("REPAIR_LEASE:FIRESTORE_REGISTRY_NOT_SELECTED");

  const first = await registry.acquire(lease.position_cycle_id, { lease });
  checks.push(Object.freeze({ id: "first_acquire", ok: first && first.acquired === true }));
  if (!first || first.acquired !== true) blockers.push("REPAIR_LEASE:FIRST_ACQUIRE_FAILED");

  const docPath = buildProtectionWriterLeaseDocPath(lease.position_cycle_id);
  const doc = db.docs.get(docPath) || {};
  const payloadOk = doc.position_cycle_id === lease.position_cycle_id
    && doc.placement_attempt_id === lease.placement_attempt_id
    && doc.command_type === lease.command_type
    && doc.lease_holder_instance_id === "p1-gate-holder";
  checks.push(Object.freeze({ id: "lease_payload_identity", ok: payloadOk }));
  if (!payloadOk) blockers.push("REPAIR_LEASE:PAYLOAD_IDENTITY_INVALID");

  const second = await registry.acquire(lease.position_cycle_id, { lease });
  const concurrentDenied = second && second.acquired === false && second.reason === "PROTECTION_WRITER_LEASE_CONCURRENT_WRITE";
  checks.push(Object.freeze({ id: "concurrent_acquire_denied", ok: concurrentDenied }));
  if (!concurrentDenied) blockers.push("REPAIR_LEASE:CONCURRENT_ACQUIRE_NOT_DENIED");

  const released = await registry.release(lease.position_cycle_id, { token: first && first.token });
  checks.push(Object.freeze({ id: "release", ok: released === true }));
  if (released !== true) blockers.push("REPAIR_LEASE:RELEASE_FAILED");

  const third = await registry.acquire(lease.position_cycle_id, { lease });
  checks.push(Object.freeze({ id: "reacquire_after_release", ok: third && third.acquired === true }));
  if (!third || third.acquired !== true) blockers.push("REPAIR_LEASE:REACQUIRE_AFTER_RELEASE_FAILED");

  now += 61000;
  const fourth = await registry.acquire(lease.position_cycle_id, { lease });
  const expiredReacquired = fourth && fourth.acquired === true && fourth.token !== (third && third.token);
  checks.push(Object.freeze({ id: "expired_reacquire", ok: expiredReacquired }));
  if (!expiredReacquired) blockers.push("REPAIR_LEASE:EXPIRED_REACQUIRE_FAILED");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_REPAIR_LEASE_FIRESTORE_TX_PASS"
      : "V2_REPAIR_LEASE_FIRESTORE_TX_BLOCKED",
    blockers: Object.freeze(blockers),
    checks: Object.freeze(checks),
    lock_doc_path: docPath,
  });
}

async function main(env = process.env) {
  const result = await evaluateRepairLeaseFirestoreTx({ env });
  const out = JSON.stringify(result);
  if (result.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_REPAIR_LEASE_FIRESTORE_TX_THROWN",
      blockers: ["REPAIR_LEASE:CHECK_THROWN"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = { main, evaluateRepairLeaseFirestoreTx, __test: { createMemoryFirestore, sampleLease } };
}
