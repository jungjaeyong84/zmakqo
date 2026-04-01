#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
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

function main() {
  const meta = nowMeta();
  const output = {
    ok: true,
    generated_at: meta.iso,
    generated_at_kst: meta.kst,
    inputs: PATHS,
    ...deriveServerSignalQuality({
      signalsRecent: readJsonSafe(PATHS.signals, null),
      intentsRecent: readJsonSafe(PATHS.intents, null),
      fillsRecent: readJsonSafe(PATHS.fills, null),
      tradesRecent: readJsonSafe(PATHS.trades, null),
      parityReport: readJsonSafe(PATHS.parity, null),
      nowMs: Date.now(),
    }),
  };
  writeJson(PATHS.latest, output);
  console.log(JSON.stringify({ ok: true, latest_json: PATHS.latest }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("SERVER_SIGNAL_QUALITY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { main };
