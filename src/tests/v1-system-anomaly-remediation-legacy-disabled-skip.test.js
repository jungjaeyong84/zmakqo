"use strict";

// 2026-04-29 Stage U-2 — V1 systemAnomalyRemediation skip test.
//
// Operator escalation: "V1 자체가 작동하면 안 되고 V2 가 모든 처리를
// 인계받아야 한다." After Stage T (V1 entry) and U-1 (V1 fast-lane
// exit), the remaining V1 emergency-exit channel was
// systemAnomalyRemediation.runSystemAnomalyRemediation, which uses
// runPaperFuturesForBar to flatten positions when the anomaly
// circuit breaker opens. Under DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1
// the V1 executor would reject every flatten order anyway, so the
// breaker-open path produces alert noise without actually flattening.
//
// Structural invariant pinned by this test:
//   (A) helper is invoked at the very start (after the breaker-open
//       check) so no V1 work happens before bailing
//   (B) reads DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED from process.env
//   (C) emits the structured skip log
//       v1_system_anomaly_remediation_skipped_legacy_runtime_disabled
//   (D) returns ok:true / skipped:true / reason
//       V1_SYSTEM_ANOMALY_REMEDIATION_LEGACY_RUNTIME_DISABLED

const assert = require("assert");
const fs = require("fs");

const FILE = require.resolve("../services/systemAnomalyRemediation");
const src = fs.readFileSync(FILE, "utf8");

function findFn(name) {
  const idx = src.indexOf(`async function ${name}(`);
  assert.ok(idx > 0, `${name} not found`);
  // body { begins after the closing ) of the param list
  const bodyStart = src.indexOf(") {", idx);
  // walk to closing brace (depth tracking from bodyStart)
  let depth = 0;
  let i = bodyStart + 2; // start at the {
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(bodyStart, i + 1);
}

function run() {
  const body = findFn("runSystemAnomalyRemediation");

  // (B) reads DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED
  assert.ok(
    body.includes("DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"),
    "(B) must read DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"
  );

  // (C) emits structured skip log
  assert.ok(
    body.includes("v1_system_anomaly_remediation_skipped_legacy_runtime_disabled"),
    "(C) must emit structured skip log"
  );

  // (D) returns the skip reason
  assert.ok(
    body.includes("V1_SYSTEM_ANOMALY_REMEDIATION_LEGACY_RUNTIME_DISABLED"),
    "(D) must return reason V1_SYSTEM_ANOMALY_REMEDIATION_LEGACY_RUNTIME_DISABLED"
  );

  // (A) the legacyRuntimeDisabled guard must precede the for-of loop
  //     over activePositions (which is where V1 invocation begins).
  const guardIdx = body.indexOf("legacyRuntimeDisabled");
  const loopIdx = body.indexOf("for (const position of activePositions)");
  assert.ok(guardIdx > 0 && loopIdx > 0, "(A) anchors not found");
  assert.ok(
    guardIdx < loopIdx,
    "(A) legacyRuntimeDisabled guard must precede the activePositions loop"
  );

  // (E) The breaker-closed early-return must precede the
  //     legacyRuntimeDisabled guard so anomaly_reason is initialized.
  const breakerIdx = body.indexOf('reason: "SYSTEM_ANOMALY_BREAKER_CLOSED"');
  assert.ok(breakerIdx > 0, "(E) breaker-closed branch not found");
  assert.ok(
    breakerIdx < guardIdx,
    "(E) breaker-closed early return must precede legacy guard"
  );
}

try {
  run();
  console.log("V1_SYSTEM_ANOMALY_REMEDIATION_LEGACY_DISABLED_SKIP_TEST_OK");
} catch (err) {
  console.error("V1_SYSTEM_ANOMALY_REMEDIATION_LEGACY_DISABLED_SKIP_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
