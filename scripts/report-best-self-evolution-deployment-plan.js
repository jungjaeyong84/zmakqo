#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveDeploymentPlan } = require("../src/utils/bestSelfEvolutionDeploymentPlan");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  changeControl: path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json"),
  codexPatch: path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json"),
  deploymentGuards: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  weeklyHistory: path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json"),
  manualPasteAck: path.join(OPS_RUNTIME_DIR, "self_evolution_manual_paste_ack.json"),
  signalsCache: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const handoff = report.handoff || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Deployment Plan",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- status: ${summary.plan_status || "N/A"}`,
    `- candidate: ${summary.display_candidate_id || summary.target_candidate_id || "N/A"}`,
    `- rollback: ${summary.rollback_file_path || "N/A"}`,
    `- prepare/dry/ready/manual: ${summary.prepare_pass ? "YES" : "NO"} / ${summary.dry_prepare_available ? "YES" : "NO"} / ${summary.ready_for_manual_paste ? "YES" : "NO"} / ${summary.manual_step_required ? "YES" : "NO"}`,
    `- applied ack/live confirm: ${summary.manual_paste_acknowledged ? "YES" : "NO"} / ${summary.live_signal_confirmation_pending ? "PENDING" : "NO"}`,
    `- wave open/target: ${summary.open_wave ?? "N/A"} / ${summary.target_wave ?? "N/A"}`,
    `- market scope ready/blocked/total: ${summary.market_scope_ready_n ?? 0} / ${summary.market_scope_blocked_n ?? 0} / ${summary.market_scope_n ?? 0}`,
    `- prepared file: ${summary.prepared_file_path || "N/A"}`,
    `- latest alias: ${summary.latest_generated_file_path || "N/A"}`,
    `- applied strategy: ${summary.applied_strategy_id || "N/A"}`,
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
  if (Array.isArray(handoff.next_actions) && handoff.next_actions.length) {
    lines.push("");
    lines.push("## Next Actions");
    for (const line of handoff.next_actions) lines.push(`- ${line}`);
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
    ...deriveDeploymentPlan({
      objectiveSupervisor: readJsonRawSafe(INPUTS.objectiveSupervisor, null),
      changeControl: readJsonRawSafe(INPUTS.changeControl, null),
      codexPatchReview: readJsonRawSafe(INPUTS.codexPatch, null),
      deploymentGuards: readJsonRawSafe(INPUTS.deploymentGuards, null),
      canaryReport: readJsonRawSafe(INPUTS.canary, null),
      stageAutopilot: readJsonRawSafe(INPUTS.stageAutopilot, null),
      weeklyHistory: readJsonRawSafe(INPUTS.weeklyHistory, null),
      manualPasteAck: readJsonRawSafe(INPUTS.manualPasteAck, null),
      signalsCache: readJsonRawSafe(INPUTS.signalsCache, null),
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_plan.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_deployment_plan.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
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
