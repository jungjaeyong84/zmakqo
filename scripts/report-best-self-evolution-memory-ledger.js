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
const { buildMemoryLedger } = require("../src/utils/bestSelfEvolutionMemoryLedger");

loadLocalEnv();

const INPUTS = Object.freeze({
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  previousLedger: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.current_rows) ? report.current_rows : [];
  const lines = [
    "# BEST Self-Evolution Memory Ledger",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- total/current: ${summary.total_n ?? 0} / ${summary.current_n ?? 0}`,
    `- success/neutral/fail/rolled_back: ${summary.success_n ?? 0} / ${summary.neutral_n ?? 0} / ${summary.fail_n ?? 0} / ${summary.rolled_back_n ?? 0}`,
    `- blocked_candidate_n: ${summary.blocked_candidate_n ?? 0}`,
    `- avg objective/count/replacement/ret: ${summary.avg_objective_delta != null ? Number(summary.avg_objective_delta).toFixed(4) : "N/A"} / ${summary.avg_count_delta != null ? Number(summary.avg_count_delta).toFixed(4) : "N/A"} / ${summary.avg_replacement_delta != null ? Number(summary.avg_replacement_delta).toFixed(4) : "N/A"} / ${summary.avg_ret_net_delta != null ? Number(summary.avg_ret_net_delta).toFixed(4) : "N/A"}`,
    `- top success: ${summary.top_success_candidate_id || "N/A"} / top failed: ${summary.top_failed_candidate_id || "N/A"}`,
    `- blocked candidates: ${Array.isArray(summary.blocked_candidate_ids) && summary.blocked_candidate_ids.length ? summary.blocked_candidate_ids.join(", ") : "none"}`,
    "",
    "## Current Rows",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 20)) {
      lines.push(`- ${row.candidate_id || "N/A"}: verdict=${row.verdict} / scope=${row.scope} / week=${row.applied_week_key || "N/A"} / objective=${row.objective_delta != null ? Number(row.objective_delta).toFixed(4) : "N/A"} / count=${row.count_delta != null ? Number(row.count_delta).toFixed(4) : "N/A"} / replacement=${row.replacement_delta != null ? Number(row.replacement_delta).toFixed(4) : "N/A"} / ret=${row.avg_ret_net_delta != null ? Number(row.avg_ret_net_delta).toFixed(4) : "N/A"} / memory_blocked=${row.memory_blocked ? "YES" : "NO"} / reason=${row.memory_block_reason || row.rollback_reason || "N/A"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = buildMemoryLedger({
    candidateChangeSet: readJsonRawSafe(INPUTS.candidates, null),
    replayReport: readJsonRawSafe(INPUTS.replay, null),
    canaryReport: readJsonRawSafe(INPUTS.canary, null),
    previousLedger: readJsonRawSafe(INPUTS.previousLedger, null),
    nowMeta,
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    summary: report.summary,
    current_rows: report.current_rows,
    rows: report.rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_memory.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_memory.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_MEMORY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
