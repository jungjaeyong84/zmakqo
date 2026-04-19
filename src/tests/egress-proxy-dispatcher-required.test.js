"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// egress-proxy-dispatcher-required.test.js
//
// 2026-04-19 RCA²: exit-worker was silently falling back to the global
// fetch pool because `require("undici")` threw MODULE_NOT_FOUND — undici
// was never declared in package.json.  The previous fix (PR#18) looked
// applied in code review but was dead-on-arrival in production, which is
// exactly why the 20-second EGRESS_PROXY_TIMEOUT pattern kept recurring
// after deploy.
//
// This regression guards the dependency itself, not behavior:
//   (1) `require("undici")` resolves from this repo.  If this test fails,
//       the half-open-pool mitigation is not active in production.
//   (2) `getEgressDispatcher()` returns a live Agent (not null) when the
//       disable-flag is unset.  A null return means the module silently
//       fell back to the global pool — the exact failure PR#19 exists to
//       prevent.
//   (3) `closeEgressDispatcher()` is exposed AND the next
//       getEgressDispatcher() call returns a *different* Agent instance
//       — proving the reset-between-retries logic can actually swap the
//       pool.  Without this, the "retry" only retries through the same
//       half-open pool and fails identically.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// Must resolve from this repo's node_modules.  If this throws, the whole
// dispatcher mitigation is inert in production — log it loudly and fail.
let undici = null;
try {
  undici = require("undici");
} catch (err) {
  console.error("FAIL: require('undici') threw — undici must be declared in package.json dependencies.");
  console.error("  Without undici, the exit-worker silently falls back to the global fetch pool,");
  console.error("  which is the root cause of the 2026-04-19 20s-EGRESS_PROXY_TIMEOUT incident.");
  console.error("  Add `undici` to dependencies and re-run.");
  console.error("  Underlying error:", err && err.message ? err.message : err);
  process.exit(1);
}
assert.strictEqual(typeof undici.Agent, "function",
  "undici.Agent must be a constructor");

// Ensure the module under test loads with the disable-flag OFF — we want
// to verify the real dispatcher path, not the test fallback.
delete process.env.EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER;
// These must be present for callEgressProxy itself, though this test only
// exercises dispatcher lifecycle.
process.env.EGRESS_PROXY_MODE = "client";
process.env.EGRESS_PROXY_URL = "https://stub.egress.example/";
process.env.EGRESS_PROXY_TOKEN = "test-token";

// Re-require after env is set.  Clear the cache entry so our flag changes
// take effect even if another test file loaded egressProxy first.
const egressProxyPath = require.resolve("../utils/egressProxy");
delete require.cache[egressProxyPath];
const { __test } = require("../utils/egressProxy");

assert.ok(__test, "__test export missing");
assert.strictEqual(typeof __test.getEgressDispatcher, "function",
  "getEgressDispatcher export missing");
assert.strictEqual(typeof __test.closeEgressDispatcher, "function",
  "closeEgressDispatcher export missing — retry-reset guarantee broken");

// (1) Dispatcher must materialize — null means silent fallback to the
// global fetch pool, which is the exact regression PR#19 prevents.
const d1 = __test.getEgressDispatcher();
assert.ok(d1, "getEgressDispatcher returned null — undici not loaded, "
  + "half-open-pool mitigation is inert.  This is the root cause of the "
  + "2026-04-19 incident and must NOT ship to production.");
assert.ok(d1 instanceof undici.Agent,
  "dispatcher must be a live undici Agent instance");

// Repeated calls must return the SAME instance (pool is shared across
// requests — that's the point of keep-alive).
const d1b = __test.getEgressDispatcher();
assert.strictEqual(d1, d1b,
  "sequential getEgressDispatcher() calls must reuse the cached Agent "
  + "— rebuilding per call would eliminate keep-alive entirely");

(async () => {
  // (2) closeEgressDispatcher must invalidate the cache so the next call
  // produces a *different* Agent.  This is what makes retry-reset actually
  // work — without a fresh instance the retry draws from the same pool
  // and the same half-open socket.
  await __test.closeEgressDispatcher();
  const d2 = __test.getEgressDispatcher();
  assert.ok(d2, "getEgressDispatcher after close must return a new Agent, "
    + "not null");
  assert.notStrictEqual(d1, d2,
    "getEgressDispatcher after closeEgressDispatcher() must return a "
    + "NEW instance — if it returns the same, the retry-reset is a no-op "
    + "and half-open sockets persist across attempts");

  // Cleanup: close the second dispatcher so we don't leak a keepalive
  // timer that blocks process exit.
  await __test.closeEgressDispatcher();

  console.log("EGRESS_PROXY_DISPATCHER_REQUIRED_TEST_OK");
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
