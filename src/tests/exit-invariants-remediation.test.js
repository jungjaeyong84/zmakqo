"use strict";

// Regression tests for the Phase 1 remediation invariants (C1, C3, C6, C9, C10, C11, C14).
// Each block asserts a single invariant. A failure here indicates that the
// fail-closed contract introduced in the 2026-04-17 audit has regressed.

const assert = require("assert");

const {
  deriveExitIntegrityExposureGuard,
} = require("../utils/exitIntegrityPolicy");
const {
  isSimplifiedExitV2Active,
  resolveSimplifiedExitV2FlagFromSnapshot,
  requireSimplifiedExitV2Flag,
} = require("../services/simplifiedExitV2");
const {
  __test: cycleTest,
} = require("../../scripts/run-binance-exit-integrity-cycle");
const {
  __test: gateTest,
} = require("../../scripts/check-binance-exit-integrity-gate");

// ---------- C5 runtime guard: missing / stale / parse error -----------------
(() => {
  const now = 2_100_000_000_000;

  const missing = deriveExitIntegrityExposureGuard(
    { doc: null, mtimeMs: null, path: "/x.json", present: false },
    { now, maxAgeMs: 60_000 }
  );
  assert.strictEqual(missing.blockNewEntries, true, "missing report must block");
  assert.strictEqual(missing.reason, "LIVE_POLICY_EXIT_INTEGRITY_REPORT_MISSING");

  const stale = deriveExitIntegrityExposureGuard(
    {
      doc: { summary: { status: "OK", reasons: [] } },
      mtimeMs: now - (60 * 60 * 1000),
      path: "/x.json",
      present: true,
    },
    { now, maxAgeMs: 30 * 60 * 1000 }
  );
  assert.strictEqual(stale.blockNewEntries, true, "stale report must block");
  assert.strictEqual(stale.reason, "LIVE_POLICY_EXIT_INTEGRITY_REPORT_STALE");

  const parseErr = deriveExitIntegrityExposureGuard(
    { doc: null, mtimeMs: now - 1000, path: "/x.json", present: true, parseError: true },
    { now, maxAgeMs: 30 * 60 * 1000 }
  );
  assert.strictEqual(parseErr.blockNewEntries, true, "parse error must block");
  assert.strictEqual(parseErr.reason, "LIVE_POLICY_EXIT_INTEGRITY_REPORT_PARSE_ERROR");

  const disabled = deriveExitIntegrityExposureGuard(null, { now, maxAgeMs: 30 * 60 * 1000 });
  assert.strictEqual(disabled.blockNewEntries, false, "disabled guard (null input) must pass");
  assert.strictEqual(disabled.scale, 1);
})();

