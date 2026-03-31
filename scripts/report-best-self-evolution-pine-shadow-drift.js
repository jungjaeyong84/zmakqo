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
  dataset: path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json"),
});

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(num, den) {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return n / d;
}

function featureObj(row = {}) {
  return (row.features_json && typeof row.features_json === "object")
    ? row.features_json
    : ((row.features && typeof row.features === "object") ? row.features : {});
}

function normalizeSourceMode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "PINE_PRIMARY" || raw === "SERVER_PRIMARY" || raw === "SERVER_SHADOW") return raw;
  return "UNKNOWN";
}

function countBy(items = [], keyFn) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(keyFn(item) || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

function marketKey(row = {}) {
  return String(row.market || row.symbol_or_pair_id || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
}

function buildDriftRow(row = {}) {
  const features = featureObj(row);
  return {
    created_at: row.created_at || row.ts || null,
    market: marketKey(row),
    event: row.event || null,
    source_row_type: String(row.source_row_type || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
    signal_id: row.signal_id || row.intent_id || row.fill_id || row.trade_id || null,
    canonical_engine_decision_id: features.canonical_engine_decision_id || null,
    canonical_engine_actual_source_decision: features.canonical_engine_actual_source_decision || null,
    canonical_engine_actual_source_reason: features.canonical_engine_actual_source_reason || null,
    pine_shadow_decision: features.pine_shadow_decision || null,
    pine_shadow_reason: features.pine_shadow_reason || null,
    canonical_engine_execution_source_effective: features.canonical_engine_execution_source_effective || null,
    pine_overlay_runtime_role: features.pine_overlay_runtime_role || null,
    pine_shadow_parity_match: features.pine_shadow_parity_match,
    canonical_engine_source_mode_effective: features.canonical_engine_source_mode_effective || null,
    drop_reason_code: row.drop_reason_code || row.drop_reason || row.reason || null,
    realized_ret_net: toNum(row.realized_ret_net),
  };
}

function derivePineShadowDrift({ dataset = null } = {}) {
  const raw = dataset && typeof dataset === "object" ? dataset : {};
  const allRows = Array.isArray(raw.rows) ? raw.rows : [];
  const primaryRows = allRows.filter((row) => isPrimaryLongShortEvent(row && row.event));
  const serverPrimaryRows = primaryRows.filter((row) => normalizeSourceMode(featureObj(row).canonical_engine_source_mode_effective) === "SERVER_PRIMARY");
  const observedRows = serverPrimaryRows.filter((row) => featureObj(row).pine_shadow_parity_match !== null && featureObj(row).pine_shadow_parity_match !== undefined);
  const driftRows = observedRows.filter((row) => featureObj(row).pine_shadow_parity_match === false);
  const executedDriftRows = driftRows.filter((row) => {
    const kind = String(row && row.source_row_type || "").trim().toUpperCase();
    return kind === "EXECUTED" || kind === "PARTIAL" || kind === "FALLBACK";
  });
  const dropDriftRows = driftRows.filter((row) => {
    const kind = String(row && row.source_row_type || "").trim().toUpperCase();
    return kind === "DROP";
  });
  const byMarket = countBy(driftRows, (row) => marketKey(row));
  const bySourceRowType = countBy(driftRows, (row) => row.source_row_type);
  const byActualSourceDecision = countBy(driftRows, (row) => featureObj(row).canonical_engine_actual_source_decision);
  const byPineShadowDecision = countBy(driftRows, (row) => featureObj(row).pine_shadow_decision);
  const byExecutionSource = countBy(driftRows, (row) => featureObj(row).canonical_engine_execution_source_effective);
  const byOverlayRole = countBy(driftRows, (row) => featureObj(row).pine_overlay_runtime_role);

  return {
    summary: {
      audit_only: true,
      row_n: driftRows.length,
      observed_n: observedRows.length,
      drift_n: driftRows.length,
      drift_rate: ratio(driftRows.length, observedRows.length),
      executed_drift_n: executedDriftRows.length,
      drop_drift_n: dropDriftRows.length,
      top_drift_market: byMarket[0] ? byMarket[0].key : null,
      by_market: byMarket,
      by_source_row_type: bySourceRowType,
      by_actual_source_decision: byActualSourceDecision,
      by_pine_shadow_decision: byPineShadowDecision,
      by_execution_source: byExecutionSource,
      by_pine_overlay_role: byOverlayRole,
    },
    rows: driftRows
      .map(buildDriftRow)
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))),
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
    "# BEST Self-Evolution Pine Shadow Drift",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- audit_only: ${summary.audit_only ? "YES" : "NO"}`,
    "",
    "## Summary",
    `- observed / drift: ${summary.observed_n || 0} / ${summary.drift_n || 0} (${pct(summary.drift_rate)})`,
    `- executed_drift / drop_drift: ${summary.executed_drift_n || 0} / ${summary.drop_drift_n || 0}`,
    `- top_market: ${summary.top_drift_market || "N/A"}`,
    `- actual_source_decision: ${Array.isArray(summary.by_actual_source_decision) && summary.by_actual_source_decision.length ? summary.by_actual_source_decision.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- pine_shadow_decision: ${Array.isArray(summary.by_pine_shadow_decision) && summary.by_pine_shadow_decision.length ? summary.by_pine_shadow_decision.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- execution_source: ${Array.isArray(summary.by_execution_source) && summary.by_execution_source.length ? summary.by_execution_source.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    `- pine_overlay_role: ${Array.isArray(summary.by_pine_overlay_role) && summary.by_pine_overlay_role.length ? summary.by_pine_overlay_role.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    "",
    "## Drift Rows",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 20)) {
      lines.push(`- ${row.market} / ${row.event || "N/A"} / ${row.source_row_type}: actual=${row.canonical_engine_actual_source_decision || "N/A"} / pine=${row.pine_shadow_decision || "N/A"} / exec=${row.canonical_engine_execution_source_effective || "N/A"} / role=${row.pine_overlay_runtime_role || "N/A"} / reason=${row.drop_reason_code || "N/A"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = derivePineShadowDrift({
    dataset: readJsonRawSafe(INPUTS.dataset, null),
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
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_pine_shadow_drift.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_pine_shadow_drift.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_pine_shadow_drift_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_pine_shadow_drift_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_PINE_SHADOW_DRIFT_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    derivePineShadowDrift,
    renderMarkdown,
  },
};
