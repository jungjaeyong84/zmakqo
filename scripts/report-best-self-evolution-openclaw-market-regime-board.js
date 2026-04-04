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
  buildOpenClawMarketRegimeRows,
  buildOpenClawMarketRegimeSummary,
} = require("../src/utils/openclawMarketRegimeBoard");

const INPUTS = Object.freeze({
  marketObjectiveScore: path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json"),
  serverVsPinePerformanceDelta: path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.json"),
  dropValidation: path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
  reversePolicy: path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json"),
  serverMarketCapitalAllocator: path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json"),
  serverMarketQuarantine: path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_quarantine_latest.json"),
});

function signedNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}` : "N/A";
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.by_market) ? report.by_market : [];
  const lines = [
    "# BEST Self-Evolution OpenClaw Market Regime Board",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- active_market_n: ${summary.active_market_n ?? 0} / market_n: ${summary.market_n ?? 0}`,
    `- rescue/mixed/keep_drop/hold_sample: ${summary.rescue_market_n ?? 0} / ${summary.mixed_market_n ?? 0} / ${summary.keep_drop_market_n ?? 0} / ${summary.hold_sample_market_n ?? 0}`,
    `- top_rescue: ${summary.top_rescue_market || "N/A"} / top_keep_drop: ${summary.top_keep_drop_market || "N/A"} / top_drag: ${summary.top_drag_market || "N/A"}`,
    "",
    "## By Market",
    ...rows.slice(0, 12).map((row) =>
      `- ${row.market}: cohort ${row.cohort || "N/A"} / obj ${signedNum(row.objective_score, 4)} / drop ${row.drop_verdict || "N/A"} / delta ${row.delta_verdict || "N/A"} / alloc ${row.allocation_action || "N/A"} / quarantine ${row.quarantine_reason || "N/A"}`
    ),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const marketObjectiveScore = readJsonRawSafe(INPUTS.marketObjectiveScore, null);
  if (!marketObjectiveScore) throw new Error(`MARKET_OBJECTIVE_SCORE_MISSING:${INPUTS.marketObjectiveScore}`);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [marketObjectiveScore],
  });
  const rows = buildOpenClawMarketRegimeRows({
    marketObjectiveScore,
    serverVsPinePerformanceDelta: readJsonRawSafe(INPUTS.serverVsPinePerformanceDelta, null),
    dropValidation: readJsonRawSafe(INPUTS.dropValidation, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
    reversePolicy: readJsonRawSafe(INPUTS.reversePolicy, null),
    serverMarketCapitalAllocator: readJsonRawSafe(INPUTS.serverMarketCapitalAllocator, null),
    serverMarketQuarantine: readJsonRawSafe(INPUTS.serverMarketQuarantine, null),
  });
  const summary = buildOpenClawMarketRegimeSummary({ rows });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: { ...INPUTS },
    summary,
    by_market: rows,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_openclaw_market_regime_board.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_openclaw_market_regime_board.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_market_regime_board_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_market_regime_board_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("openclaw_market_regime_board_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("openclaw_market_regime_board_latest.md");
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
    top_rescue_market: summary.top_rescue_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_OPENCLAW_MARKET_REGIME_BOARD_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
