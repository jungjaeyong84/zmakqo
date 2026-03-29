#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildReplayValidationReport } = require("../src/utils/bestSelfEvolutionReplay");

loadLocalEnv();

const INPUTS = Object.freeze({
  objective: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json"),
  attribution: path.join(OPS_DAILY_DIR, "best_self_evolution_attribution_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  dataset: path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.validations) ? report.validations : [];
  const lines = [
    "# BEST Self-Evolution Replay Validation",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- validation_mode: ${report.validation_mode || "N/A"}`,
    "",
    "## Summary",
    `- total/pass/warn/block: ${summary.total_n ?? 0} / ${summary.pass_n ?? 0} / ${summary.warn_n ?? 0} / ${summary.block_n ?? 0}`,
    `- best_candidate: ${summary.best_candidate_id || "N/A"} / verdict=${summary.best_verdict || "N/A"} / delta=${summary.best_objective_delta != null ? Number(summary.best_objective_delta).toFixed(4) : "N/A"}`,
    "",
    "## Validations",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 20)) {
      lines.push(`- ${row.candidate_id}: ${row.validation_verdict} / delta=${row.candidate_objective_delta != null ? Number(row.candidate_objective_delta).toFixed(4) : "N/A"} / next=${row.projected_objective_score != null ? Number(row.projected_objective_score).toFixed(4) : "N/A"} / matched=${row.historical_match_n ?? "N/A"} / applied=${row.historical_applied_n ?? "N/A"} / blockers=${Array.isArray(row.blockers) && row.blockers.length ? row.blockers.join("|") : "none"} / risks=${Array.isArray(row.risk_flags) && row.risk_flags.length ? row.risk_flags.join("|") : "none"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objectiveReport = readJsonRawSafe(INPUTS.objective, null) || {};
  const attributionReport = readJsonRawSafe(INPUTS.attribution, null) || {};
  const candidateChangeSet = readJsonRawSafe(INPUTS.candidates, null);
  const dataset = readJsonRawSafe(INPUTS.dataset, null);
  const replay = buildReplayValidationReport({
    candidateChangeSet,
    objective: objectiveReport && objectiveReport.global_objective_score ? objectiveReport.global_objective_score : objectiveReport,
    attribution: attributionReport && attributionReport.attribution ? attributionReport.attribution : attributionReport,
    dataset,
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    validation_mode: replay.validation_mode,
    inputs: Object.fromEntries(Object.entries(INPUTS).map(([k, v]) => [k, v])),
    summary: replay.summary,
    validations: replay.validations,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_replay.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_replay.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_REPLAY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
