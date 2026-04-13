"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../storage/firestore");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const LINEAGE_HEALTH_PATH = path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json");

const EXECUTION_QUALITY_REPORT_LATEST_COLLECTION = String(
  process.env.SYSTEM_SLO_EXECUTION_QUALITY_REPORT_LATEST_COLLECTION || "report_latest"
).trim() || "report_latest";
const EXECUTION_QUALITY_REPORT_LATEST_DOC_ID = String(
  process.env.SYSTEM_SLO_EXECUTION_QUALITY_REPORT_LATEST_DOC_ID || "LATEST__best_self_evolution_execution_quality__GLOBAL"
).trim() || "LATEST__best_self_evolution_execution_quality__GLOBAL";
const LINEAGE_REPORT_LATEST_COLLECTION = String(
  process.env.SYSTEM_SLO_LINEAGE_REPORT_LATEST_COLLECTION || "report_latest"
).trim() || "report_latest";
const LINEAGE_REPORT_LATEST_DOC_ID = String(
  process.env.SYSTEM_SLO_LINEAGE_REPORT_LATEST_DOC_ID || "LATEST__signal_lineage_health__GLOBAL"
).trim() || "LATEST__signal_lineage_health__GLOBAL";

function parseDateMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function readSummary(doc = null) {
  if (!doc || typeof doc !== "object") return {};
  if (doc.summary && typeof doc.summary === "object") return doc.summary;
  if (doc.state && typeof doc.state === "object") return doc.state;
  return doc;
}

function resolveGeneratedAtMs(doc = null) {
  const summary = readSummary(doc);
  return parseDateMs(
    summary.generated_at
    || summary.generated_at_kst
    || (doc && doc.generated_at)
    || (doc && doc.generated_at_kst)
    || (doc && doc.updated_at)
    || null
  );
}

async function loadSharedLatestDoc(collection, docId) {
  try {
    const db = getFirestore();
    const snap = await db.collection(collection).doc(docId).get();
    if (!snap.exists) return null;
    const raw = snap.data() || null;
    if (!raw || typeof raw !== "object") return null;
    return raw.report && typeof raw.report === "object" ? raw.report : raw;
  } catch (_) {
    return null;
  }
}

function choosePreferredInput({ localDoc = null, sharedDoc = null } = {}) {
  const localMs = resolveGeneratedAtMs(localDoc);
  const sharedMs = resolveGeneratedAtMs(sharedDoc);
  if (Number.isFinite(sharedMs) && !Number.isFinite(localMs)) return sharedDoc;
  if (Number.isFinite(sharedMs) && Number.isFinite(localMs) && sharedMs >= localMs) return sharedDoc;
  if (localDoc && typeof localDoc === "object") return localDoc;
  return sharedDoc && typeof sharedDoc === "object" ? sharedDoc : null;
}

function isStaleDoc(doc = null, maxAgeMs = null, nowMs = Date.now()) {
  if (!doc || typeof doc !== "object") return true;
  const generatedAtMs = resolveGeneratedAtMs(doc);
  if (!Number.isFinite(generatedAtMs)) return true;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  return Math.max(0, nowMs - generatedAtMs) > maxAgeMs;
}

async function loadPreferredInput({
  localPath = null,
  sharedCollection = null,
  sharedDocId = null,
  maxAgeMs = null,
  nowMs = Date.now(),
  refreshLocal = null,
} = {}) {
  async function loadPair() {
    return Promise.all([
      Promise.resolve().then(() => safeReadJson(localPath)),
      loadSharedLatestDoc(sharedCollection, sharedDocId),
    ]);
  }

  let [localDoc, sharedDoc] = await loadPair();
  let chosen = choosePreferredInput({ localDoc, sharedDoc });
  if (typeof refreshLocal === "function" && isStaleDoc(chosen, maxAgeMs, nowMs)) {
    await Promise.resolve().then(() => refreshLocal());
    [localDoc, sharedDoc] = await loadPair();
    chosen = choosePreferredInput({ localDoc, sharedDoc });
  }
  return chosen;
}

async function loadPreferredExecutionQualityInput(options = null) {
  return loadPreferredInput({
    localPath: EXECUTION_QUALITY_PATH,
    sharedCollection: EXECUTION_QUALITY_REPORT_LATEST_COLLECTION,
    sharedDocId: EXECUTION_QUALITY_REPORT_LATEST_DOC_ID,
    ...(options && typeof options === "object" ? options : {}),
  });
}

async function loadPreferredLineageHealthInput(options = null) {
  return loadPreferredInput({
    localPath: LINEAGE_HEALTH_PATH,
    sharedCollection: LINEAGE_REPORT_LATEST_COLLECTION,
    sharedDocId: LINEAGE_REPORT_LATEST_DOC_ID,
    ...(options && typeof options === "object" ? options : {}),
  });
}

module.exports = {
  loadPreferredExecutionQualityInput,
  loadPreferredLineageHealthInput,
  __test: {
    parseDateMs,
    readSummary,
    resolveGeneratedAtMs,
    choosePreferredInput,
    isStaleDoc,
    loadPreferredInput,
  },
};
