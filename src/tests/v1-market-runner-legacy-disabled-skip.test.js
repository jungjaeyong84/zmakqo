"use strict";

// 2026-04-29 — V1 trade denial architectural test (rewritten).
//
// The previous version of this test enforced a "V1 cutover guard" at
// the scheduler call site (scheduler/scheduler.js: skip runOneMarket
// when DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1). That outer guard was
// retired on 2026-04-29 because it was redundant safety AND it had
// the side effect of short-circuiting the F2 server-native ENTRY
// signal generator inject inside paperBinanceRunner.runPaperFuturesForBar.
// Operator symptom: "신호가 안 나오는 것 같다" — V1 cutover skip
// blocked F2 generator from ever running.
//
// V1 trade is now blocked at the *writer* boundary, not the
// scheduler boundary:
//   1. paperBinanceRunner.js calls
//      `isV2DiscoveryCanaryLegacyExchangeWriteBlocked` at every V1
//      exchange-write site; legacy_runtime_disabled=true returns
//      `V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED`. V1 cannot
//      enter or exit the exchange.
//   2. binanceTickExit's V1 fast-lane self-skips on
//      `legacyRuntimeDisabledNow()` (V2 direct dispatch + R1/R2 own
//      the exit path).
//   3. The V1 EXIT_OPPOSITE_SIGNAL inject inside
//      runPaperFuturesForBar self-skips on liveCfg.legacy_runtime_disabled.
//
// The scheduler tick now flows through `runOneMarket` cleanly,
// letting the F2 ENTRY signal generator inject finally fire.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

(function testStructural() {
  const marketRunnerSrc = fs.readFileSync(
    path.join(__dirname, "..", "scheduler", "marketRunner.js"),
    "utf8"
  );
  const schedulerSrc = fs.readFileSync(
    path.join(__dirname, "..", "scheduler", "scheduler.js"),
    "utf8"
  );
  const paperRunnerSrc = fs.readFileSync(
    path.join(__dirname, "..", "engine", "paperBinanceRunner.js"),
    "utf8"
  );

  // (A) The retired scheduler-level V1 cutover guard must be gone.
  //     scheduler.js no longer imports `isV1MarketRunnerDisabledByEnv`
  //     and no longer emits `v1_scheduler_market_skipped_legacy_runtime_disabled`.
  assert.ok(
    !schedulerSrc.includes("isV1MarketRunnerDisabledByEnv"),
    "(A1) scheduler.js must no longer import isV1MarketRunnerDisabledByEnv (guard retired 2026-04-29)"
  );
  assert.ok(
    !schedulerSrc.includes("v1_scheduler_market_skipped_legacy_runtime_disabled"),
    "(A2) scheduler.js must no longer emit the v1_scheduler_market_skipped_legacy_runtime_disabled log (guard retired)"
  );
  assert.ok(
    !schedulerSrc.includes("V1_SCHEDULER_LEGACY_RUNTIME_DISABLED"),
    "(A3) scheduler.js must no longer return V1_SCHEDULER_LEGACY_RUNTIME_DISABLED (guard retired)"
  );

  // (B) `runOneMarket` flows through unconditionally — no V1 guard
  //     wrapping it, so the F2 ENTRY generator inject inside
  //     paperBinanceRunner can fire.
  const runOneCallIdx = schedulerSrc.indexOf("await runOneMarket({");
  assert.ok(runOneCallIdx > 0, "(B1) runOneMarket call site not found in scheduler.js");
  // Look back ~3000 chars from the call: there must NOT be a guard
  // that short-circuits the loop with `continue;` on
  // legacy_runtime_disabled. (A normal try/catch is fine; we're
  // checking specifically that there is no V1 cutover skip.)
  const before = schedulerSrc.slice(Math.max(0, runOneCallIdx - 3000), runOneCallIdx);
  assert.ok(
    !/legacy_runtime_disabled[\s\S]{0,500}continue\s*;/i.test(before),
    "(B2) scheduler.js must not short-circuit runOneMarket on legacy_runtime_disabled"
  );

  // (C) The authoritative V1-trade denial lives at the writer boundary
  //     in paperBinanceRunner. This is the *real* safety layer.
  assert.ok(
    paperRunnerSrc.includes("V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED"),
    "(C1) paperBinanceRunner.js must define V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED"
  );
  assert.ok(
    paperRunnerSrc.includes("isV2DiscoveryCanaryLegacyExchangeWriteBlocked"),
    "(C2) paperBinanceRunner.js must call isV2DiscoveryCanaryLegacyExchangeWriteBlocked at the writer boundary"
  );

  // (D) runOneMarket itself must NOT carry the early-return guard
  //     (Stage T-hotfix invariant — V2 server-primary-tick must pass
  //     through cleanly).
  const runOneIdx = marketRunnerSrc.indexOf("async function runOneMarket(");
  assert.ok(runOneIdx > 0, "(D1) runOneMarket function not found");
  const bodyStart = marketRunnerSrc.indexOf(") {", runOneIdx);
  assert.ok(bodyStart > runOneIdx, "(D2) runOneMarket function body brace not found");
  const earlyBody = marketRunnerSrc.slice(bodyStart, bodyStart + 1200);
  assert.ok(
    !earlyBody.includes("isV1MarketRunnerDisabledByEnv(process.env)"),
    "(D3) runOneMarket must NOT call the guard internally — it would block V2 server-primary-tick + F2 generator inject"
  );
})();

// 2026-04-29 P0-2 Step 2.1 — `isV1MarketRunnerDisabledByEnv` helper
// fully retired (no callers, no exports). The previous (E) test
// kept the helper alive as dead code "for ad-hoc operator scripts";
// in practice the only effect of leaving it exported was that any
// future maintainer could rebuild the outer-guard pattern that
// 59edc900 removed (which had short-circuited the F2 server-native
// ENTRY signal generator inject for hours of operator silence). The
// helper, its export, and this preservation test are deleted; (A1)
// above already verifies scheduler.js does not import the name, and
// the writer-boundary denial in paperBinanceRunner.js:12120 remains
// the authoritative V1 trade blocker.
(function testHelperFullyRetired() {
  delete require.cache[require.resolve("../scheduler/marketRunner")];
  const mod = require("../scheduler/marketRunner");
  assert.strictEqual(mod.isV1MarketRunnerDisabledByEnv, undefined,
    "(E) isV1MarketRunnerDisabledByEnv must no longer be exported (helper retired 2026-04-29 P0-2)");
  const marketRunnerSrc = fs.readFileSync(
    path.join(__dirname, "..", "scheduler", "marketRunner.js"),
    "utf8"
  );
  assert.ok(
    !/function\s+isV1MarketRunnerDisabledByEnv\s*\(/.test(marketRunnerSrc),
    "(E) helper function definition must be removed from marketRunner.js"
  );
})();

console.log("V1_MARKET_RUNNER_LEGACY_DISABLED_SKIP_TEST_OK");
