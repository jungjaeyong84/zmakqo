"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// egress-proxy-production-startup-guard.test.js
//
// 2026-04-20 senior-audit H1. Defends the fail-closed boot guard that
// crashes the container when a production deploy ships with
// EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1.
//
// Why this matters: the deploy gate (check-binance-exit-integrity-gate.js)
// catches the flag ONLY when it's set at build time. A Cloud Run service
// env mutation made AFTER the build passes gate — directly in the Cloud
// Run console, or via a post-deploy Cloud Build trigger — sails right
// past the gate. Without the startup guard the exit-worker would silently
// revert to the global fetch() pool and resurrect the 20-second
// silent-hang pattern that caused the 2026-04-19 ETHUSDT blackout.
//
// Contract enforced here:
//   (1) Outside production (NODE_ENV != production, DONBEOLJA_PROD != 1),
//       the guard is a no-op regardless of the disable flag — unit tests
//       and local dev must not be collateral damage.
//   (2) In production with the flag unset, the guard is a no-op.
//   (3) In production with the flag set to "1", the guard throws with a
//       distinctive error code so Cloud Run's health check fails the
//       revision and the deploy auto-rolls-back.
//   (4) DONBEOLJA_PROD=1 triggers production semantics even when
//       NODE_ENV is unset (some pipelines don't set NODE_ENV).
//   (5) The underlying boolean predicate `isEgressDispatcherDisabledByEnv`
//       is the single source of truth shared with the deploy gate
//       wrapper (check-binance-exit-integrity-gate.js).  Byte-for-byte
//       identical semantics guaranteed by both sides importing the
//       same function.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// Preserve env so the test doesn't mutate the ambient shell state.
const savedNodeEnv = process.env.NODE_ENV;
const savedDonbeolja = process.env.DONBEOLJA_PROD;
const savedDisable = process.env.EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER;

function restoreEnv() {
  if (savedNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedDonbeolja == null) delete process.env.DONBEOLJA_PROD;
  else process.env.DONBEOLJA_PROD = savedDonbeolja;
  if (savedDisable == null) delete process.env.EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER;
  else process.env.EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER = savedDisable;
}

process.env.EGRESS_PROXY_MODE = "client";
process.env.EGRESS_PROXY_URL = "https://stub.egress.example/";
process.env.EGRESS_PROXY_TOKEN = "test-token";

const egressProxyPath = require.resolve("../utils/egressProxy");
delete require.cache[egressProxyPath];
const {
  isEgressDispatcherDisabledByEnv,
  assertEgressProductionStartupGuard,
  __test,
} = require("../utils/egressProxy");

function resetGuardMemo() {
  // The guard memoises its "already checked" state so a successful boot
  // doesn't re-check on every dispatcher call. Unit tests need to reset
  // that memo between scenarios — we export a test helper for exactly
  // this purpose.
  assert.strictEqual(typeof __test._resetProductionStartupGuardCheckedForTest, "function",
    "test-reset helper must be exported — otherwise memoisation makes scenarios non-hermetic");
  __test._resetProductionStartupGuardCheckedForTest();
}

try {
  // (5) Predicate coverage — locks the string-to-bool contract down.
  assert.strictEqual(
    isEgressDispatcherDisabledByEnv({ EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "1" }),
    true,
    "literal '1' must be disabled"
  );
  assert.strictEqual(
    isEgressDispatcherDisabledByEnv({ EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: " 1 " }),
    true,
    "whitespace-padded '1' must still count as disabled — Cloud Run env values sometimes arrive with trailing space"
  );
  assert.strictEqual(
    isEgressDispatcherDisabledByEnv({ EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "0" }),
    false,
    "literal '0' must be enabled"
  );
  assert.strictEqual(
    isEgressDispatcherDisabledByEnv({}),
    false,
    "unset must default to enabled — production-safe default"
  );
  assert.strictEqual(
    isEgressDispatcherDisabledByEnv({ EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "true" }),
    false,
    "string 'true' must NOT be accepted — only literal '1'. Mixing conventions would surprise ops."
  );

  // (1) Non-production: flag set but guard must no-op.
  resetGuardMemo();
  assert.doesNotThrow(() => {
    assertEgressProductionStartupGuard({
      NODE_ENV: "test",
      DONBEOLJA_PROD: "0",
      EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "1",
    });
  }, "non-prod must no-op even with the disable flag — unit tests must not crash");

  // (2) Production with flag unset: guard must no-op.
  resetGuardMemo();
  assert.doesNotThrow(() => {
    assertEgressProductionStartupGuard({
      NODE_ENV: "production",
      // DONBEOLJA_PROD unset
      // EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER unset
    });
  }, "production with flag unset must boot normally");

  // (3) Production with flag set: guard must THROW with the distinctive code.
  resetGuardMemo();
  let caught = null;
  try {
    assertEgressProductionStartupGuard({
      NODE_ENV: "production",
      EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "1",
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "production + flag=1 must throw — otherwise a mis-configured deploy boots silently");
  assert.strictEqual(caught.code, "EGRESS_PROXY_CUSTOM_DISPATCHER_DISABLED_IN_PRODUCTION",
    "error.code must be the distinctive string so Cloud Logging alerts can match exactly");
  assert.ok(String(caught.message || "").includes("EGRESS_PROXY_CUSTOM_DISPATCHER_DISABLED_IN_PRODUCTION"),
    "error.message must include the marker for text-based log grep");

  // (4) DONBEOLJA_PROD=1 alone is enough to trigger production semantics.
  resetGuardMemo();
  let caught2 = null;
  try {
    assertEgressProductionStartupGuard({
      // NODE_ENV unset — some pipelines don't set it.
      DONBEOLJA_PROD: "1",
      EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "1",
    });
  } catch (err) {
    caught2 = err;
  }
  assert.ok(caught2,
    "DONBEOLJA_PROD=1 must be treated as production even when NODE_ENV is unset");
  assert.strictEqual(caught2.code, "EGRESS_PROXY_CUSTOM_DISPATCHER_DISABLED_IN_PRODUCTION");

  // Memoisation: after a successful check, a second call with a failing
  // env must NOT throw — the guard is one-shot per process boot to avoid
  // re-running on every dispatcher request.
  resetGuardMemo();
  assertEgressProductionStartupGuard({ NODE_ENV: "production" }); // succeeds, memos true
  assert.doesNotThrow(() => {
    assertEgressProductionStartupGuard({
      NODE_ENV: "production",
      EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "1",
    });
  }, "memoised successful boot must not re-fail on a later call — that would churn logs in production");

  console.log("EGRESS_PROXY_PRODUCTION_STARTUP_GUARD_TEST_OK");
} catch (err) {
  console.error("EGRESS_PROXY_PRODUCTION_STARTUP_GUARD_TEST_FAIL",
    err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  restoreEnv();
}
