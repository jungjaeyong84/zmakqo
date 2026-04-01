"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-self-evolution-loop");

(() => {
  const steps = __test.buildStepPlan();
  assert.strictEqual(Array.isArray(steps), true);
  assert.strictEqual(steps[0].id, "dataset");
  assert.strictEqual(steps[steps.length - 1].id, "stage_autopilot");
  assert.strictEqual(steps[1].id, "canonical_engine_parity");
  assert.strictEqual(steps[2].id, "canonical_engine_provenance");
  assert.strictEqual(steps[3].id, "server_primary_canary");
  assert.strictEqual(steps[4].id, "server_primary_acceptance_watch");
  assert.strictEqual(steps[5].id, "pine_shadow_drift");
  assert.strictEqual(steps.some((row) => row.id === "objective_seed"), true);
  assert.strictEqual(steps.some((row) => row.id === "openclaw_autonomy_contract"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_recovery_governor"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_recovery_effect"), true);
  assert.strictEqual(steps.some((row) => row.id === "codex_patch_engine"), true);
  assert.strictEqual(steps.some((row) => row.id === "claude_patch_engine"), true);
  assert.strictEqual(steps.some((row) => row.id === "authority_ensemble"), true);
  assert.strictEqual(steps.some((row) => row.id === "filter_shadow_canary"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_final"), true);
  assert.strictEqual(steps.find((row) => row.id === "deployment_plan").env.SELF_EVOLUTION_SYNC_LIVE_SERVICES, "0");
  assert.strictEqual(steps.findIndex((row) => row.id === "loop_monitor") < steps.findIndex((row) => row.id === "stage_autopilot"), true);
  assert.strictEqual(steps.findIndex((row) => row.id === "authority_ensemble") < steps.findIndex((row) => row.id === "deployment_plan"), true);

  const parsed = __test.extractJson("x\n{\"ok\":true,\"step\":\"dataset\"}\n");
  assert.deepStrictEqual(parsed, { ok: true, step: "dataset" });

  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 22:00:00 KST",
    cycle_id: "cycle-1",
    status: "PASS",
    completed_steps: 30,
    total_steps: 30,
    failed_step: null,
    steps: [{ id: "dataset", status: "PASS", script: "x.js", exit_code: 0, summary: "OK" }],
  });
  assert.match(md, /cycle-1/);
  assert.match(md, /completed_steps: 30 \/ 30/);
  console.log("BEST_SELF_EVOLUTION_LOOP_RUN_TEST_OK");
})();
