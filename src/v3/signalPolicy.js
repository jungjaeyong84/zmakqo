"use strict";

const { buildV3PaperCohortKey, evaluateV3PaperPolicy } = require("./paperPolicy");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
  }
  return null;
}

function deriveSide(row = {}) {
  const event = upper(row.event);
  if (event === "LONG") return "LONG";
  if (event === "SHORT") return "SHORT";
  const side = upper(row.side);
  if (side === "BUY") return "LONG";
  if (side === "SELL") return "SHORT";
  return null;
}

function normalizeSetupType(value) {
  const setup = upper(value);
  if (setup === "CONTINUATION") return "MOMENTUM_CONTINUATION";
  if (setup === "BREAKOUT") return "BREAKOUT_RETEST";
  if (setup === "BREAKDOWN") return "BREAKOUT_RETEST";
  if (setup === "LOSS") return "PULLBACK_RECLAIM";
  if (setup === "RECLAIM" || setup === "PULLBACK_RECLAIM") return "PULLBACK_RECLAIM";
  if (setup === "BREAKOUT_RETEST") return "BREAKOUT_RETEST";
  if (setup === "MOMENTUM_CONTINUATION") return "MOMENTUM_CONTINUATION";
  return setup;
}

function normalizeTriggerType(value) {
  const trigger = upper(value);
  if (trigger === "BREAKOUT") return "BREAKOUT";
  if (trigger === "BREAKDOWN") return "BREAKDOWN";
  if (trigger === "CONTINUATION") return "CONTINUATION";
  if (trigger === "LOSS") return "LOSS";
  return trigger;
}

function deriveStructuralRegime(rawSignal = {}) {
  const direct = upper(firstNonEmpty(
    rawSignal.structural_regime,
    rawSignal.market_regime,
    rawSignal.regime
  ));
  if (direct === "TREND" || direct === "TRANSITION" || direct === "RANGE") return direct;
  const marketState = upper(rawSignal.market_state);
  if (marketState === "BULL" || marketState === "BEAR") return "TREND";
  if (marketState === "TRANSITION") return "TRANSITION";
  if (marketState === "RANGE") return "RANGE";
  return direct;
}

function buildCandidateSignal(row = {}) {
  const features = asObject(row.features_json) || {};
  const base = Object.freeze({
    signal_id: trimOrNull(row.signal_id),
    symbol: upper(firstNonEmpty(row.symbol_or_pair_id, row.symbol, features.symbol)),
    exchange: upper(row.exchange),
    tf: trimOrNull(row.tf),
    created_at: trimOrNull(row.created_at),
    side: deriveSide(row),
    setup_type: normalizeSetupType(firstNonEmpty(features.setup_type, features.effective_setup_type)),
    trigger_type: normalizeTriggerType(features.trigger_type),
    entry_grade: upper(firstNonEmpty(features.entry_grade, features.source_band)),
    source_band: upper(features.source_band),
    market_state: upper(features.market_state),
    htf_bias: upper(features.htf_bias),
    risk_mode: upper(features.risk_mode),
    opportunity_score: toNumberOrNull(features.opportunity_score),
    confidence: toNumberOrNull(features.confidence),
    setup_quality_score: toNumberOrNull(features.setup_quality_score),
    structure_alignment: toNumberOrNull(features.structure_alignment),
    htf_alignment_score: toNumberOrNull(features.htf_alignment_score),
    market_quality_score: toNumberOrNull(features.market_quality_score),
    spread_bps: toNumberOrNull(features.spread_bps),
    funding_rate: toNumberOrNull(features.funding_rate),
    btc_1h_trend: upper(features.btc_1h_trend),
    mtf_1h_direction: upper(features.mtf_1h_direction),
    feature_lineage_source: upper(features.feature_lineage_source),
    rr: toNumberOrNull(features.rr),
    signal_price: toNumberOrNull(features.signal_price),
    stop_price: toNumberOrNull(features.stop_price),
    target_price: toNumberOrNull(features.target_price),
    raw_reason: trimOrNull(row.reason),
  });
  return Object.freeze({
    ...base,
    structural_regime: deriveStructuralRegime({
      structural_regime: firstNonEmpty(features.structural_regime, row.structural_regime),
      market_regime: firstNonEmpty(features.market_regime, row.market_regime),
      regime: firstNonEmpty(features.regime, row.regime),
      market_state: base.market_state,
    }),
    edge_cohort: upper(firstNonEmpty(features.edge_cohort, row.edge_cohort)),
  });
}

