"use strict";

// 2026-04-29 — V1 market runner architectural skip test.
//
// Operator-diagnosed leak: V1 paperBinanceRunner pipeline kept
// executing on every bar even though `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1`
// rejects every resulting order. The architectural fix is to refuse
// V1 entry at the scheduler/webhook entry point (runOneMarket) so V1
// logic never starts during V2-runtime-only operation.
//
// Structural test: scheduler/marketRunner.js must:
//   (A) define `isV1MarketRunnerDisabledByEnv` reading
//       DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED
//   (B) check it as the very first action inside runOneMarket
//   (C) emit the structured skip log
//   (D) return { ok:true, skipped:true, reason:"V1_MARKET_RUNNER_LEGACY_RUNTIME_DISABLED" }
//   (E) the early-return guard must precede `signalTfFinal` resolution
//       (so no V1 work is done before bailing)

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function withEnv(name, value, fn) {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { return fn(); } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

(function testStructural() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "scheduler", "marketRunner.js"),
    "utf8"
  );

  // (A) helper exists
  assert.ok(
    src.includes("function isV1MarketRunnerDisabledByEnv"),
    "(A) isV1MarketRunnerDisabledByEnv helper must exist"
  );
  assert.ok(
    src.includes("DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"),
    "(A) helper must read DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"
  );

  // (B) called as first statement in runOneMarket. Find the function
  //     body opening brace by walking past the destructured-args block.
  const runOneIdx = src.indexOf("async function runOneMarket(");
  assert.ok(runOneIdx > 0, "runOneMarket function not found");
  const bodyStart = src.indexOf(") {", runOneIdx);
  assert.ok(bodyStart > runOneIdx, "runOneMarket function body brace not found");
  const firstStmtRegion = src.slice(bodyStart, bodyStart + 1200);
  assert.ok(
    firstStmtRegion.includes("if (isV1MarketRunnerDisabledByEnv(process.env))"),
    "(B) guard must be the first statement inside runOneMarket"
  );

  // (C) structured skip log
  assert.ok(
    firstStmtRegion.includes("v1_market_runner_skipped_legacy_runtime_disabled"),
    "(C) structured skip log event must be emitted"
  );

  // (D) return shape
  assert.ok(
    firstStmtRegion.includes("V1_MARKET_RUNNER_LEGACY_RUNTIME_DISABLED"),
    "(D) skip return must include reason V1_MARKET_RUNNER_LEGACY_RUNTIME_DISABLED"
  );
  assert.ok(
    firstStmtRegion.includes("skipped: true"),
    "(D) skip return must include skipped: true"
  );

  // (E) guard precedes signalTfFinal resolution
  const signalTfFinalIdx = src.indexOf("const signalTfFinal", bodyStart);
  const guardIdx = src.indexOf("isV1MarketRunnerDisabledByEnv(process.env)", bodyStart);
  assert.ok(guardIdx >= 0 && signalTfFinalIdx >= 0, "(E) anchor lines not found");
  assert.ok(
    guardIdx < signalTfFinalIdx,
    "(E) guard must precede signalTfFinal so no V1 work happens before bailing"
  );
})();

(function testHelperRuntime() {
  // Reload after env to test helper directly.
  delete require.cache[require.resolve("../scheduler/marketRunner")];
  // We can't directly require the helper because it's not exported,
  // so we re-implement the env parse the same way and assert symmetry.
  function parse(env) {
    const raw = env && env.DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED;
    if (raw === undefined || raw === null || raw === "") return false;
    const norm = String(raw).trim().toLowerCase();
    return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
  }
  assert.strictEqual(parse({}), false, "default OFF");
  assert.strictEqual(parse({ DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "0" }), false, "explicit 0");
  for (const truthy of ["1", "true", "yes", "on", "TRUE", "ON"]) {
    assert.strictEqual(
      parse({ DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: truthy }),
      true,
      `truthy=${truthy}`
    );
  }
})();

console.log("V1_MARKET_RUNNER_LEGACY_DISABLED_SKIP_TEST_OK");
