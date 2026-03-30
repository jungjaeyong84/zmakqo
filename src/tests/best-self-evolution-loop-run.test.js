"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-self-evolution-loop");

(() => {
  const steps = __test.buildStepPlan();
  assert.strictEqual(Array.isArray(steps), true);
  assert.strictEqual(steps[0].id, "dataset");
  assert.strictEqual(steps[steps.length - 1].id, "stage_autopilot");
  assert.strictEqual(steps.some((row) => row.id === "objective_seed"), true);
  assert.strictEqual(steps.some((row) => row.id === "codex_patch_engine"), true);
  assert.strictEqual(steps.some((row) => row.id === "filter_shadow_canary"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_final"), true);
  assert.strictEqual(steps.findIndex((row) => row.id === "loop_monitor") < steps.findIndex((row) => row.id === "stage_autopilot"), true);

  const parsed = __test.extractJson("x\n{\"ok\":true,\"step\":\"dataset\"}\n");
  assert.deepStrictEqual(parsed, { ok: true, step: "dataset" });

  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 22:00:00 KST",
    cycle_id: "cycle-1",
    status: "PASS",
    completed_steps: 17,
    total_steps: 17,
    failed_step: null,
    steps: [{ id: "dataset", status: "PASS", script: "x.js", exit_code: 0, summary: "OK" }],
  });
  assert.match(md, /cycle-1/);
  assert.match(md, /completed_steps: 17 \/ 17/);
  console.log("BEST_SELF_EVOLUTION_LOOP_RUN_TEST_OK");
})();
