"use strict";

// Regression guard for the 2026-04-20 ETHUSDT incident:
//   "signal dropped / server signal 미생성 주원인:
//    Cannot access 'nextMeta' before initialization"
//
// Root cause: inside the live-execution branch of paperBinanceRunner.js,
// `buildNativeProtectionMetaPatch` was called with `posMeta: nextMeta`
// ~300 lines BEFORE the matching `let nextMeta = mergeMeta(posMeta, …)`
// declaration in the same for-iteration block. JavaScript hoists a TDZ
// binding for `let`/`const` across the enclosing block, so the reference
// threw at runtime, signal generation aborted, and webhooks dropped.
//
// What this test does
// -------------------
// It runs the standalone TDZ audit tool (scripts/audit-tdz-traps.js) on
// paperBinanceRunner.js and FAILS if the tool reports any findings. The
// tool is a scope-aware "use-before-let/const" scanner shared with
// project-wide audits — see scripts/audit-tdz-traps.js for what it does
// and doesn't catch (e.g. closure deferred-execution patterns are skipped
// to avoid false positives that drown the real signal).
//
// The file name is kept (instead of renaming to a generic "tdz audit"
// title) because it is referenced by package.json `test` script — a
// rename would break that pin without value. The audit it performs is no
// longer specific to `nextMeta`; any future use-before-let/const trap in
// the file will fail the test.

const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCANNER = path.join(REPO_ROOT, "scripts", "audit-tdz-traps.js");
const TARGET = path.join(REPO_ROOT, "src", "engine", "paperBinanceRunner.js");

const result = spawnSync(process.execPath, [SCANNER, TARGET], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});

assert.strictEqual(
  result.status,
  0,
  `TDZ AUDIT FAILED for src/engine/paperBinanceRunner.js — the scanner ` +
  `found a "let X" / "const X" reference that appears textually above ` +
  `its declaration within the same enclosing block (the 2026-04-20 ` +
  `ETHUSDT incident pattern). Run "node scripts/audit-tdz-traps.js ` +
  `src/engine/paperBinanceRunner.js" for the offending line(s). If the ` +
  `finding is a false positive (sub-block re-declaration with shadowing, ` +
  `or closure deferred-execution), document it and adjust the scanner — ` +
  `do not silence this guard.\n\n` +
  `Scanner stdout:\n${result.stdout || "(empty)"}\n` +
  `Scanner stderr:\n${result.stderr || "(empty)"}\n` +
  `Exit code: ${result.status}`
);

// Sanity check on the scanner output so the test fails loudly if the
// invocation succeeded for the wrong reason (e.g. scanner crashed but
// returned 0 somehow).
assert.ok(
  /TDZ_AUDIT_OK/.test(result.stdout || ""),
  `Scanner returned exit code 0 but did not print TDZ_AUDIT_OK — ` +
  `something is wrong with the scanner itself.\nstdout: ${result.stdout}\n`
);

console.log("PAPER_BINANCE_RUNNER_NEXTMETA_TDZ_TEST_OK");
