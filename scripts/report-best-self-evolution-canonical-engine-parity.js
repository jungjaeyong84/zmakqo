#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { evaluateCanonicalDecision, resolveCanonicalEngineConfig } = require("../src/services/canonicalEngine");
const { isPrimaryLongShortEvent } = require("../src/utils/liveEntryTaxonomy");

loadLocalEnv();

const PROVIDER = String(process.env.BEST_SELF_EVOLUTION_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.BEST_SELF_EVOLUTION_TF || "15m").trim();
const INPUTS = Object.freeze({
  signals: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
  drops: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json"),
});

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readCacheDocs(filePath) {
  const raw = readJsonRawSafe(filePath, null);
  const docs = raw && Array.isArray(raw.docs) ? raw.docs : [];
  return docs;
}

function resolveObservationMs(row) {
  return (
    toNum(row && row.bar_close_time_utc_ms)
    ?? toNum(row && row.signal_bar_close_time_utc_ms)
    ?? toNum(row && row.exec_bar_close_time_utc_ms)
    ?? 0
  );
}

function buildObservedRows(signals = [], drops = []) {
  const attach = (rows, sourceCollection, actualAccepted) => (Array.isArray(rows) ? rows : [])
    .filter((row) => isPrimaryLongShortEvent(row && row.event))
    .map((row) => ({
      ...row,
      source_collection: sourceCollection,
      actual_accepted: actualAccepted,
    }));
  return [
    ...attach(signals, "signals", true),
    ...attach(drops, "signals_dropped", false),
  ];
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) || "UNKNOWN");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function buildParityBreakdown(rows = [], keyFn = null) {
  const scoped = Array.isArray(rows) ? rows : [];
  const groups = new Map();
  for (const row of scoped) {
    const key = String((typeof keyFn === "function" ? keyFn(row) : null) || "UNKNOWN").trim() || "UNKNOWN";
    const current = groups.get(key) || { key, comparable_n: 0, match_n: 0, mismatch_n: 0 };
    current.comparable_n += 1;
    if (row.parity_match === true) current.match_n += 1;
    if (row.parity_match === false) current.mismatch_n += 1;
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .map((row) => ({
      ...row,
      parity_rate: row.comparable_n > 0 ? (row.match_n / row.comparable_n) : null,
    }))
    .sort((a, b) => b.comparable_n - a.comparable_n || String(a.key).localeCompare(String(b.key)));
}

function classifyDropReasonFamily(reasonRaw) {
  const reason = String(reasonRaw || "").trim().toUpperCase();
  if (!reason) return "ACTUAL_PASS";
  if (reason.includes("STRATEGY_ID_MISMATCH")) return "STRATEGY_GATE";
  if (reason.includes("COOLDOWN")) return "COOLDOWN_POLICY";
  if (reason.includes("EV_GATE")) return "EV_POLICY";
  if (reason.includes("WAIT")) return "WAIT_POLICY";
  if (reason.includes("AI_")) return "AI_POLICY";
  if (reason.includes("MDD")) return "RISK_POLICY";
  if (reason.includes("CANONICAL_ENGINE")) return "SOURCE_THRESHOLD";
  return "OTHER_SERVER_POLICY";
}

function extractStoredActualSourceDecision(row = {}) {
  const featureObj = (row.features_json && typeof row.features_json === "object")
    ? row.features_json
    : ((row.features && typeof row.features === "object") ? row.features : {});
  const decisionRaw = String(
    row.canonical_engine_actual_source_decision
    || featureObj.canonical_engine_actual_source_decision
    || ""
  ).trim().toUpperCase();
  const evidence = String(
    row.canonical_engine_actual_source_evidence
    || featureObj.canonical_engine_actual_source_evidence
    || ""
  ).trim().toUpperCase() || null;
  const sourceReason = String(
    row.canonical_engine_actual_source_reason
    || featureObj.canonical_engine_actual_source_reason
    || ""
  ).trim() || null;
  if (decisionRaw === "PASS" || decisionRaw === "DROP") {
    return {
      available: true,
      pass: decisionRaw === "PASS",
      decision: decisionRaw,
      evidence: evidence || "STORED",
      reason: sourceReason,
    };
  }
  const passRaw = row.canonical_engine_actual_source_pass;
  const featurePassRaw = featureObj.canonical_engine_actual_source_pass;
  const resolvedPass = typeof passRaw === "boolean"
    ? passRaw
    : (typeof featurePassRaw === "boolean" ? featurePassRaw : null);
  if (typeof resolvedPass === "boolean") {
    return {
      available: true,
      pass: resolvedPass,
      decision: resolvedPass ? "PASS" : "DROP",
      evidence: evidence || "STORED",
      reason: sourceReason,
    };
  }
  return {
    available: false,
    pass: null,
    decision: null,
    evidence: null,
    reason: null,
  };
}

function inferActualSourceAccepted(row) {
  if (row.actual_accepted === true) return true;
  const family = classifyDropReasonFamily(row.actual_drop_reason);
  return family !== "SOURCE_THRESHOLD";
}

function deriveParityReport({ rows = [], settings = {}, provider = PROVIDER, tf = TF } = {}) {
  const baseConfig = resolveCanonicalEngineConfig(settings, {});
  const evaluatedRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const features = (row.features_json && typeof row.features_json === "object")
      ? row.features_json
      : ((row.features && typeof row.features === "object") ? row.features : {});
    const market = row.symbol_or_pair_id || row.symbol || features.symbol_or_pair_id || null;
    const resolvedConfig = resolveCanonicalEngineConfig(settings, { market });
    const decision = evaluateCanonicalDecision({
      features,
      event: row.event,
      side: row.side,
      market,
      tf: row.tf || tf,
      config: resolvedConfig,
    });
    const shadowApplicable = decision.detail && decision.detail.canonical_engine_shadow_applicable === true;
    const shadowObserved = decision.detail && decision.detail.canonical_engine_shadow_observed === true;
    const shadowPass = decision.detail && decision.detail.canonical_engine_shadow_pass === true;
    const parityComparable = shadowApplicable && shadowObserved;
    const actualDropReason = row.reason || row.drop_reason || null;
    const actualDropReasonFamily = classifyDropReasonFamily(actualDropReason);
    const storedActualSource = extractStoredActualSourceDecision(row);
    const parityMatch = parityComparable ? shadowPass === (row.actual_accepted === true) : null;
    const actualSourceAccepted = parityComparable
      ? (storedActualSource.available
        ? storedActualSource.pass === true
        : inferActualSourceAccepted({
          actual_accepted: row.actual_accepted === true,
          actual_drop_reason: actualDropReason,
        }))
      : null;
    const sourceParityMatch = parityComparable ? shadowPass === actualSourceAccepted : null;
    const mismatchScope = parityMatch === false
      ? (sourceParityMatch === true ? "FINAL_DOWNSTREAM_MISMATCH" : "SOURCE_MISMATCH")
      : null;
    evaluatedRows.push({
      signal_id: row.signal_id || row.id || null,
      market: String(market || "").trim().toUpperCase() || null,
      event: row.event || null,
      side: row.side || null,
      tf: row.tf || tf,
      source_collection: row.source_collection,
      actual_accepted: row.actual_accepted === true,
      observation_ms: resolveObservationMs(row),
      shadow_applicable: shadowApplicable,
      shadow_observed: shadowObserved,
      shadow_pass: shadowApplicable ? shadowPass : null,
      shadow_reason: decision.detail && decision.detail.canonical_engine_shadow_reason || null,
      score_abs: decision.detail && decision.detail.canonical_engine_score_abs,
      tier: decision.detail && decision.detail.canonical_engine_tier,
      regime: decision.detail && decision.detail.canonical_engine_regime,
      min_core_score_abs: decision.detail && decision.detail.canonical_engine_core_score_abs_min,
      min_transition_core_score_abs: decision.detail && decision.detail.canonical_engine_transition_core_score_abs_min,
      actual_drop_reason: actualDropReason,
      actual_drop_reason_family: actualDropReasonFamily,
      actual_source_accepted: actualSourceAccepted,
      actual_source_decision: storedActualSource.available
        ? storedActualSource.decision
        : (actualSourceAccepted == null ? null : (actualSourceAccepted ? "PASS" : "DROP")),
      actual_source_evidence: storedActualSource.available
        ? storedActualSource.evidence
        : "DERIVED_FALLBACK",
      actual_source_reason: storedActualSource.available
        ? storedActualSource.reason
        : null,
      source_parity_match: sourceParityMatch,
      mismatch_scope: mismatchScope,
      parity_match: parityMatch,
    });
  }

  const comparableRows = evaluatedRows.filter((row) => row.shadow_applicable && row.shadow_observed);
  const mismatchRows = comparableRows.filter((row) => row.parity_match === false);
  const sourceMismatchRows = comparableRows.filter((row) => row.source_parity_match === false);
  const downstreamOnlyMismatchRows = mismatchRows.filter((row) => row.mismatch_scope === "FINAL_DOWNSTREAM_MISMATCH");
  const byMarketParity = buildParityBreakdown(comparableRows, (row) => row.market);
  const byTierParity = buildParityBreakdown(comparableRows, (row) => row.tier || "UNKNOWN");
  const byRegimeParity = buildParityBreakdown(comparableRows, (row) => row.regime || "UNKNOWN");
  const coreParity = byTierParity.find((row) => row.key === "CORE") || null;
  const earlyParity = byTierParity.find((row) => row.key === "EARLY") || null;
  const summary = {
    provider,
    tf,
    source_mode: baseConfig && baseConfig.sourceMode || null,
    enabled: baseConfig && baseConfig.enabled === true,
    shadow_enabled: baseConfig && baseConfig.shadowEnabled === true,
    rows_n: evaluatedRows.length,
    actual_signal_n: evaluatedRows.filter((row) => row.actual_accepted).length,
    actual_drop_n: evaluatedRows.filter((row) => !row.actual_accepted).length,
    shadow_applicable_n: evaluatedRows.filter((row) => row.shadow_applicable).length,
    shadow_observed_n: evaluatedRows.filter((row) => row.shadow_observed).length,
    shadow_pass_n: comparableRows.filter((row) => row.shadow_pass === true).length,
    shadow_fail_n: comparableRows.filter((row) => row.shadow_pass === false).length,
    parity_match_n: comparableRows.filter((row) => row.parity_match === true).length,
    parity_mismatch_n: mismatchRows.length,
    parity_mismatch_rate: comparableRows.length > 0 ? (mismatchRows.length / comparableRows.length) : null,
    source_parity_match_n: comparableRows.filter((row) => row.source_parity_match === true).length,
    source_parity_mismatch_n: sourceMismatchRows.length,
    source_evidence_stored_n: comparableRows.filter((row) => row.actual_source_evidence !== "DERIVED_FALLBACK").length,
    source_evidence_derived_n: comparableRows.filter((row) => row.actual_source_evidence === "DERIVED_FALLBACK").length,
    final_downstream_mismatch_n: downstreamOnlyMismatchRows.length,
    primary_long_short_parity_rate: comparableRows.length > 0
      ? (comparableRows.filter((row) => row.parity_match === true).length / comparableRows.length)
      : null,
    core_parity_rate: coreParity ? coreParity.parity_rate : null,
    early_parity_rate: earlyParity ? earlyParity.parity_rate : null,
    by_market: countBy(evaluatedRows, (row) => row.market),
    by_market_parity: byMarketParity,
    by_tier_parity: byTierParity,
    by_regime_parity: byRegimeParity,
    by_shadow_reason: countBy(comparableRows, (row) => row.shadow_reason),
    by_actual_drop_reason_family: countBy(mismatchRows, (row) => row.actual_drop_reason_family),
    by_mismatch_scope: countBy(mismatchRows, (row) => row.mismatch_scope),
    by_source_collection: countBy(evaluatedRows, (row) => row.source_collection),
  };

  const rowsOut = mismatchRows.length
    ? mismatchRows
    : comparableRows.slice();
  rowsOut.sort((a, b) => Number(b.observation_ms || 0) - Number(a.observation_ms || 0));

  return {
    summary,
    rows: rowsOut.slice(0, 30),
    all_rows: evaluatedRows,
  };
}

