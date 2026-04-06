#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildLineageSloDropMonitor } = require("../src/utils/lineageSloDropMonitor");

const SIGNAL_LINEAGE_HEALTH_LATEST_PATH = path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json");
const SIGNAL_DROPS_CACHE_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# Lineage SLO Drop Monitor",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- evidence_status: ${summary.evidence_status || "N/A"}`,
    `- monitored_reason: ${summary.monitored_reason || "N/A"}`,
    `- lineage_generated_at: ${summary.lineage_generated_at || "N/A"}`,
    `- entry_fills_intent_id_null_rate: ${summary.entry_fills_intent_id_null_rate != null ? summary.entry_fills_intent_id_null_rate : "N/A"}`,
    `- external_reconciled_fills_intent_id_null_n: ${summary.external_reconciled_fills_intent_id_null_n != null ? summary.external_reconciled_fills_intent_id_null_n : "N/A"}`,
    `- total_lineage_slo_drop_n: ${summary.total_lineage_slo_drop_n ?? 0}`,
    `- post_fix_lineage_slo_drop_n: ${summary.post_fix_lineage_slo_drop_n ?? 0}`,
    `- pre_fix_lineage_slo_drop_n: ${summary.pre_fix_lineage_slo_drop_n ?? 0}`,
    `- latest_lineage_slo_drop: ${summary.latest_lineage_slo_drop_created_at || "N/A"} / ${summary.latest_lineage_slo_drop_market || "N/A"} / ${summary.latest_lineage_slo_drop_event || "N/A"}`,
    `- post_fix_clear: ${summary.post_fix_clear ? "YES" : "NO"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const meta = nowKstMeta();
  const report = {
    ok: true,
    generated_at_kst: meta.kst,
    summary: buildLineageSloDropMonitor({
      signalLineageHealth: readJsonRawSafe(SIGNAL_LINEAGE_HEALTH_LATEST_PATH, null),
      droppedSignals: readJsonRawSafe(SIGNAL_DROPS_CACHE_PATH, null),
    }),
  };

  const base = `${meta.dateKey}_${meta.hhmm}_lineage_slo_drop_monitor`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "lineage_slo_drop_monitor_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "lineage_slo_drop_monitor_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);

  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
    evidence_status: report.summary.evidence_status,
    post_fix_lineage_slo_drop_n: report.summary.post_fix_lineage_slo_drop_n,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("LINEAGE_SLO_DROP_MONITOR_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
