#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveDatasetObjectiveScore, deriveMarketObjectiveScores } = require("../src/utils/bestSelfEvolutionAnalysis");

loadLocalEnv();

const DATASET_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");
const GOVERNANCE_LATEST_PATH = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");
const PHASE0_LATEST_PATH = path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.json");
const OBJECTIVE_SUPERVISOR_LATEST_PATH = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");

function pct(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "N/A";
}

function signedNum(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}` : "N/A";
}

function renderMarkdown(report = {}) {
  const global = report.global_objective_score || {};
  const topMarkets = Array.isArray(report.market_objective_scores) ? report.market_objective_scores.slice(0, 10) : [];
  const lines = [
    "# BEST Self-Evolution Objective Score",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- dataset: ${report.dataset_path || "N/A"}`,
    "",
    "## Global",
    `- objective_score: ${signedNum(global.objective_score, 4)}`,
    `- count floor: ${global.constraints && global.constraints.count_floor_pass === true ? "PASS" : (global.constraints && global.constraints.count_floor_pass === false ? "FAIL" : "N/A")}`,
    `- replacement floor: ${global.constraints && global.constraints.replacement_floor_pass === true ? "PASS" : (global.constraints && global.constraints.replacement_floor_pass === false ? "FAIL" : "N/A")}`,
    `- latency budget: ${global.constraints && global.constraints.latency_budget_pass === true ? "PASS" : (global.constraints && global.constraints.latency_budget_pass === false ? "FAIL" : "N/A")}`,
    `- profit/count/replacement/tp1: ${signedNum(global.components && global.components.profit_score, 3)} / ${signedNum(global.components && global.components.count_score, 3)} / ${signedNum(global.components && global.components.replacement_score, 3)} / ${signedNum(global.components && global.components.tp1_score, 3)}`,
    `- drawdown/latency/instability penalty: ${signedNum(global.components && global.components.drawdown_penalty, 3)} / ${signedNum(global.components && global.components.latency_penalty, 3)} / ${signedNum(global.components && global.components.instability_penalty, 3)}`,
    `- fire win / tp1 first / count / replacement: ${pct(global.snapshot && global.snapshot.fire_win_rate)} / ${pct(global.snapshot && global.snapshot.tp1_first_rate)} / ${global.snapshot && global.snapshot.projected_count_ratio_global != null ? Number(global.snapshot.projected_count_ratio_global).toFixed(2) : "N/A"} / ${pct(global.snapshot && global.snapshot.projected_replacement_ratio)}`,
    "",
    "## Markets",
  ];
  if (!topMarkets.length) {
    lines.push("- none");
  } else {
    for (const row of topMarkets) {
      lines.push(
        `- ${row.market}: score ${signedNum(row.objective_score, 4)} / mode ${row.mode || "N/A"} / win ${pct(row.win_rate)} / tp1 ${pct(row.tp1_first_rate)} / count ${row.projected_count_ratio_global != null ? Number(row.projected_count_ratio_global).toFixed(2) : "N/A"} / replacement ${pct(row.projected_replacement_ratio)}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const dataset = readJsonRawSafe(DATASET_LATEST_PATH, null);
  if (!dataset) throw new Error(`SELF_EVOLUTION_DATASET_MISSING:${DATASET_LATEST_PATH}`);
  const governance = readJsonRawSafe(GOVERNANCE_LATEST_PATH, null);
  const phase0 = readJsonRawSafe(PHASE0_LATEST_PATH, null);
  const objectiveSupervisor = readJsonRawSafe(OBJECTIVE_SUPERVISOR_LATEST_PATH, null);
  const tuningContract = objectiveSupervisor && objectiveSupervisor.best_febt_tuning_contract || null;
  const marketContracts = objectiveSupervisor && objectiveSupervisor.best_febt_market_contracts || [];

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    dataset_path: DATASET_LATEST_PATH,
    global_objective_score: deriveDatasetObjectiveScore({
      dataset,
      governance,
      phase0,
      tuningContract,
    }),
    market_objective_scores: deriveMarketObjectiveScores({
      dataset,
      governance,
      phase0,
      marketContracts,
    }),
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_objective.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_objective.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_OBJECTIVE_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
