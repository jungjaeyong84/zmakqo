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
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");
const CAPABILITY_MANIFEST_PATH = path.join(REPO_ROOT, "ops", "manifests", "openclaw-evolution-capabilities.json");
const PLANNING_INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  serverSignalQuality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  serverSignalCutoverReadiness: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  reasoningJournal: path.join(OPS_DAILY_DIR, "best_self_evolution_reasoning_journal_latest.json"),
  autonomyParity: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_parity_latest.json"),
});

function readSummary(value) {
  if (!value || typeof value !== "object") return value || {};
  if (value.summary && typeof value.summary === "object") return value.summary;
  return value.raw && typeof value.raw === "object" && value.raw.summary && typeof value.raw.summary === "object"
    ? value.raw.summary
    : value;
}

function buildPlanningContext() {
  const objectiveSupervisor = readJsonRawSafe(PLANNING_INPUTS.objectiveSupervisor, null) || {};
  const quality = readJsonRawSafe(PLANNING_INPUTS.serverSignalQuality, null) || {};
  const cutover = readJsonRawSafe(PLANNING_INPUTS.serverSignalCutoverReadiness, null) || {};
  const reasoningJournal = readJsonRawSafe(PLANNING_INPUTS.reasoningJournal, null) || {};
  const autonomyParity = readJsonRawSafe(PLANNING_INPUTS.autonomyParity, null) || {};

  const qualitySummary = readSummary(quality);
  const cutoverSummary = readSummary(cutover);
  const journalSummary = readSummary(reasoningJournal);
  const paritySummary = readSummary(autonomyParity);
  const dominantMismatchFamily = String(
    cutoverSummary.dominant_mismatch_family
    || (qualitySummary.top_final_downstream_drop_reason_family && qualitySummary.top_final_downstream_drop_reason_family.key)
    || (qualitySummary.top_drop_reason_family && qualitySummary.top_drop_reason_family.key)
    || ""
  ).trim().toUpperCase() || null;

  const qualityStatus = String(qualitySummary.quality_status || "").trim().toUpperCase() || null;
  const needsSignalDeepDive = Boolean(
    ["EV_POLICY", "OTHER_SERVER_POLICY", "COOLDOWN_POLICY"].includes(dominantMismatchFamily)
    || qualityStatus === "WATCH_PARITY_DRIFT"
  );

  return {
    objective_verdict: String(objectiveSupervisor.verdict || "").trim().toUpperCase() || null,
    objective_root_cause: String(objectiveSupervisor.root_cause || "").trim().toUpperCase() || null,
    dominant_mismatch_family: dominantMismatchFamily,
    quality_status: qualityStatus,
    needs_signal_deep_dive: needsSignalDeepDive,
    needs_ev_policy_deep_dive: dominantMismatchFamily === "EV_POLICY",
    needs_other_server_policy_deep_dive: dominantMismatchFamily === "OTHER_SERVER_POLICY",
    needs_cooldown_policy_deep_dive: dominantMismatchFamily === "COOLDOWN_POLICY",
    reasoning_entry_n: Number(journalSummary.entry_n || 0) || 0,
    autonomy_progress_pct: Number(paritySummary.overall_progress_pct || 0) || 0,
    authority_state: String(paritySummary.current_authority_state || "").trim().toUpperCase() || null,
    other_server_policy_mismatch_n: Number(qualitySummary.other_server_policy_mismatch_n || 0) || 0,
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean) : [];
}

function loadCapabilityManifest(manifestPath = CAPABILITY_MANIFEST_PATH) {
  const payload = readJsonRawSafe(manifestPath, null) || {};
  return Array.isArray(payload.capabilities) ? payload.capabilities : [];
}

