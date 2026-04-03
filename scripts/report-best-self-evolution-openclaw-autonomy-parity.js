#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildAutonomyParity } = require("../src/utils/openclawAutonomyParity");

loadLocalEnv();

const INPUTS = Object.freeze({
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  quality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  cutover: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  policyPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json"),
  reasoningJournal: path.join(OPS_DAILY_DIR, "best_self_evolution_reasoning_journal_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  const lines = [
    "# BEST OpenClaw Autonomy Parity",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- target: ${summary.target || "N/A"}`,
    `- progress_pct: ${summary.overall_progress_pct ?? "N/A"}`,
    `- done/partial/fail/not_started: ${summary.done_n ?? 0} / ${summary.partial_n ?? 0} / ${summary.fail_n ?? 0} / ${summary.not_started_n ?? 0}`,
    `- authority_state: ${summary.current_authority_state || "N/A"}`,
    `- objective_score/verdict: ${summary.current_objective_score != null ? summary.current_objective_score : "N/A"} / ${summary.current_objective_verdict || "N/A"}`,
    `- final_downstream_mismatch_n: ${summary.current_final_downstream_mismatch_n != null ? summary.current_final_downstream_mismatch_n : "N/A"}`,
    `- reasoning entries/contradictions: ${summary.reasoning_entry_n ?? 0} / ${summary.reasoning_contradiction_n ?? 0}`,
    `- next_milestone: ${summary.next_milestone || "N/A"}`,
    "",
    "## Requirements",
  ];
  for (const row of requirements) {
    lines.push(`- ${row.id}: ${row.status} / criterion=${row.criterion} / current=${row.current == null ? "N/A" : row.current} / blocker=${row.blocker || "none"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = buildAutonomyParity({
    autonomyContract: readJsonRawSafe(INPUTS.autonomyContract, null),
    objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
    quality: readJsonRawSafe(INPUTS.quality, null),
    cutover: readJsonRawSafe(INPUTS.cutover, null),
    policyPlan: readJsonRawSafe(INPUTS.policyPlan, null),
    reasoningJournal: readJsonRawSafe(INPUTS.reasoningJournal, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    ...report,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_openclaw_autonomy_parity.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_openclaw_autonomy_parity.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_parity_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_parity_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("openclaw_autonomy_parity_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("openclaw_autonomy_parity_latest.md"));
  console.log(JSON.stringify({
    ok: true,
    cycle_id: output.cycle_id,
    progress_pct: output.summary.overall_progress_pct,
    next_milestone: output.summary.next_milestone,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_OPENCLAW_AUTONOMY_PARITY_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
