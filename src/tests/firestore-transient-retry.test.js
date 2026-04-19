"use strict";

// 2026-04-19: regression guard for `withTransientFirestoreRetry` — the
// narrow retry helper added to absorb transient Firestore infrastructure
// failures on the BE-raise (`tick_exit_tp1_break_even_stop_decision`)
// path. Production surfaced two different transient failure classes on
// the same BTCUSDT SHORT position within 1 hour:
//
//   * `10 ABORTED: cross-transaction contention` — optimistic-concurrency
//     retryable, Firestore SDK contract.
//   * `14 UNAVAILABLE: ... socket disconnected` — stale-connection
//     TLS drop, clean reconnect is the documented recovery.
//
// Both were fatal to the BE stop raise because the caller had no retry.
// This test locks in the retry helper's behavior so a future "simplify"
// pass doesn't quietly remove what production needs.
//
// Coverage:
//   1. passes through on immediate success
//   2. retries a transient gRPC code and succeeds
//   3. exhausts the retry budget on persistent transient failure and
//      augments the error with `firestore_retry_*` fields
//   4. does NOT retry a non-transient error (e.g. INVALID_ARGUMENT)
//   5. obeys the kill-switch (`enabled: false`) — one attempt only
//   6. populates the `context` object so callers can log retry stats
//   7. `computeBackoffMs` grows monotonically and applies jitter bounds

const assert = require("assert");

const {
  withTransientFirestoreRetry,
  isTransientFirestoreError,
  extractGrpcCode,
  computeBackoffMs,
  TRANSIENT_GRPC_CODES,
} = require("../utils/firestoreRetry");

function makeFirestoreErr(code, message) {
  const err = new Error(message || `grpc code ${code}`);
  err.code = code;
  return err;
}

// no-op sleeper so the test suite stays fast
const noSleep = async () => { /* no wait */ };
const deterministicRand = () => 0.5; // jitter = 0 with this seed

(async function passesThroughOnImmediateSuccess() {
  let calls = 0;
  const ctx = { attempts: 0, terminalCode: null, exhausted: false, transient: false };
  const result = await withTransientFirestoreRetry(
    async () => { calls += 1; return "ok"; },
    { context: ctx, sleep: noSleep, rand: deterministicRand }
  );
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 1, "success on 1st attempt — no retries");
  assert.strictEqual(ctx.attempts, 1);
  assert.strictEqual(ctx.terminalCode, null);
  assert.strictEqual(ctx.exhausted, false);
  assert.strictEqual(ctx.transient, false);
})();

(async function retriesTransientAndSucceeds() {
  let calls = 0;
  const ctx = { attempts: 0, terminalCode: null, exhausted: false, transient: false };
  const result = await withTransientFirestoreRetry(
    async () => {
      calls += 1;
      if (calls < 2) throw makeFirestoreErr(10, "10 ABORTED: cross-transaction contention");
      return "recovered";
    },
    { context: ctx, sleep: noSleep, rand: deterministicRand }
  );
  assert.strictEqual(result, "recovered");
  assert.strictEqual(calls, 2);
  assert.strictEqual(ctx.attempts, 2, "context.attempts reflects retry count");
  // on success branch terminalCode is reset to null (success context)
  assert.strictEqual(ctx.exhausted, false);
})();

(async function retryExhaustsOnPersistentTransient() {
  let calls = 0;
  const ctx = { attempts: 0, terminalCode: null, exhausted: false, transient: false };
  let thrown = null;
  try {
    await withTransientFirestoreRetry(
      async () => {
        calls += 1;
        throw makeFirestoreErr(14, "14 UNAVAILABLE: TLS socket disconnected");
      },
      { maxAttempts: 3, context: ctx, sleep: noSleep, rand: deterministicRand }
    );
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "error must propagate after exhaustion");
  assert.strictEqual(calls, 3, "all 3 attempts must have fired");
  assert.strictEqual(ctx.attempts, 3);
  assert.strictEqual(ctx.exhausted, true);
  assert.strictEqual(ctx.transient, true);
  assert.strictEqual(ctx.terminalCode, 14);
  // augmented error fields that callers log
  assert.strictEqual(thrown.firestore_retry_attempts, 3);
  assert.strictEqual(thrown.firestore_retry_terminal_code, 14);
  assert.strictEqual(thrown.firestore_retry_exhausted, true);
  assert.strictEqual(thrown.firestore_retry_transient, true);
})();

