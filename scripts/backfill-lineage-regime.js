#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { enrichFeaturesWithRegime } = require("../src/utils/regime");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.REGIME_BACKFILL_LOOKBACK_DAYS || 30));
const PAGE_SIZE = Math.max(100, Number(process.env.REGIME_BACKFILL_PAGE_SIZE || 500));
const MAX_DOCS = Math.max(PAGE_SIZE, Number(process.env.REGIME_BACKFILL_MAX_DOCS || 5000));
const DRY_RUN = ["1", "true", "yes", "y", "on"].includes(String(process.env.DRY_RUN || "").trim().toLowerCase());
const PROVIDER = String(process.env.REGIME_BACKFILL_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const COLLECTIONS = String(process.env.REGIME_BACKFILL_COLLECTIONS || "signals,order_intents_paper,fills_paper")
  .split(",")
  .map((value) => String(value || "").trim())
  .filter(Boolean);

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function resolveFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object" && !Array.isArray(row.features_json)) {
    return row.features_json;
  }
  if (row && row.features && typeof row.features === "object" && !Array.isArray(row.features)) {
    return row.features;
  }
  return {};
}

async function fetchRecentDocs(db, collectionName) {
  const rows = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection(collectionName)
      .where("exchange", "==", PROVIDER)
      .orderBy("created_at", "desc")
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    let snap = null;
    try {
      snap = await q.get();
    } catch (_) {
      q = db.collection(collectionName).orderBy("created_at", "desc").limit(PAGE_SIZE);
      if (last) q = q.startAfter(last);
      snap = await q.get();
    }
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (upper(data.exchange) !== PROVIDER) continue;
      const createdAt = String(data.created_at || data.updated_at || "");
      if (createdAt && createdAt < sinceIso) continue;
      rows.push({ id: doc.id, ...data });
    }
    if (rows.length >= MAX_DOCS) break;
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows.slice(0, MAX_DOCS);
}

function buildSignalLookup(signals = []) {
  const map = new Map();
  for (const row of signals) {
    const keys = [
      String(row && row.signal_id || "").trim(),
      String(row && row.id || "").trim(),
    ].filter(Boolean);
    for (const key of keys) map.set(key, row);
  }
  return map;
}

function buildIntentLookup(intents = []) {
  const map = new Map();
  for (const row of intents) {
    const keys = [
      String(row && row.intent_id || "").trim(),
      String(row && row.id || "").trim(),
    ].filter(Boolean);
    for (const key of keys) map.set(key, row);
  }
  return map;
}

function buildRegimePatch({ row = null, lineage = null, extraTag = null } = {}) {
  const sourceRow = row && typeof row === "object" ? row : {};
  let meta = enrichFeaturesWithRegime(resolveFeatures(sourceRow), sourceRow);
  if (!meta.regime && lineage && typeof lineage === "object") {
    meta = enrichFeaturesWithRegime(meta.features, lineage);
  }
  if (!meta.regime) return null;
  const patch = {};
  if (sourceRow.regime !== meta.regime) patch.regime = meta.regime;
  if (sourceRow.market_regime !== meta.market_regime) patch.market_regime = meta.market_regime;
  if (sourceRow.regime_source !== meta.regime_source) patch.regime_source = meta.regime_source;
  const currentFeatures = resolveFeatures(sourceRow);
  const currentRegime = String(currentFeatures.regime || "").trim().toLowerCase() || null;
  const currentMarketRegime = String(currentFeatures.market_regime || "").trim().toLowerCase() || null;
  if (currentRegime !== meta.regime || currentMarketRegime !== meta.market_regime) {
    patch.features_json = meta.features;
  }
  if (!Object.keys(patch).length) return null;
  patch.extra = {
    ...(sourceRow.extra && typeof sourceRow.extra === "object" ? sourceRow.extra : {}),
    regime_backfilled_at: nowIso(),
    regime_backfill_script: "scripts/backfill-lineage-regime.js",
    regime_backfill_tag: extraTag || null,
  };
  return patch;
}

async function applyPatches(db, collectionName, rows = [], patchResolver) {
  const touched = [];
  let patched = 0;
  for (const row of rows) {
    const patch = patchResolver(row);
    if (!patch) continue;
    touched.push({
      id: row.id,
      collection: collectionName,
      symbol: upper(row.symbol || row.symbol_or_pair_id || row.market) || null,
      regime: patch.regime || null,
      source: patch.regime_source || null,
    });
    patched += 1;
    if (!DRY_RUN) {
      await db.collection(collectionName).doc(row.id).set(patch, { merge: true });
    }
  }
  return { patched, touched };
}

async function main() {
  const db = getFirestore();
  const includeSignals = COLLECTIONS.includes("signals");
  const includeIntents = COLLECTIONS.includes("order_intents_paper");
  const includeFills = COLLECTIONS.includes("fills_paper");
  const [signals, intents, fills] = await Promise.all([
    includeSignals ? fetchRecentDocs(db, "signals") : Promise.resolve([]),
    includeIntents ? fetchRecentDocs(db, "order_intents_paper") : Promise.resolve([]),
    includeFills ? fetchRecentDocs(db, "fills_paper") : Promise.resolve([]),
  ]);
  const signalLookup = buildSignalLookup(signals);
  const intentLookup = buildIntentLookup(intents);

  const signalRes = await applyPatches(db, "signals", signals, (row) => (
    buildRegimePatch({ row, extraTag: "SIGNAL_SELF" })
  ));
  const intentRes = await applyPatches(db, "order_intents_paper", intents, (row) => {
    const signalKey = String(row && (row.signal_doc_id || row.signal_id) || "").trim();
    const lineage = signalKey ? signalLookup.get(signalKey) : null;
    return buildRegimePatch({ row, lineage, extraTag: lineage ? "INTENT_FROM_SIGNAL" : "INTENT_SELF" });
  });
  const fillRes = await applyPatches(db, "fills_paper", fills, (row) => {
    const intentKey = String(row && row.intent_id || "").trim();
    const signalKey = String(row && (row.signal_doc_id || row.signal_id) || "").trim();
    const lineage = intentLookup.get(intentKey) || signalLookup.get(signalKey) || null;
    return buildRegimePatch({ row, lineage, extraTag: lineage ? "FILL_FROM_LINEAGE" : "FILL_SELF" });
  });

  console.log(JSON.stringify({
    ok: true,
    dry_run: DRY_RUN,
    provider: PROVIDER,
    collections: COLLECTIONS,
    lookback_days: LOOKBACK_DAYS,
    max_docs: MAX_DOCS,
    scanned: {
      signals: signals.length,
      intents: intents.length,
      fills: fills.length,
    },
    patched: {
      signals: signalRes.patched,
      intents: intentRes.patched,
      fills: fillRes.patched,
    },
    samples: {
      signals: signalRes.touched.slice(0, 20),
      intents: intentRes.touched.slice(0, 20),
      fills: fillRes.touched.slice(0, 20),
    },
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BACKFILL_LINEAGE_REGIME_FAIL:", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

module.exports = {
  __test: {
    buildRegimePatch,
  },
};
