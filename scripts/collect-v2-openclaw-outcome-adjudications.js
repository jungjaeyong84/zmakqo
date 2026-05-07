"use strict";

const fs = require("fs");
const path = require("path");
const { collectOpenClawOutcomeAdjudicationsFromFills } = require("../src/v2/openclawOutcomeAdjudicationCollector");
const { putV2DocsBatch } = require("../src/v2/storage");
const { resolveV2CollectionName } = require("../src/v2/storage");
const { getFirestore } = require("../src/storage/firestore");

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseFillsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.docs)) return payload.docs;
  if (payload && Array.isArray(payload.fills)) return payload.fills;
  throw new Error("V2_OUTCOME_ADJUDICATION_INPUT_FILLS_REQUIRED");
}

function parseDecisionEvidencePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.docs)) return payload.docs;
  if (payload && Array.isArray(payload.decisionEvidenceRows)) return payload.decisionEvidenceRows;
  if (payload && Array.isArray(payload.decision_bundles)) return payload.decision_bundles;
  if (payload && Array.isArray(payload.bundles)) return payload.bundles;
  if (payload && Array.isArray(payload.decisions)) return payload.decisions;
  return [];
}

function loadFillsFromFile(inputPath) {
  return parseFillsPayload(readJson(inputPath));
}

function loadDecisionEvidenceFromFile(inputPath) {
  return parseDecisionEvidencePayload(readJson(inputPath));
}

function collectDecisionEvidenceLookupKeysFromFills(fills = []) {
  const openclawDecisionIds = new Set();
  const signalIntentIds = new Set();
  const positionCycleIds = new Set();
  for (const row of Array.isArray(fills) ? fills : []) {
    const features = row && typeof row === "object"
      ? (typeof row.features_json === "string"
          ? (() => { try { return JSON.parse(row.features_json); } catch { return null; } })()
          : (row.features && typeof row.features === "object" ? row.features : null))
      : null;
    const decisionId = trimOrNull(row && (row.openclaw_decision_id || row.decision_id))
      || trimOrNull(features && features.openclaw_decision_id);
    const signalIntentId = trimOrNull(row && (row.signal_intent_id || row.intent_id))
      || trimOrNull(features && (features.signal_intent_id || features.intent_id));
    const positionCycleId = trimOrNull(row && row.position_cycle_id)
      || trimOrNull(features && features.position_cycle_id);
    if (decisionId) openclawDecisionIds.add(decisionId);
    if (signalIntentId) signalIntentIds.add(signalIntentId);
    if (positionCycleId) positionCycleIds.add(positionCycleId);
  }
  return {
    openclawDecisionIds: [...openclawDecisionIds],
    signalIntentIds: [...signalIntentIds],
    positionCycleIds: [...positionCycleIds],
  };
}

function dedupeDecisionEvidenceRows(rows = []) {
  const docsById = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const key = trimOrNull(row.id)
      || trimOrNull(row.openclaw_decision_bundle_id)
      || trimOrNull(row.openclaw_decision_bundle_hash)
      || trimOrNull(row.openclaw_decision_id)
      || trimOrNull(row.signal_intent_id)
      || `row:${docsById.size}`;
    if (!docsById.has(key)) docsById.set(key, row);
  }
  return Array.from(docsById.values());
}

function mergeDecisionEvidenceSources(primary = {}, secondary = {}) {
  return {
    source: [trimOrNull(primary.source), trimOrNull(secondary.source)].filter(Boolean).join("+") || "UNKNOWN",
    input_file: primary.input_file || secondary.input_file || null,
    collection: primary.collection || secondary.collection || null,
    collections: primary.collections || secondary.collections || null,
    collection_stats: [...(Array.isArray(primary.collection_stats) ? primary.collection_stats : []), ...(Array.isArray(secondary.collection_stats) ? secondary.collection_stats : [])],
    order_field: primary.order_field || secondary.order_field || null,
    limit: primary.limit || secondary.limit || null,
    decisionEvidenceLookupKeys: secondary.decisionEvidenceLookupKeys || primary.decisionEvidenceLookupKeys || null,
    targeted_match_n: Number(secondary.targeted_match_n || 0) + Number(primary.targeted_match_n || 0),
    decisionEvidenceRows: dedupeDecisionEvidenceRows([
      ...(Array.isArray(primary.decisionEvidenceRows) ? primary.decisionEvidenceRows : []),
      ...(Array.isArray(secondary.decisionEvidenceRows) ? secondary.decisionEvidenceRows : []),
    ]),
  };
}

