#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { deriveServerMarketCapitalAllocator } = require("../src/utils/serverMarketCapitalAllocator");
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

const MARKET_OBJECTIVE_SCORE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const REVERSE_POLICY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json");
const EXPLORATION_BUDGET_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.json");
const SERVER_PRIMARY_LEARNING_EPOCH_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_learning_epoch_latest.json");
const FAILURE_LEARNING_LOOP_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_failure_learning_loop_latest.json");
const FEE_PNL_KPI_AUTHORITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_fee_pnl_kpi_authority_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Server Market Capital Allocator",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- increase: ${summary.top_increase_market || "N/A"} / ${summary.top_increase_score != null ? summary.top_increase_score : "N/A"}`,
    `- reduce: ${summary.top_reduce_market || "N/A"} / ${summary.top_reduce_score != null ? summary.top_reduce_score : "N/A"}`,
    `- quarantine: ${summary.top_quarantine_market || "N/A"} / ${summary.top_quarantine_score != null ? summary.top_quarantine_score : "N/A"}`,
    `- explore: ${summary.top_explore_market || "N/A"} / ${summary.top_explore_score != null ? summary.top_explore_score : "N/A"}`,
    `- learning_epoch: ${summary.learning_epoch_status || "N/A"} / penalty_weight=${summary.learning_epoch_penalty_weight != null ? summary.learning_epoch_penalty_weight : "N/A"}`,
    `- fee_pnl_hard_penalty_markets: ${Array.isArray(summary.fee_pnl_hard_penalty_markets) && summary.fee_pnl_hard_penalty_markets.length ? summary.fee_pnl_hard_penalty_markets.join(", ") : "none"}`,
    "",
    "## Markets",
    ...(Array.isArray(summary.top_watch_markets) && summary.top_watch_markets.length
      ? summary.top_watch_markets.map((row) => `- ${row.market}: ${row.recommended_action} / score=${row.allocation_score != null ? row.allocation_score : "N/A"} / prod=${row.production_slot ? "YES" : "NO"} / explore=${row.exploration_slot ? "YES" : "NO"} / deferred=${row.deferred_penalty ? "YES" : "NO"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const marketObjectiveScore = readJsonRawSafe(MARKET_OBJECTIVE_SCORE_PATH, null);
  const executionQuality = readJsonRawSafe(EXECUTION_QUALITY_PATH, null);
  const reversePolicy = readJsonRawSafe(REVERSE_POLICY_PATH, null);
  const explorationBudget = readJsonRawSafe(EXPLORATION_BUDGET_PATH, null);
  const serverPrimaryLearningEpoch = readJsonRawSafe(SERVER_PRIMARY_LEARNING_EPOCH_PATH, null);
  const failureLearningLoop = readJsonRawSafe(FAILURE_LEARNING_LOOP_PATH, null);
  const feePnlKpiAuthority = readJsonRawSafe(FEE_PNL_KPI_AUTHORITY_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [marketObjectiveScore, executionQuality, reversePolicy, explorationBudget, serverPrimaryLearningEpoch, failureLearningLoop, feePnlKpiAuthority],
  });

  const summary = deriveServerMarketCapitalAllocator({
    marketObjectiveScore,
    executionQuality,
    reversePolicy,
    explorationBudget,
    serverPrimaryLearningEpoch,
    failureLearningLoop,
    feePnlKpiAuthority,
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      market_objective_score: MARKET_OBJECTIVE_SCORE_PATH,
      execution_quality: EXECUTION_QUALITY_PATH,
      reverse_policy: REVERSE_POLICY_PATH,
      exploration_budget: EXPLORATION_BUDGET_PATH,
      server_primary_learning_epoch: SERVER_PRIMARY_LEARNING_EPOCH_PATH,
      failure_learning_loop: FAILURE_LEARNING_LOOP_PATH,
      fee_pnl_kpi_authority: FEE_PNL_KPI_AUTHORITY_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_server_market_capital_allocator`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("server_market_capital_allocator_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("server_market_capital_allocator_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    top_increase_market: summary.top_increase_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_SERVER_MARKET_CAPITAL_ALLOCATOR_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
