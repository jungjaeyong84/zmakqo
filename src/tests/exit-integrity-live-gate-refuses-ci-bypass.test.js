"use strict";

// 2026-04-18 P1-3: the live pre-deploy gate must refuse the CI bypass env
// var. The CI gate (`check:binance-exit-integrity-gate`) intentionally
// honors `EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1` because the CI step has no
// exchange credentials. The live gate is a separate entry point that must
// fail-closed when that bypass leaks into its env.

const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const SCRIPT = path.resolve(__dirname, "../../scripts/check-binance-exit-integrity-live-gate.js");

function runLiveGate(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...env, NODE_ENV: "test" },
    encoding: "utf8",
    // timeout at 10s — we only care about the fast-path bypass rejection;
    // the full gate requires Firestore and exchange IO which tests do not
    // have access to.
    timeout: 10000,
  });
}

(function liveGateRejectsCiBypassEnvOne() {
  const env = { ...process.env, EXIT_INTEGRITY_CI_NO_EXCHANGE_IO: "1" };
  const result = runLiveGate(env);
  assert.strictEqual(result.status, 1,
    "live gate must exit 1 when EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1 is set");
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  assert.ok(combined.includes("LIVE_GATE_REFUSES_CI_BYPASS"),
    `output must include the explicit refusal reason; got:\n${combined}`);
})();

(function liveGateRejectsCiBypassAnyTruthyValue() {
  // defensive: any non-empty, non-"0" value must trip the refusal
  const env = { ...process.env, EXIT_INTEGRITY_CI_NO_EXCHANGE_IO: "true" };
  const result = runLiveGate(env);
  assert.strictEqual(result.status, 1,
    "live gate must refuse truthy bypass values beyond literal '1'");
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  assert.ok(combined.includes("LIVE_GATE_REFUSES_CI_BYPASS"));
})();

(function liveGateAcceptsExplicitZero() {
  // a literal "0" is treated as not-set for the refusal check
  const { rejectCiBypass, CI_BYPASS_ENV } = require("../../scripts/check-binance-exit-integrity-live-gate");
  const prev = process.env[CI_BYPASS_ENV];
  process.env[CI_BYPASS_ENV] = "0";
  try {
    // should not throw / process.exit — the guard treats "0" as unset
    rejectCiBypass();
  } finally {
    if (prev == null) delete process.env[CI_BYPASS_ENV];
    else process.env[CI_BYPASS_ENV] = prev;
  }
})();

(function liveGateAcceptsUnset() {
  const { rejectCiBypass, CI_BYPASS_ENV } = require("../../scripts/check-binance-exit-integrity-live-gate");
  const prev = process.env[CI_BYPASS_ENV];
  delete process.env[CI_BYPASS_ENV];
  try {
    rejectCiBypass();
  } finally {
    if (prev != null) process.env[CI_BYPASS_ENV] = prev;
  }
})();

console.log("EXIT_INTEGRITY_LIVE_GATE_REFUSES_CI_BYPASS_TEST_OK");
