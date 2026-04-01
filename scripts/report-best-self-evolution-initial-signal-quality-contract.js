#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { TRANSITION_CORE_QUALITY_RULE } = require("../src/services/canonicalEngine/signalClassifier");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  ensureDir,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const CURRENT_VERSION_PINE_SYNC_LATEST_PATH = path.join(OPS_DAILY_DIR, "current_version_pine_sync_latest.json");
const SERVER_SIGNAL_RUNTIME_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json");

function parseLineValue(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1] : null;
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return "";
  }
}

function resolvePineSource() {
  const current = readJsonRawSafe(CURRENT_VERSION_PINE_SYNC_LATEST_PATH, null);
  const sourceFilePath = String(current && current.source_file_path || "").trim();
  return {
    strategy_id: String(current && current.strategy_id || "").trim() || null,
    source_file_path: sourceFilePath || null,
    latest_generated_file_path: String(current && current.latest_generated_file_path || "").trim() || null,
  };
}

function derivePineCriteria(filePath) {
  const text = readTextSafe(filePath);
  return {
    early_threshold: Number(parseLineValue(text, /thr_early = input\.float\(([\d.]+)/)),
    core_threshold: Number(parseLineValue(text, /thr_core = input\.float\(([\d.]+)/)),
    diag_c_threshold: Number(parseLineValue(text, /thr_diag_c = input\.float\(([\d.]+)/)),
    long_early_rule: parseLineValue(text, /long_early_raw = (.+)/),
    long_core_rule: parseLineValue(text, /long_core_raw = (.+)/),
    short_early_rule: parseLineValue(text, /short_early_raw = (.+)/),
    short_core_rule: parseLineValue(text, /short_core_raw = (.+)/),
    transition_core_quality_long_rule: parseLineValue(text, /transition_core_quality_long = (.+)/),
    transition_core_quality_short_rule: parseLineValue(text, /transition_core_quality_short = (.+)/),
  };
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const pine = summary.current_visual_pine || {};
  const criteria = summary.pine_signal_criteria || {};
  const server = summary.server_canonical_transition_core_quality || {};
  const lines = [
    "# BEST Self-Evolution Initial Signal Quality Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- strategy_id: ${pine.strategy_id || "N/A"}`,
    `- source_file_path: ${pine.source_file_path || "N/A"}`,
    `- early_threshold: ${criteria.early_threshold != null ? criteria.early_threshold : "N/A"}`,
    `- core_threshold: ${criteria.core_threshold != null ? criteria.core_threshold : "N/A"}`,
    `- diag_c_threshold: ${criteria.diag_c_threshold != null ? criteria.diag_c_threshold : "N/A"}`,
    `- server_transition_core_quality: conf>=${server.confidence_min ?? "N/A"} / posterior>=${server.posterior_min ?? "N/A"} / wave>=${server.wave_conf_min ?? "N/A"} / trisk<=${server.transition_risk_max ?? "N/A"} / align>=${server.field_alignment_min ?? "N/A"} / coh>=${server.coherence_min ?? "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  ensureDir(OPS_DAILY_DIR);
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const runtime = readJsonRawSafe(SERVER_SIGNAL_RUNTIME_LATEST_PATH, null);
  const pineSource = resolvePineSource();
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [runtime, pineSource],
  });
  const pineCriteria = pineSource.source_file_path ? derivePineCriteria(pineSource.source_file_path) : {};
  const summary = {
    status: pineSource.source_file_path ? "INITIAL_SIGNAL_QUALITY_CONTRACT_ACTIVE" : "INITIAL_SIGNAL_QUALITY_CONTRACT_SOURCE_MISSING",
    current_visual_pine: pineSource,
    pine_signal_criteria: pineCriteria,
    server_canonical_transition_core_quality: { ...TRANSITION_CORE_QUALITY_RULE },
    notes: [
      "OpenClaw must track EARLY/CORE visual criteria and server canonical transition-core quality together.",
      "Server canonical quality is authoritative for initial transition CORE acceptance.",
    ],
  };
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      current_version_pine_sync: CURRENT_VERSION_PINE_SYNC_LATEST_PATH,
      server_signal_runtime: SERVER_SIGNAL_RUNTIME_LATEST_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_initial_signal_quality_contract`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_initial_signal_quality_contract_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_initial_signal_quality_contract_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("initial_signal_quality_contract_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("initial_signal_quality_contract_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    strategy_id: pineSource.strategy_id,
    early_threshold: pineCriteria.early_threshold,
    core_threshold: pineCriteria.core_threshold,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_INITIAL_SIGNAL_QUALITY_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