const V3_SIGNAL_ACTIVE_PROFILES = Object.freeze([
  Object.freeze({
    id: "LONG_MC_TREND_BUILDABLE_CORE",
    cohort: Object.freeze({
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "BUILDABLE_EDGE",
      entry_grade: "CORE",
    }),
    entry_grade: "CORE",
    source_band: "CORE",
    market_states: Object.freeze(["BULL"]),
    htf_biases: Object.freeze(["BULL"]),
    trigger_types: Object.freeze(["CONTINUATION"]),
    min: Object.freeze({
      opportunity_score: 0.78,
      confidence: 0.78,
      setup_quality_score: 0.88,
      structure_alignment: 0.9,
      htf_alignment_score: 0.9,
      market_quality_score: 0.8,
      rr: 1.4,
    }),
  }),
  Object.freeze({
    id: "LONG_MC_TREND_MARGINAL_CORE",
    cohort: Object.freeze({
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
    }),
    entry_grade: "CORE",
    source_band: "CORE",
    market_states: Object.freeze(["BULL"]),
    htf_biases: Object.freeze(["BULL"]),
    trigger_types: Object.freeze(["CONTINUATION"]),
    min: Object.freeze({
      opportunity_score: 0.72,
      confidence: 0.72,
      setup_quality_score: 0.72,
      structure_alignment: 0.72,
      htf_alignment_score: 0.72,
      rr: 1.4,
    }),
  }),
  Object.freeze({
    id: "LONG_BR_TREND_MARGINAL_CORE",
    cohort: Object.freeze({
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
    }),
    entry_grade: "CORE",
    source_band: "CORE",
    market_states: Object.freeze(["BULL"]),
    htf_biases: Object.freeze(["BULL"]),
    trigger_types: Object.freeze(["BREAKOUT"]),
    min: Object.freeze({
      opportunity_score: 0.7,
      confidence: 0.7,
      setup_quality_score: 0.68,
      structure_alignment: 0.72,
      htf_alignment_score: 0.72,
      rr: 1.4,
    }),
  }),
  Object.freeze({
    id: "LONG_BR_TREND_MARGINAL_EARLY",
    cohort: Object.freeze({
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "EARLY",
    }),
    entry_grade: "EARLY",
    source_band: "EARLY",
    market_states: Object.freeze(["BULL"]),
    htf_biases: Object.freeze(["BULL"]),
    trigger_types: Object.freeze(["BREAKOUT"]),
    min: Object.freeze({
      opportunity_score: 0.68,
      confidence: 0.68,
      setup_quality_score: 0.55,
      structure_alignment: 0.55,
      htf_alignment_score: 0.55,
      rr: 1.4,
    }),
  }),
  Object.freeze({
    id: "LONG_BR_RANGE_MARGINAL_EARLY",
    cohort: Object.freeze({
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "RANGE",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "EARLY",
    }),
    entry_grade: "EARLY",
    source_band: "EARLY",
    market_states: Object.freeze(["RANGE"]),
    htf_biases: Object.freeze(["BULL"]),
    trigger_types: Object.freeze(["BREAKOUT"]),
    min: Object.freeze({
      opportunity_score: 0.64,
      confidence: 0.64,
      setup_quality_score: 0.4,
      structure_alignment: 0.35,
      htf_alignment_score: 0.35,
      rr: 1.4,
    }),
  }),
  Object.freeze({
    id: "LONG_BR_TRANSITION_BUILDABLE_EARLY",
    cohort: Object.freeze({
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TRANSITION",
      edge_cohort: "BUILDABLE_EDGE",
      entry_grade: "EARLY",
    }),
    entry_grade: "EARLY",
    source_band: "EARLY",
    market_states: Object.freeze(["TRANSITION"]),
    htf_biases: Object.freeze(["BULL"]),
    trigger_types: Object.freeze(["BREAKOUT"]),
    min: Object.freeze({
      opportunity_score: 0.68,
      confidence: 0.68,
      setup_quality_score: 0.6,
      structure_alignment: 0.75,
      htf_alignment_score: 0.75,
      rr: 1.4,
    }),
  }),
  Object.freeze({
    id: "SHORT_MC_TREND_MARGINAL_CORE",
    cohort: Object.freeze({
      side: "SHORT",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
    }),
    entry_grade: "CORE",
    source_band: "CORE",
    market_states: Object.freeze(["BEAR"]),
    htf_biases: Object.freeze(["BEAR"]),
    trigger_types: Object.freeze(["CONTINUATION"]),
    min: Object.freeze({
      opportunity_score: 0.72,
      confidence: 0.72,
      setup_quality_score: 0.72,
      structure_alignment: 0.72,
      htf_alignment_score: 0.72,
      rr: 1.4,
    }),
  }),
]);

function hasRequiredPriceLevels(signal = {}) {
  return (
    signal.signal_price !== null
    && signal.stop_price !== null
    && signal.target_price !== null
  );
}

function hasRequiredLearningEvidence(signal = {}) {
  return (
    signal.market_quality_score !== null
    && signal.spread_bps !== null
    && signal.funding_rate !== null
    && !!signal.btc_1h_trend
    && !!signal.mtf_1h_direction
  );
}

