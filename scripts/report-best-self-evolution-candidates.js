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
const { buildCandidateChangeSets, unwrapRawReport } = require("../src/utils/bestSelfEvolutionCandidates");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  patchCandidates: path.join(OPS_DAILY_DIR, "pine_quality_patch_candidates_latest.json"),
  ml: path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"),
  ev: path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"),
  wait: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"),
  changeControl: path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json"),
  memory: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const blockedRows = Array.isArray(report.blocked_rows) ? report.blocked_rows : [];
  const lines = [
    "# BEST Self-Evolution Candidate Change Sets",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- generated/active/ready/source_blocked: ${summary.generated_n ?? summary.total_n ?? 0} / ${summary.total_n ?? 0} / ${summary.ready_n ?? 0} / ${summary.blocked_n ?? 0}`,
    `- memory_blocked/fingerprint_repeat: ${summary.memory_blocked_n ?? 0} / ${summary.failed_fingerprint_repeat_n ?? 0}`,
    `- by_scope: ${summary.by_scope ? Object.entries(summary.by_scope).map(([k, v]) => `${k}=${v}`).join(", ") : "N/A"}`,
    `- top_candidate: ${summary.top_candidate_id || "N/A"} / scope=${summary.top_scope || "N/A"}`,
    "",
    "## Active Candidates",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 20)) {
      lines.push(`- ${row.candidate_id}: ${row.scope}/${row.direction} / status=${row.status} / ready=${row.ready_for_auto_apply ? "YES" : "NO"} / count=${row.count_guard_effect && row.count_guard_effect.projected_count_ratio_global != null ? Number(row.count_guard_effect.projected_count_ratio_global).toFixed(2) : "N/A"} / replacement=${row.replacement_effect && row.replacement_effect.projected_replacement_ratio != null ? Number(row.replacement_effect.projected_replacement_ratio).toFixed(2) : "N/A"} / risks=${Array.isArray(row.risk_flags) && row.risk_flags.length ? row.risk_flags.join("|") : "none"}`);
    }
  }
  lines.push("");
  lines.push("## Memory Blocked");
  if (!blockedRows.length) {
    lines.push("- none");
  } else {
    for (const row of blockedRows.slice(0, 20)) {
      lines.push(`- ${row.candidate_id}: ${row.scope}/${row.direction} / reason=${row.memory_block_reason || "N/A"} / risks=${Array.isArray(row.risk_flags) && row.risk_flags.length ? row.risk_flags.join("|") : "none"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = buildCandidateChangeSets({
    objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
    patchCandidates: readJsonRawSafe(INPUTS.patchCandidates, null),
    ml: readJsonRawSafe(INPUTS.ml, null),
    ev: readJsonRawSafe(INPUTS.ev, null),
    wait: readJsonRawSafe(INPUTS.wait, null),
    changeControl: readJsonRawSafe(INPUTS.changeControl, null),
    memoryLedger: readJsonRawSafe(INPUTS.memory, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: Object.fromEntries(Object.entries(INPUTS).map(([k, v]) => [k, v])),
    summary: report.summary,
    rows: report.rows,
    blocked_rows: report.blocked_rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_candidates.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_candidates.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_CANDIDATES_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
    unwrapRawReport,
  },
};
