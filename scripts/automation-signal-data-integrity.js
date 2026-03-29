#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const admin = require("firebase-admin");
const { getFirestore } = require("../src/storage/firestore");
const { enrichFeaturesWithRegime, resolveRegimeDetail } = require("../src/utils/regime");
const { resolveEventMapping } = require("../src/services/signalMapping");
const { isEntryTierEvent } = require("../src/utils/liveEntryTaxonomy");
const {
  CACHE_ROOT,
  cacheFilePath,
  getCachedRecentByCreatedAt,
  readCacheJson,
  resolveCreatedCursor,
  sortDocsDesc,
  writeCacheJson,
} = require("./lib/firestore-recent-cache");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const PROVIDER = String(process.env.DATA_INTEGRITY_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.DATA_INTEGRITY_TF || "15m").trim();
const DEFAULT_LIMIT = Math.max(3000, Number(process.env.DATA_INTEGRITY_LIMIT || 30000));
const FILL_LIMIT = Math.max(DEFAULT_LIMIT, Number(process.env.DATA_INTEGRITY_INTENT_LIMIT || 30000));
const PAGE_SIZE = Math.max(500, Number(process.env.DATA_INTEGRITY_PAGE_SIZE || 1000));
const BATCH_SIZE = Math.max(50, Math.min(400, Number(process.env.DATA_INTEGRITY_BATCH_SIZE || 300)));
const WARN_MISSING_RATE = Math.max(0.01, Number(process.env.DATA_INTEGRITY_WARN_MISSING_RATE || 0.02));
const WARN_CONTROL_CHAR_RATE = Math.max(0.005, Number(process.env.DATA_INTEGRITY_WARN_CONTROL_CHAR_RATE || 0.01));

const COLLECTIONS = [
  { name: "signals", idField: "signal_id", signalMsField: "bar_close_time_utc_ms", limit: DEFAULT_LIMIT },
  { name: "signals_dropped", idField: "drop_id", signalMsField: "bar_close_time_utc_ms", limit: DEFAULT_LIMIT },
  { name: "order_intents_paper", idField: "intent_id", signalMsField: "signal_bar_close_time_utc_ms", limit: FILL_LIMIT },
];

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function buildSignalDocId(row) {
  const exchange = toUpper(row && row.exchange);
  const symbol = toUpper(row && (row.symbol_or_pair_id || row.symbol || row.market));
  const tf = String(row && row.tf || "").trim();
  const ms = toNum(row && row.signal_bar_close_time_utc_ms);
  const event = toUpper(row && row.event);
  if (!exchange || !symbol || !tf || !Number.isFinite(ms) || !event) return null;
  return `SIG__${exchange}__${symbol}__${tf}__${ms}__${event}`;
}

function buildSignalLookup(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const rowId = String(row && (row.signal_id || row.id) || "").trim();
    if (rowId) map.set(rowId, row);
    const derivedId = buildSignalDocId(row);
    if (derivedId) map.set(derivedId, row);
  }
  return map;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object") return row.features_json;
  if (row && row.features && typeof row.features === "object") return row.features;
  return {};
}

function resolveDocMs(doc, field) {
  return (
    toNum(doc && doc[field]) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.created_at_ms) ??
    Date.parse(String((doc && (doc.created_at || doc.updated_at)) || ""))
  );
}

function isScopedRow(row) {
  const ex = String(row && row.exchange || "").trim().toUpperCase();
  const tf = String(row && row.tf || "").trim();
  if (PROVIDER && ex && ex !== PROVIDER) return false;
  if (TF && tf && tf !== TF) return false;
  return true;
}

function hasControlChar(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value == null ? "" : value));
}

function collectRegimeRawCandidates(row) {
  const features = resolveFeatures(row);
  return [
    row && row.regime,
    row && row.market_regime,
    features.regime,
    features.market_regime,
    features.regime_label,
    features.zz_regime,
    features.pro_regime_state,
    features.regime_state,
    features.pro_env_txt,
    features.env_txt,
  ].filter((v) => String(v == null ? "" : v).trim());
}

