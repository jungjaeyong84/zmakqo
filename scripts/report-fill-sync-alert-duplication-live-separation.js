#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function buildSeparatedReport(audit = {}) {
  const allRows = Array.isArray(audit.top_duplicate_groups_all) ? audit.top_duplicate_groups_all : [];
  const liveRows = Array.isArray(audit.top_duplicate_groups) ? audit.top_duplicate_groups : [];
  const historicalRows = Array.isArray(audit.historical_backfilled_duplicate_groups)
    ? audit.historical_backfilled_duplicate_groups
    : allRows.filter((row) => row && row.backfilled === true);
  const liveSymbols = [...new Set(liveRows.map((row) => upper(row && row.symbol)).filter(Boolean))];
  const historicalSymbols = [...new Set(historicalRows.map((row) => upper(row && row.symbol)).filter(Boolean))];
  const overlap = liveSymbols.filter((symbol) => historicalSymbols.includes(symbol));
  return {
    generated_at_iso: nowIso(),
    source_generated_at_iso: audit.generated_at || null,
    source_path: "ops/daily/fill_sync_alert_duplication_latest.json",
    lookback_days: Number(audit.lookback_days) || null,
    live_duplicate_group_n: liveRows.length,
    historical_backfilled_duplicate_group_n: historicalRows.length,
    live_symbols: liveSymbols,
    historical_backfilled_symbols: historicalSymbols,
    overlap_symbols: overlap,
    live_duplicate_groups: liveRows,
    historical_backfilled_duplicate_groups: historicalRows,
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Fill Sync Alert Duplication Live Separation");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- source_generated_at: ${report.source_generated_at_iso || "N/A"}`);
  lines.push(`- live_duplicate_group_n: ${report.live_duplicate_group_n || 0}`);
  lines.push(`- historical_backfilled_duplicate_group_n: ${report.historical_backfilled_duplicate_group_n || 0}`);
  lines.push(`- overlap_symbols: ${Array.isArray(report.overlap_symbols) && report.overlap_symbols.length ? report.overlap_symbols.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Live Duplicate Groups");
  if (!Array.isArray(report.live_duplicate_groups) || !report.live_duplicate_groups.length) {
    lines.push("- none");
  } else {
    for (const row of report.live_duplicate_groups.slice(0, 30)) {
      lines.push(`- ${row.symbol} | event=${row.event} | order_id=${row.order_id || "NA"} | fill_count=${row.fill_count}`);
    }
  }
  lines.push("");
  lines.push("## Historical Backfilled Duplicate Groups");
  if (!Array.isArray(report.historical_backfilled_duplicate_groups) || !report.historical_backfilled_duplicate_groups.length) {
    lines.push("- none");
  } else {
    for (const row of report.historical_backfilled_duplicate_groups.slice(0, 30)) {
      lines.push(`- ${row.symbol} | event=${row.event} | order_id=${row.order_id || "NA"} | fill_count=${row.fill_count}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const outDir = path.join(process.cwd(), "ops", "daily");
  const auditPath = path.join(outDir, "fill_sync_alert_duplication_latest.json");
  const audit = readJson(auditPath);
  const report = buildSeparatedReport(audit);
  const jsonPath = path.join(outDir, "fill_sync_alert_duplication_live_separation_latest.json");
  const mdPath = path.join(outDir, "fill_sync_alert_duplication_live_separation_latest.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${buildMarkdown(report)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    live_duplicate_group_n: report.live_duplicate_group_n,
    historical_backfilled_duplicate_group_n: report.historical_backfilled_duplicate_group_n,
    overlap_symbols: report.overlap_symbols,
    output_json: jsonPath,
    output_md: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_FILL_SYNC_ALERT_DUPLICATION_LIVE_SEPARATION_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      buildSeparatedReport,
      buildMarkdown,
    },
  };
}