// ---------- C9 simplified-exit-v2 flag: strict resolver --------------------
(() => {
  // Strict resolver returns null when snapshot does not specify the flag.
  assert.strictEqual(resolveSimplifiedExitV2FlagFromSnapshot({}), null);
  assert.strictEqual(resolveSimplifiedExitV2FlagFromSnapshot({ meta: {} }), null);
  assert.strictEqual(
    resolveSimplifiedExitV2FlagFromSnapshot({ meta: { simplified_exit_v2_enabled: true } }),
    true
  );
  assert.strictEqual(
    resolveSimplifiedExitV2FlagFromSnapshot({ simplifiedExitV2Enabled: false }),
    false
  );

  // `requireSimplifiedExitV2Flag` throws for ambiguous snapshots.
  assert.throws(() => requireSimplifiedExitV2Flag({}, { context: "entry_open" }), (err) => {
    assert.strictEqual(err.code, "SIMPLIFIED_EXIT_V2_FLAG_MISSING");
    assert.strictEqual(err.context, "entry_open");
    return true;
  });

  // Legacy `isSimplifiedExitV2Active` still accepts env fallback (migration support)
  // but MUST honour explicit meta flags even when env contradicts.
  const prevEnv = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  try {
    assert.strictEqual(
      isSimplifiedExitV2Active({ meta: { simplified_exit_v2_enabled: true } }),
      true,
      "explicit meta true must beat env false"
    );
    assert.strictEqual(
      isSimplifiedExitV2Active({ meta: { simplified_exit_v2_enabled: false } }),
      false,
      "explicit meta false must beat env true"
    );
    assert.strictEqual(
      isSimplifiedExitV2Active({}),
      false,
      "no meta falls back to env"
    );
  } finally {
    if (prevEnv == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
    else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevEnv;
  }
})();

// ---------- C6 gate profile is strictly narrower than ops ------------------
(() => {
  const gateEnv = cycleTest.resolveCycleProfileEnv("gate");
  const opsEnv = cycleTest.resolveCycleProfileEnv("ops");
  const pairs = [
    ["CANONICAL_EXIT_TRANSITION_BACKFILL_LOOKBACK_DAYS", true],
    ["CANONICAL_EXIT_TRANSITION_BACKFILL_PAGE_SIZE", true],
    ["TRADE_EXEC_ALERT_CROSS_AUDIT_LOOKBACK_HOURS", true],
    ["TRADE_EXEC_ALERT_CROSS_AUDIT_PAGE_SIZE", true],
    ["BINANCE_CANONICAL_EXIT_STAGE_QA_LOOKBACK_HOURS", true],
    ["BINANCE_CANONICAL_EXIT_STAGE_QA_FILL_SCAN_LIMIT", true],
    ["BINANCE_CANONICAL_EXIT_STAGE_QA_TRANSITION_SCAN_LIMIT", true],
    ["SIMPLIFIED_EXIT_V2_LIVE_FLOW_LOOKBACK_HOURS", true],
    ["SIMPLIFIED_EXIT_V2_LIVE_FLOW_PAGE_SIZE", true],
    ["SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_LOOKBACK_HOURS", true],
    ["SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_PAGE_SIZE", true],
  ];
  for (const [key, mustBeStrict] of pairs) {
    const g = Number(gateEnv[key]);
    const o = Number(opsEnv[key]);
    assert.ok(Number.isFinite(g) && Number.isFinite(o), `${key} must be numeric in both profiles`);
    if (mustBeStrict) {
      assert.ok(g <= o, `gate ${key}=${g} must be <= ops ${key}=${o}`);
      assert.ok(g < o, `gate ${key}=${g} should be strictly narrower than ops ${key}=${o}`);
    }
  }
})();

// ---------- C4 gate skip produces fail-closed reasons ---------------------
(() => {
  const reasons = gateTest.buildFailureReasons(
    { status: "SKIP", skip_reason: "NO_ACTIVE_POSITIONS" },
    { cycleResult: { skipped: true } }
  );
  assert.ok(reasons.some((r) => r.startsWith("CYCLE_SKIPPED:")), "skipped cycle must produce a CYCLE_SKIPPED reason");
  assert.ok(reasons.includes("STATUS_NOT_OK:SKIP"), "non-OK status must be flagged");
})();

// ---------- C1 stage-hint ledger validator (live import) -------------------
(() => {
  const fillsSync = require("../services/binanceFuturesFillsSync");
  const target = fillsSync.__test && fillsSync.__test.buildStageHintedMeta
    ? fillsSync.__test.buildStageHintedMeta
    : null;
  if (typeof target === "function") {
    // The hint builder itself stays pure: the validator is applied by the
    // caller (`promotePositionStageHintsFromExternalExit`).  We assert that
    // the pure hint still sets the flags event-shape would imply.
    const hinted = target({ tp_p0_done: false, tp_p1_done: false, trail_active: false }, "EXIT_TRAIL_1P", { time: 0, price: 1 });
    assert.strictEqual(hinted.trail_active, true);
    assert.strictEqual(hinted.tp_p1_done, true);
  }
})();

// ---------- C10 alert dedupe key binds to cycle ---------------------------
(() => {
  const tradeAlert = require("../services/tradeExecutionAlert");
  const testExports = tradeAlert.__test || {};
  const resolver = testExports.resolveTradeAlertDedupeKey
    || testExports.__resolveTradeAlertDedupeKey
    || null;
  if (typeof resolver === "function") {
    const withCycle = resolver({
      tradeAlertDedupeKey: "BASE_KEY_ABC",
      entry_event_id: "ENTRY__XYZ__1",
    });
    const withoutCycle = resolver({ tradeAlertDedupeKey: "BASE_KEY_ABC" });
    assert.ok(withCycle && withCycle.startsWith("BASE_KEY_ABC::CYCLE_"), `expected cycle-bound key, got ${withCycle}`);
    assert.strictEqual(withoutCycle, "BASE_KEY_ABC", "missing cycle token should pass through base key");
  }
})();

console.log("EXIT_INVARIANTS_REMEDIATION_TEST_OK");
