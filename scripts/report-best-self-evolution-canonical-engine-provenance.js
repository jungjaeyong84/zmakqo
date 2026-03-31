#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { isPrimaryLongShortEvent } = require("../src/utils/liveEntryTaxonomy");

loadLocalEnv();

const INPUTS = Object.freeze({
  signals: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals.json"),
  drops: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json"),
  intents: path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "order_intents_paper.json"),
  sourceModeSnapshot: path.join(OPS_DAILY_DIR, "source_mode_BINANCEFUT_autopilot_snapshot_latest.json"),
  canonicalPolicySnapshot: path.join(OPS_DAILY_DIR, "canonical_policy_BINANCEFUT_autopilot_snapshot_latest.json"),
});

function readCacheDocs(filePath) {
  const raw = readJsonRawSafe(filePath, null);
  return raw && Array.isArray(raw.docs) ? raw.docs : [];
}

function toMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function featureObj(row = {}) {
  return (row.features_json && typeof row.features_json === "object")
    ? row.features_json
    : ((row.features && typeof row.features === "object") ? row.features : {});
}

function normalizeRow(row = {}, collection = "") {
  const features = featureObj(row);
  return {
    collection,
    signal_id: row.signal_id || row.drop_id || row.intent_id || null,
    event: row.event || null,
    market: row.symbol_or_pair_id || row.symbol || null,
    created_at: row.created_at || row.updated_at || null,
    features,
  };
}

function qualifiesRow(row = {}) {
  return isPrimaryLongShortEvent(row && row.event);
}

function isEngineCollection(collection = "") {
  const normalized = String(collection || "").trim();
  return normalized === "signals_dropped" || normalized === "order_intents_paper";
}

