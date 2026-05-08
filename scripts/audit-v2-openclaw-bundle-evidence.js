#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { listV2Docs } = require("../src/v2/storage");

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function extractFrozenEvidence(row) {
  const bundle = asObject(row && row.bundle_payload) || {};
  const signalCriteria = asObject(bundle.signalCriteria || bundle.signal_criteria) || {};
  const featureContract = asObject(signalCriteria.feature_snapshot_contract) || {};
  const marketDataQuality = asObject(bundle.marketDataQuality || bundle.market_data_quality) || {};
  const metrics = asObject(marketDataQuality.metrics) || {};
  return Object.freeze({
    btc_feature_contract: upper(featureContract.btc_1h_trend || featureContract.btc_1h_direction),
    mtf_feature_contract: upper(featureContract.mtf_1h_direction || featureContract.htf_1h_direction),
    btc_market_metrics: upper(metrics.btc_1h_trend || metrics.btc_1h_direction),
    mtf_market_metrics: upper(metrics.mtf_1h_direction || metrics.htf_1h_direction),
  });
}

function evaluateBundleEvidence(row) {
  const frozen = extractFrozenEvidence(row);
  const missing = [];
  const warnings = [];
  if (!(frozen.btc_feature_contract || frozen.btc_market_metrics)) missing.push("BTC_1H_TREND_MISSING");
  if (!(frozen.mtf_feature_contract || frozen.mtf_market_metrics)) missing.push("MTF_1H_DIRECTION_MISSING");
  if (!frozen.btc_feature_contract) warnings.push("FEATURE_CONTRACT:BTC_1H_TREND_MISSING");
  if (!frozen.mtf_feature_contract) warnings.push("FEATURE_CONTRACT:MTF_1H_DIRECTION_MISSING");
  if (!frozen.btc_market_metrics) warnings.push("MARKET_METRICS:BTC_1H_TREND_MISSING");
  if (!frozen.mtf_market_metrics) warnings.push("MARKET_METRICS:MTF_1H_DIRECTION_MISSING");
  return Object.freeze({
    ok: missing.length === 0,
    missing,
    warnings,
    frozen,
  });
}

function resolveOutputFile(env = process.env) {
  return path.resolve(
    trimOrNull(env.V2_OPENCLAW_BUNDLE_EVIDENCE_AUDIT_OUTPUT_FILE)
      || path.join("ops", "daily", "v2_openclaw_bundle_evidence_audit_latest.json")
  );
}

async function runAudit({ db = null, env = process.env } = {}) {
  const limit = Math.max(1, Math.min(1000, Number(env.V2_OPENCLAW_BUNDLE_EVIDENCE_AUDIT_LIMIT || 100) || 100));
  const listed = await listV2Docs({
    db,
    env,
    collectionKey: "OPENCLAW_DECISION_BUNDLES",
    limit,
    orderBy: trimOrNull(env.V2_OPENCLAW_BUNDLE_EVIDENCE_AUDIT_ORDER_FIELD) || "created_at",
    direction: trimOrNull(env.V2_OPENCLAW_BUNDLE_EVIDENCE_AUDIT_ORDER_DIRECTION) || "desc",
  });
  const rows = listed.rows || [];
  const samples = [];
  let okN = 0;
  let failN = 0;
  const missingCounts = {};
  const warningCounts = {};
  for (const row of rows) {
    const verdict = evaluateBundleEvidence(row);
    if (verdict.ok) {
      okN += 1;
    } else {
      failN += 1;
      for (const item of verdict.missing) missingCounts[item] = (missingCounts[item] || 0) + 1;
    }
    for (const item of verdict.warnings) warningCounts[item] = (warningCounts[item] || 0) + 1;
    if (samples.length < 20) {
      samples.push({
        openclaw_decision_bundle_id: row.openclaw_decision_bundle_id,
        openclaw_decision_id: row.openclaw_decision_id,
        signal_intent_id: row.signal_intent_id,
        created_at: row.created_at,
        ok: verdict.ok,
        missing: verdict.missing,
        warnings: verdict.warnings,
        frozen: verdict.frozen,
      });
    }
  }
  return Object.freeze({
    ok: failN === 0,
    reason: failN === 0
      ? "V2_OPENCLAW_BUNDLE_EVIDENCE_AUDIT_PASS"
      : "V2_OPENCLAW_BUNDLE_EVIDENCE_AUDIT_FAIL",
    generated_at: new Date().toISOString(),
    output_file: resolveOutputFile(env),
    sample_n: rows.length,
    ok_n: okN,
    fail_n: failN,
    missing_counts: missingCounts,
    warning_counts: warningCounts,
    samples,
  });
}

async function main(env = process.env) {
  const artifact = await runAudit({ env });
  writeJson(artifact.output_file, artifact);
  console.log(JSON.stringify(artifact, null, 2));
  return artifact;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_OPENCLAW_BUNDLE_EVIDENCE_AUDIT_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runAudit,
    __test: {
      extractFrozenEvidence,
      evaluateBundleEvidence,
    },
  };
}
