"use strict";

const assert = require("assert");
const {
  STOP_DIVERGENCE_CODES,
  buildStopDivergenceItems,
  deriveExitIntegrityExposureGuard,
} = require("../utils/exitIntegrityPolicy");

(() => {
  assert.strictEqual(STOP_DIVERGENCE_CODES.has("RUNNER_MIN_GUARANTEE_MISSED"), true);
  const items = buildStopDivergenceItems([
    "runner_min_guarantee_missed",
    "NATIVE_STOP_MISMATCH",
    "RUNNER_MIN_GUARANTEE_MISSED",
  ]);
  assert.deepStrictEqual(
    items.map((item) => item.code),
    ["RUNNER_MIN_GUARANTEE_MISSED", "NATIVE_STOP_MISMATCH"]
  );
  assert.strictEqual(items[0].display, "RUNNER_MIN_GUARANTEE_MISSED · 최소 보장 수익 미준수");
})();

(() => {
  const singleStrike = deriveExitIntegrityExposureGuard({
    status: "WARN",
    stop_divergence_gate: "BLOCK",
    stop_divergence_symbol_n: 3,
    live_gate_blocked: false,
  }, { blockedScale: 0.5 });
  assert.strictEqual(singleStrike.active, true);
  assert.strictEqual(singleStrike.scale, 0.75);
  assert.strictEqual(singleStrike.reason, "LIVE_POLICY_EXIT_INTEGRITY_SINGLE_STRIKE_SCALE");
  assert.strictEqual(singleStrike.issueStrikeCount, 1);

  const doubleStrike = deriveExitIntegrityExposureGuard({
    status: "WARN",
    stop_divergence_gate: "BLOCK",
    stop_divergence_symbol_n: 3,
    canonical_exit_stage_fail_n: 1,
    live_gate_blocked: false,
  }, { blockedScale: 0.5 });
  assert.strictEqual(doubleStrike.active, true);
  assert.strictEqual(doubleStrike.scale, 0.5);
  assert.strictEqual(doubleStrike.reason, "LIVE_POLICY_EXIT_INTEGRITY_DOUBLE_STRIKE_SCALE");
  assert.strictEqual(doubleStrike.issueStrikeCount, 2);

  const tripleStrike = deriveExitIntegrityExposureGuard({
    status: "WARN",
    stop_divergence_gate: "BLOCK",
    stop_divergence_symbol_n: 1,
    canonical_exit_stage_fail_n: 1,
    trail_floor_live_violation_n: 1,
    live_gate_blocked: true,
  }, { blockedScale: 0.5 });
  assert.strictEqual(tripleStrike.scale, 0);
  assert.strictEqual(tripleStrike.reason, "LIVE_POLICY_EXIT_INTEGRITY_TRIPLE_STRIKE_BLOCK");
  assert.strictEqual(tripleStrike.blockNewEntries, true);

  const pass = deriveExitIntegrityExposureGuard({
    status: "OK",
    stop_divergence_gate: "PASS",
    stop_divergence_symbol_n: 0,
    live_gate_blocked: false,
  }, { blockedScale: 0.5 });
  assert.strictEqual(pass.active, false);
  assert.strictEqual(pass.scale, 1);
})();

(() => {
  const missing = deriveExitIntegrityExposureGuard(
    { doc: null, mtimeMs: null, path: "/missing.json", present: false },
    { blockedScale: 0.5 }
  );
  assert.strictEqual(missing.active, true);
  assert.strictEqual(missing.scale, 0);
  assert.strictEqual(missing.blockNewEntries, true);
  assert.strictEqual(missing.reason, "LIVE_POLICY_EXIT_INTEGRITY_REPORT_MISSING");
  assert.strictEqual(missing.report_missing, true);

  const parseError = deriveExitIntegrityExposureGuard(
    { doc: null, mtimeMs: Date.now(), path: "/corrupt.json", present: true, parseError: true },
    { blockedScale: 0.5 }
  );
  assert.strictEqual(parseError.active, true);
  assert.strictEqual(parseError.scale, 0);
  assert.strictEqual(parseError.blockNewEntries, true);
  assert.strictEqual(parseError.reason, "LIVE_POLICY_EXIT_INTEGRITY_REPORT_PARSE_ERROR");

  const fixedNow = 2_000_000_000_000;
  const staleMtimeMs = fixedNow - (6 * 60 * 60 * 1000);
  const stale = deriveExitIntegrityExposureGuard(
    {
      doc: { summary: { status: "OK", reasons: [] } },
      mtimeMs: staleMtimeMs,
      path: "/stale.json",
      present: true,
    },
    { blockedScale: 0.5, maxAgeMs: 5 * 60 * 60 * 1000, now: fixedNow }
  );
  assert.strictEqual(stale.active, true);
  assert.strictEqual(stale.scale, 0);
  assert.strictEqual(stale.blockNewEntries, true);
  assert.strictEqual(stale.reason, "LIVE_POLICY_EXIT_INTEGRITY_REPORT_STALE");
  assert.strictEqual(stale.report_stale, true);

  const freshMtimeMs = fixedNow - (60 * 1000);
  const fresh = deriveExitIntegrityExposureGuard(
    {
      doc: { summary: { status: "OK", reasons: [] } },
      mtimeMs: freshMtimeMs,
      path: "/fresh.json",
      present: true,
    },
    { blockedScale: 0.5, maxAgeMs: 5 * 60 * 60 * 1000, now: fixedNow }
  );
  assert.strictEqual(fresh.active, false);
  assert.strictEqual(fresh.scale, 1);
  assert.strictEqual(fresh.blockNewEntries, false);
  assert.strictEqual(fresh.report_stale, false);

  const legacyDirect = deriveExitIntegrityExposureGuard(
    { status: "OK", stop_divergence_gate: "PASS", stop_divergence_symbol_n: 0 },
    { blockedScale: 0.5 }
  );
  assert.strictEqual(legacyDirect.scale, 1);
  assert.strictEqual(legacyDirect.report_missing, false);
})();

console.log("EXIT_INTEGRITY_POLICY_TEST_OK");
