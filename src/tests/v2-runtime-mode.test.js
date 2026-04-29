"use strict";

// 2026-04-29 P1-3.1 — V2 runtime mode resolver tests.
//
// The resolver collapses 12 V1→V2 cutover boolean env flags into a
// single phase classification (DISCOVERY_CANARY / PRODUCTION_FULL /
// PAUSED / UNKNOWN) plus a flat shape of accessors that callers can
// adopt incrementally. The tests below pin:
//   (A) the production cloudbuild matrix → DISCOVERY_CANARY
//   (B) a cap-graduation matrix → PRODUCTION_FULL
//   (C) a kill-switch matrix → PAUSED
//   (D) an incoherent matrix → UNKNOWN + invariant violation
//   (E) parseBoolEnv truth table
//   (F) flat accessor shape
//   (G) logInvariantViolations behaviour (warn vs throw)

const assert = require("assert");
const path = require("path");

delete require.cache[require.resolve("../config/v2RuntimeMode")];
const {
  resolveV2RuntimeMode,
  classifyPhase,
  readMatrix,
  logInvariantViolations,
  PHASES,
  __test,
} = require("../config/v2RuntimeMode");

// ── (A) Production cloudbuild current matrix ─────────────────────
(function testDiscoveryCanary() {
  const env = {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "0",
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "0",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1",
  };
  const mode = resolveV2RuntimeMode(env);
  assert.strictEqual(mode.phase, PHASES.DISCOVERY_CANARY,
    "(A1) cloudbuild's current matrix is DISCOVERY_CANARY");
  assert.deepStrictEqual(mode.invariantViolations, [],
    "(A2) the production matrix has no invariant violations");
})();

// ── (B) PRODUCTION_FULL: same stance, canary_only relaxed ───────
(function testProductionFull() {
  const env = {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "0",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1",
  };
  const mode = resolveV2RuntimeMode(env);
  assert.strictEqual(mode.phase, PHASES.PRODUCTION_FULL,
    "(B1) canary_only=0 with the rest of the V2-owns-everything matrix is PRODUCTION_FULL");
})();

// ── (C) PAUSED: V2 off + legacy fully disabled ─────────────────
//     PAUSED requires both legacy_runtime_disabled and
//     legacy_entry_filters_disabled (the V1 stack is fully off).
(function testPaused() {
  const env = {
    DONBEOLJA_V2_ENABLED: "0",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "1",
  };
  const mode = resolveV2RuntimeMode(env);
  assert.strictEqual(mode.phase, PHASES.PAUSED,
    "(C1) V2 disabled + legacy disabled → no entries fire from any path → PAUSED");
  assert.deepStrictEqual(mode.invariantViolations, [],
    "(C2) coherent PAUSED matrix has no invariant violations");
})();

// ── (D) UNKNOWN matrix raises invariant violations ───────────────
(function testIncoherent() {
  const env = {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "1", // ← block+allow both
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "0", // ← runtime disabled but entry filters live
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "0", // ← V2 enabled but risk governor not required
  };
  const mode = resolveV2RuntimeMode(env);
  assert.strictEqual(mode.phase, PHASES.UNKNOWN,
    "(D1) incoherent matrix is UNKNOWN");
  assert.ok(mode.invariantViolations.includes("LEGACY_WEBHOOK_BLOCK_AND_ALLOW_BOTH_TRUE"),
    "(D2) block+allow violation surfaced");
  assert.ok(mode.invariantViolations.includes("LEGACY_RUNTIME_DISABLED_BUT_ENTRY_FILTERS_ACTIVE"),
    "(D3) legacy runtime/entry filter coherence violation surfaced");
  assert.ok(mode.invariantViolations.includes("V2_ENABLED_BUT_RISK_GOVERNOR_NOT_REQUIRED"),
    "(D4) risk governor invariant surfaced");
})();

