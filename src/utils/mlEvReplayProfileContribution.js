"use strict";

const { __test: replayTestUtils } = require("./bestSelfEvolutionReplay");

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

function findCandidate(candidates = null, candidateId = null) {
  const rows = Array.isArray(candidates && candidates.rows) ? candidates.rows : [];
  const exact = rows.find((row) => norm(row && row.candidate_id) === norm(candidateId));
  return exact || null;
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

function profileStats(rows = []) {
  const byProfile = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = profileKey(row);
    const entry = byProfile.get(key) || {
      profile: key,
      rows_n: 0,
      realized_n: 0,
      ret_sum: 0,
    };
    entry.rows_n += 1;
    const realized = toNum(row.realized_ret_net);
    if (realized != null) {
      entry.realized_n += 1;
      entry.ret_sum += realized;
    }
    byProfile.set(key, entry);
  }
  return byProfile;
}

function mergeProfileDeltas(beforeRows = [], afterRows = []) {
  const before = profileStats(beforeRows);
  const after = profileStats(afterRows);
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].map((key) => {
    const left = before.get(key) || { profile: key, rows_n: 0, realized_n: 0, ret_sum: 0 };
    const right = after.get(key) || { profile: key, rows_n: 0, realized_n: 0, ret_sum: 0 };
    const beforeAvg = left.realized_n > 0 ? left.ret_sum / left.realized_n : null;
    const afterAvg = right.realized_n > 0 ? right.ret_sum / right.realized_n : null;
    return {
      profile: key,
      before_rows_n: left.rows_n,
      after_rows_n: right.rows_n,
      rows_delta: right.rows_n - left.rows_n,
      before_realized_n: left.realized_n,
      after_realized_n: right.realized_n,
      realized_delta: right.realized_n - left.realized_n,
      before_avg_ret_net: beforeAvg == null ? null : Number(beforeAvg.toFixed(4)),
      after_avg_ret_net: afterAvg == null ? null : Number(afterAvg.toFixed(4)),
      avg_ret_net_delta: beforeAvg == null || afterAvg == null ? null : Number((afterAvg - beforeAvg).toFixed(4)),
    };
  }).sort((a, b) =>
    Math.abs(Number(b.avg_ret_net_delta || 0)) - Math.abs(Number(a.avg_ret_net_delta || 0))
    || Math.abs(Number(b.rows_delta || 0)) - Math.abs(Number(a.rows_delta || 0))
    || String(a.profile).localeCompare(String(b.profile))
  );
}

function marketRows(rows = [], market = null, candidate = null) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (norm(row && row.market) !== norm(market)) return false;
    return replayTestUtils.candidateTargetsRow(candidate, row);
  });
}

function topProfileWithAddedNegativeReturn(profileRows = []) {
  return (Array.isArray(profileRows) ? profileRows : []).find((row) =>
    (row.rows_delta || 0) > 0 && (row.avg_ret_net_delta || 0) < 0
  ) || null;
}

function buildMarketProfileContribution({ market, beforeRows, afterRows }) {
  const merged = mergeProfileDeltas(beforeRows, afterRows);
  const topDrag = topProfileWithAddedNegativeReturn(merged) || merged[0] || null;
  return {
    market: norm(market),
    before_rows_n: beforeRows.length,
    after_rows_n: afterRows.length,
    top_profile: norm(topDrag && topDrag.profile),
    top_profile_rows_delta: toNum(topDrag && topDrag.rows_delta),
    top_profile_avg_ret_net_delta: toNum(topDrag && topDrag.avg_ret_net_delta),
    profiles: merged.slice(0, 5),
  };
}

function buildMlEvReplayProfileContribution({
  candidates = null,
  dataset = null,
  mlEvReplayMarketContribution = null,
} = {}) {
  const summary = readSummary(mlEvReplayMarketContribution);
  const candidate = findCandidate(candidates, summary.candidate_id);
  const datasetRows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  if (!candidate || !datasetRows.length) {
    return {
      status: "ML_EV_REPLAY_PROFILE_CONTRIBUTION_READY",
      evidence_status: "PROFILE_INPUT_MISSING",
      candidate_id: norm(summary.candidate_id),
      display_candidate_id: norm(summary.display_candidate_id),
      top_return_drag_market: norm(summary.top_return_drag_market),
      top_mixed_market: norm(summary.top_mixed_market),
      top_return_drag_profile: null,
      top_mixed_profile: null,
      markets: [],
    };
  }

  const replayRows = replayTestUtils.buildHistoricalReplayRows(candidate, dataset).replay_rows || [];
  const selectedMarkets = [
    norm(summary.top_return_drag_market),
    norm(summary.top_mixed_market),
  ].filter(Boolean).filter((row, idx, arr) => arr.indexOf(row) === idx);

  const markets = selectedMarkets.map((market) => {
    const beforeRows = marketRows(datasetRows, market, candidate);
    const afterRows = marketRows(replayRows, market, candidate);
    return buildMarketProfileContribution({ market, beforeRows, afterRows });
  });

  const dragMarket = markets.find((row) => row.market === norm(summary.top_return_drag_market)) || null;
  const mixedMarket = markets.find((row) => row.market === norm(summary.top_mixed_market)) || null;

  return {
    status: "ML_EV_REPLAY_PROFILE_CONTRIBUTION_READY",
    evidence_status: "PROFILE_CONTRIBUTION_READY",
    candidate_id: norm(summary.candidate_id),
    display_candidate_id: norm(summary.display_candidate_id),
    top_return_drag_market: norm(summary.top_return_drag_market),
    top_return_drag_profile: norm(dragMarket && dragMarket.top_profile),
    top_return_drag_profile_rows_delta: toNum(dragMarket && dragMarket.top_profile_rows_delta),
    top_return_drag_profile_avg_ret_net_delta: toNum(dragMarket && dragMarket.top_profile_avg_ret_net_delta),
    top_mixed_market: norm(summary.top_mixed_market),
    top_mixed_profile: norm(mixedMarket && mixedMarket.top_profile),
    top_mixed_profile_rows_delta: toNum(mixedMarket && mixedMarket.top_profile_rows_delta),
    top_mixed_profile_avg_ret_net_delta: toNum(mixedMarket && mixedMarket.top_profile_avg_ret_net_delta),
    markets,
  };
}

module.exports = {
  buildMlEvReplayProfileContribution,
};
