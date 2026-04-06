"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function profileKey(row = {}) {
  const features = row.features_json && typeof row.features_json === "object" ? row.features_json : {};
  return [
    norm(row.entry_grade) || "NA",
    norm(row.event) || "NA",
    norm(features.reason) || "NA",
    norm(row.febt_phase) || "NA",
  ].join("|");
}

function avg(rows = [], pick) {
  const values = rows.map(pick).map(toNum).filter((v) => v != null);
  if (!values.length) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
}

function topCountValue(rows = [], pick) {
  const counts = new Map();
  for (const row of rows) {
    const key = norm(pick(row));
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] || null;
}

function rate(rows = [], pick) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const yes = rows.filter((row) => pick(row) === true).length;
  return Number((yes / rows.length).toFixed(4));
}

function profileRows(dataset = null, market = null, profile = null) {
  const rows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  return rows.filter((row) => norm(row.market) === norm(market) && profileKey(row) === norm(profile));
}

function buildProfileDiagnostic(dataset = null, market = null, profile = null) {
  const rows = profileRows(dataset, market, profile);
  return {
    market: norm(market),
    profile: norm(profile),
    rows_n: rows.length,
    dominant_source_row_type: topCountValue(rows, (row) => row.source_row_type),
    dominant_pos_state: topCountValue(rows, (row) => row.features_json && row.features_json.pos_state),
    dominant_action: topCountValue(rows, (row) => row.features_json && row.features_json.action),
    avg_ev_lb: avg(rows, (row) => row.features_json && row.features_json.ev_gate_tp1_reach_prob_lower_bound),
    avg_ev_prob: avg(rows, (row) => row.features_json && row.features_json.ev_gate_tp1_reach_prob),
    avg_effective_n: avg(rows, (row) => row.features_json && row.features_json.ev_gate_effective_n),
    avg_delay_cost: avg(rows, (row) => row.febt_delay_cost),
    avg_late_risk: avg(rows, (row) => row.febt_late_risk),
    avg_failure_risk: avg(rows, (row) => row.febt_failure_risk),
    avg_edge: avg(rows, (row) => row.febt_edge),
    avg_score: avg(rows, (row) => row.features_json && row.features_json.score),
    avg_same_dir_streak: avg(rows, (row) => row.features_json && row.features_json.ev_gate_same_dir_streak),
    cost_shield_block_add_rate: rate(rows, (row) => row.features_json && row.features_json.cost_shield_block_add === true),
    pro_conflict_rate: rate(rows, (row) => row.features_json && row.features_json.pro_conflict === true),
  };
}

function buildMlEvReplayStalePosDiagnostics({
  dataset = null,
  mlEvReplayProfileContribution = null,
} = {}) {
  const summary = readSummary(mlEvReplayProfileContribution);
  const dragProfile = buildProfileDiagnostic(dataset, summary.top_return_drag_market, summary.top_return_drag_profile);
  const mixedProfile = buildProfileDiagnostic(dataset, summary.top_mixed_market, summary.top_mixed_profile);

  return {
    status: "ML_EV_REPLAY_STALE_POS_DIAGNOSTICS_READY",
    evidence_status: "STALE_POS_PROFILE_DIAGNOSTICS_READY",
    top_return_drag_market: dragProfile.market,
    top_return_drag_profile: dragProfile.profile,
    top_return_drag_avg_ev_lb: dragProfile.avg_ev_lb,
    top_return_drag_avg_delay_cost: dragProfile.avg_delay_cost,
    top_return_drag_avg_late_risk: dragProfile.avg_late_risk,
    top_return_drag_avg_failure_risk: dragProfile.avg_failure_risk,
    top_return_drag_avg_same_dir_streak: dragProfile.avg_same_dir_streak,
    top_return_drag_cost_shield_block_add_rate: dragProfile.cost_shield_block_add_rate,
    top_mixed_market: mixedProfile.market,
    top_mixed_profile: mixedProfile.profile,
    top_mixed_avg_ev_lb: mixedProfile.avg_ev_lb,
    top_mixed_avg_delay_cost: mixedProfile.avg_delay_cost,
    top_mixed_avg_late_risk: mixedProfile.avg_late_risk,
    top_mixed_avg_failure_risk: mixedProfile.avg_failure_risk,
    top_mixed_avg_same_dir_streak: mixedProfile.avg_same_dir_streak,
    top_mixed_cost_shield_block_add_rate: mixedProfile.cost_shield_block_add_rate,
    profiles: [dragProfile, mixedProfile].filter((row) => row.market && row.profile),
  };
}

module.exports = {
  buildMlEvReplayStalePosDiagnostics,
};
