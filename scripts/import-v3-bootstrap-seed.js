#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { loadLocalEnv } = require("./lib/automation-utils");
const { getFirestore } = require("../src/storage/firestore");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const OUTPUT_PATH = path.join(OPS_RUNTIME, "v3_bootstrap_seed.jsonl");

const LOOKBACK_HOURS = (() => {
  const n = Number(process.env.V3_PAPER_BOOTSTRAP_LOOKBACK_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 720;
})();

const QUERY_LIMIT = (() => {
  const n = Number(process.env.V3_PAPER_BOOTSTRAP_QUERY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
})();

function trimOrFallback(value, fallback) {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

function resolveV3BootstrapCollectionName(env = process.env) {
  const explicit = trimOrFallback(env.V3_PAPER_BOOTSTRAP_COLLECTION, null);
  if (explicit) return explicit;
  const prefix = trimOrFallback(env.DONBEOLJA_V2_COLLECTION_PREFIX, "");
  return `${prefix}openclaw_outcome_adjudications_v2`;
}

async function loadRecentOutcomes(db) {
  const collection = resolveV3BootstrapCollectionName(process.env);
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const snap = await db.collection(collection)
    .where("adjudicated_at", ">=", since)
    .orderBy("adjudicated_at", "desc")
    .limit(QUERY_LIMIT)
    .get();
  return Object.freeze(snap.docs.map((doc) => ({ id: doc.id || null, ...(doc.data() || {}) })));
}

function buildStableSeedKey(row = {}) {
  const openclawDecisionId = String(row.openclaw_decision_id || "").trim();
  const signalIntentId = String(row.signal_intent_id || row.intent_id || "").trim();
  const positionCycleId = String(row.position_cycle_id || "").trim();
  const adjudicatedAt = String(row.adjudicated_at || "").trim();
  return [openclawDecisionId, signalIntentId, positionCycleId, adjudicatedAt].join("::");
}

function writeSeedRows(filePath, rows = []) {
  const deduped = new Map();
  for (const row of rows) {
    const key = buildStableSeedKey(row);
    deduped.set(key, row);
  }
  const payload = [...deduped.values()].map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(filePath, payload ? `${payload}\n` : "");
  return deduped.size;
}

async function main() {
  fs.mkdirSync(OPS_RUNTIME, { recursive: true });
  const db = getFirestore();
  const rows = await loadRecentOutcomes(db);
  const written = writeSeedRows(OUTPUT_PATH, rows);
  console.log(JSON.stringify({
    ok: true,
    seed_path: OUTPUT_PATH,
    source: "OPENCLAW_OUTCOME_ADJUDICATIONS",
    lookback_hours: LOOKBACK_HOURS,
    source_row_n: rows.length,
    written_row_n: written,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("IMPORT_V3_BOOTSTRAP_SEED_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
