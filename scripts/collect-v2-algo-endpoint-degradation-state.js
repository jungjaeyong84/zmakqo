#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const {
  buildAlgoEndpointDegradationDocPath,
  resolveAlgoEndpointDegradationPolicy,
} = require("../src/v2/algoEndpointDegradationState");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_FILE = path.join(REPO_ROOT, "ops", "daily", "v2_algo_endpoint_degradation_state_latest.json");
const DEFAULT_HISTORY_FILE = path.join(REPO_ROOT, "ops", "daily", "v2_algo_endpoint_degradation_state_history.jsonl");
const DEFAULT_SYMBOLS = Object.freeze([
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "AXSUSDT",
  "DOGEUSDT",
  "LINKUSDT",
]);

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function parseSymbols(value, fallback = DEFAULT_SYMBOLS) {
  const symbols = String(value || "")
    .split(/[|,]/)
    .map((row) => trimOrNull(row))
    .filter(Boolean)
    .map((row) => row.toUpperCase());
  return Object.freeze(symbols.length ? Array.from(new Set(symbols)) : Array.from(fallback));
}

function readSnapData(snap) {
  if (!snap || snap.exists !== true || typeof snap.data !== "function") return null;
  const data = snap.data();
  return data && typeof data === "object" ? data : null;
}

async function readDegradationDocs({ db, env = process.env, exchange = "BINANCEFUT", symbols = DEFAULT_SYMBOLS } = {}) {
  if (parseBool(env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_COLLECT_SKIP_FIRESTORE, false)) {
    return Object.freeze(symbols.map((symbol) => Object.freeze({
      symbol,
      doc_path: buildAlgoEndpointDegradationDocPath({ exchange, symbol }),
      exists: false,
      data: null,
    })));
  }
  const firestore = db || getFirestore();
  const rows = [];
  for (const symbol of symbols) {
    const docPath = buildAlgoEndpointDegradationDocPath({ exchange, symbol });
    const ref = typeof firestore.doc === "function"
      ? firestore.doc(docPath)
      : firestore.collection("runtime_locks").doc(docPath.split("/").pop());
    const snap = await ref.get();
    rows.push(Object.freeze({
      symbol,
      doc_path: docPath,
      exists: snap && snap.exists === true,
      data: readSnapData(snap),
    }));
  }
  return Object.freeze(rows);
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase() || "MISSING";
}

function buildArtifact({ rows = [], env = process.env, exchange = "BINANCEFUT", nowMs = Date.now(), source = "FIRESTORE_RUNTIME_LOCKS" } = {}) {
  const policy = resolveAlgoEndpointDegradationPolicy(env);
  const blockers = [];
  const normalizedRows = [];
  let degradedWarnN = 0;
  let degradedCritN = 0;
  let recoveredN = 0;
  let missingN = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const data = row && row.data && typeof row.data === "object" ? row.data : {};
    const status = normalizeStatus(data.status);
    const durationMs = Math.max(0, Number(data.duration_ms) || 0);
    const escalated = data.escalated === true || durationMs >= policy.crit_after_ms;
    const degraded = status === "DEGRADED";
    const severity = degraded
      ? (escalated ? "CRIT" : "WARN")
      : (status === "RECOVERED" || status === "HEALTHY" ? "OK" : "UNKNOWN");

    if (degraded && escalated) {
      degradedCritN += 1;
      blockers.push(`ALGO_ENDPOINT_DEGRADATION:${row.symbol}:CRIT`);
    } else if (degraded) {
      degradedWarnN += 1;
    } else if (status === "RECOVERED") {
      recoveredN += 1;
    } else if (!row.exists) {
      missingN += 1;
    }

    normalizedRows.push(Object.freeze({
      symbol: row.symbol,
      doc_path: row.doc_path,
      exists: row.exists === true,
      status,
      severity,
      duration_ms: durationMs,
      crit_after_ms: policy.crit_after_ms,
      escalated,
      first_seen_at: trimOrNull(data.first_seen_at),
      last_seen_at: trimOrNull(data.last_seen_at),
      recovered_at: trimOrNull(data.recovered_at),
      consecutive_seen_n: Number(data.consecutive_seen_n) || 0,
      note: trimOrNull(data.note),
    }));
  }

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_ALGO_ENDPOINT_DEGRADATION_STATE_COLLECTED"
      : "V2_ALGO_ENDPOINT_DEGRADATION_STATE_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    source,
    exchange,
    policy,
    blocker_n: blockers.length,
    blockers: Object.freeze(blockers),
    symbol_n: normalizedRows.length,
    degraded_warn_n: degradedWarnN,
    degraded_crit_n: degradedCritN,
    recovered_n: recoveredN,
    missing_n: missingN,
    rows: Object.freeze(normalizedRows),
  });
}

function writeArtifacts({ artifact, env = process.env } = {}) {
  const outputFile = trimOrNull(env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_STATE_FILE) || DEFAULT_OUTPUT_FILE;
  const historyFile = trimOrNull(env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_STATE_HISTORY_FILE) || DEFAULT_HISTORY_FILE;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(historyFile, `${JSON.stringify(artifact)}\n`, "utf8");
  return Object.freeze({ outputFile, historyFile });
}

async function collect({ db = null, env = process.env } = {}) {
  const exchange = trimOrNull(env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_EXCHANGE) || "BINANCEFUT";
  const symbols = parseSymbols(
    env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_SYMBOLS
    || env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS
  );
  const rows = await readDegradationDocs({ db, env, exchange, symbols });
  const source = parseBool(env.DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_COLLECT_SKIP_FIRESTORE, false)
    ? "SKIPPED_FIRESTORE"
    : "FIRESTORE_RUNTIME_LOCKS";
  const artifact = buildArtifact({ rows, env, exchange, source });
  const files = writeArtifacts({ artifact, env });
  return Object.freeze({ artifact, files });
}

async function main(env = process.env) {
  const { artifact, files } = await collect({ env });
  const payload = Object.freeze({
    ok: artifact.ok,
    reason: artifact.reason,
    blockers: artifact.blockers,
    output_file: files.outputFile,
    history_file: files.historyFile,
    symbol_n: artifact.symbol_n,
    degraded_warn_n: artifact.degraded_warn_n,
    degraded_crit_n: artifact.degraded_crit_n,
    recovered_n: artifact.recovered_n,
    missing_n: artifact.missing_n,
  });
  const out = JSON.stringify(payload);
  if (payload.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
  return payload;
}

if (require.main === module) {
  main(process.env).catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_ALGO_ENDPOINT_DEGRADATION_STATE_COLLECT_FAILED",
      blockers: ["ALGO_ENDPOINT_DEGRADATION:COLLECT_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    collect,
    main,
    buildArtifact,
    readDegradationDocs,
    writeArtifacts,
    __test: { trimOrNull, parseBool, parseSymbols, readSnapData, normalizeStatus },
  };
}
