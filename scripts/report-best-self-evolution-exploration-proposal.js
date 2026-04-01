#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { deriveExplorationProposal } = require("../src/utils/explorationProposal");
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

const EXPLORATION_BUDGET_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.json");
const MARKET_OBJECTIVE_SCORE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
const SERVER_VS_PINE_DELTA_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.json");
const DROP_VALIDATION_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Exploration Proposal",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- proposal_n: ${summary.proposal_n ?? 0}`,
    `- top_market: ${summary.top_market || "N/A"}`,
    `- top_stage: ${summary.top_stage || "N/A"}`,
    `- top_action: ${summary.top_action || "N/A"}`,
    "",
    "## Proposals",
    ...(Array.isArray(summary.proposals) && summary.proposals.length
      ? summary.proposals.map((row) => `- ${row.market}: ${row.stage} / ${row.proposed_action} / obj=${row.objective_score ?? "N/A"} / delta=${row.delta_score ?? "N/A"} / drop=${row.drop_family || "N/A"} / reason=${row.drop_reason || "N/A"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const explorationBudget = readJsonRawSafe(EXPLORATION_BUDGET_PATH, null);
  const marketObjectiveScore = readJsonRawSafe(MARKET_OBJECTIVE_SCORE_PATH, null);
  const serverVsPinePerformanceDelta = readJsonRawSafe(SERVER_VS_PINE_DELTA_PATH, null);
  const dropValidation = readJsonRawSafe(DROP_VALIDATION_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [explorationBudget, marketObjectiveScore, serverVsPinePerformanceDelta, dropValidation],
  });

  const summary = deriveExplorationProposal({
    explorationBudget,
    marketObjectiveScore,
    serverVsPinePerformanceDelta,
    dropValidation,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      exploration_budget: EXPLORATION_BUDGET_PATH,
      market_objective_score: MARKET_OBJECTIVE_SCORE_PATH,
      server_vs_pine_performance_delta: SERVER_VS_PINE_DELTA_PATH,
      drop_validation: DROP_VALIDATION_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_exploration_proposal`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_proposal_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_proposal_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("exploration_proposal_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("exploration_proposal_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    proposal_n: summary.proposal_n,
    top_market: summary.top_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXPLORATION_PROPOSAL_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
