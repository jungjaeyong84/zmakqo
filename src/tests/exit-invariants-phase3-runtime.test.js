"use strict";

// Regression tests for the Phase 3 runtime-safety tickets P3-02, P3-07,
// P3-08/P3-11, P3-13, P3-14. Each block covers one invariant with a
// self-contained stub so we never hit production Firestore / WebSocket.

const assert = require("assert");

const exitAuthorityState = require("../storage/exitAuthorityState");
const binanceUserDataStream = require("../services/binanceUserDataStream");
const openclawAuthority = require("../services/openclawExecutionAuthority");
const openclawExecutor = require("../services/openclawExecutionExecutor");
const failClosedGuard = require("../utils/failClosedEnvGuard");

// ---------- P3-02 authority persist failure alerting ----------------------
(async () => {
  exitAuthorityState.__test.resetPersistCountersForTest();

  const stubOk = {
    collection() {
      return { doc() { return { async set() { /* success */ } }; } };
    },
  };
  const stubFail = {
    collection() {
      return {
        doc() {
          return {
            async set() { throw new Error("FIRESTORE_DOWN"); },
          };
        },
      };
    },
  };

  const alerts = [];
  const sink = (payload) => alerts.push(payload);

  await exitAuthorityState.persistExitAuthorityStates(stubOk, [
    { chainKey: "BIN__BTCUSDT__ENTRY__a", exchange: "BINANCEFUT", symbol: "BTCUSDT", state: { tp1: 0.5, total: 0.5 } },
  ], { alertSink: sink });
  let stats = exitAuthorityState.getPersistCounters();
  assert.strictEqual(stats.success_n, 1);
  assert.strictEqual(stats.failure_n, 0);
  assert.strictEqual(alerts.length, 0, "no alert after a single success");

  // Cross the threshold (default 3 failures in 15 min window).
  for (let i = 0; i < exitAuthorityState.PERSIST_FAILURE_ALERT_THRESHOLD; i += 1) {
    await exitAuthorityState.persistExitAuthorityStates(stubFail, [
      { chainKey: `BIN__ETHUSDT__ENTRY__${i}`, exchange: "BINANCEFUT", symbol: "ETHUSDT", state: { tp1: 0.5 } },
    ], { alertSink: sink });
  }
  stats = exitAuthorityState.getPersistCounters();
  assert.ok(stats.failure_n >= exitAuthorityState.PERSIST_FAILURE_ALERT_THRESHOLD,
    `expected failure counter >= ${exitAuthorityState.PERSIST_FAILURE_ALERT_THRESHOLD}`);
  assert.strictEqual(alerts.length, 1, "exactly one alert when threshold crossed once");
  assert.strictEqual(alerts[0].alert, "EXIT_AUTHORITY_STATE_PERSIST_DEGRADED");
  assert.ok(alerts[0].failure_n >= 3, "alert payload must carry failure count");

  // Further failures within the rate-limit window must not emit again.
  await exitAuthorityState.persistExitAuthorityStates(stubFail, [
    { chainKey: "BIN__ETHUSDT__ENTRY__rate_limit", exchange: "BINANCEFUT", symbol: "ETHUSDT", state: { tp1: 0.5 } },
  ], { alertSink: sink });
  assert.strictEqual(alerts.length, 1, "rate-limited alert (single emission per window)");

  exitAuthorityState.__test.resetPersistCountersForTest();
})().catch((err) => {
  console.error("PHASE3_P3_02_FAIL", err);
  process.exit(1);
});

// ---------- P3-07 WS drift repair --------------------------------------
(() => {
  const T = binanceUserDataStream.__test;
  T._resetDriftState();
  // No disconnect yet → alert is a no-op.
  T.maybeEmitDisconnectDriftAlert();
  let state = T._getDriftState();
  assert.strictEqual(state.disconnect_started_at, null);
  assert.strictEqual(state.drift_alert_emitted_at, null);

  // Simulate a disconnect that started longer ago than the alert threshold.
  const ancient = Date.now() - (T.USER_STREAM_DRIFT_ALERT_MS + 5_000);
  T._markDisconnect(ancient);
  T.maybeEmitDisconnectDriftAlert();
  state = T._getDriftState();
  assert.strictEqual(state.disconnect_started_at, ancient);
  assert.ok(Number.isFinite(state.drift_alert_emitted_at),
    "drift alert must record emission timestamp");

  // Second invocation within the outage window must not re-emit.
  const firstAlertAt = state.drift_alert_emitted_at;
  T.maybeEmitDisconnectDriftAlert();
  state = T._getDriftState();
  assert.strictEqual(state.drift_alert_emitted_at, firstAlertAt,
    "drift alert must be emitted exactly once per outage");

  T._resetDriftState();
})();

