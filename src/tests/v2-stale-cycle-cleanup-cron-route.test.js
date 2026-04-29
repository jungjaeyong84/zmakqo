"use strict";

// 2026-04-30 P0-fix-G follow-up — v2-stale-cycle-cleanup cron route
// shape pin.
//
// Pre-existing pattern in this repo: cron routes are simple
// adapters over a script's main(). This test pins the route shape
// without exercising live Firestore — we only check the file
// contents to confirm the wiring is correct.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "routes", "openclaw.cron.routes.js"),
  "utf8"
);

// (A) route registered
(function testRouteRegistered() {
  assert.ok(
    /router\.post\(\s*"\/api\/openclaw\/cron\/v2-stale-cycle-cleanup"/.test(SRC),
    "(A1) /api/openclaw/cron/v2-stale-cycle-cleanup route must be registered"
  );
  assert.ok(
    /v2-stale-cycle-cleanup[\s\S]{0,500}requireSchedulerToken/.test(SRC),
    "(A2) route must require scheduler token (auth)"
  );
})();

// (B) delegates to the cleanup script's main()
(function testDelegation() {
  assert.ok(
    /v2-stale-cycle-cleanup[\s\S]{0,800}cleanup-stale-active-protected-cycles/.test(SRC),
    "(B1) route must delegate to scripts/cleanup-stale-active-protected-cycles.js"
  );
})();

// (C) operator-gated apply via env var
//
// Pin the operator-gating posture: the script's --apply flag is
// driven by V2_STALE_CYCLE_CLEANUP_APPLY env var, default OFF
// (diagnose only). This is the staged-rollout pattern — first
// observe in production, flip env to enable mutation after the
// classifier behaviour is confirmed safe.
(function testApplyGating() {
  assert.ok(
    /V2_STALE_CYCLE_CLEANUP_APPLY/.test(SRC),
    "(C1) route must gate apply via V2_STALE_CYCLE_CLEANUP_APPLY env var"
  );
  // Diagnose default — at least one of the truthy keywords ("1",
  // "true", "yes", "on") must trigger apply, with anything else
  // falling through to diagnose-only.
  assert.ok(
    /apply.*===.*"1"[\s\S]{0,200}===.*"true"/.test(SRC)
    || /\["1",\s*"true",\s*"yes"/.test(SRC)
    || /applyRaw === "1"[\s\S]{0,150}applyRaw === "true"/.test(SRC),
    "(C2) apply truthy comparison must accept 1/true/yes as enabling values"
  );
})();

// (D) timeout protection
(function testTimeout() {
  assert.ok(
    /v2-stale-cycle-cleanup[\s\S]{0,800}runWithShortTimeout[\s\S]{0,500}\d{5,7}/.test(SRC),
    "(D1) route must use runWithShortTimeout with a finite timeout (script can take up to ~3 min on a saturated board)"
  );
})();

// (E) apply_mode propagated in response
//
// Operators reading the cron response need to see whether the run
// was DIAGNOSE_ONLY or APPLY so they can correlate write_n with
// the gating env var.
(function testResponseShape() {
  assert.ok(
    /apply_mode:\s*apply\s*\?\s*"APPLY"\s*:\s*"DIAGNOSE_ONLY"/.test(SRC),
    "(E1) response must include apply_mode field for operator visibility"
  );
})();

console.log("V2_STALE_CYCLE_CLEANUP_CRON_ROUTE_TEST_OK");