async function loadFillsFromFirestore({ db = null, env = process.env } = {}) {
  const firestore = db || getFirestore();
  if (!firestore || typeof firestore.collection !== "function") {
    throw new Error("V2_OUTCOME_ADJUDICATION_FIRESTORE_REQUIRED");
  }
  const collection = trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_FILLS_COLLECTION) || "fills_paper";
  const orderField = trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_FILLS_ORDER_FIELD) || "created_at";
  const limit = Math.max(1, Math.min(
    5000,
    Number(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_FIRESTORE_LIMIT || 1500) || 1500
  ));
  const snap = await firestore.collection(collection).orderBy(orderField, "desc").limit(limit).get();
  return {
    source: "FIRESTORE",
    collection,
    order_field: orderField,
    limit,
    fills: snap.docs.map((doc) => {
      const data = typeof doc.data === "function" ? doc.data() : {};
      return { id: doc.id || data.id || null, ...data };
    }),
  };
}

async function loadDecisionEvidenceFromFirestore({ db = null, env = process.env, fills = [] } = {}) {
  const firestore = db || getFirestore();
  if (!firestore || typeof firestore.collection !== "function") {
    throw new Error("V2_OUTCOME_ADJUDICATION_FIRESTORE_REQUIRED");
  }
  const explicitCollection = trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_COLLECTION);
  const orderField = trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_ORDER_FIELD) || "created_at";
  const limit = Math.max(1, Math.min(
    5000,
    Number(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_LIMIT || 1500) || 1500
  ));
  const configuredCollection = resolveV2CollectionName("OPENCLAW_DECISION_BUNDLES", env);
  const configuredExtra = String(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_COLLECTIONS || "")
    .split(",")
    .map(trimOrNull)
    .filter(Boolean);
  const collections = explicitCollection
    ? [explicitCollection]
    : Array.from(new Set([
        configuredCollection,
        ...configuredExtra,
        "v2__openclaw_decision_bundles_v2",
        "donbeolja_v2__openclaw_decision_bundles_v2",
        "openclaw_decision_bundles_v2",
        "v2__position_cycles_v2",
        "donbeolja_v2__position_cycles_v2",
        "position_cycles_v2",
      ].filter(Boolean)));
  const targetedRows = [];
  const collectionStats = [];
  const lookupKeys = collectDecisionEvidenceLookupKeysFromFills(fills);
  const targetedTasks = [];
  for (const collection of collections) {
    for (const openclawDecisionId of lookupKeys.openclawDecisionIds) {
      targetedTasks.push(
        firestore.collection(collection).where("openclaw_decision_id", "==", openclawDecisionId).limit(5).get()
          .then((snap) => snap.docs.map((doc) => ({ id: doc.id || null, ...(typeof doc.data === "function" ? doc.data() : {}) })))
          .catch(() => [])
      );
    }
    for (const signalIntentId of lookupKeys.signalIntentIds) {
      targetedTasks.push(
        firestore.collection(collection).where("signal_intent_id", "==", signalIntentId).limit(5).get()
          .then((snap) => snap.docs.map((doc) => ({ id: doc.id || null, ...(typeof doc.data === "function" ? doc.data() : {}) })))
          .catch(() => [])
      );
    }
    for (const positionCycleId of lookupKeys.positionCycleIds) {
      targetedTasks.push(
        firestore.collection(collection).where("position_cycle_id", "==", positionCycleId).limit(5).get()
          .then((snap) => snap.docs.map((doc) => ({ id: doc.id || null, ...(typeof doc.data === "function" ? doc.data() : {}) })))
          .catch(() => [])
      );
    }
  }
  if (targetedTasks.length) {
    const targetedResults = await Promise.all(targetedTasks);
    targetedRows.push(...targetedResults.flat());
  }
  for (const collection of collections) {
    try {
      const snap = await firestore.collection(collection).orderBy(orderField, "desc").limit(limit).get();
      const rows = snap.docs.map((doc) => {
        const data = typeof doc.data === "function" ? doc.data() : {};
        return { id: doc.id || data.id || null, ...data };
      });
      collectionStats.push({ collection, row_n: rows.length, ok: true });
    } catch (error) {
      collectionStats.push({
        collection,
        row_n: 0,
        ok: false,
        error_message: trimOrNull(error && error.message) || String(error),
      });
    }
  }
  return {
    source: "FIRESTORE",
    collection: collections.join(","),
    collections,
    collection_stats: collectionStats,
    order_field: orderField,
    limit,
    decisionEvidenceLookupKeys: lookupKeys,
    targeted_match_n: targetedRows.length,
    decisionEvidenceRows: dedupeDecisionEvidenceRows(targetedRows),
  };
}

