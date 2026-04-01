#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { summarizeOpenclawOverrideAuthority } = require("../src/utils/openclawOverrideAuthority");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const PROVIDER = String(process.env.BEST_SELF_EVOLUTION_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const MARKET_OBJECTIVE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_market_objective_score_latest.json");
const SERVER_VS_PINE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_vs_pine_performance_delta_latest.json");
const DROP_VALIDATION_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Override Authority",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- provider: ${report.provider || "N/A"}`,
    "",
    "## Summary",
    `- status: ${summary.status || "N/A"}`,
    `- max_market_overrides_per_cycle: ${summary.max_market_overrides_per_cycle ?? "N/A"}`,
    `- risk_override_enabled: ${summary.risk_override_enabled ? "YES" : "NO"}`,
    `- current_source_mode: ${summary.current_source_mode || "N/A"}`,
    "",
    "## Bounds",
  ];
  for (const [key, value] of Object.entries(summary.bounds || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Priority Markets");
  const rows = Array.isArray(summary.priority_markets) ? summary.priority_markets : [];
  if (!rows.length) lines.push("- none");
  for (const row of rows) {
    lines.push(`- ${row.market}: score ${row.score} / reasons ${(row.reasons || []).join("|") || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const currentSys = await getSystemSettingsForProvider(PROVIDER, 0);
  const marketObjectiveScore = readJsonRawSafe(MARKET_OBJECTIVE_PATH, null);
  const serverVsPinePerformanceDelta = readJsonRawSafe(SERVER_VS_PINE_PATH, null);
  const dropValidation = readJsonRawSafe(DROP_VALIDATION_PATH, null);

  const summary = summarizeOpenclawOverrideAuthority({
    currentSys,
    marketObjectiveScore,
    serverVsPinePerformanceDelta,
    dropValidation,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.cycle_id,
    provider: PROVIDER,
    inputs: {
      market_objective_score: MARKET_OBJECTIVE_PATH,
      server_vs_pine_performance_delta: SERVER_VS_PINE_PATH,
      drop_validation: DROP_VALIDATION_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_override_authority`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_override_authority_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_override_authority_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copyLatest(jsonPath, selfEvolutionSnapshotLatestPath("override_authority_latest.json"));
  copyLatest(mdPath, selfEvolutionSnapshotLatestPath("override_authority_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: cycleMeta.cycle_id,
    status: summary.status,
    max_market_overrides_per_cycle: summary.max_market_overrides_per_cycle,
    top_priority_markets: (summary.top_priority_markets || []).map((row) => row.market),
    latest_json: latestJsonPath,
  }));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