function countBy(rows = [], keyFn) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(keyFn(row) || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function deriveCollectionCoverage(rows = [], collection) {
  const scoped = rows.filter((row) => row.collection === collection);
  const eligibleRows = isEngineCollection(collection) ? scoped : [];
  const eligibleN = eligibleRows.length;
  const withBundle = scoped.filter((row) => row.features.canonical_engine_bundle_version != null).length;
  const withThresholdBundle = scoped.filter((row) => row.features.canonical_engine_threshold_bundle_version != null).length;
  const withSourceMode = scoped.filter((row) => row.features.canonical_engine_source_mode_effective != null).length;
  const withExecutionSource = scoped.filter((row) => row.features.canonical_engine_execution_source_effective != null).length;
  const withSourceDecision = scoped.filter((row) => row.features.canonical_engine_actual_source_decision != null).length;
  const withDecisionId = scoped.filter((row) => row.features.canonical_engine_decision_id != null).length;
  const withPolicyOrigin = scoped.filter((row) => row.features.canonical_engine_policy_origin != null).length;
  const withPineOverlayRole = scoped.filter((row) => row.features.pine_overlay_runtime_role != null).length;
  const withPineShadowDecision = scoped.filter((row) => row.features.pine_shadow_decision != null).length;
  const withPineShadowParity = scoped.filter((row) => row.features.pine_shadow_parity_match != null).length;
  const completeN = eligibleRows.filter((row) =>
    row.features.canonical_engine_bundle_version != null
    && row.features.canonical_engine_threshold_bundle_version != null
    && row.features.canonical_engine_source_mode_effective != null
    && row.features.canonical_engine_execution_source_effective != null
    && row.features.canonical_engine_actual_source_decision != null
    && row.features.canonical_engine_decision_id != null
    && row.features.canonical_engine_policy_origin != null
    && row.features.pine_overlay_runtime_role != null
    && row.features.pine_shadow_decision != null
    && row.features.pine_shadow_parity_match != null
  ).length;
  return {
    collection,
    eligible_n: eligibleN,
    with_bundle_version_n: withBundle,
    with_threshold_bundle_version_n: withThresholdBundle,
    with_source_mode_n: withSourceMode,
    with_execution_source_n: withExecutionSource,
    with_actual_source_decision_n: withSourceDecision,
    with_decision_id_n: withDecisionId,
    with_policy_origin_n: withPolicyOrigin,
    with_pine_overlay_role_n: withPineOverlayRole,
    with_pine_shadow_decision_n: withPineShadowDecision,
    with_pine_shadow_parity_n: withPineShadowParity,
    complete_n: completeN,
    source_decision_rate: eligibleN > 0 ? (withSourceDecision / eligibleN) : null,
    complete_rate: eligibleN > 0 ? (completeN / eligibleN) : null,
  };
}

function isCompleteProvenanceRow(row = {}) {
  const features = row && row.features && typeof row.features === "object" ? row.features : {};
  return (
    features.canonical_engine_bundle_version != null
    && features.canonical_engine_threshold_bundle_version != null
    && features.canonical_engine_source_mode_effective != null
    && features.canonical_engine_execution_source_effective != null
    && features.canonical_engine_actual_source_decision != null
    && features.canonical_engine_decision_id != null
    && features.canonical_engine_policy_origin != null
    && features.pine_overlay_runtime_role != null
    && features.pine_shadow_decision != null
    && features.pine_shadow_parity_match != null
  );
}

function buildSummary(rows = []) {
  const engineRows = rows.filter((row) => isEngineCollection(row.collection));
  const rawSignalRows = rows.filter((row) => !isEngineCollection(row.collection));
  const eligibleN = engineRows.length;
  const withBundleVersionN = rows.filter((row) => row.features.canonical_engine_bundle_version != null).length;
  const withThresholdBundleVersionN = rows.filter((row) => row.features.canonical_engine_threshold_bundle_version != null).length;
  const withSourceModeN = rows.filter((row) => row.features.canonical_engine_source_mode_effective != null).length;
  const withExecutionSourceN = rows.filter((row) => row.features.canonical_engine_execution_source_effective != null).length;
  const withActualSourceDecisionN = rows.filter((row) => row.features.canonical_engine_actual_source_decision != null).length;
  const withDecisionIdN = rows.filter((row) => row.features.canonical_engine_decision_id != null).length;
  const withPolicyOriginN = rows.filter((row) => row.features.canonical_engine_policy_origin != null).length;
  const withPineOverlayRoleN = rows.filter((row) => row.features.pine_overlay_runtime_role != null).length;
  const withPineShadowDecisionN = rows.filter((row) => row.features.pine_shadow_decision != null).length;
  const withPineShadowParityN = rows.filter((row) => row.features.pine_shadow_parity_match != null).length;
  const completeRows = engineRows.filter((row) => isCompleteProvenanceRow(row));
  const byCollection = ["signals", "signals_dropped", "order_intents_paper"]
    .map((collection) => deriveCollectionCoverage(rows, collection));
  return {
    rows_n: rows.length,
    raw_signal_n: rawSignalRows.length,
    engine_eligible_n: eligibleN,
    eligible_n: eligibleN,
    with_bundle_version_n: withBundleVersionN,
    with_threshold_bundle_version_n: withThresholdBundleVersionN,
    with_source_mode_n: withSourceModeN,
    with_execution_source_n: withExecutionSourceN,
    with_actual_source_decision_n: withActualSourceDecisionN,
    with_decision_id_n: withDecisionIdN,
    with_policy_origin_n: withPolicyOriginN,
    with_pine_overlay_role_n: withPineOverlayRoleN,
    with_pine_shadow_decision_n: withPineShadowDecisionN,
    with_pine_shadow_parity_n: withPineShadowParityN,
    complete_n: completeRows.length,
    bundle_version_rate: eligibleN > 0 ? (withBundleVersionN / eligibleN) : null,
    threshold_bundle_version_rate: eligibleN > 0 ? (withThresholdBundleVersionN / eligibleN) : null,
    source_mode_rate: eligibleN > 0 ? (withSourceModeN / eligibleN) : null,
    actual_source_decision_rate: eligibleN > 0 ? (withActualSourceDecisionN / eligibleN) : null,
    complete_rate: eligibleN > 0 ? (completeRows.length / eligibleN) : null,
    by_collection: byCollection,
    by_source_mode: countBy(rows.filter((row) => row.features.canonical_engine_source_mode_effective != null), (row) => row.features.canonical_engine_source_mode_effective),
    by_execution_source: countBy(rows.filter((row) => row.features.canonical_engine_execution_source_effective != null), (row) => row.features.canonical_engine_execution_source_effective),
    by_actual_source_decision: countBy(rows.filter((row) => row.features.canonical_engine_actual_source_decision != null), (row) => row.features.canonical_engine_actual_source_decision),
    by_policy_origin: countBy(rows.filter((row) => row.features.canonical_engine_policy_origin != null), (row) => row.features.canonical_engine_policy_origin),
    by_pine_overlay_role: countBy(rows.filter((row) => row.features.pine_overlay_runtime_role != null), (row) => row.features.pine_overlay_runtime_role),
    by_pine_shadow_decision: countBy(rows.filter((row) => row.features.pine_shadow_decision != null), (row) => row.features.pine_shadow_decision),
  };
}

function deriveCutoverReference({ sourceModeSnapshot = null, canonicalPolicySnapshot = null } = {}) {
  const candidates = [
    { key: "SOURCE_MODE", generated_at: sourceModeSnapshot && sourceModeSnapshot.generated_at || null },
    { key: "CANONICAL_POLICY", generated_at: canonicalPolicySnapshot && canonicalPolicySnapshot.generated_at || null },
  ]
    .map((row) => ({ ...row, generated_at_ms: toMs(row.generated_at) }))
    .filter((row) => Number.isFinite(row.generated_at_ms))
    .sort((a, b) => b.generated_at_ms - a.generated_at_ms);
  const latest = candidates[0] || null;
  return {
    reference_iso: latest ? latest.generated_at : null,
    reference_ms: latest ? latest.generated_at_ms : null,
    reference_source: latest ? latest.key : null,
    reference_sources: candidates.map((row) => ({ key: row.key, generated_at: row.generated_at })),
  };
}

function deriveProvenanceReport({ signals = [], drops = [], intents = [], cutoverReference = null } = {}) {
  const rows = [
    ...signals.map((row) => normalizeRow(row, "signals")),
    ...drops.map((row) => normalizeRow(row, "signals_dropped")),
    ...intents.map((row) => normalizeRow(row, "order_intents_paper")),
  ].filter(qualifiesRow);
  const summary = buildSummary(rows);
  const cutoverMs = cutoverReference && Number.isFinite(cutoverReference.reference_ms)
    ? cutoverReference.reference_ms
    : null;
  const postCutoverRows = Number.isFinite(cutoverMs)
    ? rows.filter((row) => {
      const rowMs = toMs(row.created_at);
      return Number.isFinite(rowMs) && rowMs >= cutoverMs;
    })
    : [];
  const postCutoverSummary = Number.isFinite(cutoverMs) ? buildSummary(postCutoverRows) : null;
  const engineRows = rows.filter((row) => isEngineCollection(row.collection));
  const missingRowsBase = (postCutoverSummary && Number(postCutoverSummary.engine_eligible_n || 0) > 0)
    ? postCutoverRows.filter((row) => isEngineCollection(row.collection))
    : engineRows;
  const missingRows = missingRowsBase
    .filter((row) => !isCompleteProvenanceRow(row))
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 20)
    .map((row) => ({
      collection: row.collection,
      signal_id: row.signal_id,
      event: row.event,
      market: row.market,
      created_at: row.created_at,
      missing_fields: [
        row.features.canonical_engine_bundle_version == null ? "canonical_engine_bundle_version" : null,
        row.features.canonical_engine_threshold_bundle_version == null ? "canonical_engine_threshold_bundle_version" : null,
        row.features.canonical_engine_source_mode_effective == null ? "canonical_engine_source_mode_effective" : null,
        row.features.canonical_engine_execution_source_effective == null ? "canonical_engine_execution_source_effective" : null,
        row.features.canonical_engine_actual_source_decision == null ? "canonical_engine_actual_source_decision" : null,
        row.features.canonical_engine_decision_id == null ? "canonical_engine_decision_id" : null,
        row.features.canonical_engine_policy_origin == null ? "canonical_engine_policy_origin" : null,
        row.features.pine_overlay_runtime_role == null ? "pine_overlay_runtime_role" : null,
        row.features.pine_shadow_decision == null ? "pine_shadow_decision" : null,
        row.features.pine_shadow_parity_match == null ? "pine_shadow_parity_match" : null,
      ].filter(Boolean),
    }));
  const effectiveEligibleN = postCutoverSummary && Number.isFinite(Number(postCutoverSummary.engine_eligible_n))
    ? Number(postCutoverSummary.engine_eligible_n)
    : Number(summary.engine_eligible_n || 0);
  const effectiveCompleteN = postCutoverSummary && Number.isFinite(Number(postCutoverSummary.complete_n))
    ? Number(postCutoverSummary.complete_n)
    : Number(summary.complete_n || 0);
  const postCutoverStatus = !postCutoverSummary
    ? "NO_CUTOVER_REFERENCE"
    : (Number(postCutoverSummary.engine_eligible_n || 0) > 0
      ? (Number(postCutoverSummary.complete_n || 0) === Number(postCutoverSummary.engine_eligible_n || 0)
        ? "PASS"
        : "MISSING_PROVENANCE_FIELDS")
      : "NO_ENGINE_ROWS_AFTER_CUTOVER");
  summary.cutover_reference_iso = cutoverReference && cutoverReference.reference_iso || null;
  summary.cutover_reference_source = cutoverReference && cutoverReference.reference_source || null;
  summary.cutover_reference_sources = cutoverReference && cutoverReference.reference_sources || [];
  summary.post_cutover_rows_n = postCutoverSummary ? postCutoverSummary.rows_n : null;
  summary.post_cutover_raw_signal_n = postCutoverSummary ? postCutoverSummary.raw_signal_n : null;
  summary.post_cutover_engine_eligible_n = postCutoverSummary ? postCutoverSummary.engine_eligible_n : null;
  summary.post_cutover_with_bundle_version_n = postCutoverSummary ? postCutoverSummary.with_bundle_version_n : null;
  summary.post_cutover_with_threshold_bundle_version_n = postCutoverSummary ? postCutoverSummary.with_threshold_bundle_version_n : null;
  summary.post_cutover_with_source_mode_n = postCutoverSummary ? postCutoverSummary.with_source_mode_n : null;
  summary.post_cutover_with_execution_source_n = postCutoverSummary ? postCutoverSummary.with_execution_source_n : null;
  summary.post_cutover_with_actual_source_decision_n = postCutoverSummary ? postCutoverSummary.with_actual_source_decision_n : null;
  summary.post_cutover_with_decision_id_n = postCutoverSummary ? postCutoverSummary.with_decision_id_n : null;
  summary.post_cutover_with_policy_origin_n = postCutoverSummary ? postCutoverSummary.with_policy_origin_n : null;
  summary.post_cutover_with_pine_overlay_role_n = postCutoverSummary ? postCutoverSummary.with_pine_overlay_role_n : null;
  summary.post_cutover_with_pine_shadow_decision_n = postCutoverSummary ? postCutoverSummary.with_pine_shadow_decision_n : null;
  summary.post_cutover_with_pine_shadow_parity_n = postCutoverSummary ? postCutoverSummary.with_pine_shadow_parity_n : null;
  summary.post_cutover_complete_n = postCutoverSummary ? postCutoverSummary.complete_n : null;
  summary.post_cutover_complete_rate = postCutoverSummary ? postCutoverSummary.complete_rate : null;
  summary.post_cutover_by_collection = postCutoverSummary ? postCutoverSummary.by_collection : [];
  summary.post_cutover_status = postCutoverStatus;
  summary.effective_eligible_n = effectiveEligibleN;
  summary.effective_complete_n = effectiveCompleteN;
  summary.effective_complete_rate = effectiveEligibleN > 0 ? (effectiveCompleteN / effectiveEligibleN) : null;
  return {
    summary,
    rows: missingRows,
  };
}