function buildRegimeRepairPatch(row, collectionName, signalLookup = null) {
  let detail = resolveRegimeDetail(row);
  const currentFeatures = resolveFeatures(row);
  let regimeMeta = enrichFeaturesWithRegime(currentFeatures, row);
  if (!regimeMeta.regime && collectionName === "order_intents_paper" && signalLookup) {
    const signalId = String(row && (row.signal_doc_id || row.signal_id) || "").trim() || buildSignalDocId(row);
    const signalRow = signalId ? signalLookup.get(signalId) : null;
    if (signalRow) {
      detail = resolveRegimeDetail(signalRow);
      if (detail.regime) {
        regimeMeta = enrichFeaturesWithRegime(currentFeatures, signalRow);
      }
    }
  }
  const patch = {};
  if (regimeMeta.regime && row.regime !== regimeMeta.regime) patch.regime = regimeMeta.regime;
  if (regimeMeta.market_regime && row.market_regime !== regimeMeta.market_regime) patch.market_regime = regimeMeta.market_regime;
  if (regimeMeta.regime_source && row.regime_source !== regimeMeta.regime_source) patch.regime_source = regimeMeta.regime_source;
  const currentFeatureRegime = String(currentFeatures.regime || "").trim().toLowerCase() || null;
  const currentFeatureMarketRegime = String(currentFeatures.market_regime || "").trim().toLowerCase() || null;
  const structuredFieldNeedsSanitize = regimeMeta.regime && ["pro_regime_state", "regime_state", "regime_label", "zz_regime"]
    .some((key) => currentFeatures[key] != null && String(currentFeatures[key]).trim().toLowerCase() !== regimeMeta.regime);
  if (
    regimeMeta.regime &&
    (
      currentFeatureRegime !== regimeMeta.regime ||
      currentFeatureMarketRegime !== regimeMeta.market_regime ||
      structuredFieldNeedsSanitize
    )
  ) {
    patch.features_json = regimeMeta.features;
  }
  if (collectionName === "order_intents_paper") {
    const currentIntent = String(row && row.event_intent || "").trim().toUpperCase();
    if (!currentIntent) {
      const mapping = resolveEventMapping({ event: row && row.event, side: row && row.side });
      const hintedIntent = String(regimeMeta.features && regimeMeta.features._event_intent || "").trim().toUpperCase();
      const nextIntent = hintedIntent === "ENTRY" || hintedIntent === "ADD" || hintedIntent === "EXIT"
        ? hintedIntent
        : String(mapping && mapping.intent || "").trim().toUpperCase();
      if (nextIntent) patch.event_intent = nextIntent;
    }
  }
  return {
    detail,
    patch,
    patchNeeded: Object.keys(patch).length > 0,
  };
}

function applyLocalCachePatches(rows, patchesById) {
  const out = [];
  for (const row of rows || []) {
    const id = String(row && row.id || "").trim();
    if (!id) {
      out.push(row);
      continue;
    }
    const patch = patchesById.get(id);
    out.push(patch ? { ...row, ...patch } : row);
  }
  return out;
}

