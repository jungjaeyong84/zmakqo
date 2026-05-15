#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { buildV3PaperPerformanceReport } = require("../src/v3/performanceReport");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const ENTRY_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_entry_ledger.jsonl");
const EXIT_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_exit_ledger.jsonl");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_paper_performance_latest.json");

function readJsonlRows(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((row) => row && typeof row === "object");
  } catch (_) {
    return [];
  }
}

async function main() {
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  const entryRows = readJsonlRows(ENTRY_LEDGER_PATH);
  const exitRows = readJsonlRows(EXIT_LEDGER_PATH);
  const summary = buildV3PaperPerformanceReport(entryRows, exitRows);
  const payload = {
    generated_at: new Date().toISOString(),
    entry_ledger_path: ENTRY_LEDGER_PATH,
    exit_ledger_path: EXIT_LEDGER_PATH,
    ...summary,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    open_position_n: payload.open_position_n,
    today_closed_trade_n: payload.today_closed_trade_n,
    today_win_rate_pct: payload.today_metrics_r && payload.today_metrics_r.win_rate_pct,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("REPORT_V3_PAPER_PERFORMANCE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
