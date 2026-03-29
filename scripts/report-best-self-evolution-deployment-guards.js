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
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveDeploymentGuards } = require("../src/utils/bestSelfEvolutionDeploymentGuards");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  memory: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Deployment Guards",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- target: ${summary.target_candidate_id || "N/A"}`,
    `- deploy_pass: ${summary.deploy_pass ? "YES" : "NO"} / rollback_only: ${summary.rollback_only ? "YES" : "NO"}`,
    `- replay: ${summary.replay_verdict || "N/A"} / open_wave: ${summary.canary_open_wave ?? "N/A"}`,
    `- markets ready/total: ${summary.market_ready_n ?? 0} / ${summary.market_total_n ?? 0}`,
    `- memory_blocked_candidate_n: ${summary.memory_blocked_candidate_n ?? 0}`,
    `- blockers: ${Array.isArray(summary.blockers) && summary.blockers.length ? summary.blockers.join("|") : "none"}`,
    "",
    "## Markets",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 20)) {
      lines.push(`- ${row.market}: wave=${row.wave ?? "N/A"} / stage=${row.current_stage} / deploy=${row.deploy_pass ? "YES" : "NO"} / candidate=${row.candidate_id || "N/A"} / blockers=${Array.isArray(row.blockers) && row.blockers.length ? row.blockers.join("|") : "none"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    ...deriveDeploymentGuards({
      objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
      candidateChangeSet: readJsonRawSafe(INPUTS.candidates, null),
      replayReport: readJsonRawSafe(INPUTS.replay, null),
      canaryReport: readJsonRawSafe(INPUTS.canary, null),
      memoryLedger: readJsonRawSafe(INPUTS.memory, null),
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_guards.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_guards.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_DEPLOYMENT_GUARDS_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