function pct(value) {
  if (value == null || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(2)}%`;
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Canonical Engine Provenance",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- rows / raw webhook / engine eligible: ${summary.rows_n || 0} / ${summary.raw_signal_n || 0} / ${summary.engine_eligible_n || summary.eligible_n || 0}`,
    `- cutover: ${summary.cutover_reference_iso || "N/A"} / source=${summary.cutover_reference_source || "N/A"} / post_cutover=${summary.post_cutover_status || "N/A"}`,
    `- post_cutover rows / raw webhook / engine eligible: ${summary.post_cutover_rows_n ?? "N/A"} / ${summary.post_cutover_raw_signal_n ?? "N/A"} / ${summary.post_cutover_engine_eligible_n ?? "N/A"}`,
    `- bundle / threshold / source_mode / execution_source / source_decision: ${summary.with_bundle_version_n || 0} / ${summary.with_threshold_bundle_version_n || 0} / ${summary.with_source_mode_n || 0} / ${summary.with_execution_source_n || 0} / ${summary.with_actual_source_decision_n || 0}`,
    `- post_cutover bundle / threshold / source_mode / execution_source / source_decision: ${summary.post_cutover_with_bundle_version_n ?? "N/A"} / ${summary.post_cutover_with_threshold_bundle_version_n ?? "N/A"} / ${summary.post_cutover_with_source_mode_n ?? "N/A"} / ${summary.post_cutover_with_execution_source_n ?? "N/A"} / ${summary.post_cutover_with_actual_source_decision_n ?? "N/A"}`,
    `- decision_id / policy_origin / pine_overlay_role / pine_shadow / pine_shadow_parity: ${summary.with_decision_id_n || 0} / ${summary.with_policy_origin_n || 0} / ${summary.with_pine_overlay_role_n || 0} / ${summary.with_pine_shadow_decision_n || 0} / ${summary.with_pine_shadow_parity_n || 0}`,
    `- post_cutover decision_id / policy_origin / pine_overlay_role / pine_shadow / pine_shadow_parity: ${summary.post_cutover_with_decision_id_n ?? "N/A"} / ${summary.post_cutover_with_policy_origin_n ?? "N/A"} / ${summary.post_cutover_with_pine_overlay_role_n ?? "N/A"} / ${summary.post_cutover_with_pine_shadow_decision_n ?? "N/A"} / ${summary.post_cutover_with_pine_shadow_parity_n ?? "N/A"}`,
    `- complete: effective ${summary.effective_complete_n ?? 0}/${summary.effective_eligible_n ?? 0} (${pct(summary.effective_complete_rate)}) / total ${summary.complete_n || 0}/${summary.engine_eligible_n || summary.eligible_n || 0} (${pct(summary.complete_rate)})`,
    `- by collection: ${Array.isArray(summary.by_collection) ? summary.by_collection.map((row) => `${row.collection}=${row.complete_n}/${row.eligible_n} (${pct(row.complete_rate)})`).join(", ") : "none"}`,
    `- post_cutover by collection: ${Array.isArray(summary.post_cutover_by_collection) && summary.post_cutover_by_collection.length ? summary.post_cutover_by_collection.map((row) => `${row.collection}=${row.complete_n}/${row.eligible_n} (${pct(row.complete_rate)})`).join(", ") : "none"}`,
    `- by source mode: ${Array.isArray(summary.by_source_mode) && summary.by_source_mode.length ? summary.by_source_mode.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- by execution source: ${Array.isArray(summary.by_execution_source) && summary.by_execution_source.length ? summary.by_execution_source.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- by actual source decision: ${Array.isArray(summary.by_actual_source_decision) && summary.by_actual_source_decision.length ? summary.by_actual_source_decision.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- by policy origin: ${Array.isArray(summary.by_policy_origin) && summary.by_policy_origin.length ? summary.by_policy_origin.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- by pine overlay role: ${Array.isArray(summary.by_pine_overlay_role) && summary.by_pine_overlay_role.length ? summary.by_pine_overlay_role.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- by pine shadow decision: ${Array.isArray(summary.by_pine_shadow_decision) && summary.by_pine_shadow_decision.length ? summary.by_pine_shadow_decision.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    "",
    "## Missing Rows",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows) {
      lines.push(`- ${row.collection} / ${row.market || "N/A"} / ${row.event || "N/A"} / ${row.signal_id || "N/A"} / missing=${row.missing_fields.join("|")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const cutoverReference = deriveCutoverReference({
    sourceModeSnapshot: readJsonRawSafe(INPUTS.sourceModeSnapshot, null),
    canonicalPolicySnapshot: readJsonRawSafe(INPUTS.canonicalPolicySnapshot, null),
  });
  const report = deriveProvenanceReport({
    signals: readCacheDocs(INPUTS.signals),
    drops: readCacheDocs(INPUTS.drops),
    intents: readCacheDocs(INPUTS.intents),
    cutoverReference,
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
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_canonical_engine_provenance.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_canonical_engine_provenance.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_provenance_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_provenance_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_CANONICAL_ENGINE_PROVENANCE_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    deriveCutoverReference,
    deriveProvenanceReport,
    renderMarkdown,
  },
};