async function loadFills({ inputPath, env = process.env, db = null } = {}) {
  const source = upper(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE) || "AUTO";
  if (source === "FIRESTORE") return loadFillsFromFirestore({ db, env });
  if (source !== "FIRESTORE" && inputPath && fs.existsSync(inputPath)) {
    return {
      source: "CACHE_FILE",
      input_file: inputPath,
      fills: loadFillsFromFile(inputPath),
    };
  }
  if (source === "CACHE" || source === "CACHE_FILE" || source === "FILE") {
    throw new Error("V2_OUTCOME_ADJUDICATION_INPUT_FILE_MISSING");
  }
  return loadFillsFromFirestore({ db, env });
}

async function loadDecisionEvidence({ inputPath, env = process.env, db = null, fills = [] } = {}) {
  const explicitSource = upper(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_SOURCE);
  const inheritedSource = upper(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE);
  const source = explicitSource || inheritedSource || "AUTO";
  if (source === "NONE" || source === "DISABLED") {
    return { source: "DISABLED", decisionEvidenceRows: [] };
  }
  if (source === "FIRESTORE") return loadDecisionEvidenceFromFirestore({ db, env, fills });
  if (!explicitSource && inputPath && fs.existsSync(inputPath)) {
    const cachePayload = {
      source: "CACHE_FILE",
      input_file: inputPath,
      decisionEvidenceRows: loadDecisionEvidenceFromFile(inputPath),
    };
    const firestorePayload = await loadDecisionEvidenceFromFirestore({ db, env, fills }).catch(() => ({ source: "FIRESTORE", decisionEvidenceRows: [] }));
    return mergeDecisionEvidenceSources(cachePayload, firestorePayload);
  }
  if (inputPath && fs.existsSync(inputPath)) {
    return {
      source: "CACHE_FILE",
      input_file: inputPath,
      decisionEvidenceRows: loadDecisionEvidenceFromFile(inputPath),
    };
  }
  if (!explicitSource && (source === "CACHE" || source === "CACHE_FILE" || source === "FILE")) {
    return {
      source: "DISABLED",
      decisionEvidenceRows: [],
      disabled_reason: "IMPLICIT_CACHE_DECISION_EVIDENCE_FILE_MISSING",
    };
  }
  if (source === "CACHE" || source === "CACHE_FILE" || source === "FILE") {
    throw new Error("V2_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_INPUT_FILE_MISSING");
  }
  return loadDecisionEvidenceFromFirestore({ db, env, fills });
}

