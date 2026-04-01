#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  ensureDir,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  resolveSelfEvolutionRuntimeState,
  writeSelfEvolutionRuntimeState,
} = require("../src/utils/selfEvolutionRuntimeState");
const { syncStrategyRuntimeFiles } = require("./lib/self-evolution-version-sync");
const { syncSelfEvolutionLiveServices } = require("./lib/self-evolution-live-service-sync");
const { toKstString } = require("../src/utils/timeKst");

loadLocalEnv();

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return "";
  }
}

function parseStrategyId(filePath) {
  const text = readTextSafe(filePath);
  const match = text.match(/STRATEGY_ID\s*=\s*\"([^\"]+)\"/);
  return match ? String(match[1] || "").trim() || null : null;
}

function parseEnvLine(text, key) {
  const match = String(text || "").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? String(match[1] || "").trim() : "";
}

function syncCanonicalSource(appliedFilePath) {
  const canonicalPath = path.join(process.cwd(), "code", "donbeolja.pine.txt");
  if (!appliedFilePath || !fs.existsSync(appliedFilePath)) return { canonicalPath, synced: false };
  const currentText = readTextSafe(canonicalPath);
  const appliedText = readTextSafe(appliedFilePath);
  if (currentText !== appliedText) fs.copyFileSync(appliedFilePath, canonicalPath);
  return { canonicalPath, synced: true };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Self-Evolution Manual Paste Ack",
    "",
    `- acknowledged_at_kst: ${report.acknowledged_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- target_candidate_id: ${report.target_candidate_id || "N/A"}`,
    `- recommended_target_candidate_id: ${report.recommended_target_candidate_id || "N/A"}`,
    `- candidate_signature: ${report.candidate_signature || "N/A"}`,
    `- applied_strategy_id: ${report.applied_strategy_id || "N/A"}`,
    `- prepared_file_path: ${report.prepared_file_path || "N/A"}`,
    `- latest_generated_file_path: ${report.latest_generated_file_path || "N/A"}`,
    `- canonical_source_path: ${report.canonical_source_path || "N/A"}`,
    `- canonical_source_synced: ${report.canonical_source_synced ? "YES" : "NO"}`,
    `- authority_required: ${report.authority_required ? "YES" : "NO"}`,
    `- authority_approved: ${report.authority_approved ? "YES" : "NO"}`,
    `- authority_state: ${report.authority_state || "N/A"}`,
    `- external_authority_pending: ${report.external_authority_pending ? "YES" : "NO"}`,
    `- authority_bypass_active_legacy: ${report.authority_bypass_active ? "YES" : "NO"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function pickString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function pickBoolean(...values) {
  for (const value of values) {
    if (value === true) return true;
    if (value === false) return false;
  }
  return false;
}

function buildRuntimeCarryforward(summary = {}, currentRuntime = {}) {
  const liveSignalConfirmed = pickBoolean(
    summary.live_signal_confirmed,
    currentRuntime.live_signal_confirmed
  );
  const confirmationTimedOut = pickBoolean(
    summary.confirmation_timed_out,
    currentRuntime.confirmation_timed_out
  );
  return {
    prepared_stage_ready: summary.prepared_stage_ready === true,
    ready_for_manual_paste: summary.ready_for_manual_paste === true,
    plan_status: pickString(summary.plan_status) || pickString(currentRuntime.plan_status),
    prepared_strategy_id: pickString(summary.prepared_strategy_id) || pickString(currentRuntime.prepared_strategy_id),
    live_signal_confirmed: liveSignalConfirmed,
    live_signal_confirmation_pending: !liveSignalConfirmed && !confirmationTimedOut && pickBoolean(
      summary.live_signal_confirmation_pending,
      currentRuntime.live_signal_confirmation_pending
    ),
    engine_bundle_loaded: pickBoolean(summary.engine_bundle_loaded, currentRuntime.engine_bundle_loaded),
    policy_bundle_loaded: pickBoolean(summary.policy_bundle_loaded, currentRuntime.policy_bundle_loaded),
    market_data_flow_ok: pickBoolean(summary.market_data_flow_ok, currentRuntime.market_data_flow_ok),
    probe_pass: pickBoolean(summary.probe_pass, currentRuntime.probe_pass),
    probe_status: pickString(summary.probe_status) || pickString(currentRuntime.probe_status),
    probe_reason: pickString(summary.probe_reason) || pickString(currentRuntime.probe_reason),
    first_decision_seen: pickBoolean(summary.first_decision_seen, currentRuntime.first_decision_seen),
    first_decision_kind: pickString(summary.first_decision_kind) || pickString(currentRuntime.first_decision_kind),
    first_decision_id: pickString(summary.first_decision_id) || pickString(currentRuntime.first_decision_id),
    first_decision_created_at: pickString(summary.first_decision_created_at) || pickString(currentRuntime.first_decision_created_at),
    first_decision_event: pickString(summary.first_decision_event) || pickString(currentRuntime.first_decision_event),
    first_decision_reason: pickString(summary.first_decision_reason) || pickString(currentRuntime.first_decision_reason),
    confirmation_timed_out: confirmationTimedOut,
    bundle_activation_confirmed: pickBoolean(summary.activation_confirmed, currentRuntime.bundle_activation_confirmed),
    bundle_activation_status: pickString(summary.activation_status) || pickString(currentRuntime.bundle_activation_status),
    bundle_activation_reason: pickString(summary.activation_reason) || pickString(currentRuntime.bundle_activation_reason),
    confirmed_signal_id: pickString(summary.confirmed_signal_id) || pickString(currentRuntime.confirmed_signal_id),
    confirmed_signal_created_at: pickString(summary.confirmed_signal_created_at) || pickString(currentRuntime.confirmed_signal_created_at),
    confirmed_signal_event: pickString(summary.confirmed_signal_event) || pickString(currentRuntime.confirmed_signal_event),
    confirmed_strategy_id: pickString(summary.confirmed_strategy_id) || pickString(currentRuntime.confirmed_strategy_id),
  };
}

async function main() {
  const nowMeta = nowKstMeta();
  const confirmationTimeoutMinutes = Math.max(30, Number(process.env.SELF_EVOLUTION_BUNDLE_CONFIRM_TIMEOUT_MINUTES || 180));
  ensureDir(OPS_RUNTIME_DIR);
  const deploymentPlan = readJsonRawSafe(path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"), null) || {};
  const summary = deploymentPlan.summary && typeof deploymentPlan.summary === "object" ? deploymentPlan.summary : {};
  const currentRuntimeResolved = await resolveSelfEvolutionRuntimeState({ ttlMs: 0 });
  const currentRuntime = currentRuntimeResolved && currentRuntimeResolved.data && typeof currentRuntimeResolved.data === "object"
    ? currentRuntimeResolved.data
    : {};
  const handoff = deploymentPlan.handoff && typeof deploymentPlan.handoff === "object" ? deploymentPlan.handoff : {};
  const preparedFilePath = String(summary.prepared_file_path || handoff.prepared_file_path || "").trim() || null;
  const latestGeneratedFilePath = String(summary.latest_generated_file_path || handoff.latest_generated_file_path || "").trim() || null;
  const targetCandidateId = String(
    summary.prepared_origin_candidate_id
    || summary.applied_origin_candidate_id
    || handoff.applied_origin_candidate_id
    || handoff.candidate_signature
    || summary.target_candidate_id
    || ""
  ).trim() || null;
  const recommendedTargetCandidateId = String(
    summary.recommended_target_candidate_id
    || summary.target_candidate_id
    || ""
  ).trim() || null;
  const candidateSignature = targetCandidateId;
  const sourceFile = preparedFilePath || latestGeneratedFilePath;
  if (!sourceFile || !fs.existsSync(sourceFile)) {
    throw new Error("MANUAL_PASTE_ACK_SOURCE_FILE_MISSING");
  }
  const strategyId = parseStrategyId(sourceFile);
  const canonicalSync = syncCanonicalSource(sourceFile);
  const runtimeCarryforward = buildRuntimeCarryforward(summary, currentRuntime);
  const payload = {
    ok: true,
    acknowledged: true,
    acknowledged_at_kst: nowMeta.kst,
    acknowledged_at_iso: new Date().toISOString(),
    cycle_id: String(deploymentPlan.cycle_id || "").trim() || null,
    target_candidate_id: targetCandidateId,
    recommended_target_candidate_id: recommendedTargetCandidateId,
    candidate_signature: candidateSignature,
    prepared_file_path: preparedFilePath,
    latest_generated_file_path: latestGeneratedFilePath,
    applied_file_path: sourceFile,
    applied_strategy_id: strategyId,
    prepared_stage_ready: runtimeCarryforward.prepared_stage_ready,
    ready_for_manual_paste: runtimeCarryforward.ready_for_manual_paste,
    plan_status: runtimeCarryforward.plan_status,
    prepared_strategy_id: runtimeCarryforward.prepared_strategy_id,
    canonical_source_path: canonicalSync.canonicalPath,
    canonical_source_synced: canonicalSync.synced,
    authority_required: summary.authority_required === true,
    authority_approved: summary.authority_approved === true,
    authority_state: String(summary.authority_state || "").trim() || ((summary.external_authority_pending === true || summary.authority_bypass_active === true) ? "PENDING" : null),
    external_authority_pending: summary.external_authority_pending === true || summary.authority_bypass_active === true,
    authority_bypass_active: false,
    confirmation_timeout_minutes: confirmationTimeoutMinutes,
    live_signal_confirmed: runtimeCarryforward.live_signal_confirmed,
    live_signal_confirmation_pending: runtimeCarryforward.live_signal_confirmation_pending,
    engine_bundle_loaded: runtimeCarryforward.engine_bundle_loaded,
    policy_bundle_loaded: runtimeCarryforward.policy_bundle_loaded,
    market_data_flow_ok: runtimeCarryforward.market_data_flow_ok,
    probe_pass: runtimeCarryforward.probe_pass,
    probe_status: runtimeCarryforward.probe_status,
    probe_reason: runtimeCarryforward.probe_reason,
    first_decision_seen: runtimeCarryforward.first_decision_seen,
    first_decision_kind: runtimeCarryforward.first_decision_kind,
    first_decision_id: runtimeCarryforward.first_decision_id,
    first_decision_created_at: runtimeCarryforward.first_decision_created_at,
    first_decision_event: runtimeCarryforward.first_decision_event,
    first_decision_reason: runtimeCarryforward.first_decision_reason,
    confirmation_timed_out: runtimeCarryforward.confirmation_timed_out,
    bundle_activation_confirmed: runtimeCarryforward.bundle_activation_confirmed,
    bundle_activation_status: runtimeCarryforward.bundle_activation_status,
    bundle_activation_reason: runtimeCarryforward.bundle_activation_reason,
    confirmed_signal_id: runtimeCarryforward.confirmed_signal_id,
    confirmed_signal_created_at: runtimeCarryforward.confirmed_signal_created_at,
    confirmed_signal_event: runtimeCarryforward.confirmed_signal_event,
    confirmed_strategy_id: runtimeCarryforward.confirmed_strategy_id,
  };
  const runtimePath = path.join(OPS_RUNTIME_DIR, "self_evolution_manual_paste_ack.json");
  const dailyJsonPath = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.json");
  const dailyMdPath = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.md");
  writeJson(runtimePath, payload);
  writeJson(dailyJsonPath, payload);
  writeText(dailyMdPath, renderMarkdown(payload));
  await writeSelfEvolutionRuntimeState({
    ...payload,
    confirmation_timeout_minutes: confirmationTimeoutMinutes,
    confirmation_deadline_iso: payload.acknowledged_at_iso
      ? new Date(Date.parse(payload.acknowledged_at_iso) + (confirmationTimeoutMinutes * 60 * 1000)).toISOString()
      : null,
    confirmation_deadline_kst: payload.acknowledged_at_iso
      ? toKstString(Date.parse(payload.acknowledged_at_iso) + (confirmationTimeoutMinutes * 60 * 1000), { fallbackToString: true })
      : null,
    acknowledged: true,
  }, { updatedBy: "manual_paste_ack" });
  const configSync = syncStrategyRuntimeFiles({ rootDir: process.cwd(), strategyId });
  const syncedEnvText = readTextSafe(path.join(process.cwd(), ".env"));
  const desiredAllowedCsv = parseEnvLine(syncedEnvText, "WEBHOOK_ALLOWED_STRATEGY_IDS");
  const liveServiceSyncEnabled = process.env.SELF_EVOLUTION_SYNC_LIVE_SERVICES !== "0";
  const liveServiceSync = liveServiceSyncEnabled
    ? syncSelfEvolutionLiveServices({
      strategyId,
      engineVersion: configSync.engineVersion,
      desiredAllowedCsv,
    })
    : [];
  console.log(JSON.stringify({
    ok: true,
    runtime_json: runtimePath,
    latest_json: dailyJsonPath,
    latest_markdown: dailyMdPath,
    applied_strategy_id: strategyId,
    shared_runtime_state: "SYNCED",
    engine_version: configSync.engineVersion,
    config_files_synced: configSync.changed,
    live_service_sync_enabled: liveServiceSyncEnabled,
    live_services_synced: liveServiceSync.map((row) => ({
      service: row.service,
      revision: row.after && row.after.revision ? row.after.revision : null,
    })),
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SELF_EVOLUTION_MANUAL_PASTE_ACK_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    buildRuntimeCarryforward,
    parseStrategyId,
    parseEnvLine,
    renderMarkdown,
  },
};
