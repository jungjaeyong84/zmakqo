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
  const allRows = Array.isArray(audit.top_violations_all) ? audit.top_violations_all : [];
  const unresolvedRows = Array.isArray(audit.top_violations) ? audit.top_violations : [];
  const historicalRows = allRows.filter((row) => row && row.backfilled === true);
  const liveSymbols = [...new Set(unresolvedRows.map((row) => upper(row && row.symbol)).filter(Boolean))];
  const historicalSymbols = [...new Set(historicalRows.map((row) => upper(row && row.symbol)).filter(Boolean))];
  const overlap = liveSymbols.filter((symbol) => historicalSymbols.includes(symbol));
  return {
    generated_at_iso: nowIso(),
    source_generated_at_iso: audit.generated_at || null,
    source_path: "ops/daily/trail_runner_floor_audit_latest.json",
    lookback_days: Number(audit.lookback_days) || null,
    live_violation_n: Number(audit.violation_n) || 0,
    live_violation_total_n: Number(audit.violation_total_n) || 0,
    historical_backfilled_violation_n: historicalRows.length,
    live_symbols: liveSymbols,
    historical_backfilled_symbols: historicalSymbols,
    overlap_symbols: overlap,
    live_violations: unresolvedRows,
    historical_backfilled_violations: historicalRows,
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Trail Runner Floor Live Separation");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- source_generated_at: ${report.source_generated_at_iso || "N/A"}`);
  lines.push(`- live_violation_n: ${report.live_violation_n || 0}`);
  lines.push(`- historical_backfilled_violation_n: ${report.historical_backfilled_violation_n || 0}`);
  lines.push(`- overlap_symbols: ${Array.isArray(report.overlap_symbols) && report.overlap_symbols.length ? report.overlap_symbols.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Live Violations");
  if (!Array.isArray(report.live_violations) || !report.live_violations.length) {
    lines.push("- none");
  } else {
    for (const row of report.live_violations.slice(0, 30)) {
      lines.push(`- ${row.symbol} | run=${row.run_id || "N/A"} | exec=${row.exec_price} | floor=${row.runner_floor_px} | gap=${row.floor_gap_pct}`);
    }
  }
  lines.push("");
  lines.push("## Historical Backfilled Violations");
  if (!Array.isArray(report.historical_backfilled_violations) || !report.historical_backfilled_violations.length) {
    lines.push("- none");
  } else {
    for (const row of report.historical_backfilled_violations.slice(0, 30)) {
      lines.push(`- ${row.symbol} | run=${row.run_id || "N/A"} | exec=${row.exec_price} | floor=${row.runner_floor_px} | gap=${row.floor_gap_pct}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const outDir = path.join(process.cwd(), "ops", "daily");
  const auditPath = path.join(outDir, "trail_runner_floor_audit_latest.json");
  const audit = readJson(auditPath);
  const report = buildSeparatedReport(audit);
  const jsonPath = path.join(outDir, "trail_runner_floor_live_separation_latest.json");
  const mdPath = path.join(outDir, "trail_runner_floor_live_separation_latest.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${buildMarkdown(report)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    live_violation_n: report.live_violation_n,
    historical_backfilled_violation_n: report.historical_backfilled_violation_n,
    overlap_symbols: report.overlap_symbols,
    output_json: jsonPath,
    output_md: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_TRAIL_RUNNER_FLOOR_LIVE_SEPARATION_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

module.exports = {
  __test: {
    buildSeparatedReport,
  },
};
