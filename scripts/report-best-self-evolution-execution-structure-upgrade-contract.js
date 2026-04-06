#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildExecutionStructureUpgradeContract } = require("../src/utils/executionStructureUpgradeContract");

const INPUTS = Object.freeze({
  exitTrailingContract: path.join(OPS_DAILY_DIR, "best_self_evolution_exit_trailing_contract_latest.json"),
  objectiveRetrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
  evGateCompositePolicy: path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_composite_policy_latest.json"),
  modelReadiness: path.join(OPS_DAILY_DIR, "best_self_evolution_model_readiness_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Execution Structure Upgrade Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- structure_mode: ${summary.structure_mode || "N/A"}`,
    `- survivability_priority: ${summary.survivability_priority || "N/A"}`,
    `- stage_sequence_ready: ${summary.stage_sequence_ready ? "YES" : "NO"}`,
    `- survivability_ready: ${summary.survivability_ready ? "YES" : "NO"}`,
    `- label_support_ready: ${summary.label_support_ready ? "YES" : "NO"}`,
    `- tp0/tp1/trail: ${summary.tp0_stage_active ? "YES" : "NO"} / ${summary.tp1_stage_active ? "YES" : "NO"} / ${summary.trail_stage_active ? "YES" : "NO"}`,
    `- tp0_pct=${summary.tp0_pct != null ? summary.tp0_pct : "N/A"} / tp0_qty_ratio=${summary.tp0_qty_ratio != null ? summary.tp0_qty_ratio : "N/A"} / tp1_pct=${summary.tp1_pct != null ? summary.tp1_pct : "N/A"} / trail_r=${summary.trail_r_multiple != null ? summary.trail_r_multiple : "N/A"}`,
    `- microstructure: tp0_hit=${summary.tp0_hit_rate != null ? summary.tp0_hit_rate : "N/A"} / tp1_hit=${summary.tp1_hit_rate != null ? summary.tp1_hit_rate : "N/A"} / tp0_to_tp1=${summary.tp0_to_tp1_conversion_rate != null ? summary.tp0_to_tp1_conversion_rate : "N/A"} / pre_tp1_time_stop=${summary.pre_tp1_time_stop_rate != null ? summary.pre_tp1_time_stop_rate : "N/A"}`,
    `- label_support: tp0_time=${summary.model_tp0_time_labeled_n != null ? summary.model_tp0_time_labeled_n : "N/A"} / tp1_time=${summary.model_tp1_time_labeled_n != null ? summary.model_tp1_time_labeled_n : "N/A"} / converted=${summary.model_tp0_to_tp1_converted_n != null ? summary.model_tp0_to_tp1_converted_n : "N/A"} / pre_tp1_stop=${summary.model_pre_tp1_time_stop_n != null ? summary.model_pre_tp1_time_stop_n : "N/A"}`,
    "",
    "## Blocking Reasons",
    ...((summary.blocking_reasons || []).length
      ? summary.blocking_reasons.map((row) => `- ${row}`)
      : ["- none"]),
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildExecutionStructureUpgradeContract({
    exitTrailingContract: readJsonRawSafe(INPUTS.exitTrailingContract, null),
    objectiveRetrospective: readJsonRawSafe(INPUTS.objectiveRetrospective, null),
    evGateCompositePolicy: readJsonRawSafe(INPUTS.evGateCompositePolicy, null),
    modelReadiness: readJsonRawSafe(INPUTS.modelReadiness, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_structure_upgrade_contract`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_structure_upgrade_contract_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_structure_upgrade_contract_latest.md");

  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("execution_structure_upgrade_contract_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("execution_structure_upgrade_contract_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    status: summary.status,
    stage_sequence_ready: summary.stage_sequence_ready,
    survivability_ready: summary.survivability_ready,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXECUTION_STRUCTURE_UPGRADE_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
