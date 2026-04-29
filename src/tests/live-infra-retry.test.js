"use strict";

// 2026-04-29 P1-1.12 — live-infra retry helper extraction tests.
//
// Three helpers extracted from paperBinanceRunner.js (lines 1616,
// 1622, 1626) into src/utils/liveInfraRetry.js. Pre-existing
// integration coverage:
// - live-execution-runtime-guards.test.js exercises
//   isRetryableLiveInfraError through paperBinanceRunner.__test.

const assert = require("assert");

delete require.cache[require.resolve("../utils/liveInfraRetry")];
const {
  sleepMs,
  sleep,
  isRetryableLiveInfraError,
} = require("../utils/liveInfraRetry");

// ── (A) sleepMs ────────────────────────────────────────────────
(function testSleepMs() {
  // Returns a Promise.
  const p = sleepMs(0);
  assert.ok(p && typeof p.then === "function", "(A1) returns Promise");
  // Non-positive resolves immediately (no setTimeout scheduled).
  return Promise.all([
    p.then(() => true).then((ok) => assert.strictEqual(ok, true, "(A2) zero ms resolves")),
    sleepMs(-1).then(() => true).then((ok) => assert.strictEqual(ok, true, "(A3) negative ms resolves")),
    sleepMs(NaN).then(() => true).then((ok) => assert.strictEqual(ok, true, "(A4) NaN resolves")),
    sleepMs(undefined).then(() => true).then((ok) => assert.strictEqual(ok, true, "(A5) undefined resolves")),
  ]);
})();

// ── (B) sleepMs actually waits when ms > 0 ─────────────────────
(async function testSleepActuallyWaits() {
  const start = Date.now();
  await sleepMs(15);
  const elapsed = Date.now() - start;
  // Allow generous slop (CI timer jitter).
  assert.ok(elapsed >= 10, `(B1) sleepMs(15) waits at least ~10ms (got ${elapsed}ms)`);
})();

// ── (C) sleep is alias of sleepMs ──────────────────────────────
(function testSleepAlias() {
  // sleep(ms) and sleepMs(ms) both return a thenable; verify they
  // resolve identically on the no-wait fast path.
  return Promise.all([sleep(0), sleepMs(0)]).then(() => true).then((ok) => {
    assert.strictEqual(ok, true, "(C1) sleep alias resolves");
  });
})();

// ── (D) isRetryableLiveInfraError ──────────────────────────────
(function testIsRetryable() {
  // Custom egress proxy error envelope.
  assert.strictEqual(
    isRetryableLiveInfraError({ code: "EGRESS_PROXY_TIMEOUT" }),
    true,
    "(D1) EGRESS_PROXY_TIMEOUT code"
  );
  assert.strictEqual(
    isRetryableLiveInfraError({ code: "EGRESS_PROXY_FETCH_FAIL" }),
    true,
    "(D2) EGRESS_PROXY_FETCH_FAIL code"
  );
  // Node socket-level codes.
  assert.strictEqual(
    isRetryableLiveInfraError({ code: "ETIMEDOUT" }),
    true,
    "(D3) ETIMEDOUT"
  );
  assert.strictEqual(
    isRetryableLiveInfraError({ code: "ECONNRESET" }),
    true,
    "(D4) ECONNRESET"
  );
  // Vendor message fragments.
  assert.strictEqual(
    isRetryableLiveInfraError({ message: "fetch failed" }),
    true,
    "(D5) fetch failed"
  );
  assert.strictEqual(
    isRetryableLiveInfraError({ message: "Service Unavailable" }),
    true,
    "(D6) service unavailable (case-insensitive)"
  );
  assert.strictEqual(
    isRetryableLiveInfraError({ message: "please try again" }),
    true,
    "(D7) try again"
  );
  // Bare string error (not an object) — supported via fallback.
  assert.strictEqual(
    isRetryableLiveInfraError("connection timeout"),
    true,
    "(D8) bare string with TIMEOUT substring"
  );
  // Business errors are NOT retryable. Pin this contract — it's
  // the most important invariant of the function.
  assert.strictEqual(
    isRetryableLiveInfraError({ message: "margin is insufficient" }),
    false,
    "(D9) BUSINESS error → NOT retryable"
  );
  assert.strictEqual(
    isRetryableLiveInfraError({ code: "-2010", message: "order would immediately trigger" }),
    false,
    "(D10) Binance -2010 NOT retryable"
  );
  // null / undefined / empty.
  assert.strictEqual(isRetryableLiveInfraError(null), false, "(D11) null → false");
  assert.strictEqual(isRetryableLiveInfraError(undefined), false, "(D12) undefined → false");
  assert.strictEqual(isRetryableLiveInfraError({}), false, "(D13) empty object → false");
})();

// ── (E) paperBinanceRunner __test re-exports ──────────────────
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  assert.strictEqual(paperTest.isRetryableLiveInfraError, isRetryableLiveInfraError,
    "(E1) same ref for isRetryableLiveInfraError");
})();

console.log("LIVE_INFRA_RETRY_TEST_OK");
