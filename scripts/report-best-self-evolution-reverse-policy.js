#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { summarizeReversePolicy } = require("../src/utils/reversePolicy");

loadLocalEnv();

const OBJECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json");
const DROPPED_SIGNALS_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json");
const SIGNALS_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.by_market) ? report.by_market : [];
  const lines = [
    "# BEST Self-Evolution Reverse Policy",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- status: ${summary.status || "N/A"}`,
    `- reverse_drop_n: ${summary.reverse_drop_n ?? 0}`,
    `- reverse_blocked_n: ${summary.reverse_blocked_n ?? 0}`,
    `- reverse_cooldown_n: ${summary.reverse_cooldown_n ?? 0}`,
    `- reverse_revive_n: ${summary.reverse_revive_n ?? 0}`,
    `- reverse_revive_rate: ${summary.reverse_revive_rate ?? "N/A"}`,
    `- top_watch_market: ${summary.top_watch_market || "N/A"} / ${summary.top_watch_reason || "N/A"} / ${summary.top_watch_action || "N/A"}`,
    "",
    "## Markets",
  ];
  if (!rows.length) lines.push("- none");
  for (const row of rows.slice(0, 12)) {
    lines.push(`- ${row.market}: drop=${row.reverse_drop_n} / revive=${row.reverse_revive_n} / blocked=${row.reverse_blocked_n} / cooldown=${row.reverse_cooldown_n} / ${row.verdict} / ${row.recommended_action}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objective = readJsonRawSafe(OBJECTIVE_LATEST_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [objective],
  });
  const dropped = readJsonRawSafe(DROPPED_SIGNALS_PATH, null);
  const signals = readJsonRawSafe(SIGNALS_PATH, null);
  const sys = await getSystemSettingsForProvider("BINANCEFUT", 0);

  const result = summarizeReversePolicy({
    droppedSignals: dropped && Array.isArray(dropped.docs) ? dropped.docs : [],
    signals: signals && Array.isArray(signals.docs) ? signals.docs : [],
    currentSys: sys && sys.data ? sys.data : null,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      objective_latest_path: OBJECTIVE_LATEST_PATH,
      dropped_signals_path: DROPPED_SIGNALS_PATH,
      signals_path: SIGNALS_PATH,
    },
    summary: result.summary,
    by_market: result.by_market,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_reverse_policy`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_reverse_policy_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copyLatest(jsonPath, selfEvolutionSnapshotLatestPath("reverse_policy_latest.json"));
  copyLatest(mdPath, selfEvolutionSnapshotLatestPath("reverse_policy_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    cycle_id: reportCycleId,
    status: report.summary.status,
    reverse_drop_n: report.summary.reverse_drop_n,
    reverse_revive_n: report.summary.reverse_revive_n,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_REVERSE_POLICY_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