async function runCollector({ env = process.env, db = null } = {}) {
  const inputPath = env.V2_OPENCLAW_OUTCOME_ADJUDICATION_INPUT_FILE
    || path.join("ops", "daily", "cache", "firestore_recent", "fills_paper.json");
  const decisionEvidenceInputPath = env.V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_INPUT_FILE
    || path.join("ops", "daily", "cache", "firestore_recent", "openclaw_decision_bundles_v2.json");
  const outputPath = env.V2_OPENCLAW_OUTCOME_ADJUDICATION_OUTPUT_FILE
    || path.join("ops", "daily", "v2_openclaw_outcome_adjudication_collector_latest.json");
  const lookbackHours = Number(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_LOOKBACK_HOURS || 72);
  const writeEnabled = boolFromEnv(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE, false);
  const maxWrites = Math.max(0, Number(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_MAX_WRITES || 450));
  const loaded = await loadFills({ inputPath, env, db });
  const loadedDecisionEvidence = await loadDecisionEvidence({ inputPath: decisionEvidenceInputPath, env, db, fills: loaded.fills });
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    fills: loaded.fills,
    decisionEvidenceRows: loadedDecisionEvidence.decisionEvidenceRows,
    lookbackHours,
    now: env.V2_OPENCLAW_OUTCOME_ADJUDICATION_NOW || null,
  });
  const writes = result.adjudications.slice(0, maxWrites).map((doc) => ({
    collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
    doc,
    merge: true,
  }));
  let writeResult = null;
  if (writeEnabled && writes.length) {
    writeResult = await putV2DocsBatch({ db, writes, env });
  }
  const artifact = {
    ok: true,
    reason: writeEnabled
      ? "V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_WRITTEN"
      : "V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_DRY_RUN",
    generated_at: new Date().toISOString(),
    source: loaded.source,
    source_collection: loaded.collection || null,
    source_order_field: loaded.order_field || null,
    source_limit: loaded.limit || null,
    decision_evidence_source: loadedDecisionEvidence.source,
    decision_evidence_collection: loadedDecisionEvidence.collection || null,
    decision_evidence_collections: loadedDecisionEvidence.collections || null,
    decision_evidence_collection_stats: loadedDecisionEvidence.collection_stats || null,
    decision_evidence_order_field: loadedDecisionEvidence.order_field || null,
    decision_evidence_limit: loadedDecisionEvidence.limit || null,
    decision_evidence_lookup_keys: loadedDecisionEvidence.decisionEvidenceLookupKeys || null,
    decision_evidence_targeted_match_n: loadedDecisionEvidence.targeted_match_n || 0,
    decision_evidence_input_file: decisionEvidenceInputPath,
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
      decision_evidence_row_n: result.decision_evidence_row_n,
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
      feature_lineage_source: doc.evidence && doc.evidence.feature_lineage_source,
      setup_type: doc.evidence && doc.evidence.setup_type,
      edge_cohort: doc.evidence && doc.evidence.edge_cohort,
      adjudicated_at: doc.adjudicated_at,
    })),
  };
  return artifact;
}

async function main({ env = process.env, db = null, setProcessExitCode = true } = {}) {
  const artifact = await runCollector({ env, db });
  writeJson(artifact.output_file, artifact);
  console.log(JSON.stringify(artifact, null, 2));
  if (
    setProcessExitCode
    && boolFromEnv(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_REQUIRE_NONEMPTY, false)
    && !(artifact.summary && artifact.summary.adjudication_n > 0)
  ) {
    process.exitCode = 1;
  }
  return artifact;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("COLLECT_V2_OPENCLAW_OUTCOME_ADJUDICATIONS_FAIL", err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
} else {
  module.exports = {
    main,
    runCollector,
    loadFills,
    loadDecisionEvidence,
    loadFillsFromFile,
    loadDecisionEvidenceFromFile,
    loadFillsFromFirestore,
    loadDecisionEvidenceFromFirestore,
    __test: {
      boolFromEnv,
      trimOrNull,
      upper,
      parseFillsPayload,
      parseDecisionEvidencePayload,
    },
  };
}
