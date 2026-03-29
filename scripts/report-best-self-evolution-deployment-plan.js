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
const { deriveDeploymentPlan } = require("../src/utils/bestSelfEvolutionDeploymentPlan");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  changeControl: path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json"),
  codexPatch: path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json"),
  deploymentGuards: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  weeklyHistory: path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const handoff = report.handoff || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Deployment Plan",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    "",
    "## Summary",
    `- status: ${summary.plan_status || "N/A"}`,
    `- candidate: ${summary.display_candidate_id || summary.target_candidate_id || "N/A"}`,
    `- rollback: ${summary.rollback_file_path || "N/A"}`,
    `- prepare/ready/manual: ${summary.prepare_pass ? "YES" : "NO"} / ${summary.ready_for_manual_paste ? "YES" : "NO"} / ${summary.manual_step_required ? "YES" : "NO"}`,
    `- wave open/target: ${summary.open_wave ?? "N/A"} / ${summary.target_wave ?? "N/A"}`,
    `- market scope ready/blocked/total: ${summary.market_scope_ready_n ?? 0} / ${summary.market_scope_blocked_n ?? 0} / ${summary.market_scope_n ?? 0}`,
    `- prepared file: ${summary.prepared_file_path || "N/A"}`,
    `- latest alias: ${summary.latest_generated_file_path || "N/A"}`,
    `- blockers: ${Array.isArray(summary.blockers) && summary.blockers.length ? summary.blockers.join("|") : "none"}`,
    "",
    "## Market Scope",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows) {
      lines.push(`- ${row.market}: wave=${row.wave ?? "N/A"} / verdict=${row.canary_verdict || "N/A"} / stage=${row.current_stage || "N/A"} / blockers=${Array.isArray(row.blockers) && row.blockers.length ? row.blockers.join("|") : "none"}`);
    }
  }
  lines.push("");
  lines.push("## Manual Handoff");
  for (const line of Array.isArray(handoff.checklist) ? handoff.checklist : []) lines.push(`- ${line}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: { ...INPUTS },
    ...deriveDeploymentPlan({
      objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
      changeControl: readJsonRawSafe(INPUTS.changeControl, null),
      codexPatchReview: readJsonRawSafe(INPUTS.codexPatch, null),
      deploymentGuards: readJsonRawSafe(INPUTS.deploymentGuards, null),
      canaryReport: readJsonRawSafe(INPUTS.canary, null),
      stageAutopilot: readJsonRawSafe(INPUTS.stageAutopilot, null),
      weeklyHistory: readJsonRawSafe(INPUTS.weeklyHistory, null),
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_plan.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_plan.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
