#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { resolveV2CollectionName } = require("../src/v2/storage");
const { deriveServerSignalQuality } = require("../src/utils/serverSignalQuality");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(ROOT, "ops", "daily");
const PATHS = {
  signals: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
  intents: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "order_intents_paper.json"),
  fills: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "fills_paper.json"),
  trades: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "trades_paper.json"),
  parity: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json"),
  latest: path.join(OPS_DAILY_DIR, "server_signal_quality_latest.json"),
};

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function nowMeta() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return {
    iso: now.toISOString(),
    kst: `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())} KST`,
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readCycleId(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  const candidates = [doc.cycle_id, doc.source_cycle_id, doc.generation_id, doc.summary && doc.summary.cycle_id];
  for (const value of candidates) {
    const s = String(value || "").trim();
    if (s) return s;
  }
  return null;
}

async function loadRuntimeTickWindow({ nowMs = Date.now(), maxRows = 500 } = {}) {
  const db = getFirestore();
  const sinceMs = Number(nowMs) - (24 * 60 * 60 * 1000);
  const snap = await db.collection("system_runs").orderBy("started_at", "desc").limit(maxRows).get();
  const summary = {
    server_signal_created_24h_n: 0,
    intents_created_24h_n: 0,
    direct_handoff_generated_24h_n: 0,
    direct_handoff_executed_24h_n: 0,
    direct_handoff_blocked_24h_n: 0,
    direct_handoff_reason_counts: {},
    direct_handoff_nested_reason_counts: {},
    run_n: 0,
  };
  if (snap.empty) return summary;

  for (const doc of snap.docs) {
    const row = doc.data() || {};
    const startedMs = Date.parse(String(row.started_at || ""));
    if (!Number.isFinite(startedMs) || startedMs < sinceMs) continue;
    if (String(row?.meta?.source || "").trim().toUpperCase() !== "OPENCLAW_SERVER_PRIMARY_TICK") continue;
    summary.run_n += 1;
    summary.server_signal_created_24h_n += Number(row.server_signal_created_n || 0);
    summary.intents_created_24h_n += Number(row.intents_created_n || 0);
    summary.direct_handoff_generated_24h_n += Number(row.direct_handoff_generated_n || 0);
    summary.direct_handoff_executed_24h_n += Number(row.direct_handoff_executed_n || 0);
    summary.direct_handoff_blocked_24h_n += Number(row.direct_handoff_blocked_n || 0);
    const reasonCounts = row.direct_handoff_reason_counts && typeof row.direct_handoff_reason_counts === "object"
      ? row.direct_handoff_reason_counts
      : {};
    const nestedReasonCounts = row.direct_handoff_nested_reason_counts && typeof row.direct_handoff_nested_reason_counts === "object"
      ? row.direct_handoff_nested_reason_counts
      : {};
    for (const [reason, count] of Object.entries(reasonCounts)) {
      summary.direct_handoff_reason_counts[reason] = Number(summary.direct_handoff_reason_counts[reason] || 0) + Number(count || 0);
    }
    for (const [reason, count] of Object.entries(nestedReasonCounts)) {
      summary.direct_handoff_nested_reason_counts[reason] = Number(summary.direct_handoff_nested_reason_counts[reason] || 0) + Number(count || 0);
    }
  }
  return summary;
}

async function loadV2Outcomes24h({ nowMs = Date.now(), maxRows = 1000 } = {}) {
  const db = getFirestore();
  const sinceMs = Number(nowMs) - (24 * 60 * 60 * 1000);
  const collection = resolveV2CollectionName("OPENCLAW_OUTCOME_ADJUDICATIONS", process.env);
  const snap = await db.collection(collection).orderBy("adjudicated_at", "desc").limit(maxRows).get();
  const rows = [];
  snap.forEach((doc) => {
    const row = doc.data() || {};
    const atMs = Date.parse(String(row.adjudicated_at || row.created_at || ""));
    if (!Number.isFinite(atMs) || atMs < sinceMs) return;
    rows.push({ id: doc.id || null, ...row });
  });
  return rows;
}

async function main() {
  const meta = nowMeta();
  const parityReport = readJsonSafe(PATHS.parity, null);
  const runtimeTickWindow = await loadRuntimeTickWindow({ nowMs: Date.now() });
  const v2OutcomesRecent = await loadV2Outcomes24h({ nowMs: Date.now() }).catch(() => []);
  const output = {
    ok: true,
    generated_at: meta.iso,
    generated_at_kst: meta.kst,
    cycle_id: readCycleId(parityReport),
    inputs: PATHS,
    ...deriveServerSignalQuality({
      signalsRecent: readJsonSafe(PATHS.signals, null),
      intentsRecent: readJsonSafe(PATHS.intents, null),
      fillsRecent: readJsonSafe(PATHS.fills, null),
      tradesRecent: readJsonSafe(PATHS.trades, null),
      v2OutcomesRecent,
      parityReport,
      runtimeTickWindow,
      nowMs: Date.now(),
    }),
  };
  writeJson(PATHS.latest, output);
  console.log(JSON.stringify({ ok: true, latest_json: PATHS.latest }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SERVER_SIGNAL_QUALITY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { main, loadRuntimeTickWindow };
