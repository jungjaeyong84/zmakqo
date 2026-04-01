#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { deriveChangeResultAttribution } = require("../src/utils/changeResultAttribution");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { unwrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function loadHistoricalReports({ suffix = "", limit = 96 } = {}) {
  const files = fs.readdirSync(OPS_DAILY_DIR)
    .filter((name) => name.endsWith(suffix))
    .filter((name) => /^\d{4}-\d{2}-\d{2}_\d{4}_/.test(name))
    .sort();
  return files.slice(-Math.max(1, Number(limit) || 1)).map((name) => {
    const filePath = path.join(OPS_DAILY_DIR, name);
    return {
      file_path: filePath,
      raw: unwrapDisplayAndRawReport(readJsonSafe(filePath, null)),
    };
  }).filter((row) => row.raw && typeof row.raw === "object");
}

function renderChangeRow(row = {}) {
  const primary = row.primary_impact || {};
  return `- ${row.stage}/${row.action}: ${primary.impact_verdict || "PENDING"} / window=${primary.primary_window || "N/A"} / score=${primary.impact_score != null ? primary.impact_score : "N/A"} / obj=${primary.objective_score_delta != null ? primary.objective_score_delta : "N/A"} / fill=${primary.server_signal_fill_24h_delta != null ? primary.server_signal_fill_24h_delta : "N/A"} / mismatch=${primary.parity_mismatch_n_delta != null ? primary.parity_mismatch_n_delta : "N/A"} / source=${row.source || "N/A"} / at=${row.observed_at_kst || "N/A"}`;
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Change-Result Attribution",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- tracked_change_n: ${summary.tracked_change_n != null ? summary.tracked_change_n : "N/A"}`,
    `- evaluated_24h_n: ${summary.evaluated_24h_n != null ? summary.evaluated_24h_n : "N/A"}`,
    `- evaluated_72h_n: ${summary.evaluated_72h_n != null ? summary.evaluated_72h_n : "N/A"}`,
    `- partial_window_n: ${summary.partial_window_n != null ? summary.partial_window_n : "N/A"}`,
    "",
    "## Top Positive",
    summary.top_positive_change ? renderChangeRow(summary.top_positive_change) : "- none",
    "",
    "## Top Adverse",
    summary.top_adverse_change ? renderChangeRow(summary.top_adverse_change) : "- none",
    "",
    "## Top Pending",
    summary.top_pending_change ? renderChangeRow(summary.top_pending_change) : "- none",
    "",
    "## Watch",
    ...(Array.isArray(summary.top_watch_changes) && summary.top_watch_changes.length
      ? summary.top_watch_changes.map((row) => `- ${row.stage}/${row.action}: ${row.impact_verdict || "N/A"} / window=${row.primary_window || "N/A"} / score=${row.impact_score != null ? row.impact_score : "N/A"} / obj=${row.objective_score_delta != null ? row.objective_score_delta : "N/A"} / fill=${row.server_signal_fill_24h_delta != null ? row.server_signal_fill_24h_delta : "N/A"} / mismatch=${row.parity_mismatch_n_delta != null ? row.parity_mismatch_n_delta : "N/A"} / at=${row.observed_at_kst || "N/A"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const stageReports = loadHistoricalReports({ suffix: "_stage_autopilot.json", limit: 160 });
  const objectiveReports = loadHistoricalReports({ suffix: "_objective_supervisor.json", limit: 160 });
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [
      stageReports.length ? stageReports[stageReports.length - 1].raw : null,
      objectiveReports.length ? objectiveReports[objectiveReports.length - 1].raw : null,
    ],
  });

  const summary = deriveChangeResultAttribution({
    stageReports,
    objectiveReports,
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      stage_report_n: stageReports.length,
      objective_report_n: objectiveReports.length,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_change_result_attribution`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_change_result_attribution_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_change_result_attribution_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("change_result_attribution_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("change_result_attribution_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    tracked_change_n: summary.tracked_change_n,
    top_positive_stage: summary.top_positive_change ? summary.top_positive_change.stage : null,
    top_adverse_stage: summary.top_adverse_change ? summary.top_adverse_change.stage : null,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_CHANGE_RESULT_ATTRIBUTION_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    loadHistoricalReports,
    renderMarkdown,
  },
};
