#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { listV2Docs, putV2DocsBatch } = require("../src/v2/storage");
const { extractOutcomeContext } = require("../src/v2/signalCohortReport");
const { enrichOutcomeRowsWithDecisionEvidence } = require("../src/v2/openclawDailyPerformanceReport");
const {
  loadDecisionEvidence,
  __test: {
    collectDecisionEvidenceLookupKeysFromOutcomes,
  },
} = require("./collect-v2-openclaw-outcome-adjudications");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveOutputFile(env = process.env) {
  return path.resolve(
    trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_OUTPUT_FILE)
      || path.join("ops", "daily", "v2_openclaw_outcome_adjudication_backfill_latest.json")
  );
}

function chunk(items, size) {
  const out = [];
  for (let idx = 0; idx < items.length; idx += size) {
    out.push(items.slice(idx, idx + size));
  }
  return out;
}

function contextSignature(row) {
  const context = extractOutcomeContext(row);
  return JSON.stringify({
    full_evidence: context.full_evidence,
    extended_microstructure_evidence_complete: context.extended_microstructure_evidence_complete,
    setup_type: context.setup_type,
    edge_cohort: context.edge_cohort,
    market_quality_score: context.market_quality_score,
    btc_1h_trend: context.btc_1h_trend,
    mtf_1h_direction: context.mtf_1h_direction,
    spread_bps: context.spread_bps,
    funding_rate: context.funding_rate,
    feature_lineage_source: context.feature_lineage_source,
  });
}

async function collectAdjudications({ db = null, env = process.env } = {}) {
  const limit = Math.max(1, Math.min(5000, Number(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_LIMIT || 1000) || 1000));
  const result = await listV2Docs({
    db,
    env,
    collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
    limit,
    orderBy: trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_ORDER_FIELD) || "adjudicated_at",
    direction: trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_ORDER_DIRECTION) || "desc",
  });
  return result.rows || [];
}

async function runBackfill({ db = null, env = process.env } = {}) {
  const rows = await collectAdjudications({ db, env });
  const lookupKeys = collectDecisionEvidenceLookupKeysFromOutcomes(rows);
  const decisionEvidenceInputPath = env.V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_INPUT_FILE
    || path.join("ops", "daily", "cache", "firestore_recent", "openclaw_decision_bundles_v2.json");
  const loadedDecisionEvidence = await loadDecisionEvidence({
    inputPath: decisionEvidenceInputPath,
    env,
    db,
    lookupKeys,
  });
  const enrichedRows = enrichOutcomeRowsWithDecisionEvidence({
    outcomes: rows,
    decisionEvidenceRows: loadedDecisionEvidence.decisionEvidenceRows,
  });
  const changed = [];
  let improvedFullEvidenceN = 0;
  let improvedCoreEvidenceN = 0;
  for (let idx = 0; idx < rows.length; idx += 1) {
    const before = rows[idx];
    const after = enrichedRows[idx];
    const beforeContext = extractOutcomeContext(before);
    const afterContext = extractOutcomeContext(after);
    const changedEvidence = JSON.stringify(before && before.evidence || null) !== JSON.stringify(after && after.evidence || null);
    const changedContext = contextSignature(before) !== contextSignature(after);
    if (!changedEvidence && !changedContext) continue;
    if (beforeContext.full_evidence !== true && afterContext.full_evidence === true) improvedFullEvidenceN += 1;
    if ((beforeContext.full_evidence !== true) && (afterContext.full_evidence === true || afterContext.setup_type || afterContext.edge_cohort || afterContext.market_quality_score != null)) {
      improvedCoreEvidenceN += 1;
    }
    changed.push(after);
  }

  const writeEnabled = boolFromEnv(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_WRITE, false);
  const batchSize = Math.max(1, Math.min(400, Number(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_BATCH_SIZE || 200) || 200));
  const writeBatches = chunk(changed, batchSize);
  let writeN = 0;
  if (writeEnabled && writeBatches.length) {
    for (const batchRows of writeBatches) {
      const writes = batchRows.map((doc) => ({
        collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
        doc,
        merge: true,
      }));
      const result = await putV2DocsBatch({ db, env, writes });
      writeN += Number(result && result.write_n || 0);
    }
  }

  const artifact = {
    ok: true,
    reason: writeEnabled
      ? "V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_WRITTEN"
      : "V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_DRY_RUN",
    generated_at: new Date().toISOString(),
    output_file: resolveOutputFile(env),
    write_enabled: writeEnabled,
    adjudication_n: rows.length,
    decision_evidence_source: loadedDecisionEvidence.source,
    decision_evidence_row_n: Array.isArray(loadedDecisionEvidence.decisionEvidenceRows) ? loadedDecisionEvidence.decisionEvidenceRows.length : 0,
    decision_evidence_targeted_match_n: loadedDecisionEvidence.targeted_match_n || 0,
    lookup_key_counts: {
      openclaw_decision_id_n: lookupKeys.openclawDecisionIds.length,
      signal_intent_id_n: lookupKeys.signalIntentIds.length,
      position_cycle_id_n: lookupKeys.positionCycleIds.length,
    },
    changed_n: changed.length,
    improved_full_evidence_n: improvedFullEvidenceN,
    improved_core_evidence_n: improvedCoreEvidenceN,
    write_n: writeN,
    sample_changed_ids: changed.slice(0, 20).map((row) => row.openclaw_outcome_adjudication_id),
  };
  writeJson(artifact.output_file, artifact);
  return artifact;
}

async function main(env = process.env) {
  const artifact = await runBackfill({ env });
  console.log(JSON.stringify(artifact, null, 2));
  return artifact;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_OPENCLAW_OUTCOME_ADJUDICATION_BACKFILL_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runBackfill,
    collectAdjudications,
    __test: {
      contextSignature,
      chunk,
      resolveOutputFile,
    },
  };
}