function summarizeCollectionMetrics({ rows, collection, signalMsField }) {
  let scoped = 0;
  let regimeScoped = 0;
  let missingRegime = 0;
  let controlChars = 0;
  let missingId = 0;
  let missingEvent = 0;
  let missingSide = 0;
  let missingMs = 0;
  let missingIntent = 0;
  for (const row of rows || []) {
    if (!isScopedRow(row)) continue;
    scoped += 1;
    const eventIntent = toUpper(row && row.event_intent);
    const regimeApplicable = collection.name === "order_intents_paper"
      ? (eventIntent === "ENTRY" || (!eventIntent && isEntryTierEvent(row && row.event)))
      : isEntryTierEvent(row && row.event);
    if (regimeApplicable) {
      regimeScoped += 1;
      if (!resolveRegimeDetail(row).regime) missingRegime += 1;
      const rawStructured = [
        row && row.regime,
        row && row.market_regime,
        resolveFeatures(row).pro_regime_state,
        resolveFeatures(row).regime_state,
        resolveFeatures(row).regime_label,
        resolveFeatures(row).zz_regime,
      ].filter((value) => String(value == null ? "" : value).trim());
      if (rawStructured.some((value) => hasControlChar(value))) controlChars += 1;
    }
    if (!String(row && row[collection.idField] || "").trim()) missingId += 1;
    if (!String(row && row.event || "").trim()) missingEvent += 1;
    if (!String(row && row.side || "").trim()) missingSide += 1;
    if (!Number.isFinite(resolveDocMs(row, signalMsField))) missingMs += 1;
    if (collection.name === "order_intents_paper" && !String(row && row.event_intent || "").trim()) missingIntent += 1;
  }
  return {
    scoped_n: scoped,
    regime_scoped_n: regimeScoped,
    missing_regime_n: missingRegime,
    missing_regime_rate: regimeScoped > 0 ? missingRegime / regimeScoped : null,
    control_char_n: controlChars,
    control_char_rate: regimeScoped > 0 ? controlChars / regimeScoped : null,
    missing_id_n: missingId,
    missing_event_n: missingEvent,
    missing_side_n: missingSide,
    missing_signal_ms_n: missingMs,
    missing_event_intent_n: missingIntent,
  };
}

