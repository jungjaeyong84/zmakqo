"use strict";

const assert = require("assert");
const deploymentPlanReport = require("../../scripts/report-best-self-evolution-deployment-plan");
const authorityReport = require("../../scripts/report-self-evolution-authority-ensemble");
const loopMonitorReport = require("../../scripts/report-best-self-evolution-loop-monitor");

(() => {
  assert.strictEqual(
    authorityReport.__test.INPUTS.deploymentPlan,
    "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_plan_latest.json"
  );

  const authorityCycle = authorityReport.__test.resolveReportCycleId({
    deploymentPlan: { source_cycle_id: "cycle-source", cycle_id: "cycle-plan" },
    codexReview: { cycle_id: "cycle-codex" },
    claudeReview: { cycle_id: "cycle-claude" },
    fallbackCycleId: "cycle-fallback",
  });
  assert.strictEqual(authorityCycle, "cycle-source");

  const loopCycle = loopMonitorReport.__test.resolveReportCycleId({
    objectiveSupervisor: { source_cycle_id: "cycle-source", cycle_id: "cycle-objective" },
    deploymentPlan: { cycle_id: "cycle-plan" },
    fallbackCycleId: "cycle-fallback",
  });
  assert.strictEqual(loopCycle, "cycle-source");

  const deploymentCycle = deploymentPlanReport.__test.resolveReportCycleId({
    objectiveSupervisor: { cycle_id: "cycle-objective" },
    runtimeState: { cycle_id: "cycle-runtime" },
    fallbackCycleId: "cycle-fallback",
  });
  assert.strictEqual(deploymentCycle, "cycle-objective");

  console.log("SELF_EVOLUTION_REPORT_CYCLE_TEST_OK");
})();
