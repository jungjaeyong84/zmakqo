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
const { writeSelfEvolutionRuntimeState } = require("../src/utils/selfEvolutionRuntimeState");
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

async function main() {
  const nowMeta = nowKstMeta();
  const confirmationTimeoutMinutes = Math.max(30, Number(process.env.SELF_EVOLUTION_BUNDLE_CONFIRM_TIMEOUT_MINUTES || 180));
  ensureDir(OPS_RUNTIME_DIR);
  const deploymentPlan = readJsonRawSafe(path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"), null) || {};
  const summary = deploymentPlan.summary && typeof deploymentPlan.summary === "object" ? deploymentPlan.summary : {};
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
    canonical_source_path: canonicalSync.canonicalPath,
    canonical_source_synced: canonicalSync.synced,
    authority_required: summary.authority_required === true,
    authority_approved: summary.authority_approved === true,
    authority_state: String(summary.authority_state || "").trim() || ((summary.external_authority_pending === true || summary.authority_bypass_active === true) ? "PENDING" : null),
    external_authority_pending: summary.external_authority_pending === true || summary.authority_bypass_active === true,
    authority_bypass_active: false,
    confirmation_timeout_minutes: confirmationTimeoutMinutes,
  };
  const runtimePath = path.join(OPS_RUNTIME_DIR, "self_evolution_manual_paste_ack.json");
  const dailyJsonPath = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.json");
  const dailyMdPath = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.md");
  writeJson(runtimePath, payload);
  writeJson(dailyJsonPath, payload);
  writeText(dailyMdPath, renderMarkdown(payload));
  await writeSelfEvolutionRuntimeState({
    ...payload,
    engine_bundle_loaded: true,
    policy_bundle_loaded: false,
    market_data_flow_ok: false,
    first_decision_seen: false,
    first_decision_kind: null,
    first_decision_id: null,
    first_decision_created_at: null,
    first_decision_event: null,
    first_decision_reason: null,
    confirmation_timeout_minutes: confirmationTimeoutMinutes,
    confirmation_deadline_iso: payload.acknowledged_at_iso
      ? new Date(Date.parse(payload.acknowledged_at_iso) + (confirmationTimeoutMinutes * 60 * 1000)).toISOString()
      : null,
    confirmation_deadline_kst: payload.acknowledged_at_iso
      ? toKstString(Date.parse(payload.acknowledged_at_iso) + (confirmationTimeoutMinutes * 60 * 1000), { fallbackToString: true })
      : null,
    bundle_activation_confirmed: false,
    bundle_activation_status: "PENDING",
    bundle_activation_reason: "PENDING_POLICY_BUNDLE_LOAD",
    acknowledged: true,
    live_signal_confirmed: false,
    confirmed_signal_id: null,
    confirmed_signal_created_at: null,
    confirmed_signal_event: null,
    confirmed_strategy_id: null,
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
    parseStrategyId,
    parseEnvLine,
    renderMarkdown,
  },
};
