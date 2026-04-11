#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { evaluateCanonicalDecision } = require("../src/services/canonicalEngine");
const { isPrimaryLongShortEvent } = require("../src/utils/liveEntryTaxonomy");
const { __test: runnerTest } = require("../src/engine/paperBinanceRunner");

const OPS_DAILY_DIR = path.join(__dirname, "..", "ops", "daily");
const APPLY = String(process.env.APPLY || "0") === "1";
const PROVIDER = String(process.env.BEST_SELF_EVOLUTION_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const INPUTS = Object.freeze({
  drops: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json"),
  intents: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "order_intents_paper.json"),
  sourceModeSnapshot: path.join(OPS_DAILY_DIR, "source_mode_BINANCEFUT_autopilot_snapshot_latest.json"),
  canonicalPolicySnapshot: path.join(OPS_DAILY_DIR, "canonical_policy_BINANCEFUT_autopilot_snapshot_latest.json"),
});
const REQUIRED_KEYS = Object.freeze([
  "canonical_engine_bundle_version",
  "canonical_engine_threshold_bundle_version",
  "canonical_engine_source_mode_effective",
  "canonical_engine_execution_source_effective",
  "canonical_engine_actual_source_decision",
  "canonical_engine_decision_id",
  "canonical_engine_policy_origin",
  "pine_overlay_runtime_role",
  "pine_shadow_decision",
  "pine_shadow_parity_match",
]);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function readCacheDocs(filePath) {
  const raw = readJson(filePath, null);
  return raw && Array.isArray(raw.docs) ? raw.docs : [];
}

function toMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFeatures(row = {}) {
  return row && row.features_json && typeof row.features_json === "object"
    ? { ...row.features_json }
    : {};
}

function deriveCutoverReference() {
  const candidates = [
    { key: "SOURCE_MODE", generated_at: readJson(INPUTS.sourceModeSnapshot, null)?.generated_at || null },
    { key: "CANONICAL_POLICY", generated_at: readJson(INPUTS.canonicalPolicySnapshot, null)?.generated_at || null },
  ]
    .map((row) => ({ ...row, generated_at_ms: toMs(row.generated_at) }))
    .filter((row) => Number.isFinite(row.generated_at_ms))
    .sort((a, b) => b.generated_at_ms - a.generated_at_ms);
  return candidates[0] || null;
}

function hasCompleteCanonicalProvenance(features = {}) {
  return REQUIRED_KEYS.every((key) => features[key] !== null && features[key] !== undefined);
}

function collectCandidates({ intents = [], drops = [], cutoverMs = null } = {}) {
  const rows = [
    ...intents.map((row) => ({ collection: "order_intents_paper", row })),
    ...drops.map((row) => ({ collection: "signals_dropped", row })),
  ];
  return rows.filter(({ collection, row }) => {
    if (String(row.exchange || "").trim().toUpperCase() !== PROVIDER) return false;
    if (!isPrimaryLongShortEvent(row.event)) return false;
    const createdAtMs = toMs(row.created_at);
    if (Number.isFinite(cutoverMs) && (!Number.isFinite(createdAtMs) || createdAtMs < cutoverMs)) return false;
    const features = normalizeFeatures(row);
    if (hasCompleteCanonicalProvenance(features)) return false;
    const docId = String(row.id || row.intent_id || row.drop_id || "").trim();
    if (!docId) return false;
    return collection === "order_intents_paper" || collection === "signals_dropped";
  });
}

async function main() {
  const cutover = deriveCutoverReference();
  const cutoverMs = cutover ? cutover.generated_at_ms : null;
  const intents = readCacheDocs(INPUTS.intents);
  const drops = readCacheDocs(INPUTS.drops);
  const candidates = collectCandidates({ intents, drops, cutoverMs });

  const sys = await getSystemSettingsForProvider(PROVIDER, 5000);
  const sysCfg = sys && sys.data ? sys.data : {};
  const db = getFirestore();
  const now = new Date().toISOString();
  let updated = 0;
  let batch = db.batch();
  let batchOps = 0;
  const preview = [];
  const byCollection = {};
  const bySourceMode = {};

  for (const { collection, row } of candidates) {
    const features = normalizeFeatures(row);
    const market = String(row.symbol_or_pair_id || row.market || "").trim().toUpperCase();
    const tf = String(row.tf || "").trim() || "15m";
    const config = runnerTest.resolveCanonicalEntryConfig(sysCfg, market);
    const decision = evaluateCanonicalDecision({
      features,
      event: row.event,
      side: row.side,
      market,
      tf,
      config,
      pineShadowDecision: "PASS",
    });
    const detail = decision && decision.detail ? decision.detail : null;
    if (!detail || !hasCompleteCanonicalProvenance(detail)) continue;

    const docId = String(row.id || row.intent_id || row.drop_id || "").trim();
    const mergedFeatures = {
      ...features,
      ...detail,
      canonical_provenance_backfilled_at: now,
      canonical_provenance_backfill_script: "scripts/backfill-canonical-engine-provenance.js",
    };
    byCollection[collection] = (byCollection[collection] || 0) + 1;
    const sourceMode = String(detail.canonical_engine_source_mode_effective || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    bySourceMode[sourceMode] = (bySourceMode[sourceMode] || 0) + 1;
    if (preview.length < 12) {
      preview.push({
        collection,
        doc_id: docId,
        market,
        event: row.event,
        created_at: row.created_at || null,
        source_mode: sourceMode,
        execution_source: detail.canonical_engine_execution_source_effective || null,
      });
    }
    if (!APPLY) continue;
    const ref = db.collection(collection).doc(docId);
    batch.set(ref, {
      features_json: mergedFeatures,
      updated_at: now,
    }, { merge: true });
    batchOps += 1;
    updated += 1;
    if (batchOps >= 350) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  if (APPLY && batchOps > 0) {
    await batch.commit();
  }

  console.log(JSON.stringify({
    ok: true,
    apply: APPLY,
    provider: PROVIDER,
    cutover_reference_iso: cutover ? cutover.generated_at : null,
    cutover_reference_source: cutover ? cutover.key : null,
    candidates_n: candidates.length,
    updated,
    by_collection: byCollection,
    by_source_mode: bySourceMode,
    preview,
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_CANONICAL_ENGINE_PROVENANCE_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
