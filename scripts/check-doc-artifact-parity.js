#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(ROOT, "ops", "daily");
const LOCK_DOC_PATH = path.join(ROOT, "docs", "ARTIFACT_SSOT_LOCK.md");

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function unwrapSummary(doc) {
  if (!doc || typeof doc !== "object") return {};
  const raw = doc.raw && typeof doc.raw === "object"
    ? doc.raw
    : (doc.display && typeof doc.display === "object" ? doc.display : doc);
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function parseValue(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseLockDoc(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*-\s*([a-zA-Z0-9_.-]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = String(m[1] || "").trim();
    const value = parseValue(m[2]);
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function normalize(v) {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v == null ? "" : v).trim();
}

function main() {
  const lockText = fs.readFileSync(LOCK_DOC_PATH, "utf8");
  const lock = parseLockDoc(lockText);

  const governorSummary = unwrapSummary(readJsonSafe(path.join(OPS_DAILY_DIR, "best_self_evolution_objective_recovery_governor_latest.json"), null));
  const runtimeSummary = unwrapSummary(readJsonSafe(path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json"), null));
  const cutoverSummary = unwrapSummary(readJsonSafe(path.join(OPS_DAILY_DIR, "server_signal_cutover_readiness_latest.json"), null));

  const actual = {
    governor_status: governorSummary.governor_status,
    degraded_authority_eligible: governorSummary.degraded_authority_eligible,
    server_signal_source_mode: runtimeSummary.canonical_engine_source_mode,
    server_signal_readiness_status: cutoverSummary.readiness_status,
  };

  const mismatches = [];
  for (const [key, expectedRaw] of Object.entries(lock)) {
    if (!(key in actual)) continue;
    const expected = normalize(expectedRaw);
    const got = normalize(actual[key]);
    if (expected !== got) {
      mismatches.push({ key, expected, actual: got });
    }
  }

  const result = {
    ok: mismatches.length === 0,
    checked_n: Object.keys(lock).length,
    mismatch_n: mismatches.length,
    mismatches,
    lock_doc: LOCK_DOC_PATH,
    generated_at: new Date().toISOString(),
  };

  const outPath = path.join(OPS_DAILY_DIR, "doc_artifact_parity_latest.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);

  if (mismatches.length > 0) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main();
}
