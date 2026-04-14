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

loadLocalEnv();

const ALLOCATOR_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json");
const DEFAULT_HOURS = 12;
const PAGE_SIZE = 400;
const MAX_FETCH = 2000;

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseArgs(argv = []) {
  const out = { hours: DEFAULT_HOURS, exchange: "BINANCEFUT" };
  for (const raw of argv) {
    const text = String(raw || "").trim();
    if (!text.startsWith("--")) continue;
    const [key, value = ""] = text.slice(2).split("=");
    if (key === "hours") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out.hours = n;
    } else if (key === "exchange") {
      out.exchange = String(value || "").trim().toUpperCase() || out.exchange;
    }
  }
  return out;
}

function resolveDropReason(row = {}) {
  const features = row.features && typeof row.features === "object" ? row.features : {};
  return upper(
    row.reason
    || row.drop_reason
    || row._openclaw_executor_reason
    || features._openclaw_executor_reason
    || row.openclaw_executor_reason
    || ""
  ) || "UNKNOWN";
}

function classifyReason(reason = "") {
  const upperReason = upper(reason) || "UNKNOWN";
  if (upperReason.startsWith("OPENCLAW_EXECUTOR_ALLOCATOR_")) return "ALLOCATOR";
  if (upperReason === "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK") return "CORRELATED_EXPOSURE_BLOCK";
  if (upperReason === "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE") return "CORRELATED_EXPOSURE_REDUCE";
  if (upperReason.includes("RECENT_WIN_RATE")) return "RECENT_WIN_RATE_GUARD";
  if (upperReason.includes("CORRELATED_CLUSTER")) return "CORRELATED_CLUSTER";
  if (upperReason.includes("SAME_SIDE")) return "SAME_SIDE";
  if (upperReason.includes("RECENT_REENTRY")) return "RECENT_REENTRY";
  return "OTHER";
}

function classifyLiveIssue({ family, allocatorStale }) {
  if (family === "ALLOCATOR") {
    return allocatorStale ? "STALE_ALLOCATOR_AFFECTED" : "LIVE_ALLOCATOR_POLICY";
  }
  if (family === "CORRELATED_EXPOSURE_BLOCK") return "LIVE_CORRELATED_EXPOSURE_BLOCK";
  if (family === "RECENT_WIN_RATE_GUARD") return "LIVE_RECENT_WIN_RATE_GUARD";
  return "OTHER";
}