// ── (E) parseBoolEnv truth table ────────────────────────────────
(function testParseBoolEnv() {
  const f = __test.parseBoolEnv;
  for (const truthy of ["1", "true", "TRUE", "yes", "YES", "on", "ON"]) {
    assert.strictEqual(f(truthy), true, `(E) ${truthy} truthy`);
  }
  for (const falsy of ["0", "false", "FALSE", "no", "NO", "off", "OFF"]) {
    assert.strictEqual(f(falsy), false, `(E) ${falsy} falsy`);
  }
  assert.strictEqual(f(undefined, true), true, "(E) undefined → fallback");
  assert.strictEqual(f(null, false), false, "(E) null → fallback");
  assert.strictEqual(f("", true), true, "(E) empty string → fallback");
  assert.strictEqual(f("garbage", true), true, "(E) garbage → fallback (warn-only)");
})();

// ── (F) flat accessor shape ─────────────────────────────────────
(function testFlatShape() {
  const mode = resolveV2RuntimeMode({
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
  });
  for (const key of [
    "phase", "matrix", "invariantViolations",
    "v2Enabled", "dryRun", "canaryOnly",
    "legacyRuntimeDisabled", "legacyEntryFiltersDisabled",
    "blockLegacyWebhook", "allowLegacyWebhook",
    "allowLegacySchedulerWrites",
    "productionEntryLiveEndpointEnabled", "riskGovernorRequired",
    "requireProductionCutover", "legacyWaitOneBarHardDropDisabled",
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(mode, key),
      `(F) returned mode must include ${key}`);
  }
  // Flat aliases must mirror matrix.
  assert.strictEqual(mode.legacyRuntimeDisabled, mode.matrix.legacyRuntimeDisabled,
    "(F) flat alias mirrors matrix");
})();

// ── (G) logInvariantViolations: warn-only by default ───────────
(function testLogger() {
  const violations = [];
  const stubLogger = {
    warn(tag, body) { violations.push({ tag, body }); },
  };
  const incoherent = resolveV2RuntimeMode({
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "1",
  });
  const result = logInvariantViolations(incoherent, { logger: stubLogger });
  assert.strictEqual(result.ok, false, "(G1) warn fires when violations exist");
  assert.strictEqual(violations.length, 1, "(G2) exactly one warn line");
  assert.strictEqual(violations[0].tag, "[V2_RUNTIME_MODE_INVARIANT]",
    "(G3) standard log tag");

  // Coherent matrix → ok=true, no log. PAUSED requires both
  // legacy runtime AND legacy entry filters disabled (the V1 stack
  // is fully off — no entries fire from any path), so we set both.
  violations.length = 0;
  const coherent = resolveV2RuntimeMode({
    DONBEOLJA_V2_ENABLED: "0",
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "1",
  });
  const okResult = logInvariantViolations(coherent, { logger: stubLogger });
  assert.strictEqual(okResult.ok, true);
  assert.strictEqual(violations.length, 0, "(G4) no warn when coherent");
})();

// ── (H) hard-throw mode under V2_RUNTIME_MODE_INVARIANT_THROW=1 ──
(function testThrowMode() {
  const incoherent = resolveV2RuntimeMode({
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "1",
  });
  const prev = process.env.V2_RUNTIME_MODE_INVARIANT_THROW;
  process.env.V2_RUNTIME_MODE_INVARIANT_THROW = "1";
  try {
    let thrown = null;
    try {
      logInvariantViolations(incoherent, { logger: { warn() {} } });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown && /V2_RUNTIME_MODE_INVARIANT_VIOLATION/.test(thrown.message),
      "(H) hard-throw mode raises Error containing the marker");
  } finally {
    if (prev === undefined) delete process.env.V2_RUNTIME_MODE_INVARIANT_THROW;
    else process.env.V2_RUNTIME_MODE_INVARIANT_THROW = prev;
  }
})();

console.log("V2_RUNTIME_MODE_TEST_OK");
