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
  readJsonSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { derivePerformanceKpiUpgradeContract } = require("../src/utils/performanceKpiUpgradeContract");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveRetrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
  executionStructureUpgradeContract: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_structure_upgrade_contract_latest.json"),
  costControlEngineContract: path.join(OPS_DAILY_DIR, "best_self_evolution_cost_control_engine_contract_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Performance KPI Upgrade Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- contract_mode: ${summary.contract_mode || "N/A"}`,
    `- readiness: microstructure=${summary.microstructure_kpi_ready ? "YES" : "NO"} / survivability=${summary.survivability_kpi_ready ? "YES" : "NO"} / expectancy=${summary.expectancy_kpi_ready ? "YES" : "NO"} / structure=${summary.structure_alignment_ready ? "YES" : "NO"} / cost=${summary.cost_alignment_ready ? "YES" : "NO"}`,
    `- primary_kpis: ${Array.isArray(summary.primary_kpis) ? summary.primary_kpis.join(", ") : "N/A"}`,
    `- tp0/tp1/conversion/pre_tp1_stop: ${summary.tp0_hit_rate != null ? summary.tp0_hit_rate : "N/A"} / ${summary.tp1_hit_rate != null ? summary.tp1_hit_rate : "N/A"} / ${summary.tp0_to_tp1_conversion_rate != null ? summary.tp0_to_tp1_conversion_rate : "N/A"} / ${summary.pre_tp1_time_stop_rate != null ? summary.pre_tp1_time_stop_rate : "N/A"}`,
    `- fee_adjusted_expectancy/net/realized: ${summary.fee_adjusted_expectancy != null ? summary.fee_adjusted_expectancy : "N/A"} / ${summary.fee_adjusted_net_pnl_quote != null ? summary.fee_adjusted_net_pnl_quote : "N/A"} / ${summary.realized_trade_n != null ? summary.realized_trade_n : "N/A"}`,
    `- legacy_win_rate_reference: ${summary.legacy_win_rate_reference != null ? summary.legacy_win_rate_reference : "N/A"} / objective_verdict=${summary.objective_verdict || "N/A"}`,
    `- blocking_reason_n: ${summary.blocking_reason_n != null ? summary.blocking_reason_n : "N/A"}`,
  ];
  if (Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length) {
    lines.push("", "## Blocking Reasons");
    for (const reason of summary.blocking_reasons) lines.push(`- ${reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = derivePerformanceKpiUpgradeContract({
    objectiveRetrospective: readJsonSafe(INPUTS.objectiveRetrospective, null),
    executionStructureUpgradeContract: readJsonRawSafe(INPUTS.executionStructureUpgradeContract, null),
    costControlEngineContract: readJsonRawSafe(INPUTS.costControlEngineContract, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    summary: report,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_performance_kpi_upgrade_contract.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_performance_kpi_upgrade_contract.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_performance_kpi_upgrade_contract_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_performance_kpi_upgrade_contract_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("performance_kpi_upgrade_contract_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("performance_kpi_upgrade_contract_latest.md"));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    status: report.status,
    tp0_hit_rate: report.tp0_hit_rate,
    fee_adjusted_expectancy: report.fee_adjusted_expectancy,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_PERFORMANCE_KPI_UPGRADE_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
