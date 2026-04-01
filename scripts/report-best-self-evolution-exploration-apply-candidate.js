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
    "",
    "## Candidates",
    ...(Array.isArray(summary.candidates) && summary.candidates.length
      ? summary.candidates.map((row) => `- ${row.market}: ${row.stage} / ${row.proposed_action} / dryrun=${row.source_proposed_action || "N/A"} / obj=${row.objective_score ?? "N/A"} / delta=${row.delta_score ?? "N/A"} / drop=${row.drop_family || "N/A"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const explorationProposal = readJsonRawSafe(EXPLORATION_PROPOSAL_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [explorationProposal],
  });

  const summary = deriveExplorationApplyCandidate({ explorationProposal });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      exploration_proposal: EXPLORATION_PROPOSAL_PATH,
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
