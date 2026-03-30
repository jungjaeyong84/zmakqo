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
    `- candidate_signature: ${report.candidate_signature || "N/A"}`,
    `- applied_strategy_id: ${report.applied_strategy_id || "N/A"}`,
    `- prepared_file_path: ${report.prepared_file_path || "N/A"}`,
    `- latest_generated_file_path: ${report.latest_generated_file_path || "N/A"}`,
    `- canonical_source_path: ${report.canonical_source_path || "N/A"}`,
    `- canonical_source_synced: ${report.canonical_source_synced ? "YES" : "NO"}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  ensureDir(OPS_RUNTIME_DIR);
  const deploymentPlan = readJsonRawSafe(path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"), null) || {};
  const summary = deploymentPlan.summary && typeof deploymentPlan.summary === "object" ? deploymentPlan.summary : {};
  const handoff = deploymentPlan.handoff && typeof deploymentPlan.handoff === "object" ? deploymentPlan.handoff : {};
  const preparedFilePath = String(summary.prepared_file_path || handoff.prepared_file_path || "").trim() || null;
  const latestGeneratedFilePath = String(summary.latest_generated_file_path || handoff.latest_generated_file_path || "").trim() || null;
  const candidateSignature = String(handoff.candidate_signature || summary.target_candidate_id || "").trim() || null;
  const targetCandidateId = String(summary.target_candidate_id || "").trim() || null;
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
    candidate_signature: candidateSignature,
    prepared_file_path: preparedFilePath,
    latest_generated_file_path: latestGeneratedFilePath,
    applied_file_path: sourceFile,
    applied_strategy_id: strategyId,
    canonical_source_path: canonicalSync.canonicalPath,
    canonical_source_synced: canonicalSync.synced,
  };
  const runtimePath = path.join(OPS_RUNTIME_DIR, "self_evolution_manual_paste_ack.json");
  const dailyJsonPath = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.json");
  const dailyMdPath = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.md");
  writeJson(runtimePath, payload);
  writeJson(dailyJsonPath, payload);
  writeText(dailyMdPath, renderMarkdown(payload));
  console.log(JSON.stringify({ ok: true, runtime_json: runtimePath, latest_json: dailyJsonPath, latest_markdown: dailyMdPath, applied_strategy_id: strategyId }));
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
    renderMarkdown,
  },
};
