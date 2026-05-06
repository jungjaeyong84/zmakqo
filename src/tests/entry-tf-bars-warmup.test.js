"use strict";

// 2026-04-30 P0-fix-H — entry-tf bars warmup pin tests.
//
// Production verification on 2026-04-29 found the 8 newly added
// symbols (WLD/TAO/ARB/INJ/SUI/AAVE/SAND/TIA) had ZERO entries
// because Firestore held only 96-97 15m bars per symbol vs F2
// generator's 220-bar requirement. This test pins the source-text
// contract that marketRunner detects cold-start and triggers a
// one-shot 230-bar backfill via countOverride.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "scheduler", "marketRunner.js"),
  "utf8"
);
const marketRunner = require("../scheduler/marketRunner");

// (A) warmup branch present
(function testWarmupBranchPresent() {
  assert.ok(
    /SERVER_ENTRY_TF_BARS_WARMUP_THRESHOLD/.test(SRC),
    "(A1) marketRunner must read SERVER_ENTRY_TF_BARS_WARMUP_THRESHOLD env var"
  );
  assert.ok(
    /SERVER_ENTRY_TF_BARS_WARMUP_COUNT/.test(SRC),
    "(A2) marketRunner must read SERVER_ENTRY_TF_BARS_WARMUP_COUNT env var"
  );
  assert.ok(
    /entry_tf_bars_warmup_triggered/.test(SRC),
    "(A3) marketRunner must emit entry_tf_bars_warmup_triggered observability event"
  );
  assert.ok(
    /entry_tf_bars_warmup_completed/.test(SRC),
    "(A4) marketRunner must emit entry_tf_bars_warmup_completed observability event"
  );
})();

// (B) thresholds default to 220 / 230
//
// The 220 floor matches v2/serverEntrySignalGenerator.js' queryBars
// limit (the F2 generator's hard requirement). 230 = 220 + 10
// safety margin so the next tick still has fresh bars to layer
// on top.
(function testThresholdDefaults() {
  // Default 220 (queryBars limit in F2 generator)
  assert.ok(
    /Number\.isFinite\(raw\)\s*&&\s*raw\s*>\s*0\s*\?\s*Math\.floor\(raw\)\s*:\s*220/.test(SRC),
    "(B1) warmup threshold must default to 220 (matches F2 generator limit)"
  );
  // Default 230 (220 + 10 margin)
  assert.ok(
    /Number\.isFinite\(raw\)\s*&&\s*raw\s*>\s*0\s*\?\s*Math\.floor\(raw\)\s*:\s*230/.test(SRC),
    "(B2) warmup count must default to 230 (220 threshold + safety)"
  );
})();

// (C) cold-start detection via post-refresh queryBars
//
// The decision is whether existing bars in Firestore < threshold
// AFTER a normal refresh. This avoids the false-positive 219/220
// stale-window case where the latest bar simply hasn't been refreshed
// yet.
(function testColdStartDetection() {
  assert.ok(
    /snapshotRefresh\s*=\s*await\s+refreshLatestBarSnapshot/.test(SRC),
    "(C1) must perform a normal refresh before warmup escalation"
  );
  assert.ok(
    /existingBars\s*=\s*await\s+queryBars/.test(SRC),
    "(C2) must use queryBars to count existing bars after the normal refresh"
  );
  assert.ok(
    /existingCount\s*<\s*ENTRY_TF_BARS_WARMUP_THRESHOLD/.test(SRC),
    "(C3) cold-start condition: existing < threshold"
  );
})();

// (D) countOverride applied only when post-refresh cache is still cold
//
// CRITICAL: healthy symbols must stop after the normal refresh — not
// constantly fetch 230 bars every tick. Otherwise every new bar
// briefly makes the stale cache look like 219/220 and wastes Binance
// weight forever.
(function testCountOverrideAppliedOnlyOnColdStart() {
  // Warmup branch passes countOverride only after the normal refresh + query.
  assert.ok(
    /existingBars\s*=\s*await\s+queryBars[\s\S]{0,1200}existingCount\s*<\s*ENTRY_TF_BARS_WARMUP_THRESHOLD[\s\S]{0,800}countOverride:\s*ENTRY_TF_BARS_WARMUP_COUNT/.test(SRC),
    "(D1) cold-start branch must pass countOverride: ENTRY_TF_BARS_WARMUP_COUNT"
  );
  // There should be only one unconditional normal refresh in the warmup
  // block, and no separate else-branch normal refresh anymore.
  assert.ok(
    /snapshotRefresh\s*=\s*await\s+refreshLatestBarSnapshot\(\{[\s\S]{0,300}runId:\s*runIdHint,?[\s\S]{0,120}\}\);/.test(SRC),
    "(D2) warm path must use the unconditional normal refresh"
  );
})();

// (D2) countOverride must actually bypass the legacy 200-bar cap.
//
// Regression caught 2026-05-01: production logs showed all 16 symbols
// repeatedly stuck at existing_bars_n=219 threshold=220. The warmup
// branch requested 230 bars, but refreshLatestBarSnapshot hard-capped
// countOverride to 200, so the logged contract did not match the fetch.
(function testWarmupCountOverrideBypassesLegacy200Cap() {
  const fn = marketRunner && marketRunner.__test && marketRunner.__test.resolveSnapshotRefreshCount;
  assert.strictEqual(typeof fn, "function", "(D3) resolveSnapshotRefreshCount must be exported for contract tests");
  assert.strictEqual(
    fn({ countOverride: 230, snapshotRefreshCount: 3 }),
    230,
    "(D4) warmup countOverride=230 must remain 230, not be capped to 200"
  );
  assert.strictEqual(
    fn({ countOverride: 700, snapshotRefreshCount: 3, maxOverrideCount: 500 }),
    500,
    "(D5) countOverride must still have a bounded safety ceiling"
  );
  assert.strictEqual(
    fn({ countOverride: null, snapshotRefreshCount: 99 }),
    10,
    "(D6) normal refresh cadence must still cap at 10 bars"
  );
})();

// (E) graceful failure
//
// queryBars can throw (Firestore transient failure). The fallback
// path must run the LEGACY refresh (no warmup) — never break the
// tick.
(function testGracefulFailure() {
  assert.ok(
    /entry_tf_bars_warmup_check_fail/.test(SRC),
    "(E1) must emit observability log when warmup-decision query fails"
  );
  assert.ok(
    /catch\s*\(warmupErr\)[\s\S]{0,400}refreshLatestBarSnapshot/.test(SRC),
    "(E2) catch branch must fall back to refreshLatestBarSnapshot (legacy refresh)"
  );
})();

console.log("ENTRY_TF_BARS_WARMUP_TEST_OK");
