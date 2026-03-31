#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  shouldWriteSelfEvolutionLatest,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveDeploymentPlan } = require("../src/utils/bestSelfEvolutionDeploymentPlan");
const {
  resolveSelfEvolutionRuntimeState,
  syncPreparedSelfEvolutionRuntime,
} = require("../src/utils/selfEvolutionRuntimeState");
const { syncStrategyRuntimeFiles } = require("./lib/self-evolution-version-sync");
const { syncSelfEvolutionLiveServices } = require("./lib/self-evolution-live-service-sync");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json"),
  changeControl: path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json"),
  codexPatch: selfEvolutionSnapshotLatestPath("self_evolution_authority_latest.json"),
  deploymentGuards: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_guards_latest.json"),
  candidateChangeSet: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  weeklyHistory: path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json"),
  manualPasteAck: path.join(OPS_RUNTIME_DIR, "self_evolution_manual_paste_ack.json"),
  preparedOverride: path.join(OPS_RUNTIME_DIR, "self_evolution_prepared_override.json"),
  signalsCache: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
  bundleActivation: path.join(OPS_DAILY_DIR, "best_self_evolution_bundle_activation_latest.json"),
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
    `- applied ack/activation: ${summary.manual_paste_acknowledged ? "YES" : "NO"} / ${summary.activation_status || "N/A"}`,
    `- deploy unit: ${summary.deploy_unit_primary || "N/A"} / ${(Array.isArray(summary.deploy_units) && summary.deploy_units.length) ? summary.deploy_units.join("+") : "N/A"}`,
    `- engine/policy bundles: ${summary.prepared_engine_bundle_id || summary.active_engine_bundle_id || "N/A"} / ${summary.prepared_policy_bundle_id || summary.active_policy_bundle_id || "N/A"}`,
    `- rollback engine bundle: ${summary.rollback_engine_bundle_id || "N/A"}`,
    `- authority state: ${summary.authority_state || "N/A"} / pending ${summary.external_authority_pending ? "YES" : "NO"}`,
    `- bundle loaded/data/decision: ${summary.engine_bundle_loaded ? "YES" : "NO"} / ${summary.market_data_flow_ok ? "YES" : "NO"} / ${summary.first_decision_seen ? "YES" : "NO"}`,
    `- wave open/target: ${summary.open_wave ?? "N/A"} / ${summary.target_wave ?? "N/A"}`,
    `- market scope ready/blocked/total: ${summary.market_scope_ready_n ?? 0} / ${summary.market_scope_blocked_n ?? 0} / ${summary.market_scope_n ?? 0}`,
    `- shadow pine overlay prepared/latest: ${summary.prepared_file_path || "N/A"} / ${summary.latest_generated_file_path || "N/A"}`,
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

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return "";
  }
}

function parseEnvLine(text, key) {
  const match = String(text || "").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? String(match[1] || "").trim() : "";
}

function resolveReportCycleId({ preferredCycleId = null, objectiveSupervisor = null, runtimeState = null, fallbackCycleId = null } = {}) {
  const objectiveData = objectiveSupervisor && typeof objectiveSupervisor === "object"
    ? objectiveSupervisor
    : {};
  const runtimeData = runtimeState && typeof runtimeState === "object"
    ? runtimeState
    : {};
  return String(
    preferredCycleId
    || objectiveData.source_cycle_id
    || objectiveData.cycle_id
    || runtimeData.cycle_id
    || runtimeData.source_cycle_id
    || fallbackCycleId
    || ""
  ).trim() || null;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const runtimeState = await resolveSelfEvolutionRuntimeState({ ttlMs: 0 });
  const objectiveSupervisor = readJsonRawSafe(INPUTS.objectiveSupervisor, null);
  const runtimeStateData = runtimeState && runtimeState.data ? runtimeState.data : readJsonRawSafe(INPUTS.manualPasteAck, null);
  const reportCycleId = resolveReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    objectiveSupervisor,
    runtimeState: runtimeStateData,
    fallbackCycleId: cycleMeta.cycle_id,
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    source_cycle_id: String(
      (objectiveSupervisor && (objectiveSupervisor.source_cycle_id || objectiveSupervisor.cycle_id))
      || reportCycleId
      || ""
    ).trim() || null,
    evaluation_cycle_id: cycleMeta.cycle_id,
    inputs: { ...INPUTS },
    ...deriveDeploymentPlan({
      objectiveSupervisor,
      changeControl: readJsonRawSafe(INPUTS.changeControl, null),
      codexPatchReview: readJsonRawSafe(INPUTS.codexPatch, null),
      deploymentGuards: readJsonRawSafe(INPUTS.deploymentGuards, null),
      candidateChangeSet: readJsonRawSafe(INPUTS.candidateChangeSet, null),
      canaryReport: readJsonRawSafe(INPUTS.canary, null),
      stageAutopilot: readJsonRawSafe(INPUTS.stageAutopilot, null),
      weeklyHistory: readJsonRawSafe(INPUTS.weeklyHistory, null),
      manualPasteAck: runtimeStateData,
      preparedOverride: readJsonRawSafe(INPUTS.preparedOverride, null),
      signalsCache: readJsonRawSafe(INPUTS.signalsCache, null),
      bundleActivation: readJsonRawSafe(INPUTS.bundleActivation, null),
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
  const canMutateRuntime = shouldWriteSelfEvolutionLatest();
  const shouldSyncPreparedRuntime = canMutateRuntime
    && !(output.summary && output.summary.manual_paste_acknowledged === true);
  if (shouldSyncPreparedRuntime) {
    await syncPreparedSelfEvolutionRuntime({
      cycle_id: output.cycle_id || null,
      ...(output.summary || {}),
    }, { updatedBy: "deployment_plan_report" });
  }
  let runtimeSync = null;
  const appliedStrategyId = String(output.summary && output.summary.applied_strategy_id || "").trim() || null;
  if (canMutateRuntime && appliedStrategyId) {
    const configSync = syncStrategyRuntimeFiles({ rootDir: process.cwd(), strategyId: appliedStrategyId });
    const syncedEnvText = readTextSafe(path.join(process.cwd(), ".env"));
    const desiredAllowedCsv = parseEnvLine(syncedEnvText, "WEBHOOK_ALLOWED_STRATEGY_IDS");
    const liveServiceSyncEnabled = process.env.SELF_EVOLUTION_SYNC_LIVE_SERVICES !== "0";
    const liveServices = liveServiceSyncEnabled
      ? syncSelfEvolutionLiveServices({
        strategyId: appliedStrategyId,
        engineVersion: configSync.engineVersion,
        desiredAllowedCsv,
      })
      : [];
    runtimeSync = {
      applied_strategy_id: appliedStrategyId,
      engine_version: configSync.engineVersion,
      config_files_synced: configSync.changed,
      live_service_sync_enabled: liveServiceSyncEnabled,
      live_services_synced: liveServices.map((row) => ({
        service: row.service,
        revision: row.after && row.after.revision ? row.after.revision : null,
      })),
    };
  }
  console.log(JSON.stringify({
    ok: true,
    json: jsonPath,
    markdown: mdPath,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
    runtime_sync: runtimeSync,
  }));
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
    resolveReportCycleId,
    renderMarkdown,
  },
};
