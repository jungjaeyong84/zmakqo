#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { buildV3BootstrapLiveSeedReport } = require("../src/v3/bootstrapLiveSeed");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_bootstrap_live_seed_latest.json");
const ENTRY_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_entry_ledger.jsonl");
const EXIT_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_exit_ledger.jsonl");
const STATIC_SEED_PATH = path.join(OPS_RUNTIME, "v3_bootstrap_seed.jsonl");
const LIVE_SEED_PATH = path.join(OPS_RUNTIME, "v3_bootstrap_live_seed.jsonl");
const SOURCE_FEED_PATH = path.join(OPS_RUNTIME, "v3_raw_signal_feed.jsonl");

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

function writeJsonlRows(filePath, rows = []) {
  const payload = (Array.isArray(rows) ? rows : [])
    .map((row) => JSON.stringify(row))
    .join("\n");
  fs.writeFileSync(filePath, payload ? `${payload}\n` : "");
  return Array.isArray(rows) ? rows.length : 0;
}

function buildSignalLookup(signalRows = []) {
  const lookup = Object.create(null);
  for (const row of Array.isArray(signalRows) ? signalRows : []) {
    const signalId = String(row && row.signal_id || "").trim();
    if (!signalId) continue;
    const features = row && row.features_json && typeof row.features_json === "object" ? row.features_json : {};
    lookup[signalId] = Object.freeze({
      setup_type: features.setup_type,
      structural_regime: features.structural_regime,
      edge_cohort: features.edge_cohort,
      profile_id: features.profile_id,
      entry_grade: features.entry_grade,
      market_quality_score: features.market_quality_score,
      spread_bps: features.spread_bps,
      funding_rate: features.funding_rate,
      btc_1h_trend: features.btc_1h_trend,
      mtf_1h_direction: features.mtf_1h_direction,
      feature_lineage_source: features.feature_lineage_source,
      signal_price: features.signal_price,
      stop_price: features.stop_price,
      target_price: features.target_price,
    });
  }
  return lookup;
}

async function main() {
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  fs.mkdirSync(OPS_RUNTIME, { recursive: true });

  const entryRows = readJsonlRows(ENTRY_LEDGER_PATH);
  const exitRows = readJsonlRows(EXIT_LEDGER_PATH);
  const staticSeedRows = readJsonlRows(STATIC_SEED_PATH);
  const sourceSignalRows = readJsonlRows(SOURCE_FEED_PATH);
  const report = buildV3BootstrapLiveSeedReport({
    entryRows,
    exitRows,
    staticSeedRows,
    explicitRiskUnitUsdt: process.env.V3_PAPER_BOOTSTRAP_LIVE_RISK_UNIT_USDT,
    signalLookup: buildSignalLookup(sourceSignalRows),
  });
  const writtenRowN = writeJsonlRows(LIVE_SEED_PATH, report.live_seed_rows);
  const payload = {
    generated_at: new Date().toISOString(),
    source: "V3_LOCAL_PAPER_BOOTSTRAP_LIVE_SEED",
    entry_ledger_path: ENTRY_LEDGER_PATH,
    exit_ledger_path: EXIT_LEDGER_PATH,
    static_seed_path: STATIC_SEED_PATH,
    live_seed_path: LIVE_SEED_PATH,
    source_feed_path: SOURCE_FEED_PATH,
    static_seed_reference_n: staticSeedRows.length,
    written_row_n: writtenRowN,
    ...report,
    live_seed_preview: report.live_seed_rows.slice(0, 20),
  };
  delete payload.live_seed_rows;
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    live_seed_path: LIVE_SEED_PATH,
    live_seed_row_n: writtenRowN,
    risk_unit_usdt: payload.risk_unit_usdt,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("REPORT_V3_BOOTSTRAP_LIVE_SEED_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
