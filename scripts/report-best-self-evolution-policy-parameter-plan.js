#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { derivePolicyParameterEvolutionPlan } = require("../src/utils/policyParameterEvolutionPlan");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

const INPUTS = Object.freeze({
  objective: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json"),
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  objectiveRecoveryGovernor: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json"),
  objectiveRecoveryEffect: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_effect_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
  serverMarketCapitalAllocator: path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json"),
  serverMarketQuarantine: path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_quarantine_latest.json"),
  explorationApplyCandidate: path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_apply_candidate_latest.json"),
  serverSignalDriftRemediationPlan: path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_plan_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const globalRows = Array.isArray(report.recommendations && report.recommendations.global) ? report.recommendations.global : [];
  const marketRows = Array.isArray(report.recommendations && report.recommendations.by_market) ? report.recommendations.by_market : [];
  const lines = [
    "# BEST Self-Evolution Policy Parameter Plan",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status/mode: ${summary.status || "N/A"} / ${summary.mode || "N/A"}`,
    `- blocker_n: ${summary.blocker_n ?? 0} / ${Array.isArray(summary.blockers) && summary.blockers.length ? summary.blockers.join("|") : "none"}`,
    `- global_qty_scale: ${summary.global_qty_scale != null ? summary.global_qty_scale : "N/A"}`,
    `- ev_policy_action: ${summary.ev_policy_action_canonical || summary.ev_policy_action || "N/A"} / legacy=${summary.ev_policy_action || "N/A"}`,
    `- objective score (cur -> proj): ${summary.current_objective_score != null ? summary.current_objective_score : "N/A"} -> ${summary.projected_objective_score != null ? summary.projected_objective_score : "N/A"}`,
    `- execution_quality: ${summary.execution_quality_status || "N/A"}`,
    `- quarantine/watch-only/other-policy: ${summary.quarantine_market_n ?? 0} / ${summary.watch_only_review_market_n ?? 0} / ${summary.other_server_policy_watch_only_market_n ?? 0}`,
    `- quarantine markets: ${Array.isArray(summary.top_quarantine_markets) && summary.top_quarantine_markets.length ? summary.top_quarantine_markets.join("|") : "none"}`,
    `- watch-only review markets: ${Array.isArray(summary.top_watch_only_review_markets) && summary.top_watch_only_review_markets.length ? summary.top_watch_only_review_markets.join("|") : "none"}`,
    "",
    "## Global Recommendations",
    ...(globalRows.length
      ? globalRows.map((row) => `- ${row.key}: ${row.recommended_value} (${row.reason || "N/A"})`)
      : ["- none"]),
    "",
    "## Market Recommendations",
    ...(marketRows.length
      ? marketRows.map((row) => `- ${row.market}: scale=${row.qty_scale} / mode=${row.mode} / source=${row.source_action} / penalty=${row.quality_penalty}`)
      : ["- none"]),
    "",
    "## Next Actions",
    ...(Array.isArray(summary.next_actions) && summary.next_actions.length ? summary.next_actions.map((line) => `- ${line}`) : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objectiveRecoveryGovernor = readJsonRawSafe(INPUTS.objectiveRecoveryGovernor, null);
  const objectiveRecoveryEffect = readJsonRawSafe(INPUTS.objectiveRecoveryEffect, null);
  const objective = readJsonRawSafe(INPUTS.objective, null);
  const objectiveSupervisor = readJsonRawSafe(INPUTS.objectiveSupervisor, null);
  const autonomyContract = readJsonRawSafe(INPUTS.autonomyContract, null);
  const executionQuality = readJsonRawSafe(INPUTS.executionQuality, null);
  const serverMarketCapitalAllocator = readJsonRawSafe(INPUTS.serverMarketCapitalAllocator, null);
  const serverMarketQuarantine = readJsonRawSafe(INPUTS.serverMarketQuarantine, null);
  const explorationApplyCandidate = readJsonRawSafe(INPUTS.explorationApplyCandidate, null);
  const serverSignalDriftRemediationPlan = readJsonRawSafe(INPUTS.serverSignalDriftRemediationPlan, null);

  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [
      objectiveRecoveryGovernor,
      objectiveRecoveryEffect,
      objective,
      objectiveSupervisor,
      autonomyContract,
      executionQuality,
      serverMarketCapitalAllocator,
      serverMarketQuarantine,
      explorationApplyCandidate,
      serverSignalDriftRemediationPlan,
    ],
  });

  const plan = derivePolicyParameterEvolutionPlan({
    objectiveRecoveryGovernor,
    objectiveRecoveryEffect,
    objective,
    objectiveSupervisor,
    autonomyContract,
    executionQuality,
    serverMarketCapitalAllocator,
    serverMarketQuarantine,
    explorationApplyCandidate,
    serverSignalDriftRemediationPlan,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: { ...INPUTS },
    ...plan,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_policy_parameter_plan.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_policy_parameter_plan.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("policy_parameter_plan_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("policy_parameter_plan_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: report.summary && report.summary.status,
    mode: report.summary && report.summary.mode,
    global_qty_scale: report.summary && report.summary.global_qty_scale,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_POLICY_PARAMETER_PLAN_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
