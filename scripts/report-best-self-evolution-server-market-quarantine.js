#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { deriveServerMarketQuarantine } = require("../src/utils/serverMarketQuarantine");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const SERVER_MARKET_CAPITAL_ALLOCATOR_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Server Market Quarantine",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- quarantine_market_n: ${summary.quarantine_market_n ?? "N/A"}`,
    `- top_quarantine_market: ${summary.top_quarantine_market || "N/A"}`,
    `- top_quarantine_reason: ${summary.top_quarantine_reason || "N/A"}`,
    `- top_quarantine_severity: ${summary.top_quarantine_severity || "N/A"}`,
    "",
    "## Markets",
    ...(Array.isArray(summary.by_market) && summary.by_market.length
      ? summary.by_market.map((row) => `- ${row.market}: ${row.quarantine_reason || "N/A"} / severity=${row.quarantine_severity || "N/A"} / score=${row.allocation_score != null ? row.allocation_score : "N/A"} / action=${row.recommended_action || "N/A"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const serverMarketCapitalAllocator = readJsonRawSafe(SERVER_MARKET_CAPITAL_ALLOCATOR_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [serverMarketCapitalAllocator],
  });

  const summary = deriveServerMarketQuarantine({ serverMarketCapitalAllocator });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      server_market_capital_allocator: SERVER_MARKET_CAPITAL_ALLOCATOR_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_server_market_quarantine`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_quarantine_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_quarantine_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("server_market_quarantine_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("server_market_quarantine_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: summary.status,
    top_quarantine_market: summary.top_quarantine_market,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_SERVER_MARKET_QUARANTINE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