function pct(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(2)}%`;
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Canonical Engine Parity",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- provider/tf: ${summary.provider || "N/A"} / ${summary.tf || "N/A"}`,
    "",
    "## Summary",
    `- source_mode: ${summary.source_mode || "N/A"} / enabled=${summary.enabled ? "YES" : "NO"} / shadow=${summary.shadow_enabled ? "YES" : "NO"}`,
    `- rows: ${summary.rows_n || 0} / signals=${summary.actual_signal_n || 0} / drops=${summary.actual_drop_n || 0}`,
    `- shadow applicable/observed/pass/fail: ${summary.shadow_applicable_n || 0} / ${summary.shadow_observed_n || 0} / ${summary.shadow_pass_n || 0} / ${summary.shadow_fail_n || 0}`,
    `- parity match/mismatch: ${summary.parity_match_n || 0} / ${summary.parity_mismatch_n || 0} (${pct(summary.parity_mismatch_rate)})`,
    `- source parity match/mismatch: ${summary.source_parity_match_n || 0} / ${summary.source_parity_mismatch_n || 0}`,
    `- source evidence stored/derived: ${summary.source_evidence_stored_n || 0} / ${summary.source_evidence_derived_n || 0}`,
    `- downstream-only mismatches: ${summary.final_downstream_mismatch_n || 0}`,
    `- primary/core/early parity: ${pct(summary.primary_long_short_parity_rate)} / ${pct(summary.core_parity_rate)} / ${pct(summary.early_parity_rate)}`,
    `- top shadow reasons: ${Array.isArray(summary.by_shadow_reason) && summary.by_shadow_reason.length ? summary.by_shadow_reason.slice(0, 5).map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- mismatch families: ${Array.isArray(summary.by_actual_drop_reason_family) && summary.by_actual_drop_reason_family.length ? summary.by_actual_drop_reason_family.slice(0, 5).map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- market parity: ${Array.isArray(summary.by_market_parity) && summary.by_market_parity.length ? summary.by_market_parity.slice(0, 5).map((row) => `${row.key}=${row.match_n}/${row.comparable_n} (${pct(row.parity_rate)})`).join(", ") : "none"}`,
    `- tier parity: ${Array.isArray(summary.by_tier_parity) && summary.by_tier_parity.length ? summary.by_tier_parity.map((row) => `${row.key}=${row.match_n}/${row.comparable_n} (${pct(row.parity_rate)})`).join(", ") : "none"}`,
    "",
    "## Rows",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows) {
      lines.push(`- ${row.market || "N/A"} ${row.event || "N/A"} / actual=${row.actual_accepted ? "PASS" : "DROP"} / shadow=${row.shadow_pass === true ? "PASS" : row.shadow_pass === false ? "FAIL" : "N/A"} / source_parity=${row.source_parity_match === true ? "MATCH" : row.source_parity_match === false ? "MISMATCH" : "N/A"} / family=${row.actual_drop_reason_family || "N/A"} / drop=${row.actual_drop_reason || "N/A"} / reason=${row.shadow_reason || "N/A"} / tier=${row.tier || "N/A"} / regime=${row.regime || "N/A"} / score_abs=${row.score_abs != null ? Number(row.score_abs).toFixed(2) : "N/A"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const settingsRes = await getSystemSettingsForProvider(PROVIDER, 3000);
  const settings = settingsRes && settingsRes.data ? settingsRes.data : {};
  const report = deriveParityReport({
    rows: buildObservedRows(readCacheDocs(INPUTS.signals), readCacheDocs(INPUTS.drops)),
    settings,
    provider: PROVIDER,
    tf: TF,
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    summary: report.summary,
    rows: report.rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_canonical_engine_parity.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_canonical_engine_parity.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_CANONICAL_ENGINE_PARITY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    buildObservedRows,
    deriveParityReport,
    renderMarkdown,
    classifyDropReasonFamily,
    inferActualSourceAccepted,
    extractStoredActualSourceDecision,
  },
};
