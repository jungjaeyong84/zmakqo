#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  buildServerVsPinePerformanceRows,
  buildServerVsPinePerformanceSummary,
} = require("../src/utils/serverVsPinePerformanceDelta");

const MARKET_OBJECTIVE_SCORE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
const SERVER_SIGNAL_AUTHORITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json");
const SERVER_SIGNAL_QUALITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json");

function signedNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}` : "N/A";
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.by_market) ? report.by_market : [];
  const lines = [
    "# BEST Self-Evolution Server vs Pine Performance Delta",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- active_market_n: ${summary.active_market_n ?? 0}`,
    `- avg_active_delta_score: ${signedNum(summary.avg_active_delta_score, 4)}`,
    `- top_server_edge: ${summary.top_server_edge_market || "N/A"} / score ${signedNum(summary.top_server_edge_score, 4)}`,
    `- top_shadow_gap: ${summary.top_shadow_gap_market || "N/A"} / score ${signedNum(summary.top_shadow_gap_score, 4)} / action ${summary.top_shadow_gap_action || "N/A"} / reason ${summary.top_shadow_gap_reason || "N/A"}`,
    `- parity_mismatch_rate: ${summary.parity_mismatch_rate != null ? summary.parity_mismatch_rate : "N/A"}`,
    "",
    "## By Market",
    ...rows.slice(0, 12).map((row) => `- ${row.market}: ${row.verdict} / delta ${signedNum(row.performance_delta_score, 4)} / obj ${signedNum(row.objective_score, 4)} / mismatch ${row.mismatch_count ?? 0} / action ${row.recommended_action || "N/A"}`),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const marketObjectiveScore = readJsonRawSafe(MARKET_OBJECTIVE_SCORE_LATEST_PATH, null);
  const authority = readJsonRawSafe(SERVER_SIGNAL_AUTHORITY_LATEST_PATH, null);
  const quality = readJsonRawSafe(SERVER_SIGNAL_QUALITY_LATEST_PATH, null);
  if (!marketObjectiveScore) throw new Error(`MARKET_OBJECTIVE_SCORE_MISSING:${MARKET_OBJECTIVE_SCORE_LATEST_PATH}`);
  if (!authority) throw new Error(`SERVER_SIGNAL_AUTHORITY_MISSING:${SERVER_SIGNAL_AUTHORITY_LATEST_PATH}`);
  if (!quality) throw new Error(`SERVER_SIGNAL_QUALITY_MISSING:${SERVER_SIGNAL_QUALITY_LATEST_PATH}`);

  const rows = buildServerVsPinePerformanceRows({ marketObjectiveScore, authority, quality });
  const summary = buildServerVsPinePerformanceSummary({ authority, quality, rows });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: {
      market_objective_score_latest_path: MARKET_OBJECTIVE_SCORE_LATEST_PATH,
      server_signal_authority_latest_path: SERVER_SIGNAL_AUTHORITY_LATEST_PATH,
      server_signal_quality_latest_path: SERVER_SIGNAL_QUALITY_LATEST_PATH,
    },
    summary,
    by_market: rows,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_server_vs_pine_performance_delta.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_server_vs_pine_performance_delta.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("server_vs_pine_performance_delta_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("server_vs_pine_performance_delta_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  if (selfEvolutionLatestJson) copySelfEvolutionLatest(jsonPath, selfEvolutionLatestJson);
  if (selfEvolutionLatestMd) copySelfEvolutionLatest(mdPath, selfEvolutionLatestMd);
  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    top_shadow_gap_market: summary.top_shadow_gap_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_SERVER_VS_PINE_PERFORMANCE_DELTA_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
