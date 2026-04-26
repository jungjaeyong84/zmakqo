"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function readText(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), "utf8");
}

function has(source, pattern) {
  return String(source || "").includes(pattern);
}

function buildCheck(id, ok, detail = {}) {
  return Object.freeze({
    id,
    ok: ok === true,
    detail: Object.freeze({ ...detail }),
  });
}

function runCheck() {
  const cloudbuild = readText("cloudbuild.yaml");
  const submit = readText("scripts/submit-v2-promotion-cloudbuild.js");
  const preflight = readText("scripts/run-v2-discovery-canary-preflight-deploy.js");
  const runner = readText("src/engine/paperBinanceRunner.js");
  const bridgeTest = readText("src/tests/v2-discovery-live-bridge.test.js");
  const manifestTest = readText("src/tests/check-v2-runtime-discovery-canary-manifest.test.js");

  const checks = [
    buildCheck(
      "CLOUDBUILD_LEGACY_WAIT_HARD_DROP_DISABLED_DEFAULT",
      has(cloudbuild, '_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "1"')
    ),
    buildCheck(
      "SUBMIT_FORCES_LEGACY_WAIT_HARD_DROP_DISABLED",
      has(submit, '_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "1"')
    ),
    buildCheck(
      "PREFLIGHT_FORCES_LEGACY_WAIT_HARD_DROP_DISABLED",
      has(preflight, '_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "1"')
    ),
    buildCheck(
      "DISCOVERY_BRIDGE_BLOCKS_IF_LEGACY_WAIT_NOT_RETIRED",
      has(runner, "V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WAIT_ONE_BAR_HARD_DROP_NOT_RETIRED")
    ),
    buildCheck(
      "DISCOVERY_BRIDGE_MAKES_LEGACY_WAIT_ADVISORY_ONLY",
      has(runner, "wait_one_bar_v2_discovery_advisory_only")
        && has(runner, "wait_one_bar_legacy_hard_drop_bypassed")
        && has(runner, "shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery")
    ),
    buildCheck(
      "DISCOVERY_WAIT_ADVISORY_TEST_PRESENT",
      has(bridgeTest, "discoveryBridgeMakesLegacyWaitOneBarAdvisoryOnly")
    ),
    buildCheck(
      "RUNTIME_MANIFEST_REQUIRES_LEGACY_WAIT_RETIRED",
      has(manifestTest, "DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED")
    ),
  ];

  const failed = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0
      ? "V2_LEGACY_WAIT_RETIREMENT_PASS"
      : "V2_LEGACY_WAIT_RETIREMENT_BLOCKED",
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    checks: Object.freeze(checks),
  });
}

if (require.main === module) {
  const result = runCheck();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

module.exports = { runCheck };