function capabilityMatches(capability = {}, context = {}) {
  const trigger = capability && capability.trigger && typeof capability.trigger === "object"
    ? capability.trigger
    : {};
  const familyIn = normalizeArray(trigger.dominant_mismatch_family_in);
  const qualityIn = normalizeArray(trigger.quality_status_in);
  const verdictIn = normalizeArray(trigger.objective_verdict_in);
  const authorityIn = normalizeArray(trigger.authority_state_in);

  if (typeof trigger.needs_signal_deep_dive === "boolean" && trigger.needs_signal_deep_dive !== Boolean(context.needs_signal_deep_dive)) {
    return false;
  }
  if (typeof trigger.needs_ev_policy_deep_dive === "boolean" && trigger.needs_ev_policy_deep_dive !== Boolean(context.needs_ev_policy_deep_dive)) {
    return false;
  }
  if (typeof trigger.needs_other_server_policy_deep_dive === "boolean" && trigger.needs_other_server_policy_deep_dive !== Boolean(context.needs_other_server_policy_deep_dive)) {
    return false;
  }
  if (typeof trigger.needs_cooldown_policy_deep_dive === "boolean" && trigger.needs_cooldown_policy_deep_dive !== Boolean(context.needs_cooldown_policy_deep_dive)) {
    return false;
  }
  if (familyIn.length && !familyIn.includes(String(context.dominant_mismatch_family || "").trim().toUpperCase())) {
    return false;
  }
  if (qualityIn.length && !qualityIn.includes(String(context.quality_status || "").trim().toUpperCase())) {
    return false;
  }
  if (verdictIn.length && !verdictIn.includes(String(context.objective_verdict || "").trim().toUpperCase())) {
    return false;
  }
  if (authorityIn.length && !authorityIn.includes(String(context.authority_state || "").trim().toUpperCase())) {
    return false;
  }
  return true;
}

function applyCapabilityManifest(steps = [], context = {}, capabilities = []) {
  const rows = Array.isArray(steps) ? [...steps] : [];
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    if (!capability || !capability.id || !capability.script) continue;
    if (!capabilityMatches(capability, context)) continue;
    if (rows.some((row) => row.id === capability.id)) continue;

    const step = {
      id: capability.id,
      script: capability.script,
      contextual: true,
      trigger_reason: capability.trigger_reason
        || String(context.dominant_mismatch_family || context.quality_status || "CAPABILITY_TRIGGER"),
      capability_id: capability.id,
      capability_side_effect: capability.side_effect || null,
      capability_type: capability.type || null,
    };

    const insertBefore = String(capability.insert_before || "").trim();
    const insertAfter = String(capability.insert_after || "").trim();
    if (insertBefore) {
      const idx = rows.findIndex((row) => row.id === insertBefore);
      if (idx >= 0) {
        rows.splice(idx, 0, step);
        continue;
      }
    }
    if (insertAfter) {
      const idx = rows.findIndex((row) => row.id === insertAfter);
      if (idx >= 0) {
        rows.splice(idx + 1, 0, step);
        continue;
      }
    }
    rows.push(step);
  }
  return rows;
}

