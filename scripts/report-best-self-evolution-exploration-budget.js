#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { deriveExplorationBudget } = require("../src/utils/explorationBudget");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const OVERRIDE_AUTHORITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_override_authority_latest.json");
const MARKET_OBJECTIVE_SCORE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
const SERVER_VS_PINE_DELTA_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.json");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const REVERSE_POLICY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json");
const SERVER_PRIMARY_LEARNING_EPOCH_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_learning_epoch_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Exploration Budget",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- production_slot_n: ${summary.production_slot_n ?? "N/A"}`,
    `- exploration_slot_n: ${summary.exploration_slot_n ?? "N/A"}`,
    `- production_markets: ${Array.isArray(summary.production_markets) && summary.production_markets.length ? summary.production_markets.join("|") : "none"}`,
    `- exploration_markets: ${Array.isArray(summary.exploration_markets) && summary.exploration_markets.length ? summary.exploration_markets.join("|") : "none"}`,
    `- deferred_penalty_markets: ${Array.isArray(summary.deferred_penalty_markets) && summary.deferred_penalty_markets.length ? summary.deferred_penalty_markets.join("|") : "none"}`,
    `- execution_quality_penalty_markets: ${Array.isArray(summary.execution_quality_penalty_markets) && summary.execution_quality_penalty_markets.length ? summary.execution_quality_penalty_markets.join("|") : "none"}`,
    `- reverse_policy_penalty_markets: ${Array.isArray(summary.reverse_policy_penalty_markets) && summary.reverse_policy_penalty_markets.length ? summary.reverse_policy_penalty_markets.join("|") : "none"}`,
    `- learning_epoch: ${summary.learning_epoch_status || "N/A"} / age_days=${summary.learning_epoch_age_days != null ? summary.learning_epoch_age_days : "N/A"} / penalty_weight=${summary.learning_epoch_penalty_weight != null ? summary.learning_epoch_penalty_weight : "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const overrideAuthority = readJsonRawSafe(OVERRIDE_AUTHORITY_PATH, null);
  const marketObjectiveScore = readJsonRawSafe(MARKET_OBJECTIVE_SCORE_PATH, null);
  const serverVsPinePerformanceDelta = readJsonRawSafe(SERVER_VS_PINE_DELTA_PATH, null);
  const executionQuality = readJsonRawSafe(EXECUTION_QUALITY_PATH, null);
  const reversePolicy = readJsonRawSafe(REVERSE_POLICY_PATH, null);
  const serverPrimaryLearningEpoch = readJsonRawSafe(SERVER_PRIMARY_LEARNING_EPOCH_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [overrideAuthority, marketObjectiveScore, serverVsPinePerformanceDelta, executionQuality, reversePolicy, serverPrimaryLearningEpoch],
  });

  const summary = deriveExplorationBudget({
    overrideAuthority,
    marketObjectiveScore,
    serverVsPinePerformanceDelta,
    executionQuality,
    reversePolicy,
    serverPrimaryLearningEpoch,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      override_authority: OVERRIDE_AUTHORITY_PATH,
      market_objective_score: MARKET_OBJECTIVE_SCORE_PATH,
      server_vs_pine_performance_delta: SERVER_VS_PINE_DELTA_PATH,
      execution_quality: EXECUTION_QUALITY_PATH,
      reverse_policy: REVERSE_POLICY_PATH,
      server_primary_learning_epoch: SERVER_PRIMARY_LEARNING_EPOCH_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_exploration_budget`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("exploration_budget_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("exploration_budget_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    production_markets: summary.production_markets,
    exploration_markets: summary.exploration_markets,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXPLORATION_BUDGET_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
