#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveObjectiveRecoveryGovernor } = require("../src/utils/objectiveRecoveryGovernor");

loadLocalEnv();

const INPUTS = Object.freeze({
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  objective: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json"),
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  deploymentGuards: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json"),
  memory: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
  serverPrimaryAcceptanceWatch: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_acceptance_watch_latest.json"),
  watchdog: path.join(OPS_DAILY_DIR, "automation_watchdog_latest.json"),
  dropValidation: path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
  reversePolicy: path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json"),
  explorationBudget: path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Objective Recovery Governor",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.governor_status || "N/A"}`,
    `- reason: ${summary.governor_reason || "N/A"}`,
    `- recovery_required: ${summary.recovery_required ? "YES" : "NO"}`,
    `- candidate: ${summary.display_candidate_id || summary.target_candidate_id || "N/A"}`,
    `- deploy_unit: ${summary.target_deploy_unit || "N/A"}`,
    `- replay/canary/guards: ${summary.replay_pass ? "YES" : "NO"} / ${summary.canary_ready ? "YES" : "NO"} / ${summary.deployment_guards_pass ? "YES" : "NO"}`,
    `- memory/ops/phase_d: ${summary.memory_blocked ? "BLOCK" : "CLEAR"} / ${summary.openclaw_ops_healthy ? "PASS" : "WARN"} / ${summary.phase_d_status || "N/A"}`,
    `- drop_validation: ${summary.drop_validation_status || "N/A"} / ${summary.drop_validation_top_rescue_family || "N/A"} / ${summary.drop_validation_top_rescue_reason || "N/A"} / ${summary.drop_validation_top_rescue_market || "N/A"}`,
    `- execution_quality: ${summary.execution_quality_status || "N/A"} / latency_p95 ${summary.execution_quality_created_to_fill_p95_ms ?? "N/A"} / slippage_p95 ${summary.execution_quality_adverse_slippage_p95_bps ?? "N/A"} / partial ${summary.execution_quality_partial_fill_rate_pct ?? "N/A"} / top ${summary.execution_quality_top_latency_market || summary.execution_quality_top_slippage_market || summary.execution_quality_top_partial_market || "N/A"}`,
    `- reverse_policy: ${summary.reverse_policy_status || "N/A"} / top ${summary.reverse_policy_top_watch_market || "N/A"} / ${summary.reverse_policy_top_watch_reason || "N/A"} / ${summary.reverse_policy_top_watch_action || "N/A"}`,
    `- exploration_budget: ${summary.exploration_budget_status || "N/A"} / prod ${Array.isArray(summary.exploration_budget_production_markets) && summary.exploration_budget_production_markets.length ? summary.exploration_budget_production_markets.join("|") : "none"} / explore ${Array.isArray(summary.exploration_budget_exploration_markets) && summary.exploration_budget_exploration_markets.length ? summary.exploration_budget_exploration_markets.join("|") : "none"} / deferred ${Array.isArray(summary.exploration_budget_deferred_penalty_markets) && summary.exploration_budget_deferred_penalty_markets.length ? summary.exploration_budget_deferred_penalty_markets.join("|") : "none"}`,
    `- degraded_authority: ${summary.degraded_authority_enabled ? "ENABLED" : "DISABLED"} / eligible=${summary.degraded_authority_eligible ? "YES" : "NO"} / ${summary.degraded_authority_reason || "N/A"}`,
    "",
    "## Next Actions",
    ...(Array.isArray(summary.next_actions) && summary.next_actions.length ? summary.next_actions.map((line) => `- ${line}`) : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objective = readJsonRawSafe(INPUTS.objective, null);
  const objectiveSupervisor = readJsonRawSafe(INPUTS.objectiveSupervisor, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [objectiveSupervisor, objective],
  });
  const report = deriveObjectiveRecoveryGovernor({
    autonomyContract: readJsonRawSafe(INPUTS.autonomyContract, null),
    objective,
    objectiveSupervisor,
    candidates: readJsonRawSafe(INPUTS.candidates, null),
    replay: readJsonRawSafe(INPUTS.replay, null),
    canary: readJsonRawSafe(INPUTS.canary, null),
    deploymentGuards: readJsonRawSafe(INPUTS.deploymentGuards, null),
    memory: readJsonRawSafe(INPUTS.memory, null),
    serverPrimaryAcceptanceWatch: readJsonRawSafe(INPUTS.serverPrimaryAcceptanceWatch, null),
    watchdog: readJsonRawSafe(INPUTS.watchdog, null),
    dropValidation: readJsonRawSafe(INPUTS.dropValidation, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
    reversePolicy: readJsonRawSafe(INPUTS.reversePolicy, null),
    explorationBudget: readJsonRawSafe(INPUTS.explorationBudget, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: { ...INPUTS },
    ...report,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_objective_recovery_governor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_objective_recovery_governor.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_OBJECTIVE_RECOVERY_GOVERNOR_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
