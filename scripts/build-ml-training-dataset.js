#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  buildMlTrainingRow,
  summarizeMlTrainingRows,
  ML_DATASET_SCHEMA_VERSION,
} = require("../src/utils/mlDatasetSchema");
const { buildBestSelfEvolutionDataset } = require("../src/utils/bestSelfEvolutionDataset");

const DATASET_LATEST_JSON = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");
const EV_TUNER_LATEST_JSON = path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json");
const RECENT_CACHE_DIR = path.join(OPS_DAILY_DIR, "cache", "firestore_recent");
const CACHE_PATHS = Object.freeze({
  signals: path.join(RECENT_CACHE_DIR, "signals.json"),
  drops: path.join(RECENT_CACHE_DIR, "signals_dropped.json"),
  intents: path.join(RECENT_CACHE_DIR, "order_intents_paper.json"),
  fills: path.join(RECENT_CACHE_DIR, "fills_paper.json"),
  trades: path.join(RECENT_CACHE_DIR, "trades_paper.json"),
});
const SOURCE_MODE = String(process.env.ML_TRAINING_DATASET_SOURCE_MODE || "ARTIFACT").trim().toUpperCase();
const DEFAULT_PROVIDER = String(process.env.BEST_SELF_EVOLUTION_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const DEFAULT_TF = String(process.env.BEST_SELF_EVOLUTION_TF || "15m").trim();
const DEFAULT_WINDOW_DAYS = Math.max(1, Number(process.env.BEST_SELF_EVOLUTION_WINDOW_DAYS || 7));

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readRecentCacheDocs(value) {
  const raw = value && typeof value === "object" ? value : {};
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.docs)) return raw.docs;
  return [];
}

function resolveReferenceWindow(reference = null, nowMs = Date.now()) {
  const window = reference && reference.window && typeof reference.window === "object" ? reference.window : {};
  const fromMs = toNum(window.from_ms);
  const toMs = toNum(window.to_ms);
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
    return { fromMs, toMs, source: "REFERENCE_DATASET" };
  }
  const rollingToMs = nowMs;
  const rollingFromMs = rollingToMs - (DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { fromMs: rollingFromMs, toMs: rollingToMs, source: "ROLLING_FALLBACK" };
}

async function buildDatasetFromRawCache({
  referenceDataset = null,
  evTunerReport = null,
  recentCaches = {},
  nowMs = Date.now(),
} = {}) {
  const windowMeta = resolveReferenceWindow(referenceDataset, nowMs);
  const provider = String(referenceDataset && referenceDataset.provider || DEFAULT_PROVIDER).trim().toUpperCase() || DEFAULT_PROVIDER;
  const tf = String(referenceDataset && referenceDataset.tf || DEFAULT_TF).trim() || DEFAULT_TF;
  const dataset = await buildBestSelfEvolutionDataset({
    signals: readRecentCacheDocs(recentCaches.signals),
    drops: readRecentCacheDocs(recentCaches.drops),
    intents: readRecentCacheDocs(recentCaches.intents),
    fills: readRecentCacheDocs(recentCaches.fills),
    trades: readRecentCacheDocs(recentCaches.trades),
    provider,
    tf,
    fromMs: windowMeta.fromMs,
    toMs: windowMeta.toMs,
    evTunerReport,
    loadPathMetrics: true,
  });
  return {
    provider,
    tf,
    source_cycle_id: String(referenceDataset && referenceDataset.cycle_id || "").trim() || null,
    source_dataset_path: "RAW_CACHE_DIRECT",
    source_mode: "RAW_CACHE",
    window: windowMeta,
    rows: dataset.rows,
  };
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const top = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 8).map((row) => `${row.key} ${row.count}`).join(" / ") || "N/A";
  return [
    "# ML Training Dataset",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- schema_version: ${report.schema_version || "N/A"}`,
    `- source_mode: ${report.source_mode || "N/A"}`,
    `- source_dataset_path: ${report.source_dataset_path || "N/A"}`,
    `- rows: ${summary.rows_n || 0} / valid ${summary.valid_n || 0} / invalid ${summary.invalid_n || 0} / realized ${summary.realized_n || 0}`,
    `- outcome_state: ${top(summary.by_outcome_state)}`,
    `- source_row_type: ${top(summary.by_source_row_type)}`,
    `- market: ${top(summary.by_market)}`,
  ].join("\n") + "\n";
}

function main() {
  const nowMeta = nowKstMeta();
  const datasetArtifact = readJsonRawSafe(DATASET_LATEST_JSON, null);
  let source = null;

  if (SOURCE_MODE === "RAW_CACHE") {
    source = buildDatasetFromRawCache({
      referenceDataset: datasetArtifact,
      evTunerReport: readJsonRawSafe(EV_TUNER_LATEST_JSON, null),
      recentCaches: {
        signals: readJsonRawSafe(CACHE_PATHS.signals, null),
        drops: readJsonRawSafe(CACHE_PATHS.drops, null),
        intents: readJsonRawSafe(CACHE_PATHS.intents, null),
        fills: readJsonRawSafe(CACHE_PATHS.fills, null),
        trades: readJsonRawSafe(CACHE_PATHS.trades, null),
      },
      nowMs: nowMeta.nowMs,
    });
  } else {
    if (!datasetArtifact || !Array.isArray(datasetArtifact.rows)) {
      throw new Error(`ML_TRAINING_DATASET_SOURCE_MISSING:${DATASET_LATEST_JSON}`);
    }
    source = Promise.resolve({
      source_mode: "ARTIFACT",
      source_dataset_path: DATASET_LATEST_JSON,
      source_cycle_id: datasetArtifact.cycle_id || null,
      rows: datasetArtifact.rows,
    });
  }

  return Promise.resolve(source).then((resolved) => {
    const rows = resolved.rows.map((row) => buildMlTrainingRow(row));
    const summary = summarizeMlTrainingRows(rows);
    const payload = {
      ok: true,
      generated_at_kst: nowMeta.kst,
      schema_version: ML_DATASET_SCHEMA_VERSION,
      source_mode: resolved.source_mode,
      source_dataset_path: resolved.source_dataset_path,
      source_cycle_id: resolved.source_cycle_id,
      summary,
      rows,
    };

    const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
    const jsonPath = path.join(OPS_DAILY_DIR, `${base}_ml_training_dataset.json`);
    const mdPath = path.join(OPS_DAILY_DIR, `${base}_ml_training_dataset.md`);
    const jsonlPath = path.join(OPS_DAILY_DIR, `${base}_ml_training_dataset.jsonl`);
    const latestJson = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.json");
    const latestMd = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.md");
    const latestJsonl = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.jsonl");

    writeJson(jsonPath, payload);
    writeText(mdPath, renderMarkdown(payload));
    writeText(jsonlPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    writeJson(latestJson, payload);
    writeText(latestMd, renderMarkdown(payload));
    writeText(latestJsonl, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

    console.log(JSON.stringify({
      ok: true,
      latest_json: latestJson,
      latest_md: latestMd,
      latest_jsonl: latestJsonl,
      source_mode: resolved.source_mode,
      rows_n: summary.rows_n,
      valid_n: summary.valid_n,
      invalid_n: summary.invalid_n,
    }));
  });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BUILD_ML_TRAINING_DATASET_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    readRecentCacheDocs,
    resolveReferenceWindow,
  },
};
