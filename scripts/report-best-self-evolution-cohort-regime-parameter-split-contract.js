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
const { deriveCohortRegimeParameterSplitContract } = require("../src/utils/cohortRegimeParameterSplitContract");

loadLocalEnv();

const INPUTS = Object.freeze({
  marketRegimeBoard: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_market_regime_board_latest.json"),
  policyParameterPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Cohort Regime Parameter Split Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- contract_mode: ${summary.contract_mode || "N/A"}`,
    `- cohort_scope: ${summary.cohort_scope || "N/A"}`,
    `- board_status: ${summary.board_status || "N/A"} / split=${summary.has_market_split ? "YES" : "NO"} / active_market_n=${summary.active_market_n != null ? summary.active_market_n : "N/A"}`,
    `- cohort_counts: rescue=${summary.rescue_market_n != null ? summary.rescue_market_n : "N/A"} / mixed=${summary.mixed_market_n != null ? summary.mixed_market_n : "N/A"} / keep_drop=${summary.keep_drop_market_n != null ? summary.keep_drop_market_n : "N/A"} / active=${summary.active_cohort_n != null ? summary.active_cohort_n : "N/A"}`,
    `- readiness: cohort_parameterization=${summary.cohort_parameterization_ready ? "YES" : "NO"} / regime_switch=${summary.regime_switch_ready ? "YES" : "NO"} / policy_scope=${summary.policy_scoped_ready ? "YES" : "NO"} / observability=${summary.auto_switch_observability_ready ? "YES" : "NO"} / automatic_transition=${summary.automatic_transition_ready ? "YES" : "NO"}`,
    `- policy: status=${summary.policy_plan_status || "N/A"} / mode=${summary.policy_plan_mode || "N/A"} / qty_scale=${summary.policy_global_qty_scale != null ? summary.policy_global_qty_scale : "N/A"} / watch_only=${summary.policy_watch_only_review_market_n != null ? summary.policy_watch_only_review_market_n : "N/A"} / quarantine=${summary.policy_quarantine_market_n != null ? summary.policy_quarantine_market_n : "N/A"}`,
    `- blocking_reason_n: ${summary.blocking_reason_n != null ? summary.blocking_reason_n : "N/A"}`,
  ];
  if (Array.isArray(summary.cohort_action_rows) && summary.cohort_action_rows.length) {
    lines.push("", "## Cohort Action Rows");
    for (const row of summary.cohort_action_rows) {
      lines.push(`- ${row.cohort}: market_n=${row.market_n} / quarantine=${row.quarantine_n} / hold=${row.hold_n} / increase=${row.increase_n} / review=${row.review_n} / avg_objective=${row.avg_objective_score != null ? row.avg_objective_score : "N/A"}`);
    }
  }
  if (Array.isArray(summary.blocking_reasons) && summary.blocking_reasons.length) {
    lines.push("", "## Blocking Reasons");
    for (const reason of summary.blocking_reasons) lines.push(`- ${reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = deriveCohortRegimeParameterSplitContract({
    marketRegimeBoard: readJsonRawSafe(INPUTS.marketRegimeBoard, null),
    policyParameterPlan: readJsonRawSafe(INPUTS.policyParameterPlan, null),
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
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_cohort_regime_parameter_split_contract.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_cohort_regime_parameter_split_contract.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_cohort_regime_parameter_split_contract_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_cohort_regime_parameter_split_contract_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("cohort_regime_parameter_split_contract_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("cohort_regime_parameter_split_contract_latest.md"));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    status: report.status,
    cohort_parameterization_ready: report.cohort_parameterization_ready,
    automatic_transition_ready: report.automatic_transition_ready,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