async function commitPatches(collectionName, patchRows) {
  if (!Array.isArray(patchRows) || !patchRows.length) return 0;
  const db = getFirestore();
  let written = 0;
  for (let i = 0; i < patchRows.length; i += BATCH_SIZE) {
    const chunk = patchRows.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const row of chunk) {
      const ref = db.collection(collectionName).doc(row.id);
      batch.set(ref, {
        ...row.patch,
        regime_backfilled_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function renderMarkdown({ nowMeta, collections, verdict }) {
  const lines = [];
  lines.push("# Signal Data Integrity");
  lines.push("");
  lines.push(`- 실행 시각: ${nowMeta.kst}`);
  lines.push(`- provider/tf: ${PROVIDER} / ${TF}`);
  lines.push(`- 판정: ${verdict}`);
  lines.push(`- 로컬 캐시: ${CACHE_ROOT}`);
  lines.push("");
  lines.push("## 컬렉션별");
  for (const row of collections) {
    lines.push(`- ${row.name}: scoped=${row.metrics_after.scoped_n} / regime-applicable=${row.metrics_after.regime_scoped_n} / repaired=${row.repaired_n} / unresolved regime=${row.metrics_after.missing_regime_n} (${pct(row.metrics_after.missing_regime_rate)}) / control-char=${row.metrics_after.control_char_n} (${pct(row.metrics_after.control_char_rate)}) / missing id=${row.metrics_after.missing_id_n} / missing event=${row.metrics_after.missing_event_n} / missing side=${row.metrics_after.missing_side_n} / missing bar_ms=${row.metrics_after.missing_signal_ms_n}${row.name === "order_intents_paper" ? ` / missing event_intent=${row.metrics_after.missing_event_intent_n}` : ""}`);
    lines.push(`  - before: regime-applicable=${row.metrics_before.regime_scoped_n} / missing regime=${row.metrics_before.missing_regime_n} (${pct(row.metrics_before.missing_regime_rate)}) / control-char=${row.metrics_before.control_char_n} (${pct(row.metrics_before.control_char_rate)}) / cache source=${row.cache_meta.source} / cached=${row.cache_meta.count} / new=${row.cache_meta.fetched_new}`);
  }
  return `${lines.join("\n")}\n`;
}

function decideVerdict(collections) {
  let worst = "OK";
  for (const row of collections) {
    const missingRate = Number(row.metrics_after.missing_regime_rate || 0);
    const controlRate = Number(row.metrics_after.control_char_rate || 0);
    const severe = (
      row.metrics_after.missing_id_n > 0 ||
      row.metrics_after.missing_event_n > 0 ||
      row.metrics_after.missing_signal_ms_n > 0 ||
      missingRate >= WARN_MISSING_RATE ||
      controlRate >= WARN_CONTROL_CHAR_RATE
    );
    if (severe) return "WARN";
    if (row.repaired_n > 0) worst = "FIXED";
  }
  return worst;
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const collections = [];
  const signalCache = await getCachedRecentByCreatedAt("signals", {
    limit: DEFAULT_LIMIT,
    maxDocs: DEFAULT_LIMIT,
    overlapDocs: Math.max(200, Math.min(1200, Math.floor(DEFAULT_LIMIT / 10))),
    pageSize: PAGE_SIZE,
    refresh: true,
  });
  const signalLookup = buildSignalLookup(signalCache.rows);

  for (const collection of COLLECTIONS) {
    const cached = await getCachedRecentByCreatedAt(collection.name, {
      limit: collection.limit,
      maxDocs: collection.limit,
      overlapDocs: Math.max(200, Math.min(1200, Math.floor(collection.limit / 10))),
      pageSize: PAGE_SIZE,
      refresh: true,
    });
    const rows = cached.rows.filter(isScopedRow);
    const metricsBefore = summarizeCollectionMetrics({ rows, collection, signalMsField: collection.signalMsField });
    const patchRows = [];
    const localPatches = new Map();
    for (const row of rows) {
      const id = String(row && row.id || "").trim();
      if (!id) continue;
      const repair = buildRegimeRepairPatch(row, collection.name, signalLookup);
      if (!repair.patchNeeded) continue;
      patchRows.push({ id, patch: repair.patch });
      localPatches.set(id, repair.patch);
    }
    const repaired = await commitPatches(collection.name, patchRows);
    const patchedRows = applyLocalCachePatches(rows, localPatches);
    const metricsAfter = summarizeCollectionMetrics({ rows: patchedRows, collection, signalMsField: collection.signalMsField });

    const existingCache = readCacheJson(cacheFilePath(collection.name)) || {};
    const existingDocs = Array.isArray(existingCache.docs) ? existingCache.docs : [];
    const fullPatchedDocs = applyLocalCachePatches(existingDocs, localPatches);
    const sortedDocs = sortDocsDesc(fullPatchedDocs);
    writeCacheJson(cacheFilePath(collection.name), {
      collection: collection.name,
      updated_at: new Date().toISOString(),
      max_docs: existingCache.max_docs || collection.limit,
      latest_created_at: resolveCreatedCursor(sortedDocs[0] || {}),
      docs: sortedDocs,
    });

    collections.push({
      name: collection.name,
      repaired_n: repaired,
      metrics_before: metricsBefore,
      metrics_after: metricsAfter,
      cache_meta: cached.meta,
    });
  }

  const verdict = decideVerdict(collections);
  const report = {
    ok: verdict !== "WARN",
    verdict,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    collections,
  };
  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_signal_data_integrity.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_signal_data_integrity.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown({ nowMeta, collections, verdict }));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "signal_data_integrity_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "signal_data_integrity_latest.md"));

  await sendKoreanTelegramSummary({
    title: "[데이터 무결성 점검] signal regime",
    severity: verdict === "WARN" ? "WARN" : "INFO",
    sections: [
      {
        header: "현재 상태",
        lines: collections.map((row) => `${row.name} repaired ${row.repaired_n} / unresolved regime ${row.metrics_after.missing_regime_n} (${pct(row.metrics_after.missing_regime_rate)}) / control-char ${row.metrics_after.control_char_n} (${pct(row.metrics_after.control_char_rate)})`),
      },
    ],
    provider: PROVIDER,
  });

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-signal-data-integrity failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    buildRegimeRepairPatch,
    applyLocalCachePatches,
    summarizeCollectionMetrics,
  },
};
