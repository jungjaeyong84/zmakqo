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
const { buildMarketCanaryRows, unwrapRawReport } = require("../src/utils/bestSelfEvolutionCanary");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  driftCanary: path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"),
  previousCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  memory: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Market Canary",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- total/shadow/soft/hard: ${summary.total_n ?? 0} / ${summary.shadow_n ?? 0} / ${summary.soft_n ?? 0} / ${summary.hard_n ?? 0}`,
    `- ready/blocked/rollback: ${summary.ready_n ?? 0} / ${summary.blocked_n ?? 0} / ${summary.rollback_ready_n ?? 0}`,
    `- apply_pass: ${summary.apply_pass ? "YES" : "NO"} / global_canary_pass: ${summary.global_canary_pass ? "YES" : "NO"}`,
    `- drift global shadow/golden: ${summary.shadow_global_drift ?? 0} / ${summary.golden_global_drift ?? 0}`,
    `- wave open/current/next: ${summary.open_wave ?? "N/A"} / ${summary.current_open_wave ?? "N/A"} / ${summary.next_wave_candidate ?? "N/A"}`,
    `- scale_allowed: ${summary.scale_allowed ? "YES" : "NO"} / reason=${summary.scale_block_reason || "N/A"}`,
    `- top_ready: ${summary.top_ready_market || "N/A"} / top_rollback: ${summary.top_rollback_market || "N/A"} / top_shadow_drift: ${summary.top_shadow_drift_market || "N/A"} / top_golden_drift: ${summary.top_golden_drift_market || "N/A"}`,
    "",
    "## Markets",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 20)) {
      lines.push(`- ${row.market}: wave=${row.wave} / stage ${row.previous_stage} -> ${row.current_stage} / action=${row.canary_action} / verdict=${row.canary_verdict} / candidate=${row.candidate_id || "N/A"} / replay=${row.replay_verdict || "N/A"} / objective=${row.objective_score != null ? Number(row.objective_score).toFixed(3) : "N/A"} / drift shadow=${row.drift_shadow_market ?? 0} golden=${row.drift_golden_market ?? 0} / blockers=${Array.isArray(row.blockers) && row.blockers.length ? row.blockers.join("|") : "none"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objectiveSupervisor = unwrapRawReport(readJsonRawSafe(INPUTS.objectiveSupervisor, null)) || {};
  const report = buildMarketCanaryRows({
    objectiveSupervisor,
    candidateChangeSet: readJsonRawSafe(INPUTS.candidates, null),
    replayReport: readJsonRawSafe(INPUTS.replay, null),
    driftCanary: readJsonRawSafe(INPUTS.driftCanary, null),
    previousCanary: readJsonRawSafe(INPUTS.previousCanary, null),
    memoryLedger: readJsonRawSafe(INPUTS.memory, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    summary: report.summary,
    rows: report.rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_canary.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_canary.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_CANARY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
