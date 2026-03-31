#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");

function buildStepPlan() {
  return [
    { id: "dataset", script: "report-best-self-evolution-dataset.js" },
    { id: "canonical_engine_parity", script: "report-best-self-evolution-canonical-engine-parity.js" },
    { id: "canonical_engine_provenance", script: "report-best-self-evolution-canonical-engine-provenance.js" },
    { id: "server_primary_canary", script: "report-best-self-evolution-server-primary-canary.js" },
    { id: "server_primary_acceptance_watch", script: "report-best-self-evolution-server-primary-acceptance-watch.js" },
    { id: "pine_shadow_drift", script: "report-best-self-evolution-pine-shadow-drift.js" },
    { id: "deployment_probe", script: "report-best-self-evolution-deployment-probe.js" },
    { id: "bundle_activation", script: "report-best-self-evolution-bundle-activation.js" },
    { id: "objective_seed", script: "automation-objective-supervisor.js", env: { OBJECTIVE_SUPERVISOR_SKIP_TELEGRAM: "1", OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE: "SEED" } },
    { id: "objective", script: "report-best-self-evolution-objective.js" },
    { id: "openclaw_autonomy_contract", script: "report-best-self-evolution-openclaw-autonomy-contract.js" },
    { id: "attribution", script: "report-best-self-evolution-attribution.js" },
    { id: "candidates", script: "report-best-self-evolution-candidates.js" },
    { id: "replay", script: "report-best-self-evolution-replay.js" },
    { id: "filter_shadow_canary", script: "automation-filter-shadow-canary.js" },
    { id: "ev_gate_rescue", script: "report-best-self-evolution-ev-gate-rescue.js" },
    { id: "canary", script: "report-best-self-evolution-canary.js" },
    { id: "memory", script: "report-best-self-evolution-memory-ledger.js" },
    { id: "deployment_guards", script: "report-best-self-evolution-deployment-guards.js" },
    { id: "objective_recovery_governor", script: "report-best-self-evolution-objective-recovery-governor.js" },
    { id: "weight_tuning", script: "report-best-self-evolution-weight-tuning.js" },
    {
      id: "codex_patch_engine",
      script: "automation-codex-weekly-patch-engine.js",
      env: {
        CODEX_PATCH_ENGINE_SKIP_TELEGRAM: "1",
        CODEX_PATCH_ENGINE_TIMEOUT_MS: String(process.env.CODEX_PATCH_ENGINE_TIMEOUT_MS || 120000),
      },
    },
    {
      id: "claude_patch_engine",
      script: "automation-claude-weekly-patch-engine.js",
      env: {
        CLAUDE_PATCH_ENGINE_SKIP_TELEGRAM: "1",
      },
    },
    { id: "authority_ensemble", script: "report-self-evolution-authority-ensemble.js" },
    { id: "deployment_plan", script: "report-best-self-evolution-deployment-plan.js", env: { SELF_EVOLUTION_SYNC_LIVE_SERVICES: "0" } },
    { id: "objective_integrated", script: "automation-objective-supervisor.js", env: { OBJECTIVE_SUPERVISOR_SKIP_TELEGRAM: "1", OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE: "INTEGRATED" } },
    { id: "objective_final", script: "automation-objective-supervisor.js", env: { OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE: "FINAL" } },
    { id: "loop_monitor", script: "report-best-self-evolution-loop-monitor.js" },
    { id: "stage_autopilot", script: "automation-stage-autopilot.js", env: { STAGE_AUTOPILOT_SKIP_TELEGRAM: "1" } },
  ];
}

function extractJson(stdout = "") {
  const lines = String(stdout || "").trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (_err) {
      // continue
    }
  }
  return null;
}

function renderMarkdown(report = {}) {
  const lines = [
    "# BEST Self-Evolution Loop Run",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    `- completed_steps: ${report.completed_steps != null ? report.completed_steps : "N/A"} / ${report.total_steps != null ? report.total_steps : "N/A"}`,
    `- failed_step: ${report.failed_step || "none"}`,
    "",
    "## Steps",
  ];
  for (const row of Array.isArray(report.steps) ? report.steps : []) {
    lines.push(`- ${row.id}: ${row.status} / script=${row.script} / code=${row.exit_code != null ? row.exit_code : "N/A"} / summary=${row.summary || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const steps = buildStepPlan();
  const results = [];
  let failedStep = null;

  for (const step of steps) {
    const scriptPath = path.join(__dirname, step.script);
    const child = spawnSync(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        BEST_SELF_EVOLUTION_CYCLE_ID: cycleMeta.cycle_id,
        BEST_SELF_EVOLUTION_ALLOW_LATEST_WRITE: "1",
        ...(step.env || {}),
      },
      maxBuffer: 1024 * 1024 * 8,
    });
    const parsed = extractJson(child.stdout);
    const row = {
      id: step.id,
      script: scriptPath,
      status: child.status === 0 ? "PASS" : "FAIL",
      exit_code: child.status,
      summary: parsed && (parsed.reason || parsed.verdict || parsed.latest_json || parsed.json || parsed.ok === true && "OK") || null,
      stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).slice(-5),
      stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).slice(-5),
    };
    results.push(row);
    if (child.status !== 0) {
      failedStep = row.id;
      break;
    }
  }

  const report = {
    ok: failedStep == null,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    status: failedStep == null ? "PASS" : "FAIL",
    completed_steps: results.filter((row) => row.status === "PASS").length,
    total_steps: steps.length,
    failed_step: failedStep,
    steps: results,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_run.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_run.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_run_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_run_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);

  console.log(JSON.stringify({
    ok: report.ok,
    cycle_id: report.cycle_id,
    status: report.status,
    completed_steps: report.completed_steps,
    total_steps: report.total_steps,
    failed_step: report.failed_step,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
  }));

  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_LOOP_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  __test: {
    buildStepPlan,
    extractJson,
    renderMarkdown,
  },
};
