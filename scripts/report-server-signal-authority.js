#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { deriveServerSignalAuthority } = require("../src/utils/serverSignalAuthority");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(ROOT, "ops", "daily");
const SIGNALS_RECENT_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json");
const PARITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json");
const LATEST_JSON_PATH = path.join(OPS_DAILY_DIR, "server_signal_authority_latest.json");

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

function main() {
  const meta = nowMeta();
  const signalsRecent = readJsonSafe(SIGNALS_RECENT_PATH, null);
  const parityReport = readJsonSafe(PARITY_LATEST_PATH, null);
  const report = deriveServerSignalAuthority({ signalsRecent, parityReport, nowMs: Date.now() });
  const output = {
    ok: true,
    generated_at: meta.iso,
    generated_at_kst: meta.kst,
    cycle_id: readCycleId(parityReport),
    inputs: {
      signals_recent: SIGNALS_RECENT_PATH,
      parity_latest: PARITY_LATEST_PATH,
    },
    ...report,
  };
  writeJson(LATEST_JSON_PATH, output);
  console.log(JSON.stringify({ ok: true, latest_json: LATEST_JSON_PATH }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("SERVER_SIGNAL_AUTHORITY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
