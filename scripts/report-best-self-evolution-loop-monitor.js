#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
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
const { deriveLoopMonitor } = require("../src/utils/bestSelfEvolutionLoopMonitor");

loadLocalEnv();

const MAX_AGE_HOURS = Object.freeze({
  objectiveSupervisor: 12,
  candidates: 24,
  replay: 24,
  canary: 12,
  deployment: 12,
  deploymentPlan: 12,
  stageAutopilot: 12,
  weightTuning: 24,
  memory: 24,
  codexPatch: 48,
});

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  deployment: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json"),
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  weightTuning: path.join(OPS_DAILY_DIR, "best_self_evolution_weight_tuning_latest.json"),
  memory: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
  codexPatch: path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json"),
});

function readFresh(filePath, maxAgeHours) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) return { filePath, data: null, fresh: false, exists: false, age_hours: null };
  try {
    const st = fs.statSync(filePath);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    return {
      filePath,
      data,
      fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours,
      exists: true,
      age_hours: ageHours,
    };
  } catch (_err) {
    return { filePath, data, fresh: false, exists: true, age_hours: null };
  }
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Loop Monitor",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- cycle_consistent: ${summary.cycle_consistent ? "YES" : "NO"} / cycle_mismatch_n: ${summary.cycle_mismatch_n ?? 0}`,
    `- overall_status: ${summary.overall_status || "N/A"}`,
    `- fresh loops: ${summary.fresh_loop_n ?? 0} / ${summary.loop_n ?? 0}`,
    `- stale artifacts: ${Array.isArray(summary.stale_artifacts) && summary.stale_artifacts.length ? summary.stale_artifacts.join(", ") : "none"}`,
    `- critical blockers: ${Array.isArray(summary.critical_blockers) && summary.critical_blockers.length ? summary.critical_blockers.join("|") : "none"}`,
    `- promotion_path_ready: ${summary.promotion_path_ready ? "YES" : "NO"} / manual_paste_ready: ${summary.manual_paste_ready ? "YES" : "NO"}`,
    `- ready_candidate: ${summary.ready_candidate_id || "N/A"} / canary_open_wave: ${summary.canary_open_wave ?? "N/A"}`,
    "",
    "## Loops",
  ];
  for (const row of rows) {
    lines.push(`- ${row.loop}: ${row.status} / fresh=${row.fresh ? "YES" : "NO"} / ${row.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const artifacts = Object.fromEntries(
    Object.entries(INPUTS).map(([key, filePath]) => [key, readFresh(filePath, MAX_AGE_HOURS[key] || 24)])
  );
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    ...deriveLoopMonitor({
      artifacts,
      reports: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.data])),
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_monitor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_monitor.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_LOOP_MONITOR_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    readFresh,
    renderMarkdown,
  },
};
