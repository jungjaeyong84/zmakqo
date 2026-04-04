#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const REPORT_LATEST_COLLECTION = "report_latest";
const REPORT_LATEST_DOC_ID = "LATEST__signal_lineage_health__GLOBAL";

loadLocalEnv();

const PATHS = Object.freeze({
  signals: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
  intents: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "order_intents_paper.json"),
  fills: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "fills_paper.json"),
});

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function inLastHours(row, hours = 24) {
  const nowMs = Date.now();
  const cutoffMs = nowMs - (Math.max(1, Number(hours) || 24) * 60 * 60 * 1000);
  const ms = toMs(row && (row.updated_at || row.created_at));
  return Number.isFinite(ms) && ms >= cutoffMs && ms <= nowMs + (5 * 60 * 1000);
}

function upper(v) {
  return String(v || "").trim().toUpperCase();
}

function readDocs(filePath) {
  const data = readJsonRawSafe(filePath, null);
  return Array.isArray(data && data.docs) ? data.docs : [];
}

function ratio(n, d) {
  if (!Number.isFinite(Number(d)) || Number(d) <= 0) return null;
  return Number(n) / Number(d);
}

function pct(v) {
  if (!Number.isFinite(Number(v))) return "N/A";
  return `${(Number(v) * 100).toFixed(2)}%`;
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(keyFn(row) || "UNKNOWN");
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function topMap(obj = {}, limit = 8) {
  return Object.entries(obj)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, Math.max(1, Number(limit) || 8))
    .map(([k, v]) => ({ key: k, n: Number(v) }));
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# Signal Lineage Health",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- verdict: ${summary.verdict || "N/A"}`,
    `- window_hours: ${summary.window_hours || 24}`,
    "",
    "## Summary",
    `- server_auth_24h_n: ${summary.server_auth_24h_n ?? 0}`,
    `- authoritative_entry_24h_n: ${summary.authoritative_entry_24h_n ?? 0}`,
    `- intents_24h_n: ${summary.intents_24h_n ?? 0}`,
    `- fills_24h_n: ${summary.fills_24h_n ?? 0}`,
    `- intents_signal_doc_id_null_rate: ${pct(summary.intents_signal_doc_id_null_rate)}`,
    `- fills_signal_doc_id_null_rate: ${pct(summary.fills_signal_doc_id_null_rate)}`,
    `- fills_intent_id_null_rate: ${pct(summary.fills_intent_id_null_rate)}`,
    `- intents_linked_by_signal_doc_id_n: ${summary.intents_linked_by_signal_doc_id_n ?? 0}`,
    "",
    "## Top Null Buckets",
    "- intents.signal_doc_id null",
  ];
  for (const row of (report.top_null_buckets && report.top_null_buckets.intents_signal_doc_id_null) || []) {
    lines.push(`  - ${row.key}: ${row.n}`);
  }
  lines.push("- fills.signal_doc_id null");
  for (const row of (report.top_null_buckets && report.top_null_buckets.fills_signal_doc_id_null) || []) {
    lines.push(`  - ${row.key}: ${row.n}`);
  }
  lines.push("- fills.intent_id null");
  for (const row of (report.top_null_buckets && report.top_null_buckets.fills_intent_id_null) || []) {
    lines.push(`  - ${row.key}: ${row.n}`);
  }
  return `${lines.join("\n")}\n`;
}

function computeVerdict(summary = {}) {
  const intentNull = Number(summary.intents_signal_doc_id_null_rate || 0);
  const fillSignalNull = Number(summary.fills_signal_doc_id_null_rate || 0);
  const fillIntentNull = Number(summary.fills_intent_id_null_rate || 0);
  if (intentNull >= 0.2 || fillSignalNull >= 0.5 || fillIntentNull >= 0.5) return "FAIL";
  if (intentNull > 0 || fillSignalNull > 0 || fillIntentNull > 0) return "WARN";
  return "PASS";
}

