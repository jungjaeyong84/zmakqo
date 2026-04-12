#!/usr/bin/env node
"use strict";

require("dotenv").config();

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
  const issuesAll = Array.isArray(audit.issues_total) ? audit.issues_total : [];
  const liveIssues = Array.isArray(audit.issues) ? audit.issues : [];
  const backfilledIssues = issuesAll.filter((row) => row && row.backfilled === true);
  const liveSymbols = [...new Set(liveIssues.map((row) => upper(row && row.symbol)).filter(Boolean))];
  const backfilledSymbols = [...new Set(backfilledIssues.map((row) => upper(row && row.symbol)).filter(Boolean))];
  const overlap = liveSymbols.filter((symbol) => backfilledSymbols.includes(symbol));
  return {
    generated_at_iso: nowIso(),
    source_generated_at_iso: audit.generated_at_iso || null,
    source_path: "ops/daily/binance_exit_qty_contract_audit_latest.json",
    lookback_days: Number(audit.lookback_days) || null,
    live_issue_chain_n: liveIssues.length,
    historical_backfilled_issue_chain_n: backfilledIssues.length,
    live_symbols: liveSymbols,
    historical_backfilled_symbols: backfilledSymbols,
    overlap_symbols: overlap,
    live_issue_codes: Array.isArray(audit.issue_code_counts) ? audit.issue_code_counts : [],
    historical_issue_codes: Array.isArray(audit.issue_code_total_counts)
      ? audit.issue_code_total_counts.map((row) => ({ ...row }))
      : [],
    live_issues: liveIssues,
    historical_backfilled_issues: backfilledIssues,
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Binance Exit Qty Live Separation");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- source_generated_at: ${report.source_generated_at_iso || "N/A"}`);
  lines.push(`- live_issue_chain_n: ${report.live_issue_chain_n || 0}`);
  lines.push(`- historical_backfilled_issue_chain_n: ${report.historical_backfilled_issue_chain_n || 0}`);
  lines.push(`- overlap_symbols: ${Array.isArray(report.overlap_symbols) && report.overlap_symbols.length ? report.overlap_symbols.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Live Issues");
  if (!Array.isArray(report.live_issues) || !report.live_issues.length) {
    lines.push("- none");
  } else {
    for (const row of report.live_issues.slice(0, 30)) {
      lines.push(`- ${row.symbol} | chain=${row.chain_key} | issues=${(row.issues || []).map((issue) => issue.code).join(", ") || "none"}`);
    }
  }
  lines.push("");
  lines.push("## Historical Backfilled Issues");
  if (!Array.isArray(report.historical_backfilled_issues) || !report.historical_backfilled_issues.length) {
    lines.push("- none");
  } else {
    for (const row of report.historical_backfilled_issues.slice(0, 30)) {
      lines.push(`- ${row.symbol} | chain=${row.chain_key} | issues=${(row.issues || []).map((issue) => issue.code).join(", ") || "none"}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const outDir = path.join(process.cwd(), "ops", "daily");
  const auditPath = path.join(outDir, "binance_exit_qty_contract_audit_latest.json");
  const audit = readJson(auditPath);
  const report = buildSeparatedReport(audit);
  const jsonPath = path.join(outDir, "binance_exit_qty_live_separation_latest.json");
  const mdPath = path.join(outDir, "binance_exit_qty_live_separation_latest.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${buildMarkdown(report)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    live_issue_chain_n: report.live_issue_chain_n,
    historical_backfilled_issue_chain_n: report.historical_backfilled_issue_chain_n,
    overlap_symbols: report.overlap_symbols,
    output_json: jsonPath,
    output_md: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_BINANCE_EXIT_QTY_LIVE_SEPARATION_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

module.exports = {
  __test: {
    buildSeparatedReport,
  },
};
