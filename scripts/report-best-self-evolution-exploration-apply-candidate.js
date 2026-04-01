#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { deriveExplorationApplyCandidate } = require("../src/utils/explorationApplyCandidate");
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

const EXPLORATION_PROPOSAL_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_proposal_latest.json");
const EXPLORATION_BUDGET_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_budget_latest.json");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const REVERSE_POLICY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json");
const PROVISIONAL_REALIZED_OUTCOME_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_provisional_realized_outcome_latest.json");
const SERVER_PRIMARY_LEARNING_EPOCH_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_learning_epoch_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Exploration Apply Candidate",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- candidate_n: ${summary.candidate_n ?? 0}`,
    `- top_market: ${summary.top_market || "N/A"}`,
    `- top_stage: ${summary.top_stage || "N/A"}`,
    `- top_action: ${summary.top_action || "N/A"}`,
    `- manual_confirm_required: ${summary.manual_confirm_required ? "YES" : "NO"}`,
    `- auto_apply_allowed: ${summary.auto_apply_allowed ? "YES" : "NO"}`,
    `- effective_realized_n: ${summary.effective_realized_n ?? "N/A"} / min_required: ${summary.min_effective_realized_n ?? "N/A"}`,
    `- learning_epoch: ${summary.learning_epoch_status || "N/A"} / active=${summary.learning_epoch_active ? "YES" : "NO"}`,
    `- blockers: ${Array.isArray(summary.blockers) && summary.blockers.length ? summary.blockers.join("|") : "none"}`,
    "",
    "## Candidates",
    ...(Array.isArray(summary.candidates) && summary.candidates.length
      ? summary.candidates.map((row) => `- ${row.market}: ${row.stage} / ${row.proposed_action} / dryrun=${row.source_proposed_action || "N/A"} / obj=${row.objective_score ?? "N/A"} / delta=${row.delta_score ?? "N/A"} / drop=${row.drop_family || "N/A"} / blockers=${Array.isArray(row.blockers) && row.blockers.length ? row.blockers.join("|") : "none"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const explorationProposal = readJsonRawSafe(EXPLORATION_PROPOSAL_PATH, null);
  const explorationBudget = readJsonRawSafe(EXPLORATION_BUDGET_PATH, null);
  const executionQuality = readJsonRawSafe(EXECUTION_QUALITY_PATH, null);
  const reversePolicy = readJsonRawSafe(REVERSE_POLICY_PATH, null);
  const provisionalRealizedOutcome = readJsonRawSafe(PROVISIONAL_REALIZED_OUTCOME_PATH, null);
  const serverPrimaryLearningEpoch = readJsonRawSafe(SERVER_PRIMARY_LEARNING_EPOCH_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [explorationProposal, explorationBudget, executionQuality, reversePolicy, provisionalRealizedOutcome, serverPrimaryLearningEpoch],
  });

  const summary = deriveExplorationApplyCandidate({
    explorationProposal,
    explorationBudget,
    executionQuality,
    reversePolicy,
    provisionalRealizedOutcome,
    serverPrimaryLearningEpoch,
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      exploration_proposal: EXPLORATION_PROPOSAL_PATH,
      exploration_budget: EXPLORATION_BUDGET_PATH,
      execution_quality: EXECUTION_QUALITY_PATH,
      reverse_policy: REVERSE_POLICY_PATH,
      provisional_realized_outcome: PROVISIONAL_REALIZED_OUTCOME_PATH,
      server_primary_learning_epoch: SERVER_PRIMARY_LEARNING_EPOCH_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_exploration_apply_candidate`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_apply_candidate_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exploration_apply_candidate_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("exploration_apply_candidate_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("exploration_apply_candidate_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    candidate_n: summary.candidate_n,
    top_market: summary.top_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXPLORATION_APPLY_CANDIDATE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