(async function nonTransientPassesThroughImmediately() {
  let calls = 0;
  const ctx = { attempts: 0, terminalCode: null, exhausted: false, transient: false };
  let thrown = null;
  try {
    await withTransientFirestoreRetry(
      async () => {
        calls += 1;
        // gRPC 3 = INVALID_ARGUMENT — business logic failure, NOT retryable.
        throw makeFirestoreErr(3, "3 INVALID_ARGUMENT: field X is required");
      },
      { maxAttempts: 3, context: ctx, sleep: noSleep, rand: deterministicRand }
    );
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "non-transient errors must propagate");
  assert.strictEqual(calls, 1, "non-transient errors must NOT retry");
  assert.strictEqual(ctx.attempts, 1);
  assert.strictEqual(ctx.transient, false);
  assert.strictEqual(thrown.firestore_retry_attempts, 1);
  assert.strictEqual(thrown.firestore_retry_transient, false);
})();

(async function killSwitchDisablesRetry() {
  let calls = 0;
  const ctx = { attempts: 0, terminalCode: null, exhausted: false, transient: false };
  let thrown = null;
  try {
    await withTransientFirestoreRetry(
      async () => {
        calls += 1;
        throw makeFirestoreErr(10, "10 ABORTED");
      },
      { maxAttempts: 5, enabled: false, context: ctx, sleep: noSleep, rand: deterministicRand }
    );
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.strictEqual(calls, 1, "kill-switch collapses maxAttempts to 1");
  assert.strictEqual(ctx.attempts, 1);
  assert.strictEqual(ctx.exhausted, true, "with only 1 attempt, ctx.exhausted must be true");
})();

(async function messageOnlyTransientStillRetried() {
  // Some deployments re-throw the SDK error with only the message string
  // preserved (no `code` property). The helper must still classify on
  // message patterns.
  let calls = 0;
  const result = await withTransientFirestoreRetry(
    async () => {
      calls += 1;
      if (calls < 2) throw new Error("GOAWAY: TLS connection was terminated");
      return "ok";
    },
    { sleep: noSleep, rand: deterministicRand }
  );
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 2, "message-pattern match must trigger retry when code is missing");
})();

(function transientClassificationHelpers() {
  assert.strictEqual(isTransientFirestoreError(makeFirestoreErr(4, "")), true);
  assert.strictEqual(isTransientFirestoreError(makeFirestoreErr(10, "")), true);
  assert.strictEqual(isTransientFirestoreError(makeFirestoreErr(14, "")), true);
  assert.strictEqual(isTransientFirestoreError(makeFirestoreErr(3, "")), false);
  assert.strictEqual(isTransientFirestoreError(makeFirestoreErr(7, "")), false);
  assert.strictEqual(isTransientFirestoreError(null), false);

  // wrapped error via `cause`
  const outer = new Error("wrapper");
  outer.cause = makeFirestoreErr(10, "10 ABORTED");
  assert.strictEqual(isTransientFirestoreError(outer), true,
    "must unwrap via err.cause for nested SDK errors");

  // code extraction from message when `err.code` is absent
  const msgOnly = new Error("14 UNAVAILABLE: socket disconnected");
  assert.strictEqual(extractGrpcCode(msgOnly), 14);

  // whitelist set hasn't drifted
  assert.deepStrictEqual([...TRANSIENT_GRPC_CODES].sort((a, b) => a - b), [4, 10, 14]);
})();

(function backoffGrowthAndJitterBounds() {
  const base = 100;
  // With rand=0 we hit the minimum of the jitter range; with rand=1 we
  // hit the maximum. Attempt 1 → floor=100 → window [75,125].
  const a1Min = computeBackoffMs(1, base, () => 0);
  const a1Max = computeBackoffMs(1, base, () => 0.99);
  assert.ok(a1Min <= a1Max, "jitter ordering must hold");
  assert.ok(a1Min >= 50 && a1Max <= 150, `attempt 1 window 50..150, got ${a1Min}..${a1Max}`);

  // Backoff must grow monotonically (middle of jitter window).
  const a1 = computeBackoffMs(1, base, () => 0.5);
  const a2 = computeBackoffMs(2, base, () => 0.5);
  const a3 = computeBackoffMs(3, base, () => 0.5);
  assert.ok(a2 > a1, `attempt 2 (${a2}) must exceed attempt 1 (${a1})`);
  assert.ok(a3 > a2, `attempt 3 (${a3}) must exceed attempt 2 (${a2})`);
})();

console.log("FIRESTORE_TRANSIENT_RETRY_TEST_OK");
