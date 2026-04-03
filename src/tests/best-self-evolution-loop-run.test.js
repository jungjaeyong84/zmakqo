"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-self-evolution-loop");

(() => {
  const capabilities = __test.loadCapabilityManifest();
  assert.strictEqual(Array.isArray(capabilities), true);
  assert.strictEqual(capabilities.some((row) => row.id === "ev_gate_rescue"), true);

  const steps = __test.buildStepPlan();
  assert.strictEqual(Array.isArray(steps), true);
  assert.strictEqual(steps[0].id, "dataset");
  assert.strictEqual(steps[steps.length - 1].id, "stage_autopilot");
  assert.strictEqual(steps[1].id, "canonical_engine_parity");
  assert.strictEqual(steps[2].id, "server_signal_authority");
  assert.strictEqual(steps[3].id, "server_signal_quality");
  assert.strictEqual(steps[4].id, "server_signal_runtime");
  assert.strictEqual(steps[5].id, "server_signal_cutover_readiness");
  assert.strictEqual(steps.some((row) => row.id === "canonical_engine_provenance"), true);
  assert.strictEqual(steps.some((row) => row.id === "server_primary_canary"), true);
  assert.strictEqual(steps.some((row) => row.id === "server_primary_acceptance_watch"), true);
  assert.strictEqual(steps.some((row) => row.id === "pine_shadow_drift"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_seed"), true);
  assert.strictEqual(steps.some((row) => row.id === "openclaw_autonomy_contract"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_recovery_governor"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_recovery_effect"), true);
  assert.strictEqual(steps.some((row) => row.id === "codex_patch_engine"), true);
  assert.strictEqual(steps.some((row) => row.id === "claude_patch_engine"), true);
  assert.strictEqual(steps.some((row) => row.id === "authority_ensemble"), true);
  assert.strictEqual(steps.some((row) => row.id === "filter_shadow_canary"), true);
  assert.strictEqual(steps.some((row) => row.id === "objective_final"), true);
  assert.strictEqual(steps.some((row) => row.id === "reasoning_journal"), true);
  assert.strictEqual(steps.some((row) => row.id === "server_signal_observation_24h_context"), false);
  assert.strictEqual(steps.find((row) => row.id === "deployment_plan").env.SELF_EVOLUTION_SYNC_LIVE_SERVICES, "0");
  assert.strictEqual(steps.findIndex((row) => row.id === "loop_monitor") < steps.findIndex((row) => row.id === "stage_autopilot"), true);
  assert.strictEqual(steps.findIndex((row) => row.id === "authority_ensemble") < steps.findIndex((row) => row.id === "deployment_plan"), true);
  assert.strictEqual(steps.findIndex((row) => row.id === "objective_final") < steps.findIndex((row) => row.id === "reasoning_journal"), true);
  assert.strictEqual(steps.findIndex((row) => row.id === "reasoning_journal") < steps.findIndex((row) => row.id === "loop_monitor"), true);

  const evSteps = __test.buildStepPlan({
    dominant_mismatch_family: "EV_POLICY",
    quality_status: "WATCH_PARITY_DRIFT",
    needs_signal_deep_dive: true,
    needs_ev_policy_deep_dive: true,
    authority_state: "PENDING",
  });
  assert.strictEqual(evSteps.some((row) => row.id === "server_signal_observation_24h_context"), true);
  assert.strictEqual(evSteps.some((row) => row.id === "server_signal_drift_remediation_plan_context"), true);
  assert.strictEqual(evSteps.some((row) => row.id === "ev_gate_rescue"), true);
  assert.strictEqual(evSteps.find((row) => row.id === "ev_gate_rescue").contextual, true);
  assert.strictEqual(evSteps.findIndex((row) => row.id === "server_signal_observation_24h_context") < evSteps.findIndex((row) => row.id === "drop_validation"), true);
  assert.strictEqual(evSteps.find((row) => row.id === "ev_gate_rescue").capability_id, "ev_gate_rescue");

  const neutralSteps = __test.buildStepPlan({
    dominant_mismatch_family: "NONE",
    quality_status: "PASS",
    needs_signal_deep_dive: false,
    needs_ev_policy_deep_dive: false,
    authority_state: "PENDING",
  });
  assert.strictEqual(neutralSteps.some((row) => row.id === "server_signal_observation_24h_context"), false);
  assert.strictEqual(neutralSteps.some((row) => row.id === "ev_gate_rescue"), false);

  assert.strictEqual(
    __test.capabilityMatches(
      {
        trigger: {
          needs_signal_deep_dive: true,
          authority_state_in: ["PENDING"],
          dominant_mismatch_family_in: ["EV_POLICY"],
        },
      },
      {
        needs_signal_deep_dive: true,
        authority_state: "PENDING",
        dominant_mismatch_family: "EV_POLICY",
      }
    ),
    true
  );

  const parsed = __test.extractJson("x\n{\"ok\":true,\"step\":\"dataset\"}\n");
  assert.deepStrictEqual(parsed, { ok: true, step: "dataset" });

  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 22:00:00 KST",
    cycle_id: "cycle-1",
    status: "PASS",
    completed_steps: 34,
    total_steps: 34,
    failed_step: null,
    steps: [{ id: "dataset", status: "PASS", script: "x.js", exit_code: 0, summary: "OK" }],
  });
  assert.match(md, /cycle-1/);
  assert.match(md, /completed_steps: 34 \/ 34/);
  console.log("BEST_SELF_EVOLUTION_LOOP_RUN_TEST_OK");
})();
