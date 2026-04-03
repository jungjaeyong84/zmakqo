"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-openclaw-hourly-cycle");

(() => {
  const registry = __test.buildStepRegistry();
  assert.ok(Array.isArray(registry));
  assert.strictEqual(registry.length, 10);

  const ids = registry.map((row) => row.id);
  assert.deepStrictEqual(ids, [
    "analytics_local_cache",
    "signal_lineage_health",
    "doc_artifact_parity",
    "server_signal_drift_remediation_plan",
    "server_signal_drift_remediation_apply",
    "server_signal_post_remediation_refresh",
    "automation_watchdog",
    "self_evolution_loop",
    "current_version_pine_sync",
    "hourly_overall_report",
  ]);

  const applyStep = registry.find((row) => row.id === "server_signal_drift_remediation_apply");
  assert.deepStrictEqual(applyStep.depends_on, ["server_signal_drift_remediation_plan"]);
  assert.strictEqual(applyStep.produces_artifact, "server_signal_drift_remediation_apply_latest.json");

  const watchdogStep = registry.find((row) => row.id === "automation_watchdog");
  assert.deepStrictEqual(watchdogStep.depends_on, ["server_signal_post_remediation_refresh"]);
  assert.strictEqual(watchdogStep.produces_artifact, "automation_watchdog_latest.json");

  const result = __test.toStepResult(
    {
      id: "x",
      criticality: "HIGH",
      depends_on: ["a"],
      produces_artifact: "foo.json",
    },
    {
      status: "PASS",
      summary: "OK",
    }
  );
  assert.deepStrictEqual(result, {
    id: "x",
    status: "PASS",
    summary: "OK",
    criticality: "HIGH",
    depends_on: ["a"],
    produces_artifact: "foo.json",
  });

  console.log("AUTOMATION_OPENCLAW_HOURLY_CYCLE_TEST_OK");
})();
