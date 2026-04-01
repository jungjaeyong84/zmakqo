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
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  buildMarketObjectiveRows,
  buildMarketObjectiveSummary,
} = require("../src/utils/marketObjectiveScore");

const OBJECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json");
const DROP_VALIDATION_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json");
const SERVER_SIGNAL_RUNTIME_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  const n = toNum(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "N/A";
}

function signedNum(value, digits = 2) {
  const n = toNum(value);
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}` : "N/A";
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.by_market) ? report.by_market : [];
  const lines = [
    "# BEST Self-Evolution Market Objective Score",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- global_objective_score: ${signedNum(summary.global_objective_score, 4)}`,
    `- active_market_n: ${summary.active_market_n ?? 0} / market_n: ${summary.market_n ?? 0}`,
    `- top_recovery: ${summary.top_recovery_market || "N/A"} / score ${signedNum(summary.top_recovery_objective_score, 4)} / action ${summary.top_recovery_drop_action || "N/A"} / avg_pnl_proxy ${signedNum(summary.top_recovery_avg_horizon_pnl_quote_proxy, 2)}`,
    `- top_drag: ${summary.top_drag_market || "N/A"} / score ${signedNum(summary.top_drag_objective_score, 4)}`,
    `- top_positive: ${summary.top_positive_market || "N/A"} / score ${signedNum(summary.top_positive_objective_score, 4)}`,
    `- concentration: ${summary.concentration_flag ? "YES" : "NO"} / dominant_negative_share ${pct(summary.dominant_negative_share)}`,
    "",
    "## By Market",
    ...rows.slice(0, 16).map((row) => `- ${row.market}: prio ${signedNum(row.recovery_priority_score, 4)} / obj ${signedNum(row.objective_score, 4)} / band ${row.objective_band || "N/A"} / drop ${row.drop_verdict || "N/A"} / action ${row.drop_action || "N/A"} / avg_pnl_proxy ${signedNum(row.drop_avg_horizon_pnl_quote_proxy, 2)} / realized ${row.realized_n ?? 0}`),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objective = readJsonRawSafe(OBJECTIVE_LATEST_PATH, null);
  if (!objective) throw new Error(`SELF_EVOLUTION_OBJECTIVE_MISSING:${OBJECTIVE_LATEST_PATH}`);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [objective],
  });
  const dropValidation = readJsonRawSafe(DROP_VALIDATION_LATEST_PATH, null) || {};
  const runtime = readJsonRawSafe(SERVER_SIGNAL_RUNTIME_LATEST_PATH, null) || {};
  const rows = buildMarketObjectiveRows({ objective, dropValidation, runtime });
  const summary = buildMarketObjectiveSummary({ objective, dropValidation, runtime, rows });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      objective_latest_path: OBJECTIVE_LATEST_PATH,
      drop_validation_latest_path: DROP_VALIDATION_LATEST_PATH,
      runtime_latest_path: SERVER_SIGNAL_RUNTIME_LATEST_PATH,
    },
    summary,
    by_market: rows,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_market_objective_score.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_market_objective_score.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("market_objective_score_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("market_objective_score_latest.md");
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
    top_recovery_market: summary.top_recovery_market,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_MARKET_OBJECTIVE_SCORE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
