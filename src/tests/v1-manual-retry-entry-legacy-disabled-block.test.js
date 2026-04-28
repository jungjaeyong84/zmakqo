"use strict";

// 2026-04-29 Stage U-3 — V1 manual-retry-entry block test.
//
// Operator escalation: "V1 자체가 작동하면 안 되고 V2 가 모든 처리를
// 인계받아야 한다." After Stage T (V1 entry), U-1 (V1 fast-lane), and
// U-2 (V1 anomaly flatten), the remaining V1 entry-side channel was
// the operator-facing /api/trading/manual-retry-entry endpoint, which
// invokes runPaperFuturesForBar to retry a missed entry.
//
// Under DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1 the V1 executor would
// reject the order anyway. Rather than producing a confusing 500 with
// "V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED" buried inside,
// the endpoint now returns a clear 503 with explicit error code
// V1_MANUAL_RETRY_LEGACY_RUNTIME_DISABLED so the operator UI can
// surface a useful message ("use exchange UI directly").
//
// Structural invariant pinned by this test:
//   (A) the legacy guard is the very first action inside the handler
//       (before body parse, before market validation, before any I/O)
//   (B) reads DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED
//   (C) emits structured log v1_manual_retry_entry_blocked_legacy_runtime_disabled
//   (D) returns 503 with error V1_MANUAL_RETRY_LEGACY_RUNTIME_DISABLED

const assert = require("assert");
const fs = require("fs");

const FILE = require.resolve("../routes/trading.actions.routes");
const src = fs.readFileSync(FILE, "utf8");

function findHandlerBody(route) {
  // Locate router.post("<route>", async (req, res) => { ... }) body.
  // We slice from the route's signature to the next router.post (next
  // route) boundary — sufficient region for our structural checks.
  const sig = `router.post("${route}", async (req, res) => {`;
  const idx = src.indexOf(sig);
  assert.ok(idx > 0, `${route} handler not found`);
  const nextRouterIdx = src.indexOf("router.post(", idx + sig.length);
  const end = nextRouterIdx > idx ? nextRouterIdx : Math.min(src.length, idx + sig.length + 6000);
  return src.slice(idx, end);
}

function run() {
  const body = findHandlerBody("/api/trading/manual-retry-entry");

  // (B) reads env
  assert.ok(
    body.includes("DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"),
    "(B) handler must read DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"
  );

  // (C) structured log
  assert.ok(
    body.includes("v1_manual_retry_entry_blocked_legacy_runtime_disabled"),
    "(C) handler must emit structured block log"
  );

  // (D) 503 + error code
  assert.ok(
    body.includes('error: "V1_MANUAL_RETRY_LEGACY_RUNTIME_DISABLED"') ||
    body.includes("error: 'V1_MANUAL_RETRY_LEGACY_RUNTIME_DISABLED'"),
    "(D) handler must return error V1_MANUAL_RETRY_LEGACY_RUNTIME_DISABLED"
  );
  assert.ok(
    body.includes("status(503)"),
    "(D) handler must respond with HTTP 503"
  );

  // (A) the guard runs before runPaperFuturesForBar invocation. We
  //     anchor on `await runPaperFuturesForBar(` to skip the comment
  //     mention of the function name in the guard's own justification.
  const guardIdx = body.indexOf("legacyRuntimeDisabledNow");
  const v1CallIdx = body.indexOf("await runPaperFuturesForBar(");
  assert.ok(guardIdx > 0 && v1CallIdx > 0, "(A) anchors not found");
  assert.ok(
    guardIdx < v1CallIdx,
    "(A) legacy guard must precede runPaperFuturesForBar"
  );

  // (A.2) the guard runs before market validation (so the operator
  // gets the clear V2-runtime message regardless of market mistake).
  const marketCheckIdx = body.indexOf('"MARKET_REQUIRED"');
  assert.ok(marketCheckIdx > 0, "(A.2) MARKET_REQUIRED check not found");
  assert.ok(
    guardIdx < marketCheckIdx,
    "(A.2) legacy guard must precede MARKET_REQUIRED check"
  );
}

try {
  run();
  console.log("V1_MANUAL_RETRY_ENTRY_LEGACY_DISABLED_BLOCK_TEST_OK");
} catch (err) {
  console.error("V1_MANUAL_RETRY_ENTRY_LEGACY_DISABLED_BLOCK_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