function collectCommonBlockers(signal = {}) {
  const blockers = [];
  if (!signal.side) blockers.push("V3_SIGNAL_SIDE_REQUIRED");
  if (!signal.setup_type) blockers.push("V3_SIGNAL_SETUP_REQUIRED");
  if (!signal.entry_grade) blockers.push("V3_SIGNAL_ENTRY_GRADE_REQUIRED");
  if (!signal.structural_regime) blockers.push("V3_SIGNAL_STRUCTURAL_REGIME_REQUIRED");
  if (signal.risk_mode && signal.risk_mode !== "PASS") blockers.push("V3_SIGNAL_RISK_MODE_PASS_REQUIRED");
  if (!hasRequiredPriceLevels(signal)) blockers.push("V3_SIGNAL_PRICE_LEVELS_REQUIRED");
  if (signal.market_quality_score === null) blockers.push("V3_SIGNAL_MARKET_QUALITY_REQUIRED");
  if (signal.spread_bps === null) blockers.push("V3_SIGNAL_SPREAD_BPS_REQUIRED");
  if (signal.funding_rate === null) blockers.push("V3_SIGNAL_FUNDING_RATE_REQUIRED");
  if (!signal.btc_1h_trend) blockers.push("V3_SIGNAL_BTC_1H_TREND_REQUIRED");
  if (!signal.mtf_1h_direction) blockers.push("V3_SIGNAL_MTF_1H_DIRECTION_REQUIRED");
  return blockers;
}

function matchProfile(profile, signal) {
  if (signal.side !== profile.cohort.side) return false;
  if (signal.setup_type !== profile.cohort.setup_type) return false;
  if (signal.structural_regime !== profile.cohort.structural_regime) return false;
  if (signal.entry_grade !== profile.entry_grade) return false;
  if (signal.source_band && signal.source_band !== profile.source_band) return false;
  if (profile.market_states && !profile.market_states.includes(signal.market_state)) return false;
  if (profile.htf_biases && !profile.htf_biases.includes(signal.htf_bias)) return false;
  if (profile.trigger_types && !profile.trigger_types.includes(signal.trigger_type)) return false;
  for (const [field, floor] of Object.entries(profile.min || {})) {
    if ((signal[field] ?? -Infinity) < floor) return false;
  }
  return true;
}

function findMatchingProfile(signal = {}) {
  return V3_SIGNAL_ACTIVE_PROFILES.find((profile) => matchProfile(profile, signal)) || null;
}

function normalizeSignalForV3(row = {}) {
  return buildCandidateSignal(row);
}

function evaluateV3SignalPolicy(signal = {}) {
  const commonBlockers = collectCommonBlockers(signal);
  if (commonBlockers.length) {
    return Object.freeze({
      ok: false,
      reason: commonBlockers[0],
      apply_mode: null,
      blockers: Object.freeze(commonBlockers),
      cohort_key: null,
      profile_id: null,
      cohort_context: null,
    });
  }

  if (signal.setup_type === "PULLBACK_RECLAIM") {
    return Object.freeze({
      ok: false,
      reason: "V3_SIGNAL_PULLBACK_RECLAIM_DISABLED",
      apply_mode: null,
      blockers: Object.freeze(["V3_SIGNAL_PULLBACK_RECLAIM_DISABLED"]),
      cohort_key: null,
      profile_id: null,
      cohort_context: null,
    });
  }

  const profile = findMatchingProfile(signal);
  if (!profile) {
    return Object.freeze({
      ok: false,
      reason: "V3_SIGNAL_NO_ACTIVE_PROFILE_MATCH",
      apply_mode: null,
      blockers: Object.freeze(["V3_SIGNAL_NO_ACTIVE_PROFILE_MATCH"]),
      cohort_key: null,
      profile_id: null,
      cohort_context: null,
    });
  }

  const cohortContext = Object.freeze({
    side: profile.cohort.side,
    setup_type: profile.cohort.setup_type,
    structural_regime: profile.cohort.structural_regime,
    edge_cohort: profile.cohort.edge_cohort,
    entry_grade: profile.cohort.entry_grade,
  });
  const policyVerdict = evaluateV3PaperPolicy(cohortContext);
  const cohortKey = buildV3PaperCohortKey(cohortContext);

  if (!policyVerdict.ok) {
    return Object.freeze({
      ok: false,
      reason: policyVerdict.reason,
      apply_mode: null,
      blockers: Object.freeze([policyVerdict.reason]),
      cohort_key: cohortKey,
      profile_id: profile.id,
      cohort_context: cohortContext,
    });
  }

  return Object.freeze({
    ok: true,
    reason: "V3_SIGNAL_ALLOWED",
    apply_mode: policyVerdict.apply_mode || "ACTIVE",
    blockers: Object.freeze([]),
    cohort_key: cohortKey,
    profile_id: profile.id,
    cohort_context: cohortContext,
  });
}

module.exports = Object.freeze({
  V3_SIGNAL_ACTIVE_PROFILES,
  normalizeSignalForV3,
  evaluateV3SignalPolicy,
  __test: {
    deriveStructuralRegime,
    findMatchingProfile,
    hasRequiredLearningEvidence,
  },
});
