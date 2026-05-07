#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { listV2Docs, queryV2DocsByField } = require("../src/v2/storage");
const { buildOpenClawDailyPerformanceReport } = require("../src/v2/openclawDailyPerformanceReport");

const OUTPUT_FILENAME = "v2_openclaw_daily_performance_report_latest.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveRunId(env = process.env) {
  return trimOrNull(env.V2_EVIDENCE_CYCLE_RUN_ID)
    || trimOrNull(env.OPENCLAW_RUN_ID)
    || null;
}

function resolveOutputFile(env = process.env) {
  const explicit = trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve("ops", "daily", OUTPUT_FILENAME);
}

function resolveInputRows(env = process.env) {
  const file = trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_INPUT_FILE);
  if (!file) return null;
  const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return Array.isArray(payload) ? payload : (Array.isArray(payload.outcomes) ? payload.outcomes : []);
}

async function collectOutcomes({ db = null, env = process.env } = {}) {
  const fixtureRows = resolveInputRows(env);
  if (fixtureRows) return fixtureRows;
  const limit = Math.max(1, Math.min(500, Number(env.V2_OPENCLAW_DAILY_PERFORMANCE_LIMIT || 100) || 100));
  const result = await listV2Docs({
    db,
    env,
    collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
    limit,
    orderBy: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_ORDER_FIELD) || "adjudicated_at",
    direction: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_ORDER_DIRECTION) || "desc",
  });
  return result.rows || [];
}

async function collectDecisionEvidenceRows({ db = null, env = process.env } = {}) {
  const limit = Math.max(1, Math.min(1000, Number(env.V2_OPENCLAW_DAILY_PERFORMANCE_DECISION_LIMIT || 500) || 500));
  const [decisions, bundles] = await Promise.all([
    listV2Docs({
      db,
      env,
      collectionKey: "OPENCLAW_DECISIONS",
      limit,
      orderBy: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_DECISION_ORDER_FIELD) || "created_at",
      direction: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_DECISION_ORDER_DIRECTION) || "desc",
    }).catch(() => ({ rows: [] })),
    listV2Docs({
      db,
      env,
      collectionKey: "OPENCLAW_DECISION_BUNDLES",
      limit,
      orderBy: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_DECISION_ORDER_FIELD) || "created_at",
      direction: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_DECISION_ORDER_DIRECTION) || "desc",
    }).catch(() => ({ rows: [] })),
  ]);
  return [...(decisions.rows || []), ...(bundles.rows || [])];
}

function collectDecisionLookupKeys(outcomes = []) {
  const decisionIds = new Set();
  const signalIntentIds = new Set();
  const positionCycleIds = new Set();
  for (const row of Array.isArray(outcomes) ? outcomes : []) {
    const evidence = row && row.evidence && typeof row.evidence === "object" ? row.evidence : {};
    const entryFeatures = evidence.entry_features && typeof evidence.entry_features === "object" ? evidence.entry_features : {};
    const decisionId = trimOrNull(row && row.openclaw_decision_id)
      || trimOrNull(evidence.openclaw_decision_id);
    const signalIntentId = trimOrNull(row && (row.signal_intent_id || row.intent_id))
      || trimOrNull(evidence.signal_intent_id)
      || trimOrNull(evidence.intent_id)
      || trimOrNull(entryFeatures.signal_intent_id)
      || trimOrNull(entryFeatures.intent_id);
    const positionCycleId = trimOrNull(row && row.position_cycle_id)
      || trimOrNull(evidence.position_cycle_id)
      || trimOrNull(entryFeatures.position_cycle_id);
    if (decisionId) decisionIds.add(decisionId);
    if (signalIntentId) signalIntentIds.add(signalIntentId);
    if (positionCycleId) positionCycleIds.add(positionCycleId);
  }
  return {
    decisionIds: [...decisionIds],
    signalIntentIds: [...signalIntentIds],
    positionCycleIds: [...positionCycleIds],
  };
}

function dedupeDecisionEvidenceRows(rows = []) {
  const seen = new Set();
  const deduped = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const key = trimOrNull(row.openclaw_decision_bundle_id)
      || trimOrNull(row.openclaw_decision_id)
      || trimOrNull(row.signal_intent_id)
      || JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

async function collectDecisionEvidenceRowsForOutcomes({ outcomes = [], db = null, env = process.env } = {}) {
  const keys = collectDecisionLookupKeys(outcomes);
  const queries = [];
  const collections = ["OPENCLAW_DECISIONS", "OPENCLAW_DECISION_BUNDLES"];
  for (const collectionKey of collections) {
    for (const decisionId of keys.decisionIds) {
      queries.push(queryV2DocsByField({ db, env, collectionKey, field: "openclaw_decision_id", value: decisionId, limit: 5 }).catch(() => ({ rows: [] })));
    }
    for (const signalIntentId of keys.signalIntentIds) {
      queries.push(queryV2DocsByField({ db, env, collectionKey, field: "signal_intent_id", value: signalIntentId, limit: 5 }).catch(() => ({ rows: [] })));
    }
    for (const positionCycleId of keys.positionCycleIds) {
      queries.push(queryV2DocsByField({ db, env, collectionKey, field: "position_cycle_id", value: positionCycleId, limit: 5 }).catch(() => ({ rows: [] })));
    }
  }
  if (!queries.length) return collectDecisionEvidenceRows({ db, env });
  const results = await Promise.all(queries);
  const rows = results.flatMap((result) => result && Array.isArray(result.rows) ? result.rows : []);
  if (rows.length) return dedupeDecisionEvidenceRows(rows);
  return collectDecisionEvidenceRows({ db, env });
}

async function main(env = process.env) {
  const rows = await collectOutcomes({ env });
  const decisionEvidenceRows = await collectDecisionEvidenceRowsForOutcomes({ outcomes: rows, env });
  const basePayload = buildOpenClawDailyPerformanceReport({
    outcomes: rows,
    decisionEvidenceRows,
    source: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_INPUT_FILE) ? "JSON_FIXTURE" : "OPENCLAW_OUTCOME_ADJUDICATIONS",
    lookbackHours: Number(env.V2_OPENCLAW_DAILY_PERFORMANCE_LOOKBACK_HOURS || 24) || 24,
  });
  const runId = resolveRunId(env);
  const payload = Object.freeze({
    ...basePayload,
    run_id: runId,
    source_cycle_id: runId,
    manual_run: trimOrNull(env.V2_EVIDENCE_CYCLE_MANUAL_RUN) === "1",
  });
  const outputFile = resolveOutputFile(env);
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, payload);
  console.log(JSON.stringify({
    ok: true,
    reason: payload.reason,
    output_file: outputFile,
    sample_n: payload.sample_n,
    win_rate_pct: payload.win_rate_pct,
    profit_factor: payload.profit_factor,
    expectancy: payload.expectancy,
  }));
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, reason: "V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    collectOutcomes,
    collectDecisionEvidenceRows,
    collectDecisionEvidenceRowsForOutcomes,
    __test: { resolveOutputFile, resolveInputRows },
  };
}
