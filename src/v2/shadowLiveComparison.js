"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function absDelta(left, right) {
  const a = toNumberOrNull(left);
  const b = toNumberOrNull(right);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

function compareProposalPair({
  label = null,
  shadowProposal,
  liveProposal,
  shadowDecision = null,
  liveDecision = null,
  thresholds = {},
} = {}) {
  const shadow = shadowProposal && typeof shadowProposal === "object" ? shadowProposal : null;
  const live = liveProposal && typeof liveProposal === "object" ? liveProposal : null;
  if (!shadow) throw new Error("SHADOW_PROPOSAL_REQUIRED");
  if (!live) throw new Error("LIVE_PROPOSAL_REQUIRED");

  const effective = {
    qualityScoreAbsDeltaWarn: toNumberOrNull(thresholds.qualityScoreAbsDeltaWarn) ?? 0.15,
    rankScoreAbsDeltaWarn: toNumberOrNull(thresholds.rankScoreAbsDeltaWarn) ?? 0.2,
    sizeRatioAbsDeltaWarn: toNumberOrNull(thresholds.sizeRatioAbsDeltaWarn) ?? 0.25,
  };

  const blockerReasons = [];
  const warnReasons = [];
  if (upper(shadow.symbol) !== upper(live.symbol)) blockerReasons.push("SYMBOL_MISMATCH");
  if (upper(shadow.side) !== upper(live.side)) blockerReasons.push("SIDE_MISMATCH");
  if (upper(shadow.timeframe) !== upper(live.timeframe)) blockerReasons.push("TIMEFRAME_MISMATCH");

  const verdictMismatch = upper(shadow.proposal_verdict) !== upper(live.proposal_verdict);
  const filterMismatch = upper(shadow.strategy_filter_verdict) !== upper(live.strategy_filter_verdict);
  const liveApproved = liveDecision ? liveDecision.approved === true : null;
  const shadowApproved = shadowDecision ? shadowDecision.approved === true : null;
  const decisionApprovalMismatch = shadowDecision && liveDecision ? shadowApproved !== liveApproved : false;

  if (verdictMismatch) blockerReasons.push("PROPOSAL_VERDICT_MISMATCH");
  if (filterMismatch) blockerReasons.push("FILTER_VERDICT_MISMATCH");
  if (decisionApprovalMismatch) blockerReasons.push("DECISION_APPROVAL_MISMATCH");

  const qualityScoreAbsDelta = absDelta(shadow.quality_score, live.quality_score);
  const rankScoreAbsDelta = absDelta(shadow.rank_score, live.rank_score);
  const sizeRatioAbsDelta = absDelta(shadow.size_ratio, live.size_ratio);

  if (qualityScoreAbsDelta !== null && qualityScoreAbsDelta >= effective.qualityScoreAbsDeltaWarn) {
    warnReasons.push("QUALITY_SCORE_DRIFT");
  }
  if (rankScoreAbsDelta !== null && rankScoreAbsDelta >= effective.rankScoreAbsDeltaWarn) {
    warnReasons.push("RANK_SCORE_DRIFT");
  }
  if (sizeRatioAbsDelta !== null && sizeRatioAbsDelta >= effective.sizeRatioAbsDeltaWarn) {
    warnReasons.push("SIZE_RATIO_DRIFT");
  }

  const pass = blockerReasons.length === 0;
  return Object.freeze({
    label: trimOrNull(label) || `${upper(live.symbol) || "UNKNOWN"}__${upper(live.side) || "UNKNOWN"}__${upper(live.timeframe) || "UNKNOWN"}`,
    pass,
    blocker_reasons: blockerReasons,
    warn_reasons: warnReasons,
    symbol: upper(live.symbol),
    side: upper(live.side),
    timeframe: upper(live.timeframe),
    verdict_pair: Object.freeze({
      shadow: upper(shadow.proposal_verdict),
      live: upper(live.proposal_verdict),
    }),
    approved_pair: Object.freeze({
      shadow: shadowApproved,
      live: liveApproved,
    }),
    deltas: Object.freeze({
      quality_score_abs: qualityScoreAbsDelta,
      rank_score_abs: rankScoreAbsDelta,
      size_ratio_abs: sizeRatioAbsDelta,
    }),
  });
}

function buildShadowLiveComparisonReport({
  pairs,
  thresholds = {},
} = {}) {
  const rows = Array.isArray(pairs) ? pairs.map((pair) => compareProposalPair({ ...pair, thresholds })) : [];
  const blockerRows = rows.filter((row) => row.blocker_reasons.length > 0);
  const warnRows = rows.filter((row) => row.warn_reasons.length > 0);
  return Object.freeze({
    pass: rows.length > 0 && blockerRows.length === 0,
    pair_n: rows.length,
    block_n: blockerRows.length,
    warn_n: warnRows.length,
    blockers: blockerRows.flatMap((row) => row.blocker_reasons.map((reason) => `${row.label}:${reason}`)),
    warnings: warnRows.flatMap((row) => row.warn_reasons.map((reason) => `${row.label}:${reason}`)),
    rows,
  });
}

module.exports = {
  compareProposalPair,
  buildShadowLiveComparisonReport,
};
