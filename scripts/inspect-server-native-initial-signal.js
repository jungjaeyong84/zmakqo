#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { queryBars } = require("../src/storage/barsSnapshots");
const { __test, HTF_TF } = require("../src/services/serverNativeInitialSignal");

function loadAdcQuotaProject() {
  try {
    const adcPath = path.join(process.env.HOME || "", ".config", "gcloud", "application_default_credentials.json");
    if (!adcPath || !fs.existsSync(adcPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(adcPath, "utf8"));
    const quotaProject = String(parsed && parsed.quota_project_id || "").trim();
    return quotaProject || null;
  } catch (_err) {
    return null;
  }
}

if (!process.env.GOOGLE_CLOUD_PROJECT) {
  const quotaProject = loadAdcQuotaProject();
  if (quotaProject) process.env.GOOGLE_CLOUD_PROJECT = quotaProject;
}

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => String(item || "").startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function pickDiagnostics(diag) {
  if (!diag || typeof diag !== "object") return null;
  return {
    timestamp: diag.timestamp,
    pricePosition: diag.pricePosition,
    bodyRatio: diag.bodyRatio,
    participation: diag.participation,
    trendStrengthRaw: diag.trendStrengthRaw,
    structureAlignmentLong: diag.structureAlignmentLong,
    structureAlignmentShort: diag.structureAlignmentShort,
    directionalPressureLong: diag.directionalPressureLong,
    directionalPressureShort: diag.directionalPressureShort,
    continuationPressureLong: diag.continuationPressureLong,
    continuationPressureShort: diag.continuationPressureShort,
    pullbackQualityLong: diag.pullbackQualityLong,
    pullbackQualityShort: diag.pullbackQualityShort,
    riskEfficiencyLong: diag.riskEfficiencyLong,
    riskEfficiencyShort: diag.riskEfficiencyShort,
    triggerTypeLong: diag.triggerTypeLong,
    triggerTypeShort: diag.triggerTypeShort,
    triggerBreakoutLong: diag.triggerBreakoutLong,
    triggerReclaimLong: diag.triggerReclaimLong,
    triggerContinuationLong: diag.triggerContinuationLong,
    triggerBreakdownShort: diag.triggerBreakdownShort,
    triggerLossShort: diag.triggerLossShort,
    triggerContinuationShort: diag.triggerContinuationShort,
    longOpportunity: diag.longOpportunity,
    shortOpportunity: diag.shortOpportunity,
    longEarlyRaw: diag.longEarlyRaw,
    longCoreRaw: diag.longCoreRaw,
    shortEarlyRaw: diag.shortEarlyRaw,
    shortCoreRaw: diag.shortCoreRaw,
    transitionCoreQualityLong: diag.transitionCoreQualityLong,
    transitionCoreQualityShort: diag.transitionCoreQualityShort,
    riskModeLongEarly: diag.riskModeLongEarly,
    riskModeShortEarly: diag.riskModeShortEarly,
    riskModeLongCore: diag.riskModeLongCore,
    riskModeShortCore: diag.riskModeShortCore,
  };
}

function summarizeBlockers(row) {
  const diag = row && row.diagnostics;
  if (!diag) return ["NO_DIAGNOSTICS"];
  const blockers = [];
  if (
    !diag.triggerBreakoutLong &&
    !diag.triggerReclaimLong &&
    !diag.triggerContinuationLong &&
    !diag.triggerBreakdownShort &&
    !diag.triggerLossShort &&
    !diag.triggerContinuationShort
  ) {
    blockers.push("NO_TRIGGER");
  }
  if (diag.longOpportunity < 0.56 && diag.shortOpportunity < 0.56) {
    blockers.push("OPPORTUNITY_BELOW_EARLY");
  }
  if (
    (diag.triggerContinuationLong || diag.triggerBreakoutLong || diag.triggerContinuationShort || diag.triggerBreakdownShort) &&
    diag.longOpportunity < 0.68 &&
    diag.shortOpportunity < 0.68
  ) {
    blockers.push("OPPORTUNITY_BELOW_CORE");
  }
  if (
    (diag.triggerContinuationLong || diag.triggerBreakoutLong || diag.triggerContinuationShort || diag.triggerBreakdownShort) &&
    diag.participation < 0.42
  ) {
    blockers.push("LOW_PARTICIPATION_FOR_CORE");
  }
  if (
    (!diag.transitionCoreQualityLong && (diag.triggerContinuationLong || diag.triggerBreakoutLong)) ||
    (!diag.transitionCoreQualityShort && (diag.triggerContinuationShort || diag.triggerBreakdownShort))
  ) {
    blockers.push("TRANSITION_CORE_QUALITY_FAIL");
  }
  const riskModes = [
    diag.riskModeLongEarly,
    diag.riskModeShortEarly,
    diag.riskModeLongCore,
    diag.riskModeShortCore,
  ].filter((item) => item && item !== "PASS");
  blockers.push(...riskModes.map((mode) => `RISK_${mode}`));
  return Array.from(new Set(blockers));
}

async function main() {
  const exchange = arg("exchange", "BINANCEFUT");
  const symbol = arg("symbol", "BNBUSDT");
  const tf = arg("tf", "15m");
  const rawBarMs = arg("bar-ms", null);
  const barMs = rawBarMs == null || rawBarMs === "" ? NaN : Number(rawBarMs);
  const bars = await queryBars({ exchange, symbol, tf, limit: 260 });
  const htfBars = await queryBars({ exchange, symbol, tf: HTF_TF, limit: 140 });
  const evaluated = __test.evaluateSignalsForBars({ exchange, symbol, tf, bars, htfBars });
  const selected = Number.isFinite(barMs)
    ? evaluated.filter((row) => Number(row && row.diagnostics && row.diagnostics.timestamp) === barMs)
    : evaluated.slice(-5);
  const payload = selected.map((row) => ({
    bar_close_ms: row && row.diagnostics && row.diagnostics.timestamp,
    marketState: row && row.marketState,
    htfBias: row && row.htfBias,
    emitted: Array.isArray(row && row.emitted) ? row.emitted.map((signal) => ({
      event: signal && signal.event,
      grade: signal && signal.features && signal.features.entry_grade,
      trigger: signal && signal.features && signal.features.trigger_type,
      opportunity: signal && signal.features && signal.features.opportunity_score,
    })) : [],
    blockers: summarizeBlockers(row),
    diagnostics: pickDiagnostics(row && row.diagnostics),
  }));
  console.log(JSON.stringify({
    exchange,
    symbol,
    tf,
    google_cloud_project: process.env.GOOGLE_CLOUD_PROJECT || null,
    bar_count: bars.length,
    htf_bar_count: htfBars.length,
    rows: payload,
  }, null, 2));
}

main().catch((err) => {
  console.error("[INSPECT_SERVER_NATIVE_INITIAL_SIGNAL_FAIL]", err && err.message ? err.message : String(err));
  process.exit(1);
});