function increment(map, key) {
  const normalized = String(key || "UNKNOWN").trim() || "UNKNOWN";
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function mapToSortedRows(map) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

async function fetchRecentDrops({ db, sinceIso, exchange }) {
  const rows = [];
  let lastDoc = null;
  while (rows.length < MAX_FETCH) {
    let query = db.collection("signals_dropped").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const createdAt = String(data.created_at || "").trim();
      if (createdAt && createdAt < sinceIso) {
        return rows;
      }
      if (upper(data.exchange) !== exchange) continue;
      rows.push({ id: doc.id, ...data });
      if (rows.length >= MAX_FETCH) return rows;
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchSignalDocs(db, signalIds = []) {
  const uniqueIds = Array.from(new Set((Array.isArray(signalIds) ? signalIds : []).filter(Boolean)));
  const out = new Map();
  const chunkSize = 50;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const docs = await Promise.all(chunk.map((id) => db.collection("signals").doc(String(id)).get().catch(() => null)));
    docs.forEach((snap, index) => {
      if (snap && snap.exists) out.set(chunk[index], snap.data() || null);
    });
  }
  return out;
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const allocator = report.current_allocator || {};
  const lines = [
    "# OpenClaw Executor Drop Audit",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- exchange: ${report.exchange || "N/A"}`,
    `- window_hours: ${report.window_hours != null ? report.window_hours : "N/A"}`,
    `- since_iso: ${report.since_iso || "N/A"}`,
    `- drop_n: ${summary.drop_n != null ? summary.drop_n : 0}`,
    `- unique_signal_n: ${summary.unique_signal_n != null ? summary.unique_signal_n : 0}`,
    `- allocator_snapshot_status: ${allocator.status || "N/A"} / freshness=${allocator.input_freshness_status || "N/A"} / input_stale=${allocator.input_stale ? "YES" : "NO"} / generated=${allocator.generated_at_kst || "N/A"}`,
    "",
    "## By Live Issue",
    ...(Array.isArray(summary.by_live_issue) && summary.by_live_issue.length
      ? summary.by_live_issue.map((row) => `- ${row.key}: ${row.count}`)
      : ["- none"]),
    "",
    "## By Reason",
    ...(Array.isArray(summary.by_reason) && summary.by_reason.length
      ? summary.by_reason.slice(0, 12).map((row) => `- ${row.key}: ${row.count}`)
      : ["- none"]),
    "",
    "## Recent Examples",
    ...(Array.isArray(report.examples) && report.examples.length
      ? report.examples.map((row) => `- ${row.created_at || "N/A"} / ${row.symbol || "N/A"} / ${row.reason || "N/A"} / live_issue=${row.live_issue || "N/A"} / drop_qty=${row.drop_qty_pct != null ? row.drop_qty_pct : "N/A"} / signal_qty=${row.signal_qty_pct != null ? row.signal_qty_pct : "N/A"} / signal_id=${row.signal_id || "N/A"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nowMeta = nowKstMeta();
  const nowMs = Date.now();
  const sinceMs = nowMs - (args.hours * 60 * 60 * 1000);
  const sinceIso = new Date(sinceMs).toISOString();
  const allocator = readJsonRawSafe(ALLOCATOR_PATH, null) || {};
  const allocatorSummary = allocator.summary && typeof allocator.summary === "object" ? allocator.summary : {};
  const allocatorStale = allocatorSummary.input_stale === true
    || allocatorSummary.inputs_fresh === false
    || upper(allocatorSummary.input_freshness_status) === "STALE_INPUTS";

  const db = getFirestore();
  const drops = await fetchRecentDrops({ db, sinceIso, exchange: args.exchange });
  const signalIds = drops
    .map((row) => String(row.signal_id || row.signal_doc_id || row.id || "").trim())
    .filter(Boolean)
    .slice(0, MAX_FETCH);
  const signalDocs = await fetchSignalDocs(db, signalIds);

  const byReason = new Map();
  const byFamily = new Map();
  const byLiveIssue = new Map();
  const examples = [];
  const uniqueSignals = new Set();

  for (const row of drops) {
    const signalId = String(row.signal_id || row.signal_doc_id || row.id || "").trim() || null;
    if (signalId) uniqueSignals.add(signalId);
    const reason = resolveDropReason(row);
    const family = classifyReason(reason);
    const liveIssue = classifyLiveIssue({ family, allocatorStale });
    increment(byReason, reason);
    increment(byFamily, family);
    increment(byLiveIssue, liveIssue);
    if (examples.length < 15) {
      const signal = signalId ? signalDocs.get(signalId) : null;
      examples.push({
        created_at: row.created_at || null,
        signal_id: signalId,
        symbol: upper(row.symbol || row.market || signal && signal.symbol) || null,
        reason,
        family,
        live_issue: liveIssue,
        drop_qty_pct: toNum(row.qty_pct),
        signal_qty_pct: toNum(signal && signal.qty_pct),
      });
    }
  }

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    exchange: args.exchange,
    window_hours: args.hours,
    since_iso: sinceIso,
    input_paths: {
      allocator: ALLOCATOR_PATH,
      firestore: "signals_dropped, signals",
    },
    current_allocator: {
      generated_at_kst: allocator.generated_at_kst || null,
      status: allocatorSummary.status || null,
      input_freshness_status: allocatorSummary.input_freshness_status || null,
      input_stale: allocatorSummary.input_stale === true,
      stale_input_n: allocatorSummary.stale_input_n != null ? allocatorSummary.stale_input_n : null,
      stale_input_keys: Array.isArray(allocatorSummary.stale_input_keys) ? allocatorSummary.stale_input_keys : [],
      max_input_age_hours: allocatorSummary.max_input_age_hours != null ? allocatorSummary.max_input_age_hours : null,
    },
    summary: {
      drop_n: drops.length,
      unique_signal_n: uniqueSignals.size,
      allocator_stale: allocatorStale,
      by_reason: mapToSortedRows(byReason),
      by_family: mapToSortedRows(byFamily),
      by_live_issue: mapToSortedRows(byLiveIssue),
    },
    examples,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_openclaw_executor_drop_audit`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "openclaw_executor_drop_audit_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "openclaw_executor_drop_audit_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);

  console.log(JSON.stringify({
    ok: true,
    exchange: report.exchange,
    window_hours: report.window_hours,
    drop_n: report.summary.drop_n,
    allocator_stale: report.summary.allocator_stale,
    top_live_issue: report.summary.by_live_issue[0] || null,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("OPENCLAW_EXECUTOR_DROP_AUDIT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  resolveDropReason,
  classifyReason,
  classifyLiveIssue,
};
