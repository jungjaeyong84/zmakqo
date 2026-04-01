#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
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
  canonicalParity: 24,
  serverSignalAuthority: 24,
  serverSignalQuality: 24,
  serverSignalRuntime: 24,
  serverSignalCutoverReadiness: 24,
  dropValidation: 24,
  canonicalProvenance: 24,
  serverPrimaryCanary: 24,
  serverPrimaryAcceptanceWatch: 24,
  pineShadowDrift: 24,
  deploymentProbe: 12,
  bundleActivation: 12,
  openclawAutonomyContract: 24,
  objectiveRecoveryGovernor: 24,
  objectiveRecoveryEffect: 24,
  deployment: 12,
  deploymentPlan: 12,
  stageAutopilot: 12,
  weightTuning: 24,
  memory: 24,
  codexPatch: 48,
});

const INPUTS = Object.freeze({
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  candidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  replay: path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  canonicalParity: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json"),
  serverSignalAuthority: path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json"),
  serverSignalQuality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  serverSignalRuntime: path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json"),
  serverSignalCutoverReadiness: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  dropValidation: path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json"),
  canonicalProvenance: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_provenance_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
  serverPrimaryAcceptanceWatch: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_acceptance_watch_latest.json"),
  pineShadowDrift: path.join(OPS_DAILY_DIR, "best_self_evolution_pine_shadow_drift_latest.json"),
  deploymentProbe: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_probe_latest.json"),
  bundleActivation: path.join(OPS_DAILY_DIR, "best_self_evolution_bundle_activation_latest.json"),
  openclawAutonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  objectiveRecoveryGovernor: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json"),
  objectiveRecoveryEffect: path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_effect_latest.json"),
  deployment: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json"),
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  weightTuning: path.join(OPS_DAILY_DIR, "best_self_evolution_weight_tuning_latest.json"),
  memory: path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json"),
  codexPatch: selfEvolutionSnapshotLatestPath("self_evolution_authority_latest.json"),
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
    `- server_signal_authority: ${summary.server_signal_drift_status || "N/A"} / mismatch_rate: ${summary.server_signal_parity_mismatch_rate != null ? summary.server_signal_parity_mismatch_rate : "N/A"}`,
    `- server_signal_quality: ${summary.server_signal_quality_status || "N/A"} / entry_24h: ${summary.server_signal_entry_24h_n ?? "N/A"} / intent_24h: ${summary.server_signal_intent_24h_n ?? "N/A"} / fill_24h: ${summary.server_signal_fill_24h_n ?? "N/A"}`,
    `- server_signal_runtime: ${summary.server_signal_runtime_status || "N/A"} / tf: ${summary.server_signal_runtime_exec_tf || "N/A"} / markets: ${summary.server_signal_runtime_market_count ?? "N/A"}`,
    `- server_signal_cutover: ${summary.server_signal_cutover_status || "N/A"} / ready: ${summary.server_signal_cutover_ready ? "YES" : "NO"} / blockers: ${Array.isArray(summary.server_signal_cutover_blockers) && summary.server_signal_cutover_blockers.length ? summary.server_signal_cutover_blockers.join("|") : "none"}`,
    `- drop_validation: ${summary.drop_validation_status || "N/A"} / top_rescue: ${summary.drop_validation_top_rescue_family || "N/A"} / reason: ${summary.drop_validation_top_rescue_reason || "N/A"} / market: ${summary.drop_validation_top_rescue_market || "N/A"}`,
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

function resolveReportCycleId({ preferredCycleId = null, objectiveSupervisor = null, deploymentPlan = null, fallbackCycleId = null } = {}) {
  const objective = objectiveSupervisor && typeof objectiveSupervisor === "object" ? objectiveSupervisor : {};
  const plan = deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {};
  return String(
    preferredCycleId
    || objective.source_cycle_id
    || objective.cycle_id
    || plan.source_cycle_id
    || plan.cycle_id
    || fallbackCycleId
    || ""
  ).trim() || null;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const artifacts = Object.fromEntries(
    Object.entries(INPUTS).map(([key, filePath]) => [key, readFresh(filePath, MAX_AGE_HOURS[key] || 24)])
  );
  const objectiveSupervisor = artifacts.objectiveSupervisor && artifacts.objectiveSupervisor.data;
  const deploymentPlan = artifacts.deploymentPlan && artifacts.deploymentPlan.data;
  const reportCycleId = resolveReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    objectiveSupervisor,
    deploymentPlan,
    fallbackCycleId: cycleMeta.cycle_id,
  });
  const derived = deriveLoopMonitor({
    artifacts,
    reports: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.data])),
  });
  const dropValidationRaw = artifacts.dropValidation && artifacts.dropValidation.data
    ? ((artifacts.dropValidation.data.raw && typeof artifacts.dropValidation.data.raw === "object")
      ? artifacts.dropValidation.data.raw
      : artifacts.dropValidation.data)
    : {};
  const dropValidationSummary = dropValidationRaw.summary && typeof dropValidationRaw.summary === "object"
    ? dropValidationRaw.summary
    : {};
  const dropValidationRow = {
    loop: "DROP_VALIDATION",
    fresh: artifacts.dropValidation && artifacts.dropValidation.fresh === true,
    cycle_id: String(dropValidationRaw.cycle_id || dropValidationRaw.generation_id || "").trim() || null,
    status: String(dropValidationSummary.status || "N/A").trim().toUpperCase() === "ACTIONABLE_RESCUE_REVIEW"
      ? "WARN"
      : (String(dropValidationSummary.status || "N/A").trim().toUpperCase() === "KEEP_DROP_CONFIRMED"
      ? "PASS"
      : (String(dropValidationSummary.status || "N/A").trim() ? "HOLD" : "N/A")),
    reason: `recent=${dropValidationSummary.recent_drop_n ?? 0} / matured=${dropValidationSummary.matured_reason_n ?? 0} / dominant=${dropValidationSummary.dominant_family || "N/A"}:${dropValidationSummary.dominant_verdict || "N/A"} / rescue=${dropValidationSummary.top_rescue_family || "N/A"}:${dropValidationSummary.top_rescue_reason || "N/A"}:${dropValidationSummary.top_rescue_market || "N/A"}`,
  };
  const rows = Array.isArray(derived.rows) ? derived.rows.slice() : [];
  if (!rows.find((row) => row.loop === "DROP_VALIDATION")) {
    rows.splice(9, 0, dropValidationRow);
  }
  const summary = {
    ...(derived.summary || {}),
    drop_validation_status: dropValidationSummary.status || derived.summary && derived.summary.drop_validation_status || null,
    drop_validation_top_rescue_family: dropValidationSummary.top_rescue_family || derived.summary && derived.summary.drop_validation_top_rescue_family || null,
    drop_validation_top_rescue_reason: dropValidationSummary.top_rescue_reason || derived.summary && derived.summary.drop_validation_top_rescue_reason || null,
    drop_validation_top_rescue_market: dropValidationSummary.top_rescue_market || derived.summary && derived.summary.drop_validation_top_rescue_market || null,
    loop_n: rows.length,
    fresh_loop_n: rows.filter((row) => row.fresh === true).length,
  };
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    source_cycle_id: String(
      (objectiveSupervisor && (objectiveSupervisor.source_cycle_id || objectiveSupervisor.cycle_id))
      || (deploymentPlan && (deploymentPlan.source_cycle_id || deploymentPlan.cycle_id))
      || reportCycleId
      || ""
    ).trim() || null,
    evaluation_cycle_id: cycleMeta.cycle_id,
    inputs: { ...INPUTS },
    summary,
    rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_monitor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_loop_monitor.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
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
    resolveReportCycleId,
    renderMarkdown,
  },
};