async function publishSharedLatest(report = {}, meta = {}, latestJsonPath = null, latestMdPath = null) {
  try {
    const db = getFirestore();
    await db.collection(REPORT_LATEST_COLLECTION).doc(REPORT_LATEST_DOC_ID).set({
      updated_at: new Date().toISOString(),
      report_type: "signal_lineage_health",
      generated_at_kst: report.generated_at_kst || null,
      generated_at: report.generated_at || null,
      date_key: meta.dateKey || null,
      hhmm: meta.hhmm || null,
      latest_json_path: latestJsonPath || null,
      latest_markdown_path: latestMdPath || null,
      summary: report.summary || {},
      report,
    }, { merge: true });
    return true;
  } catch (err) {
    console.error(`[SIGNAL_LINEAGE_HEALTH_SHARED_LATEST_WRITE_FAIL] ${err.message}`);
    return false;
  }
}

async function main() {
  const meta = nowKstMeta();
  const windowHours = Math.max(1, Number(process.env.SIGNAL_LINEAGE_HEALTH_WINDOW_HOURS || 24) || 24);

  const signals = readDocs(PATHS.signals).filter((row) => inLastHours(row, windowHours));
  const intents = readDocs(PATHS.intents).filter((row) => inLastHours(row, windowHours));
  const fills = readDocs(PATHS.fills).filter((row) => inLastHours(row, windowHours));

  const serverAuthSignals = signals.filter((row) =>
    upper(row && row.source) === "SERVER"
    && row && row.authoritative === true
  );
  const authoritativeEntrySignals = serverAuthSignals.filter((row) => !upper(row && row.event).startsWith("EXIT_"));
  const authoritativeSignalDocIds = new Set(
    authoritativeEntrySignals
      .map((row) => String(row && row.signal_id || "").trim())
      .filter((id) => id.startsWith("SIG__"))
  );

  const intentsSignalDocIdNull = intents.filter((row) => !String(row && row.signal_doc_id || "").trim());
  const fillsSignalDocIdNull = fills.filter((row) => !String(row && row.signal_doc_id || "").trim());
  const fillsIntentIdNull = fills.filter((row) => !String(row && row.intent_id || "").trim());

  const intentsLinkedBySignalDocIdN = intents.filter((row) => {
    const id = String(row && row.signal_doc_id || "").trim();
    return id && authoritativeSignalDocIds.has(id);
  }).length;

  const summary = {
    window_hours: windowHours,
    server_auth_24h_n: serverAuthSignals.length,
    authoritative_entry_24h_n: authoritativeEntrySignals.length,
    intents_24h_n: intents.length,
    fills_24h_n: fills.length,
    intents_signal_doc_id_null_n: intentsSignalDocIdNull.length,
    intents_signal_doc_id_null_rate: ratio(intentsSignalDocIdNull.length, intents.length),
    fills_signal_doc_id_null_n: fillsSignalDocIdNull.length,
    fills_signal_doc_id_null_rate: ratio(fillsSignalDocIdNull.length, fills.length),
    fills_intent_id_null_n: fillsIntentIdNull.length,
    fills_intent_id_null_rate: ratio(fillsIntentIdNull.length, fills.length),
    intents_linked_by_signal_doc_id_n: intentsLinkedBySignalDocIdN,
  };
  summary.verdict = computeVerdict(summary);

  const report = {
    ok: true,
    generated_at_kst: meta.kst,
    inputs: {
      window_hours: windowHours,
      signals_path: PATHS.signals,
      intents_path: PATHS.intents,
      fills_path: PATHS.fills,
    },
    summary,
    top_null_buckets: {
      intents_signal_doc_id_null: topMap(countBy(intentsSignalDocIdNull, (row) => `${upper(row && row.event) || "N/A"}|${upper(row && row.reason) || "N/A"}`)),
      fills_signal_doc_id_null: topMap(countBy(fillsSignalDocIdNull, (row) => `${upper(row && row.event) || "N/A"}|${upper(row && row.exec_price_source) || "N/A"}`)),
      fills_intent_id_null: topMap(countBy(fillsIntentIdNull, (row) => `${upper(row && row.event) || "N/A"}|${upper(row && row.exec_price_source) || "N/A"}`)),
    },
  };

  const base = `${meta.dateKey}_${meta.hhmm}_signal_lineage_health`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  const shared_latest_written = await publishSharedLatest(report, meta, latestJsonPath, latestMdPath);

  console.log(JSON.stringify({
    ok: true,
    verdict: summary.verdict,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
    shared_latest_written,
    shared_latest_doc: `${REPORT_LATEST_COLLECTION}/${REPORT_LATEST_DOC_ID}`,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
