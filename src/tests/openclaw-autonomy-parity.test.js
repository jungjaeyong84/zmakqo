"use strict";

const assert = require("assert");
const { buildAutonomyParity } = require("../../src/utils/openclawAutonomyParity");

(() => {
  const report = buildAutonomyParity({
    autonomyContract: { summary: { authority_state: "PENDING" } },
    objectiveSupervisor: { verdict: "HOLD", root_cause: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK" },
    quality: { summary: { final_downstream_mismatch_n: 12 } },
    cutover: { summary: { readiness_status: "SERVER_PRIMARY_ACTIVE" } },
    policyPlan: { summary: { current_objective_score: -2.5 } },
    reasoningJournal: { summary: { entry_n: 3, contradiction_n: 0, verified_n: 2, not_met_n: 1, verification_rate: 0.6667 } },
  });

  assert.strictEqual(report.summary.current_authority_state, "PENDING");
  assert.strictEqual(report.summary.current_objective_score, -2.5);
  assert.strictEqual(report.summary.next_milestone, "objective_score_non_negative");
  assert.strictEqual(report.requirements.find((row) => row.id === "server_primary_active").status, "DONE");
  assert.strictEqual(report.requirements.find((row) => row.id === "reasoning_journal_consistency").status, "PARTIAL");
  assert.strictEqual(report.requirements.find((row) => row.id === "reasoning_verification_quality").status, "PARTIAL");
  assert.strictEqual(report.requirements.find((row) => row.id === "authority_state_ready").status, "PARTIAL");

  console.log("OPENCLAW_AUTONOMY_PARITY_TEST_OK");
})();
