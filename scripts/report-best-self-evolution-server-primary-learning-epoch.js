#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { deriveServerPrimaryLearningEpoch } = require("../src/utils/serverPrimaryLearningEpoch");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
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

const RUNTIME_STATE_PATH = path.join(OPS_RUNTIME_DIR, "server_primary_learning_epoch.json");
const SERVER_SIGNAL_RUNTIME_PATH = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json");
const SERVER_PRIMARY_ACCEPTANCE_WATCH_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_acceptance_watch_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Server Primary Learning Epoch",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- started_at: ${summary.started_at || "N/A"}`,
    `- age_days: ${summary.age_days != null ? summary.age_days : "N/A"}`,
    `- learning_window_days: ${summary.learning_window_days != null ? summary.learning_window_days : "N/A"}`,
    `- penalty_weight: ${summary.penalty_weight != null ? summary.penalty_weight : "N/A"}`,
    `- sample_weight: ${summary.sample_weight != null ? summary.sample_weight : "N/A"}`,
    `- exploration_boost: ${summary.exploration_boost != null ? summary.exploration_boost : "N/A"}`,
    `- realized_sample_floor_scale: ${summary.realized_sample_floor_scale != null ? summary.realized_sample_floor_scale : "N/A"}`,
    `- source_mode: ${summary.source_mode || "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  ensureDir(OPS_RUNTIME_DIR);
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const runtime = readJsonRawSafe(SERVER_SIGNAL_RUNTIME_PATH, null);
  const acceptanceWatch = readJsonRawSafe(SERVER_PRIMARY_ACCEPTANCE_WATCH_PATH, null);
  const epochState = readJsonRawSafe(RUNTIME_STATE_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [runtime, acceptanceWatch],
  });

  const summary = deriveServerPrimaryLearningEpoch({
    epochState,
    runtime,
    serverPrimaryAcceptanceWatch: acceptanceWatch,
    nowMs: Date.now(),
  });

  if (!epochState || String(epochState.started_at || "").trim() !== String(summary.started_at || "").trim()) {
    writeJson(RUNTIME_STATE_PATH, {
      started_at: summary.started_at,
      start_source: summary.start_source,
      learning_window_days: summary.learning_window_days,
      learning_focus: summary.learning_focus,
    });
  }

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      runtime: SERVER_SIGNAL_RUNTIME_PATH,
      server_primary_acceptance_watch: SERVER_PRIMARY_ACCEPTANCE_WATCH_PATH,
      runtime_state: RUNTIME_STATE_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_server_primary_learning_epoch`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_learning_epoch_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_learning_epoch_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("server_primary_learning_epoch_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("server_primary_learning_epoch_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    started_at: summary.started_at,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_SERVER_PRIMARY_LEARNING_EPOCH_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
