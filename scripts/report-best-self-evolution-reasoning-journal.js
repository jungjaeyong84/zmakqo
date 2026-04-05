#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  readJsonSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildReasoningJournal } = require("../src/utils/openclawReasoningJournal");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  serverSignalQuality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  cutover: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  policyPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json"),
  objectiveRetrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
  overallAccountReport: path.join(OPS_DAILY_DIR, "overall_account_report_latest.json"),
  signalLineageHealth: path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
});

const RUNTIME_JOURNAL_PATH = path.join(OPS_RUNTIME_DIR, "openclaw_reasoning_journal.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const entries = Array.isArray(report.entries) ? report.entries : [];
  const lines = [
    "# BEST Self-Evolution Reasoning Journal",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- entry_n: ${summary.entry_n ?? 0}`,
    `- contradiction_n: ${summary.contradiction_n ?? 0}`,
    `- verified_n: ${summary.verified_n ?? 0}`,
    `- fast_track_verified_n: ${summary.fast_track_verified_n ?? 0}`,
    `- not_met_n: ${summary.not_met_n ?? 0}`,
    `- unknown_n: ${summary.unknown_n ?? 0}`,
    `- deferred_n: ${summary.deferred_n ?? 0}`,
    `- verification_rate: ${summary.verification_rate != null ? summary.verification_rate : "N/A"}`,
    `- objective_verdict: ${summary.current_objective_verdict || "N/A"}`,
    `- authority_state: ${summary.current_authority_state || "N/A"}`,
    `- dominant_issue: ${summary.current_dominant_issue || "N/A"} / source=${summary.current_dominant_issue_source || "N/A"}`,
    `- recommended_action: ${summary.current_recommended_action || "N/A"}`,
    `- execution_quality/lineage/account: ${summary.current_execution_quality_status || "N/A"} / ${summary.current_lineage_status || "N/A"} / ${summary.current_account_integrity_status || "N/A"}`,
    `- microstructure: tp0_hit=${summary.current_microstructure_tp0_hit_rate != null ? summary.current_microstructure_tp0_hit_rate : "N/A"} / tp1_hit=${summary.current_microstructure_tp1_hit_rate != null ? summary.current_microstructure_tp1_hit_rate : "N/A"} / pre_tp1_time_stop=${summary.current_microstructure_pre_tp1_time_stop_rate != null ? summary.current_microstructure_pre_tp1_time_stop_rate : "N/A"} / chase_reject=${summary.current_microstructure_chase_reject_n != null ? summary.current_microstructure_chase_reject_n : "N/A"} / cluster_reduce=${summary.current_microstructure_cluster_reduce_n != null ? summary.current_microstructure_cluster_reduce_n : "N/A"} / cluster_block=${summary.current_microstructure_cluster_block_n != null ? summary.current_microstructure_cluster_block_n : "N/A"}`,
    `- compacted_context: ${report.compacted_context || "N/A"}`,
    "",
    "## Entries",
  ];
  if (!entries.length) {
    lines.push("- none");
  } else {
    for (const row of entries.slice(0, 10)) {
      lines.push(`- ${row.cycle_id || "N/A"}: issue=${row.dominant_issue || "UNKNOWN"} / action=${row.recommended_action || "MONITOR_ONLY"} / objective=${row.objective_verdict || "N/A"} / authority=${row.authority_state || "N/A"} / pending=${row.pending_verification && row.pending_verification.metric || "none"} / verification=${row.verification_outcome && row.verification_outcome.status || "UNRESOLVED"} / hypothesis=${row.hypothesis || "N/A"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = buildReasoningJournal({
    cycleId: cycleMeta.cycle_id,
    nowKst: nowMeta.kst,
    objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
    autonomyContract: readJsonRawSafe(INPUTS.autonomyContract, null),
    quality: readJsonRawSafe(INPUTS.serverSignalQuality, null),
    cutover: readJsonRawSafe(INPUTS.cutover, null),
    policyPlan: readJsonRawSafe(INPUTS.policyPlan, null),
    objectiveRetrospective: readJsonSafe(INPUTS.objectiveRetrospective, null),
    overallAccountReport: readJsonRawSafe(INPUTS.overallAccountReport, null),
    signalLineageHealth: readJsonRawSafe(INPUTS.signalLineageHealth, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
    previousJournal: readJsonSafe(RUNTIME_JOURNAL_PATH, null),
  });

  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS, runtimeJournal: RUNTIME_JOURNAL_PATH },
    ...report,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_reasoning_journal.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_reasoning_journal.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_reasoning_journal_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_reasoning_journal_latest.md");

  writeJson(RUNTIME_JOURNAL_PATH, output);
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("reasoning_journal_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("reasoning_journal_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: output.cycle_id,
    dominant_issue: output.summary.current_dominant_issue,
    recommended_action: output.summary.current_recommended_action,
    contradiction_n: output.summary.contradiction_n,
    verified_n: output.summary.verified_n,
    fast_track_verified_n: output.summary.fast_track_verified_n,
    verification_rate: output.summary.verification_rate,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_REASONING_JOURNAL_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