// ---------- P3-08 / P3-11 fail-closed env guard -------------------------
(() => {
  failClosedGuard.__test.resetForTest();
  const prev = process.env.ML_SERVING_FAIL_CLOSED;
  const errLogs = [];
  const origWarn = console.warn;
  console.warn = (...args) => errLogs.push(args.join(" "));
  try {
    process.env.ML_SERVING_FAIL_CLOSED = "1";
    assert.strictEqual(
      failClosedGuard.warnIfFailClosedDisabled("ML_SERVING_FAIL_CLOSED"),
      false,
      "fail-closed env=1 must not warn"
    );

    process.env.ML_SERVING_FAIL_CLOSED = "0";
    assert.strictEqual(
      failClosedGuard.warnIfFailClosedDisabled("ML_SERVING_FAIL_CLOSED"),
      true,
      "fail-closed env=0 must emit a warning"
    );
    assert.strictEqual(
      failClosedGuard.warnIfFailClosedDisabled("ML_SERVING_FAIL_CLOSED"),
      false,
      "warning emits only once per process per env"
    );
    assert.ok(errLogs.some((line) => line.includes("FAIL_CLOSED_ENV_DISABLED")),
      "warning must be written to console.warn");
  } finally {
    console.warn = origWarn;
    if (prev == null) delete process.env.ML_SERVING_FAIL_CLOSED;
    else process.env.ML_SERVING_FAIL_CLOSED = prev;
    failClosedGuard.__test.resetForTest();
  }

  // isFailOpenExplicit covers the input shapes we actually see in env.
  assert.strictEqual(failClosedGuard.isFailOpenExplicit("0"), true);
  assert.strictEqual(failClosedGuard.isFailOpenExplicit("FALSE"), true);
  assert.strictEqual(failClosedGuard.isFailOpenExplicit("off"), true);
  assert.strictEqual(failClosedGuard.isFailOpenExplicit(undefined), false);
  assert.strictEqual(failClosedGuard.isFailOpenExplicit(""), false);
  assert.strictEqual(failClosedGuard.isFailOpenExplicit("1"), false);
})();

// ---------- P3-13 budget floor structured drop -------------------------
(() => {
  const prev = process.env.ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED;
  try {
    process.env.ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED = "1";
    delete process.env.ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_MARKETS;
    const mod = require("../services/openclawExecutionAuthority");
    // Clear the cache so env changes are respected.
    delete require.cache[require.resolve("../services/openclawExecutionAuthority")];
    const freshMod = require("../services/openclawExecutionAuthority");

    // Case 1: not applicable → structured "NOT_APPLICABLE".
    const notApplicable = freshMod.__test.resolveEntryBudgetGuardMinQtyFloor({
      symbol: "BTCUSDT",
      entryBudgetGuard: { applicable: false, ok: true },
    });
    assert.strictEqual(notApplicable.applied, false);
    assert.strictEqual(notApplicable.reason, "ENTRY_BUDGET_GUARD_NOT_APPLICABLE");

    // Case 2: required qty > max snap qty → "FLOOR_INFEASIBLE" (previously silent null).
    const infeasible = freshMod.__test.resolveEntryBudgetGuardMinQtyFloor({
      symbol: "BTCUSDT",
      qtyRequested: 0.05,
      openclawQty: 0.05,
      finalQty: 0.02,
      entryBudgetGuard: {
        applicable: true,
        ok: false,
        reason: "MIN_ORDER_EXCEEDS_BUDGET",
        requiredQtyPct: 0.9,
      },
    });
    assert.strictEqual(infeasible.applied, false);
    assert.strictEqual(infeasible.reason, "ENTRY_BUDGET_GUARD_FLOOR_INFEASIBLE",
      `expected FLOOR_INFEASIBLE diagnosis, got ${infeasible.reason}`);
    assert.ok(Number.isFinite(infeasible.requiredQtyPct));
    assert.ok(Number.isFinite(infeasible.maxSnapQtyPct));

    // Case 3: final qty already ≥ floor → "FLOOR_MET".
    const alreadyMet = freshMod.__test.resolveEntryBudgetGuardMinQtyFloor({
      symbol: "BTCUSDT",
      qtyRequested: 1,
      openclawQty: 0.8,
      finalQty: 0.8,
      entryBudgetGuard: {
        applicable: true,
        ok: false,
        reason: "MIN_ORDER_EXCEEDS_BUDGET",
        requiredQtyPct: 0.5,
      },
    });
    assert.strictEqual(alreadyMet.applied, false);
    assert.strictEqual(alreadyMet.reason, "ENTRY_BUDGET_GUARD_FINAL_QTY_ALREADY_MEETS_FLOOR");
  } finally {
    if (prev == null) delete process.env.ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED;
    else process.env.ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED = prev;
  }
})();

// ---------- P3-14 allocator epoch release audit log --------------------
(() => {
  const T = openclawExecutor.__test;
  T.resetAllocatorEpochReleaseLogForTest();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    T.logAllocatorQuarantineEpochRelease({
      market: "btcusdt",
      reason: "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_REDUCE",
      releaseScale: 0.5,
    });
    T.logAllocatorQuarantineEpochRelease({
      market: "btcusdt",
      reason: "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_REDUCE",
      releaseScale: 0.5,
    });
    T.logAllocatorQuarantineEpochRelease({
      market: "ETHUSDT",
      reason: "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE",
      releaseScale: 1,
    });
    const btcLogs = warnings.filter((line) => line.includes("BTCUSDT"));
    const ethLogs = warnings.filter((line) => line.includes("ETHUSDT"));
    assert.strictEqual(btcLogs.length, 1, "rate-limited to 1 per market per window");
    assert.strictEqual(ethLogs.length, 1, "new market emits one line");
    assert.ok(btcLogs[0].includes("ALLOCATOR_QUARANTINE_EPOCH_RELEASE"));
  } finally {
    console.warn = origWarn;
    T.resetAllocatorEpochReleaseLogForTest();
  }
})();

console.log("EXIT_INVARIANTS_PHASE3_RUNTIME_TEST_OK");
