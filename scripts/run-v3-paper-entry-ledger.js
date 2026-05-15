#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { loadLocalEnv } = require("./lib/automation-utils");
const {
  buildV3PaperEntryLedgerReport,
  __test: {
    compactQueueRows,
    readJsonlRows: readLedgerJsonlRows,
    writeJsonlRows,
    buildRecordedSignalIdSet,
  },
} = require("../src/v3/localPaperEntryLedger");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const QUEUE_PATH = path.join(OPS_RUNTIME, "v3_paper_candidate_queue.jsonl");
const LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_entry_ledger.jsonl");
const EXIT_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_exit_ledger.jsonl");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_paper_entry_ledger_latest.json");

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
  fs.mkdirSync(OPS_RUNTIME, { recursive: true });
  const queueRows = readJsonlRows(QUEUE_PATH);
  const exitRows = readJsonlRows(EXIT_LEDGER_PATH);
  const closedSignalIds = new Set(
    exitRows
      .filter((row) => String(row && row.status || "").trim().toUpperCase() === "CLOSED")
      .map((row) => String(row && row.signal_id || "").trim())
      .filter(Boolean)
  );
  const summary = buildV3PaperEntryLedgerReport(queueRows, {
    ledgerPath: LEDGER_PATH,
    closedSignalIds,
    exitRows,
  });
  const recordedSignalIds = buildRecordedSignalIdSet(readLedgerJsonlRows(LEDGER_PATH));
  const queueCompaction = compactQueueRows(queueRows, { recordedSignalIds });
  writeJsonlRows(QUEUE_PATH, queueCompaction.retained_rows);
  const payload = {
    generated_at: new Date().toISOString(),
    queue_path: QUEUE_PATH,
    ledger_path: LEDGER_PATH,
    exit_ledger_path: EXIT_LEDGER_PATH,
    queue_compaction: queueCompaction,
    ...summary,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    source_queue_n: payload.source_queue_n,
    appended_entry_n: payload.appended_entry_n,
    open_position_n: payload.open_position_n,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V3_PAPER_ENTRY_LEDGER_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
