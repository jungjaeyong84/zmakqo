#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { enrichFeaturesWithRegime } = require("../src/utils/regime");
const { isEntryTierEvent } = require("../src/utils/liveEntryTaxonomy");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.REGIME_GAP_LOOKBACK_DAYS || 14));
const PAGE_SIZE = Math.max(100, Number(process.env.REGIME_GAP_PAGE_SIZE || 500));
const MAX_DOCS = Math.max(PAGE_SIZE, Number(process.env.REGIME_GAP_MAX_DOCS || 5000));
const PROVIDER = String(process.env.REGIME_GAP_PROVIDER || "BINANCEFUT").trim().toUpperCase();

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function safeFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object") return row.features_json;
  if (row && row.features && typeof row.features === "object") return row.features;
  return {};
}

function buildRegimeState(row = null) {
  const enriched = enrichFeaturesWithRegime(safeFeatures(row), row || {});
  return {
    regime: enriched.regime || null,
    market_regime: enriched.market_regime || null,
    regime_source: enriched.regime_source || null,
  };
}

function isRegimeApplicable(collectionName, row = null) {
  const eventIntent = upper(row && row.event_intent);
  if (collectionName === "order_intents_paper") {
    if (eventIntent === "ENTRY" || eventIntent === "ADD") return true;
    return isEntryTierEvent(row);
  }
  if (collectionName === "fills_paper") {
    if (eventIntent === "ENTRY" || eventIntent === "ADD") return true;
    return isEntryTierEvent(row);
  }
  return isEntryTierEvent(row);
}

async function fetchRecentDocs(db, collectionName) {
  const rows = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection(collectionName).orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (upper(data.exchange) !== PROVIDER) continue;
      const createdAt = String(data.created_at || data.updated_at || "");
      if (createdAt && createdAt < sinceIso) continue;
      rows.push({ id: doc.id, ...data });
      if (rows.length >= MAX_DOCS) return rows;
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function summarizeMissing(rows = [], collectionName = "signals") {
  const missing = [];
  const bySymbol = new Map();
  let scoped = 0;
  for (const row of rows) {
    if (!isRegimeApplicable(collectionName, row)) continue;
    scoped += 1;
    const state = buildRegimeState(row);
    if (state.regime) continue;
    const symbol = upper(row.symbol || row.symbol_or_pair_id || row.market) || "UNKNOWN";
    missing.push({
      id: row.id || null,
      symbol,
      event: upper(row.event),
      signal_id: row.signal_id || null,
      signal_doc_id: row.signal_doc_id || null,
      created_at: row.created_at || row.updated_at || null,
    });
    bySymbol.set(symbol, (bySymbol.get(symbol) || 0) + 1);
  }
  return {
    scoped_n: scoped,
    missing_n: missing.length,
    missing_rate: scoped > 0 ? Number((missing.length / scoped).toFixed(6)) : null,
    top_symbols: Array.from(bySymbol.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([symbol, count]) => ({ symbol, count })),
    samples: missing.slice(0, 50),
  };
}

function buildReport({ signals = [], intents = [], fills = [] } = {}) {
  return {
    generated_at_iso: nowIso(),
    lookback_days: LOOKBACK_DAYS,
    exchange: PROVIDER,
    signals: summarizeMissing(signals, "signals"),
    intents: summarizeMissing(intents, "order_intents_paper"),
    fills: summarizeMissing(fills, "fills_paper"),
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Regime Lineage Gap");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- lookback_days: ${report.lookback_days || "N/A"}`);
  lines.push(`- exchange: ${report.exchange || "N/A"}`);
  lines.push("");
  for (const key of ["signals", "intents", "fills"]) {
    const section = report[key] || {};
    lines.push(`## ${key}`);
    lines.push(`- scoped_n: ${section.scoped_n || 0}`);
    lines.push(`- missing_n: ${section.missing_n || 0}`);
    lines.push(`- missing_rate: ${section.missing_rate == null ? "N/A" : `${(section.missing_rate * 100).toFixed(2)}%`}`);
    lines.push(`- top_symbols: ${Array.isArray(section.top_symbols) && section.top_symbols.length ? section.top_symbols.map((row) => `${row.symbol}(${row.count})`).join(", ") : "none"}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const db = getFirestore();
  const [signals, intents, fills] = await Promise.all([
    fetchRecentDocs(db, "signals"),
    fetchRecentDocs(db, "order_intents_paper"),
    fetchRecentDocs(db, "fills_paper"),
  ]);
  const report = buildReport({ signals, intents, fills });
  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const latestJson = path.join(outDir, "regime_lineage_gap_latest.json");
  const datedJson = path.join(outDir, `${isoDate()}_regime_lineage_gap.json`);
  const latestMd = path.join(outDir, "regime_lineage_gap_latest.md");
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestMd, `${buildMarkdown(report)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    signals_missing_n: report.signals.missing_n,
    intents_missing_n: report.intents.missing_n,
    fills_missing_n: report.fills.missing_n,
    output_json: latestJson,
    output_md: latestMd,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_REGIME_LINEAGE_GAP_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

module.exports = {
  __test: {
    isRegimeApplicable,
    summarizeMissing,
    buildReport,
  },
};
