"use strict";

// 2026-04-18 P0-3: stale-lease force-release admin path.
//
// The POSITION_WRITER lease has a 15s TTL with a heartbeat loop (see
// positionsPaper.js:147 acquire, 180 heartbeat, 211 release). When a
// Cloud Run instance dies mid-mutation, the Firestore lease doc retains
// the dead owner until lease_until_ms elapses. The operational surface
// exposed via `forceReleaseStalePositionWriterLease` must:
//
//   1. Refuse to cut an active (non-expired) lease unless `force: true`
//      — so routine ops cannot accidentally corrupt a running writer.
//   2. Release a stale lease (expired past the min-stale threshold) so
//      new writers can proceed.
//   3. Return a distinct reason code for each outcome so the admin API
//      can choose the right HTTP status.
//   4. Stamp the audit trail (released_at, force_released_by,
//      force_released_reason) on the Firestore doc so operators who
//      inspect next tick see what happened.

const assert = require("assert");
const { __test } = require("../storage/positionsPaper");

const { summarizeLeaseDoc } = __test;

(function summarizeLeaseDocClassifiesExpiry() {
  const now = 1_000_000;
  const active = summarizeLeaseDoc({
    owner: "holder-A",
    lease_until_ms: now + 5000,
    heartbeat_ms: now - 1000,
  }, now);
  assert.strictEqual(active.expired, false);
  assert.strictEqual(active.expired_age_ms, -5000,
    "active lease must report negative expired_age_ms (-5000 = expires in 5s)");
  assert.strictEqual(active.owner, "holder-A");

  const stale = summarizeLeaseDoc({
    owner: "holder-B",
    lease_until_ms: now - 20000,
    heartbeat_ms: now - 30000,
  }, now);
  assert.strictEqual(stale.expired, true);
  assert.strictEqual(stale.expired_age_ms, 20000,
    "stale lease must report positive expired_age_ms so operators can see staleness");
  assert.strictEqual(stale.heartbeat_age_ms, 30000);

  // Missing lease_until — treat as expired (safest default for reclaim logic).
  const unknown = summarizeLeaseDoc({ owner: "holder-C" }, now);
  assert.strictEqual(unknown.expired, true,
    "a lease doc with no lease_until_ms must be treated as expired so it never blocks recovery");
})();

// Inline fake Firestore — small enough to verify the transaction logic
// without pulling in the emulator.
function makeFakeFirestore() {
  const store = new Map();
  const db = {
    doc(path) {
      return {
        path,
        async get() {
          const data = store.get(path);
          return {
            exists: data !== undefined,
            data: () => (data ? { ...data } : undefined),
          };
        },
        async set(next, opts = {}) {
          const prev = store.get(path) || {};
          if (opts.merge === true) store.set(path, { ...prev, ...next });
          else store.set(path, { ...next });
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, next, opts = {}) {
          const prev = store.get(ref.path) || {};
          if (opts.merge === true) store.set(ref.path, { ...prev, ...next });
          else store.set(ref.path, { ...next });
        },
      };
      return fn(tx);
    },
    __raw: store,
  };
  return db;
}

(async function forceReleaseFlows() {
  // Inject the fake Firestore via the `db` param — avoids any dependency
  // on the real Firestore module cache or credentials.
  const fakeDb = makeFakeFirestore();
  const { inspectPositionWriterLease, forceReleaseStalePositionWriterLease } = require("../storage/positionsPaper");

  // --- Case 1: no lease doc at all ---
  let out = await forceReleaseStalePositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    db: fakeDb,
  });
  assert.strictEqual(out.reason, "NO_LEASE_DOC");
  assert.strictEqual(out.released, false);

  // --- Case 2: active lease, force=false → refuses to release ---
  const leasePath = "runtime_locks/positions_paper_writer__BINANCEFUT__DOGEUSDT";
  fakeDb.__raw.set(leasePath, {
    owner: "dead-writer-A",
    lease_until_ms: Date.now() + 60_000,
    heartbeat_ms: Date.now() - 1000,
  });
  out = await forceReleaseStalePositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    db: fakeDb,
  });
  assert.strictEqual(out.released, false,
    "an active (non-expired) lease must NOT be released without force:true");
  assert.strictEqual(out.reason, "LEASE_NOT_STALE");
  // Doc should be untouched
  const afterRefuse = fakeDb.__raw.get(leasePath);
  assert.strictEqual(afterRefuse.owner, "dead-writer-A",
    "refused force-release must not mutate the lease doc");

  // --- Case 3: active lease, force=true → releases anyway, stamps audit ---
  out = await forceReleaseStalePositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    force: true,
    actor: "ops@example.com",
    db: fakeDb,
  });
  assert.strictEqual(out.released, true);
  assert.strictEqual(out.reason, "FORCE_RELEASED");
  const afterForce = fakeDb.__raw.get(leasePath);
  assert.ok(afterForce.lease_until_ms < Date.now(),
    "force-released lease must have lease_until_ms in the past");
  assert.strictEqual(afterForce.force_released_by, "ops@example.com");
  assert.strictEqual(afterForce.force_released_reason, "FORCE_RELEASED");
  assert.ok(String(afterForce.released_at || "").length > 0,
    "released_at audit stamp must be populated");

  // --- Case 4: stale lease with default min_stale_ms → STALE_RELEASED ---
  fakeDb.__raw.set(leasePath, {
    owner: "dead-writer-B",
    // Expired 60s ago → well past 1×TTL staleness
    lease_until_ms: Date.now() - 60_000,
    heartbeat_ms: Date.now() - 90_000,
  });
  out = await forceReleaseStalePositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    actor: "scheduler",
    db: fakeDb,
  });
  assert.strictEqual(out.released, true);
  assert.strictEqual(out.reason, "STALE_RELEASED");
  const afterStale = fakeDb.__raw.get(leasePath);
  assert.strictEqual(afterStale.force_released_reason, "STALE_RELEASED");
  assert.strictEqual(afterStale.force_released_by, "scheduler");

  // --- Case 5: minStaleMs guard — lease expired 1s ago fails the default
  // (POSITION_WRITER_LEASE_TTL_MS ≈ 15s) threshold without force ---
  fakeDb.__raw.set(leasePath, {
    owner: "maybe-recovering-writer",
    lease_until_ms: Date.now() - 1000,
    heartbeat_ms: Date.now() - 2000,
  });
  out = await forceReleaseStalePositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    db: fakeDb,
  });
  assert.strictEqual(out.released, false,
    "just-expired lease (< min_stale_ms) must not be reclaimed — the heartbeat loop could recover it");
  assert.strictEqual(out.reason, "LEASE_NOT_STALE");

  // --- Case 6: inspectPositionWriterLease returns a structured view ---
  const inspected = await inspectPositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    db: fakeDb,
  });
  assert.strictEqual(inspected.exists, true);
  assert.strictEqual(inspected.owner, "maybe-recovering-writer");
  assert.ok(Number.isFinite(inspected.expired_age_ms));
  assert.ok(inspected.expired_age_ms > 0, "expired_age_ms must be > 0 for an expired lease");

  console.log("POSITION_WRITER_LEASE_FORCE_RELEASE_TEST_OK");
})().catch((err) => {
  console.error("POSITION_WRITER_LEASE_FORCE_RELEASE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
