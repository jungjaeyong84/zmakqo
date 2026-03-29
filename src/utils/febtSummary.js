"use strict";

const { buildFilterFeatureSignature } = require("./filterFeatureBuckets");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

function emptySummary() {
  return {
    sampled_n: 0,
    signals_n: 0,
    calc_ok_n: 0,
    phase_known_n: 0,
    payload_missing_n: 0,
    disagreement_n: 0,
    fallback_legacy_n: 0,
    prepare_n: 0,
    armed_n: 0,
    fire_n: 0,
    late_n: 0,
    void_n: 0,
    unknown_n: 0,
    lock_score_sum: 0,
    lock_score_n: 0,
    delay_cost_sum: 0,
    delay_cost_n: 0,
    late_risk_sum: 0,
    late_risk_n: 0,
    failure_risk_sum: 0,
    failure_risk_n: 0,
    edge_sum: 0,
    edge_n: 0,
    _phaseCounts: new Map(),
    _verdictCounts: new Map(),
    _disagreementReasonCounts: new Map(),
    _fallbackReasonCounts: new Map(),
  };
}

function bump(map, value) {
  const key = toUpper(value, "UNKNOWN");
  map.set(key, (map.get(key) || 0) + 1);
}

function toBreakdown(map, limit = 8) {
  return Array.from(map.entries())
    .map(([value, n]) => ({ value, n }))
    .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function firstValue(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const value = String(rows[0] && rows[0].value || "").trim();
  return value || null;
}

function addSignature(summary, signature = {}) {
  summary.sampled_n += 1;
  if (signature.febt_calc_ok === true) summary.calc_ok_n += 1;
  if (signature.febt_payload_missing === true) summary.payload_missing_n += 1;
  if (signature.febt_shadow_disagrees_legacy_wait === true) {
    summary.disagreement_n += 1;
    bump(summary._disagreementReasonCounts, signature.febt_shadow_disagreement_reason);
  }
  if (signature.febt_shadow_fallback_to_legacy === true) {
    summary.fallback_legacy_n += 1;
    bump(summary._fallbackReasonCounts, signature.febt_shadow_fallback_reason);
  }

  const phase = toUpper(signature.febt_phase, "UNKNOWN");
  const verdict = toUpper(signature.febt_shadow_verdict, "UNKNOWN");
  bump(summary._phaseCounts, phase);
  bump(summary._verdictCounts, verdict);
  if (phase !== "UNKNOWN") summary.phase_known_n += 1;
  if (phase === "PREPARE") summary.prepare_n += 1;
  else if (phase === "ARMED") summary.armed_n += 1;
  else if (phase === "FIRE") summary.fire_n += 1;
  else if (phase === "LATE") summary.late_n += 1;
  else if (phase === "VOID") summary.void_n += 1;
  else summary.unknown_n += 1;

  if (Number.isFinite(signature.febt_lock_score)) {
    summary.lock_score_sum += Number(signature.febt_lock_score);
    summary.lock_score_n += 1;
  }
  if (Number.isFinite(signature.febt_delay_cost)) {
    summary.delay_cost_sum += Number(signature.febt_delay_cost);
    summary.delay_cost_n += 1;
  }
  if (Number.isFinite(signature.febt_late_risk)) {
    summary.late_risk_sum += Number(signature.febt_late_risk);
    summary.late_risk_n += 1;
  }
  if (Number.isFinite(signature.febt_failure_risk)) {
    summary.failure_risk_sum += Number(signature.febt_failure_risk);
    summary.failure_risk_n += 1;
  }
  if (Number.isFinite(signature.febt_edge)) {
    summary.edge_sum += Number(signature.febt_edge);
    summary.edge_n += 1;
  }
}

function finalizeSummary(summary) {
  const phaseBreakdown = toBreakdown(summary._phaseCounts);
  const verdictBreakdown = toBreakdown(summary._verdictCounts);
  const disagreementReasonBreakdown = toBreakdown(summary._disagreementReasonCounts);
  const fallbackReasonBreakdown = toBreakdown(summary._fallbackReasonCounts);
  const denom = summary.sampled_n > 0 ? summary.sampled_n : null;
  return {
    sampled_n: summary.sampled_n,
    signals_n: summary.signals_n,
    calc_ok_n: summary.calc_ok_n,
    calc_ok_rate: denom ? (summary.calc_ok_n / denom) : null,
    phase_known_n: summary.phase_known_n,
    phase_known_rate: denom ? (summary.phase_known_n / denom) : null,
    payload_missing_n: summary.payload_missing_n,
    payload_missing_rate: denom ? (summary.payload_missing_n / denom) : null,
    disagreement_n: summary.disagreement_n,
    disagreement_rate: denom ? (summary.disagreement_n / denom) : null,
    fallback_legacy_n: summary.fallback_legacy_n,
    fallback_legacy_rate: denom ? (summary.fallback_legacy_n / denom) : null,
    prepare_n: summary.prepare_n,
    armed_n: summary.armed_n,
    fire_n: summary.fire_n,
    late_n: summary.late_n,
    void_n: summary.void_n,
    unknown_n: summary.unknown_n,
    avg_lock_score: summary.lock_score_n > 0 ? (summary.lock_score_sum / summary.lock_score_n) : null,
    avg_delay_cost: summary.delay_cost_n > 0 ? (summary.delay_cost_sum / summary.delay_cost_n) : null,
    avg_late_risk: summary.late_risk_n > 0 ? (summary.late_risk_sum / summary.late_risk_n) : null,
    avg_failure_risk: summary.failure_risk_n > 0 ? (summary.failure_risk_sum / summary.failure_risk_n) : null,
    avg_edge: summary.edge_n > 0 ? (summary.edge_sum / summary.edge_n) : null,
    phase_breakdown: phaseBreakdown,
    verdict_breakdown: verdictBreakdown,
    disagreement_reason_breakdown: disagreementReasonBreakdown,
    fallback_reason_breakdown: fallbackReasonBreakdown,
    top_phase: firstValue(phaseBreakdown),
    top_verdict: firstValue(verdictBreakdown),
    top_disagreement_reason: firstValue(disagreementReasonBreakdown),
    top_fallback_reason: firstValue(fallbackReasonBreakdown),
  };
}

function summarizeFebtRows(rows = []) {
  const summary = emptySummary();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row._query_error) continue;
    const signature = buildFilterFeatureSignature(row);
    addSignature(summary, signature);
  }
  return finalizeSummary(summary);
}

