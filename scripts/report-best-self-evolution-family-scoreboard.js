#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

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
const { buildFamilyScoreboard } = require("../src/utils/openclawFamilyScoreboard");

loadLocalEnv();

const INPUTS = Object.freeze({
  quality: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
  cutover: path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"),
  observation: path.join(OPS_DAILY_DIR, "server_signal_observation_24h_latest.json"),
  reasoningJournal: path.join(OPS_DAILY_DIR, "best_self_evolution_reasoning_journal_latest.json"),
  autonomyParity: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_parity_latest.json"),
  capabilities: path.join(__dirname, "..", "ops", "manifests", "openclaw-evolution-capabilities.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Family Scoreboard",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- tracked_family_n: ${summary.tracked_family_n ?? 0}`,
    `- dominant_mismatch_family: ${summary.dominant_mismatch_family || "N/A"}`,
    "",
    "## Families",
  ];
  for (const row of rows) {
    lines.push(`- ${row.family}: mismatch_n=${row.mismatch_n} / status=${row.status} / action=${row.recommended_action || "N/A"} / capabilities=${(row.capability_ids || []).join("|") || "none"} / verification=${row.verification_hint || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const capabilitiesPayload = readJsonRawSafe(INPUTS.capabilities, null) || {};
  const report = buildFamilyScoreboard({
    quality: readJsonRawSafe(INPUTS.quality, null),
    cutover: readJsonRawSafe(INPUTS.cutover, null),
    observation: readJsonRawSafe(INPUTS.observation, null),
    reasoningJournal: readJsonRawSafe(INPUTS.reasoningJournal, null),
    autonomyParity: readJsonRawSafe(INPUTS.autonomyParity, null),
    capabilities: Array.isArray(capabilitiesPayload.capabilities) ? capabilitiesPayload.capabilities : [],
  });

  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: INPUTS,
    ...report,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_family_scoreboard.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_family_scoreboard.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_family_scoreboard_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_family_scoreboard_latest.md");

  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("family_scoreboard_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("family_scoreboard_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: output.cycle_id,
    tracked_family_n: output.summary.tracked_family_n,
    dominant_mismatch_family: output.summary.dominant_mismatch_family,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_FAMILY_SCOREBOARD_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
