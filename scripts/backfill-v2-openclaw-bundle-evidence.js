#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { listV2Docs, putV2DocsBatch } = require("../src/v2/storage");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function firstValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    return value;
  }
  return null;
}

function normalizeBundleEvidence(row) {
  const doc = asObject(cloneJson(row));
  if (!doc) return null;
  const payload = asObject(doc.bundle_payload);
  if (!payload) return null;
  const signalCriteria = asObject(payload.signalCriteria || payload.signal_criteria);
  const marketDataQuality = asObject(payload.marketDataQuality || payload.market_data_quality);
  const canonical = asObject(payload.canonicalEvidenceSummary || payload.canonical_evidence_summary);
  const featureContract = asObject(signalCriteria && signalCriteria.feature_snapshot_contract);
  const metrics = asObject(marketDataQuality && marketDataQuality.metrics);
  const canonicalMdq = asObject(canonical && canonical.market_data_quality);
  const canonicalMetrics = asObject(canonicalMdq && canonicalMdq.metrics);
  if (!featureContract && !metrics && !canonicalMetrics) return doc;

  const btc = upper(firstValue(
    featureContract && (featureContract.btc_1h_trend || featureContract.btc_1h_direction),
    metrics && (metrics.btc_1h_trend || metrics.btc_1h_direction),
    canonicalMetrics && (canonicalMetrics.btc_1h_trend || canonicalMetrics.btc_1h_direction)
  ));
  const mtf = upper(firstValue(
    featureContract && (featureContract.mtf_1h_direction || featureContract.htf_1h_direction),
    metrics && (metrics.mtf_1h_direction || metrics.htf_1h_direction),
    canonicalMetrics && (canonicalMetrics.mtf_1h_direction || canonicalMetrics.htf_1h_direction)
  ));

  const nextSignalCriteria = signalCriteria ? {
    ...signalCriteria,
    feature_snapshot_contract: {
      ...(featureContract || {}),
      btc_1h_trend: upper(firstValue(featureContract && featureContract.btc_1h_trend, btc)),
      mtf_1h_direction: upper(firstValue(featureContract && featureContract.mtf_1h_direction, mtf)),
    },
  } : signalCriteria;
  const nextMarketDataQuality = marketDataQuality ? {
    ...marketDataQuality,
    metrics: {
      ...(metrics || {}),
      btc_1h_trend: upper(firstValue(metrics && metrics.btc_1h_trend, btc)),
      mtf_1h_direction: upper(firstValue(metrics && metrics.mtf_1h_direction, mtf)),
    },
  } : marketDataQuality;
  const nextCanonical = canonical ? {
    ...canonical,
    market_data_quality: canonicalMdq ? {
      ...canonicalMdq,
      metrics: {
        ...(canonicalMetrics || {}),
        btc_1h_trend: upper(firstValue(canonicalMetrics && canonicalMetrics.btc_1h_trend, btc)),
        mtf_1h_direction: upper(firstValue(canonicalMetrics && canonicalMetrics.mtf_1h_direction, mtf)),
      },
    } : canonicalMdq,
  } : canonical;

  const nextPayload = {
    ...payload,
    signalCriteria: nextSignalCriteria || payload.signalCriteria,
    marketDataQuality: nextMarketDataQuality || payload.marketDataQuality,
    canonicalEvidenceSummary: nextCanonical || payload.canonicalEvidenceSummary,
  };
  return {
    ...doc,
    bundle_payload: nextPayload,
  };
}

function changed(row, nextRow) {
  return JSON.stringify(row) !== JSON.stringify(nextRow);
}

function resolveOutputFile(env = process.env) {
  return path.resolve(
    trimOrNull(env.V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_OUTPUT_FILE)
      || path.join("ops", "daily", "v2_openclaw_bundle_evidence_backfill_latest.json")
  );
}

async function runBackfill({ db = null, env = process.env } = {}) {
  const limit = Math.max(1, Math.min(5000, Number(env.V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_LIMIT || 500) || 500));
  const listed = await listV2Docs({
    db,
    env,
    collectionKey: "OPENCLAW_DECISION_BUNDLES",
    limit,
    orderBy: trimOrNull(env.V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_ORDER_FIELD) || "created_at",
    direction: trimOrNull(env.V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_ORDER_DIRECTION) || "desc",
  });
  const rows = listed.rows || [];
  const changedRows = [];
  for (const row of rows) {
    const nextRow = normalizeBundleEvidence(row);
    if (!nextRow) continue;
    if (changed(row, nextRow)) changedRows.push(nextRow);
  }

  const writeEnabled = boolFromEnv(env.V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_WRITE, false);
  let writeN = 0;
  if (writeEnabled && changedRows.length) {
    const writes = changedRows.map((doc) => ({
      collectionKey: "OPENCLAW_DECISION_BUNDLES",
      doc,
      merge: true,
    }));
    const result = await putV2DocsBatch({ db, env, writes });
    writeN = Number(result && result.write_n || 0);
  }

  const artifact = {
    ok: true,
    reason: writeEnabled
      ? "V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_WRITTEN"
      : "V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_DRY_RUN",
    generated_at: new Date().toISOString(),
    output_file: resolveOutputFile(env),
    sample_n: rows.length,
    changed_n: changedRows.length,
    write_enabled: writeEnabled,
    write_n: writeN,
    sample_changed_ids: changedRows.slice(0, 20).map((row) => row.openclaw_decision_bundle_id),
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
      reason: "V2_OPENCLAW_BUNDLE_EVIDENCE_BACKFILL_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runBackfill,
    __test: {
      normalizeBundleEvidence,
      changed,
    },
  };
}