function buildStepPlan(context = {}, capabilityDefs = null) {
  const steps = [
    { id: "dataset", script: "report-best-self-evolution-dataset.js" },
    { id: "canonical_engine_parity", script: "report-best-self-evolution-canonical-engine-parity.js" },
    { id: "server_signal_authority", script: "report-server-signal-authority.js" },
    { id: "server_signal_quality", script: "report-server-signal-quality.js" },
    { id: "server_signal_runtime", script: "report-server-signal-runtime.js" },
    { id: "server_signal_cutover_readiness", script: "report-server-signal-cutover-readiness.js" },
    { id: "drop_validation", script: "report-best-self-evolution-drop-validation.js" },
    { id: "provisional_realized_outcome", script: "report-best-self-evolution-provisional-realized-outcome.js" },
    { id: "override_authority", script: "report-best-self-evolution-override-authority.js" },
    { id: "execution_quality", script: "report-best-self-evolution-execution-quality.js" },
    { id: "reverse_policy", script: "report-best-self-evolution-reverse-policy.js" },
    { id: "canonical_engine_provenance", script: "report-best-self-evolution-canonical-engine-provenance.js" },
    { id: "server_primary_canary", script: "report-best-self-evolution-server-primary-canary.js" },
    { id: "server_primary_acceptance_watch", script: "report-best-self-evolution-server-primary-acceptance-watch.js" },
    { id: "server_primary_learning_epoch", script: "report-best-self-evolution-server-primary-learning-epoch.js" },
    { id: "initial_signal_quality_contract", script: "report-best-self-evolution-initial-signal-quality-contract.js" },
    { id: "exit_trailing_contract", script: "report-best-self-evolution-exit-trailing-contract.js" },
    { id: "server_native_htf_mode_comparison", script: "report-best-self-evolution-server-native-htf-mode-comparison.js" },
    { id: "server_native_htf_mode_governor", script: "report-best-self-evolution-server-native-htf-mode-governor.js" },
    { id: "pine_shadow_drift", script: "report-best-self-evolution-pine-shadow-drift.js" },
    { id: "deployment_probe", script: "report-best-self-evolution-deployment-probe.js" },
    { id: "bundle_activation", script: "report-best-self-evolution-bundle-activation.js" },
    { id: "objective_seed", script: "automation-objective-supervisor.js", env: { OBJECTIVE_SUPERVISOR_SKIP_TELEGRAM: "1", OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE: "SEED" } },
    { id: "objective", script: "report-best-self-evolution-objective.js" },
    { id: "market_objective_score", script: "report-best-self-evolution-market-objective-score.js" },
    { id: "server_vs_pine_performance_delta", script: "report-best-self-evolution-server-vs-pine-performance-delta.js" },
    { id: "openclaw_market_regime_board", script: "report-best-self-evolution-openclaw-market-regime-board.js" },
    { id: "exploration_budget", script: "report-best-self-evolution-exploration-budget.js" },
    { id: "server_market_capital_allocator", script: "report-best-self-evolution-server-market-capital-allocator.js" },
    { id: "server_market_quarantine", script: "report-best-self-evolution-server-market-quarantine.js" },
    { id: "policy_parameter_plan", script: "report-best-self-evolution-policy-parameter-plan.js" },
    { id: "exploration_proposal", script: "report-best-self-evolution-exploration-proposal.js" },
    { id: "exploration_apply_candidate", script: "report-best-self-evolution-exploration-apply-candidate.js" },
    { id: "change_result_attribution", script: "report-best-self-evolution-change-result-attribution.js" },
    { id: "attribution", script: "report-best-self-evolution-attribution.js" },
    { id: "candidates", script: "report-best-self-evolution-candidates.js" },
    { id: "replay", script: "report-best-self-evolution-replay.js" },
    { id: "filter_shadow_canary", script: "automation-filter-shadow-canary.js" },
    { id: "canary", script: "report-best-self-evolution-canary.js" },
    { id: "memory", script: "report-best-self-evolution-memory-ledger.js" },
    { id: "deployment_guards", script: "report-best-self-evolution-deployment-guards.js" },
    { id: "objective_recovery_governor", script: "report-best-self-evolution-objective-recovery-governor.js" },
    { id: "objective_recovery_effect", script: "report-best-self-evolution-objective-recovery-effect.js" },
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
    { id: "openclaw_autonomy_contract", script: "report-best-self-evolution-openclaw-autonomy-contract.js" },
    { id: "objective_integrated", script: "automation-objective-supervisor.js", env: { OBJECTIVE_SUPERVISOR_SKIP_TELEGRAM: "1", OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE: "INTEGRATED" } },
    { id: "objective_final", script: "automation-objective-supervisor.js", env: { OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE: "FINAL" } },
    { id: "reasoning_journal", script: "report-best-self-evolution-reasoning-journal.js" },
    { id: "openclaw_autonomy_parity", script: "report-best-self-evolution-openclaw-autonomy-parity.js" },
    { id: "family_scoreboard", script: "report-best-self-evolution-family-scoreboard.js" },
    { id: "loop_monitor", script: "report-best-self-evolution-loop-monitor.js" },
    { id: "stage_autopilot", script: "automation-stage-autopilot.js", env: { STAGE_AUTOPILOT_SKIP_TELEGRAM: "1" } },
  ];

  const capabilities = Array.isArray(capabilityDefs) ? capabilityDefs : loadCapabilityManifest();
  return applyCapabilityManifest(steps, context, capabilities);
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
  const planningContext = buildPlanningContext();
  const steps = buildStepPlan(planningContext);
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
      contextual: step.contextual === true,
      trigger_reason: step.trigger_reason || null,
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
    planning_context: planningContext,
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
    buildPlanningContext,
    applyCapabilityManifest,
    buildStepPlan,
    capabilityMatches,
    extractJson,
    loadCapabilityManifest,
    renderMarkdown,
  },
};
