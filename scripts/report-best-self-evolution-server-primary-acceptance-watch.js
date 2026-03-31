#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveServerPrimaryAcceptanceWatch } = require("../src/utils/serverPrimaryAcceptanceWatch");

loadLocalEnv();

const INPUTS = Object.freeze({
  autonomyContract: path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_autonomy_contract_latest.json"),
  serverPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Server-Primary Acceptance Watch",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- phase_d_status: ${summary.phase_d_status || "N/A"}`,
    `- phase_d_ready: ${summary.phase_d_ready ? "YES" : "NO"}`,
    `- reason: ${summary.phase_d_reason || "N/A"}`,
    `- markets: ${summary.configured_server_primary_markets_n || 0} / ${Array.isArray(summary.configured_server_primary_markets) && summary.configured_server_primary_markets.length ? summary.configured_server_primary_markets.join(", ") : "none"}`,
    `- observed/executed/realized: ${summary.observed_n || 0} / ${summary.executed_n || 0} / ${summary.realized_n || 0}`,
    `- disagreement: ${summary.disagreement_rate != null ? summary.disagreement_rate : "N/A"} <= ${summary.max_disagreement_rate != null ? summary.max_disagreement_rate : "N/A"}`,
    `- rollback: ${summary.rollback_trigger_n || 0} <= ${summary.max_rollback_trigger_n != null ? summary.max_rollback_trigger_n : "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = deriveServerPrimaryAcceptanceWatch({
    autonomyContract: readJsonRawSafe(INPUTS.autonomyContract, null),
    serverPrimaryCanary: readJsonRawSafe(INPUTS.serverPrimaryCanary, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.cycle_id,
    inputs: { ...INPUTS },
    ...report,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_server_primary_acceptance_watch.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_server_primary_acceptance_watch.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_acceptance_watch_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_acceptance_watch_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_SERVER_PRIMARY_ACCEPTANCE_WATCH_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