function summarizeFebtByTier(byTier = {}) {
  const summary = emptySummary();
  for (const row of Object.values(byTier && typeof byTier === "object" ? byTier : {})) {
    const executedN = Number(row && row.executed_n || 0);
    if (!Number.isFinite(executedN) || executedN <= 0) continue;
    summary.sampled_n += executedN;
    summary.signals_n += Number(row && row.signals_n || 0);
    summary.calc_ok_n += Number(row && row.febt_calc_ok_n || 0);
    summary.phase_known_n += Number(row && row.febt_phase_known_n || 0);
    summary.payload_missing_n += Number(row && row.febt_payload_missing_n || 0);
    summary.disagreement_n += Number(row && row.febt_disagreement_n || 0);
    summary.fallback_legacy_n += Number(row && row.febt_fallback_legacy_n || 0);
    summary.prepare_n += Number(row && row.febt_prepare_n || 0);
    summary.armed_n += Number(row && row.febt_armed_n || 0);
    summary.fire_n += Number(row && row.febt_fire_n || 0);
    summary.late_n += Number(row && row.febt_late_n || 0);
    summary.void_n += Number(row && row.febt_void_n || 0);
    summary.unknown_n += Number(row && row.febt_unknown_n || 0);

    if (Number.isFinite(Number(row && row.febt_lock_score_sum)) && Number.isFinite(Number(row && row.febt_lock_score_n))) {
      summary.lock_score_sum += Number(row.febt_lock_score_sum || 0);
      summary.lock_score_n += Number(row.febt_lock_score_n || 0);
    }
    if (Number.isFinite(Number(row && row.febt_delay_cost_sum)) && Number.isFinite(Number(row && row.febt_delay_cost_n))) {
      summary.delay_cost_sum += Number(row.febt_delay_cost_sum || 0);
      summary.delay_cost_n += Number(row.febt_delay_cost_n || 0);
    }
    if (Number.isFinite(Number(row && row.febt_late_risk_sum)) && Number.isFinite(Number(row && row.febt_late_risk_n))) {
      summary.late_risk_sum += Number(row.febt_late_risk_sum || 0);
      summary.late_risk_n += Number(row.febt_late_risk_n || 0);
    }
    if (Number.isFinite(Number(row && row.febt_failure_risk_sum)) && Number.isFinite(Number(row && row.febt_failure_risk_n))) {
      summary.failure_risk_sum += Number(row.febt_failure_risk_sum || 0);
      summary.failure_risk_n += Number(row.febt_failure_risk_n || 0);
    }
    if (Number.isFinite(Number(row && row.febt_edge_sum)) && Number.isFinite(Number(row && row.febt_edge_n))) {
      summary.edge_sum += Number(row.febt_edge_sum || 0);
      summary.edge_n += Number(row.febt_edge_n || 0);
    }
  }

  summary._phaseCounts = new Map([
    ["PREPARE", summary.prepare_n],
    ["ARMED", summary.armed_n],
    ["FIRE", summary.fire_n],
    ["LATE", summary.late_n],
    ["VOID", summary.void_n],
    ["UNKNOWN", summary.unknown_n],
  ].filter(([, n]) => Number(n) > 0));

  return finalizeSummary(summary);
}

function summarizeFebtPhase0Artifact(artifact = null) {
  const baseline = artifact && artifact.legacy_wait_baseline && typeof artifact.legacy_wait_baseline === "object"
    ? artifact.legacy_wait_baseline
    : {};
  const latency = artifact && artifact.bridge_latency && typeof artifact.bridge_latency === "object"
    ? artifact.bridge_latency
    : {};
  return {
    available: !!artifact,
    fresh: artifact && artifact.fresh === true,
    provider: String(artifact && artifact.provider || "N/A"),
    tf: String(artifact && artifact.tf || "N/A"),
    legacy_wait_coverage_rate: toNum(baseline.legacy_wait_coverage_rate),
    legacy_wait_observed_chain_n: toNum(baseline.legacy_wait_observed_chain_n),
    immediate_win_rate: toNum(baseline.immediate_win_rate),
    saved_loss_pct: toNum(baseline.saved_loss_pct),
    missed_gain_pct: toNum(baseline.missed_gain_pct),
    saved_loss_minus_missed_gain: toNum(baseline.saved_loss_minus_missed_gain),
    webhook_to_fill_p95_ms: toNum(latency && latency.webhook_to_fill_ms && latency.webhook_to_fill_ms.p95),
    duplicate_count: toNum(latency.duplicate_count) || 0,
    stale_count: toNum(latency.stale_count) || 0,
    reject_count: toNum(latency.reject_count) || 0,
  };
}

module.exports = {
  summarizeFebtRows,
  summarizeFebtByTier,
  summarizeFebtPhase0Artifact,
  __test: {
    finalizeSummary,
  },
};
