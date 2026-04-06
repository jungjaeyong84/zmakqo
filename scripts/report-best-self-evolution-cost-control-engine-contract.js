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
const { buildCostControlEngineContract } = require("../src/utils/costControlEngineContract");

const INPUTS = Object.freeze({
  evGateCompositePolicy: path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_composite_policy_latest.json"),
  overallAccountReport: path.join(OPS_DAILY_DIR, "overall_account_report_latest.json"),
  cooldownPolicyReview: path.join(OPS_DAILY_DIR, "best_self_evolution_cooldown_policy_review_latest.json"),
  serverSignalCutoverReadiness: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  reversePolicy: path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Cost Control Engine Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- contract_mode: ${summary.contract_mode || "N/A"}`,
    `- automatic_entry_suppression_ready: ${summary.automatic_entry_suppression_ready ? "YES" : "NO"}`,
    `- system_reentry_control_ready: ${summary.system_reentry_control_ready ? "YES" : "NO"}`,
    `- expectancy_gate_active: ${summary.expectancy_gate_active ? "YES" : "NO"} / metric=${summary.expectancy_metric || "N/A"} / family=${summary.expectancy_metric_family || "N/A"}`,
    `- cost_block_mode_active: ${summary.cost_block_mode_active ? "YES" : "NO"} / ops=${summary.operations_status || "N/A"}:${summary.operations_mode || "N/A"} / error_24h=${summary.operations_error_count_24h ?? "N/A"}`,
    `- cooldown_reentry_control_active: ${summary.cooldown_reentry_control_active ? "YES" : "NO"} / status=${summary.cooldown_policy_status || "N/A"} / mismatch_n=${summary.cooldown_policy_mismatch_n ?? "N/A"}`,
    `- reverse_reentry_control_active: ${summary.reverse_reentry_control_active ? "YES" : "NO"} / status=${summary.reverse_policy_status || "N/A"} / blocked=${summary.reverse_blocked_n ?? "N/A"} / cooldown=${summary.reverse_cooldown_n ?? "N/A"}`,
    `- fill_cost_pressure_active: ${summary.fill_cost_pressure_active ? "YES" : "NO"} / quality=${summary.execution_quality_status || "N/A"}`,
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
  const summary = buildCostControlEngineContract({
    evGateCompositePolicy: readJsonRawSafe(INPUTS.evGateCompositePolicy, null),
    overallAccountReport: readJsonRawSafe(INPUTS.overallAccountReport, null),
    cooldownPolicyReview: readJsonRawSafe(INPUTS.cooldownPolicyReview, null),
    serverSignalCutoverReadiness: readJsonRawSafe(INPUTS.serverSignalCutoverReadiness, null),
    reversePolicy: readJsonRawSafe(INPUTS.reversePolicy, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_cost_control_engine_contract`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_cost_control_engine_contract_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_cost_control_engine_contract_latest.md");

  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("cost_control_engine_contract_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("cost_control_engine_contract_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    status: summary.status,
    automatic_entry_suppression_ready: summary.automatic_entry_suppression_ready,
    system_reentry_control_ready: summary.system_reentry_control_ready,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_COST_CONTROL_ENGINE_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
