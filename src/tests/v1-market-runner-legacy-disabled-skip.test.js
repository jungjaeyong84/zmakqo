"use strict";

// 2026-04-29 — V1 market runner architectural skip test.
// 2026-04-28 Stage T-hotfix — guard moved from runOneMarket itself to
// the legacy scheduler call site (scheduler/scheduler.js) because the
// V2 server-primary tick (scripts/run-openclaw-server-primary-tick.js)
// also calls runOneMarket for bars-refresh + V2 server-signal
// generation, and the prior placement blocked that legitimate V2 path.
// runOneMarket no longer carries the guard; the guard now lives on
// the V1-only callers (legacy scheduler tick) so server-primary-tick
// passes through cleanly.
//
// Structural test:
//   (A) marketRunner.js exports `isV1MarketRunnerDisabledByEnv` so
//       legacy callers can apply it
//   (B) scheduler/scheduler.js imports the helper
//   (C) scheduler/scheduler.js applies the guard immediately before
//       its runOneMarket call site, emits the structured skip log,
//       and `continue`s the loop without running V1 logic
//   (D) marketRunner.js no longer has an early-return guard inside
//       runOneMarket itself (so V2 server-primary-tick can pass)

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

  // (A) helper exists + reads env + is exported
  assert.ok(
    marketRunnerSrc.includes("function isV1MarketRunnerDisabledByEnv"),
    "(A) isV1MarketRunnerDisabledByEnv helper must exist in marketRunner.js"
  );
  assert.ok(
    marketRunnerSrc.includes("DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"),
    "(A) helper must read DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"
  );
  assert.ok(
    /module\.exports\s*=\s*\{[\s\S]*isV1MarketRunnerDisabledByEnv[\s\S]*\}/.test(marketRunnerSrc),
    "(A) marketRunner.js must export isV1MarketRunnerDisabledByEnv"
  );

  // (B) scheduler.js imports the helper
  assert.ok(
    schedulerSrc.includes("isV1MarketRunnerDisabledByEnv"),
    "(B) scheduler.js must import isV1MarketRunnerDisabledByEnv"
  );

  // (C) scheduler.js applies the guard right before its runOneMarket
  //     call site. Locate the runOneMarket call and require the guard
  //     to appear within the immediate preceding ~1500 chars.
  const runOneCallIdx = schedulerSrc.indexOf("await runOneMarket({");
  assert.ok(runOneCallIdx > 0, "(C) runOneMarket call site not found in scheduler.js");
  const region = schedulerSrc.slice(Math.max(0, runOneCallIdx - 1500), runOneCallIdx);
  assert.ok(
    region.includes("isV1MarketRunnerDisabledByEnv(process.env)"),
    "(C) scheduler.js must check isV1MarketRunnerDisabledByEnv before runOneMarket"
  );
  assert.ok(
    region.includes("v1_scheduler_market_skipped_legacy_runtime_disabled"),
    "(C) scheduler.js skip branch must emit structured skip log"
  );
  assert.ok(
    region.includes("V1_SCHEDULER_LEGACY_RUNTIME_DISABLED"),
    "(C) scheduler.js skip return reason must be V1_SCHEDULER_LEGACY_RUNTIME_DISABLED"
  );
  assert.ok(
    region.includes("continue;"),
    "(C) skip branch must continue the loop without running V1 logic"
  );

  // (D) runOneMarket itself must NOT carry the early-return guard any
  //     more — that placement also blocked V2 server-primary-tick.
  const runOneIdx = marketRunnerSrc.indexOf("async function runOneMarket(");
  assert.ok(runOneIdx > 0, "runOneMarket function not found");
  const bodyStart = marketRunnerSrc.indexOf(") {", runOneIdx);
  assert.ok(bodyStart > runOneIdx, "runOneMarket function body brace not found");
  const earlyBody = marketRunnerSrc.slice(bodyStart, bodyStart + 1200);
  assert.ok(
    !earlyBody.includes("isV1MarketRunnerDisabledByEnv(process.env)"),
    "(D) runOneMarket must NOT call the guard internally — it would block V2 server-primary-tick"
  );
})();

(function testHelperRuntime() {
  // Reload after env to test helper directly via export.
  delete require.cache[require.resolve("../scheduler/marketRunner")];
  const { isV1MarketRunnerDisabledByEnv } = require("../scheduler/marketRunner");
  assert.strictEqual(isV1MarketRunnerDisabledByEnv({}), false, "default OFF");
  assert.strictEqual(isV1MarketRunnerDisabledByEnv({ DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "0" }), false, "explicit 0");
  for (const truthy of ["1", "true", "yes", "on", "TRUE", "ON"]) {
    assert.strictEqual(
      isV1MarketRunnerDisabledByEnv({ DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: truthy }),
      true,
      `truthy=${truthy}`
    );
  }
})();

console.log("V1_MARKET_RUNNER_LEGACY_DISABLED_SKIP_TEST_OK");
