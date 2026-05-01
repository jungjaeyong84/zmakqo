"use strict";

const fs = require("fs");
const path = require("path");
const { collectOpenClawOutcomeAdjudicationsFromFills } = require("../src/v2/openclawOutcomeAdjudicationCollector");
const { putV2DocsBatch } = require("../src/v2/storage");

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadFills(inputPath) {
  const payload = readJson(inputPath);
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.docs)) return payload.docs;
  if (payload && Array.isArray(payload.fills)) return payload.fills;
  throw new Error("V2_OUTCOME_ADJUDICATION_INPUT_FILLS_REQUIRED");
}

async function main() {
  const inputPath = process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_INPUT_FILE
    || path.join("ops", "daily", "cache", "firestore_recent", "fills_paper.json");
  const outputPath = process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_OUTPUT_FILE
    || path.join("ops", "daily", "v2_openclaw_outcome_adjudication_collector_latest.json");
  const lookbackHours = Number(process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_LOOKBACK_HOURS || 72);
  const writeEnabled = boolFromEnv(process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE, false);
  const maxWrites = Math.max(0, Number(process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_MAX_WRITES || 450));
  const fills = loadFills(inputPath);
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    fills,
    lookbackHours,
    now: process.env.V2_OPENCLAW_OUTCOME_ADJUDICATION_NOW || null,
  });
  const writes = result.adjudications.slice(0, maxWrites).map((doc) => ({
    collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
    doc,
    merge: true,
  }));
  let writeResult = null;
  if (writeEnabled && writes.length) {
    writeResult = await putV2DocsBatch({ writes, env: process.env });
  }
  const artifact = {
    ok: true,
    reason: writeEnabled
      ? "V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_WRITTEN"
      : "V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_DRY_RUN",
    generated_at: new Date().toISOString(),
    input_file: inputPath,
    output_file: outputPath,
    write_enabled: writeEnabled,
    max_writes: maxWrites,
    write_n: writeResult ? writeResult.write_n : 0,
    write_result: writeResult,
    summary: {
      source: result.source,
      lookback_hours: result.lookback_hours,
      scanned_fill_n: result.scanned_fill_n,
      protected_entry_fill_n: result.protected_entry_fill_n,
      realized_exit_group_n: result.realized_exit_group_n,
      adjudication_n: result.adjudication_n,
      skipped_n: result.skipped_n,
    },
    skipped_sample: result.skipped.slice(0, 20),
    adjudication_sample: result.adjudications.slice(0, 20).map((doc) => ({
      openclaw_outcome_adjudication_id: doc.openclaw_outcome_adjudication_id,
      openclaw_decision_id: doc.openclaw_decision_id,
      signal_intent_id: doc.signal_intent_id,
      position_cycle_id: doc.position_cycle_id,
      symbol: doc.evidence && doc.evidence.symbol,
      side: doc.evidence && doc.evidence.side,
      adjudication_label: doc.adjudication_label,
      adjudication_family: doc.adjudication_family,
      realized_exit_event: doc.realized_exit_event,
      realized_pnl: doc.realized_pnl,
      lineage_quality: doc.evidence && doc.evidence.lineage_quality,
      performance_eligibility_basis: doc.evidence && doc.evidence.performance_eligibility_basis,
      adjudicated_at: doc.adjudicated_at,
    })),
  };
  writeJson(outputPath, artifact);
  console.log(JSON.stringify(artifact, null, 2));
  if (!result.adjudication_n) process.exitCode = 1;
}

main().catch((err) => {
  console.error("COLLECT_V2_OPENCLAW_OUTCOME_ADJUDICATIONS_FAIL", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
