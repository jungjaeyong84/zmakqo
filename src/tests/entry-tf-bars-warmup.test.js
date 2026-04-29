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

// (C) cold-start detection via queryBars
//
// The decision is whether existing bars in Firestore < threshold.
// queryBars must be called with the same exchange/symbol/tf the
// F2 generator reads. The check is read-only — no mutation in
// the threshold-decision path.
(function testColdStartDetection() {
  assert.ok(
    /existingBars\s*=\s*await\s+queryBars/.test(SRC),
    "(C1) must use queryBars to count existing bars before deciding"
  );
  assert.ok(
    /existingCount\s*<\s*ENTRY_TF_BARS_WARMUP_THRESHOLD/.test(SRC),
    "(C2) cold-start condition: existing < threshold"
  );
})();

// (D) countOverride applied on cold-start branch only
//
// CRITICAL: warm symbols (existingCount >= threshold) MUST fall
// through to the normal refresh cadence — not constantly fetch
// 230 bars every tick. Otherwise we'd burn Binance weight
// uselessly forever.
(function testCountOverrideAppliedOnlyOnColdStart() {
  // Cold-start branch passes countOverride
  assert.ok(
    /existingCount\s*<\s*ENTRY_TF_BARS_WARMUP_THRESHOLD[\s\S]{0,800}countOverride:\s*ENTRY_TF_BARS_WARMUP_COUNT/.test(SRC),
    "(D1) cold-start branch must pass countOverride: ENTRY_TF_BARS_WARMUP_COUNT"
  );
  // Warm branch (else) does NOT pass countOverride — this is the
  // saving-Binance-weight half of the contract.
  assert.ok(
    /\}\s*else\s*\{[\s\S]{0,500}refreshLatestBarSnapshot\(\{[\s\S]{0,300}runId:\s*runIdHint,?[\s\S]{0,50}\}\);/.test(SRC),
    "(D2) warm branch (else) must call refreshLatestBarSnapshot WITHOUT countOverride"
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
