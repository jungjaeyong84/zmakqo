"use strict";

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

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function incrementCounter(map, key) {
  map[key] = Number(map[key] || 0) + 1;
}

function median(values = []) {
  const nums = values
    .map(toNumberOrNull)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

function resolveLiveRiskUnitUsdt({
  staticSeedRows = [],
  explicitRiskUnitUsdt = null,
  fallbackRiskUnitUsdt = 0.67,
} = {}) {
  const explicit = toNumberOrNull(explicitRiskUnitUsdt);
  if (explicit !== null && explicit > 0) return explicit;
  const staticAbsPnls = (Array.isArray(staticSeedRows) ? staticSeedRows : [])
    .map((row) => Math.abs(Number(toNumberOrNull(row && row.realized_pnl) || 0)))
    .filter((value) => value > 0);
  const inferred = median(staticAbsPnls);
  if (inferred !== null && inferred > 0) return inferred;
  return fallbackRiskUnitUsdt;
}

function buildEntryLookup(entryRows = []) {
  const map = new Map();
  for (const row of Array.isArray(entryRows) ? entryRows : []) {
    const signalId = trimOrNull(row && row.signal_id);
    if (!signalId) continue;
    map.set(signalId, row);
  }
  return map;
}

function buildClosedSignalIdSet(exitRows = []) {
  const ids = new Set();
  for (const row of Array.isArray(exitRows) ? exitRows : []) {
    if (upper(row && row.status) !== "CLOSED") continue;
    const signalId = trimOrNull(row && row.signal_id);
    if (signalId) ids.add(signalId);
  }
  return ids;
}

function hydrateEntryContext(entry = {}, signalLookup = {}) {
  const signalId = trimOrNull(entry && entry.signal_id);
  const fallback = signalId ? signalLookup[signalId] || null : null;
  if (!fallback) return entry;
  return Object.freeze({
    ...entry,
    setup_type: upper(entry.setup_type) || upper(fallback.setup_type),
    structural_regime: upper(entry.structural_regime) || upper(fallback.structural_regime),
    edge_cohort: upper(entry.edge_cohort) || upper(fallback.edge_cohort),
    cohort_key: trimOrNull(entry.cohort_key) || trimOrNull(fallback.cohort_key),
    profile_id: upper(entry.profile_id) || upper(fallback.profile_id),
    entry_grade: upper(entry.entry_grade) || upper(fallback.entry_grade),
    market_quality_score: toNumberOrNull(entry.market_quality_score ?? fallback.market_quality_score),
    spread_bps: toNumberOrNull(entry.spread_bps ?? fallback.spread_bps),
    funding_rate: toNumberOrNull(entry.funding_rate ?? fallback.funding_rate),
    btc_1h_trend: upper(entry.btc_1h_trend) || upper(fallback.btc_1h_trend),
    mtf_1h_direction: upper(entry.mtf_1h_direction) || upper(fallback.mtf_1h_direction),
    feature_lineage_source: upper(entry.feature_lineage_source) || upper(fallback.feature_lineage_source),
    signal_price: toNumberOrNull(entry.signal_price ?? fallback.signal_price),
    stop_price: toNumberOrNull(entry.stop_price ?? fallback.stop_price),
    target_price: toNumberOrNull(entry.target_price ?? fallback.target_price),
  });
}

function buildStableLiveSeedId(entry = {}, exit = {}) {
  const signalId = trimOrNull(exit.signal_id) || trimOrNull(entry.signal_id) || "UNKNOWN_SIGNAL";
  const exitId = trimOrNull(exit.v3_paper_exit_id) || "UNKNOWN_EXIT";
  return `V3LIVESEED__${signalId}__${exitId}`;
}

function buildPseudoOutcomeIds(entry = {}, exit = {}) {
  const signalId = trimOrNull(exit.signal_id) || trimOrNull(entry.signal_id) || "UNKNOWN_SIGNAL";
  const entryId = trimOrNull(entry.v3_paper_entry_id) || signalId;
  return Object.freeze({
    openclaw_decision_id: `V3LIVEDEC__${signalId}`,
    signal_intent_id: `V3LIVEINTENT__${signalId}`,
    position_cycle_id: `V3LIVECYCLE__${entryId}`,
  });
}

function hasCompleteBootstrapContext(entry = {}) {
  return (
    upper(entry.side)
    && upper(entry.setup_type)
    && upper(entry.structural_regime)
    && upper(entry.edge_cohort)
    && upper(entry.entry_grade)
    && toNumberOrNull(entry.market_quality_score) !== null
    && toNumberOrNull(entry.spread_bps) !== null
    && toNumberOrNull(entry.funding_rate) !== null
    && upper(entry.btc_1h_trend)
    && upper(entry.mtf_1h_direction)
  );
}

function listMissingBootstrapContextFields(entry = {}) {
  const missing = [];
  if (!upper(entry.side)) missing.push("side");
  if (!upper(entry.setup_type)) missing.push("setup_type");
  if (!upper(entry.structural_regime)) missing.push("structural_regime");
  if (!upper(entry.edge_cohort)) missing.push("edge_cohort");
  if (!upper(entry.entry_grade)) missing.push("entry_grade");
  if (toNumberOrNull(entry.market_quality_score) === null) missing.push("market_quality_score");
  if (toNumberOrNull(entry.spread_bps) === null) missing.push("spread_bps");
  if (toNumberOrNull(entry.funding_rate) === null) missing.push("funding_rate");
  if (!upper(entry.btc_1h_trend)) missing.push("btc_1h_trend");
  if (!upper(entry.mtf_1h_direction)) missing.push("mtf_1h_direction");
  return Object.freeze(missing);
}

function buildLiveSeedRow(entry = {}, exit = {}, { riskUnitUsdt = 1 } = {}) {
  const realizedR = toNumberOrNull(exit && exit.realized_r);
  if (realizedR === null) return null;
  const ids = buildPseudoOutcomeIds(entry, exit);
  const pseudoPnlUsdt = round(realizedR * riskUnitUsdt, 6);
  const realizedExitEvent = upper(exit && exit.exit_event) || "UNKNOWN_EXIT";
  const adjudicationLabel = pseudoPnlUsdt > 0 ? "MODEL_WIN" : "MODEL_ERROR";
  const side = upper(entry.side);
  const setupType = upper(entry.setup_type);
  const structuralRegime = upper(entry.structural_regime);
  const edgeCohort = upper(entry.edge_cohort);
  const entryGrade = upper(entry.entry_grade);
  const marketQualityScore = toNumberOrNull(entry.market_quality_score);
  const spreadBps = toNumberOrNull(entry.spread_bps);
  const fundingRate = toNumberOrNull(entry.funding_rate);
  const btcTrend = upper(entry.btc_1h_trend);
  const mtfDirection = upper(entry.mtf_1h_direction);
  const featureLineageSource = upper(entry.feature_lineage_source) || "V3_LOCAL_PAPER";

  return Object.freeze({
    bootstrap_seed_id: buildStableLiveSeedId(entry, exit),
    bootstrap_seed_kind: "V3_LIVE_PAPER",
    source: "V3_LOCAL_PAPER_BOOTSTRAP_LIVE_SEED",
    adjudicated_at: trimOrNull(exit.closed_at) || new Date().toISOString(),
    adjudication_family: "MODEL",
    adjudication_label: adjudicationLabel,
    realized_exit_event: realizedExitEvent,
    realized_pnl: null,
    realized_r: realizedR,
    synthetic_realized_pnl_usdt: pseudoPnlUsdt,
    realized_pnl_pct: toNumberOrNull(exit.realized_pnl_pct),
    signal_id: trimOrNull(exit.signal_id) || trimOrNull(entry.signal_id),
    ...ids,
    side,
    setup_type: setupType,
    structural_regime: structuralRegime,
    edge_cohort: edgeCohort,
    entry_grade: entryGrade,
    evidence: Object.freeze({
      side,
      setup_type: setupType,
      structural_regime: structuralRegime,
      edge_cohort: edgeCohort,
      entry_grade: entryGrade,
      market_quality_score: marketQualityScore,
      spread_bps: spreadBps,
      funding_rate: fundingRate,
      btc_1h_trend: btcTrend,
      mtf_1h_direction: mtfDirection,
      feature_lineage_source: featureLineageSource,
      signal_intent_id: ids.signal_intent_id,
      position_cycle_id: ids.position_cycle_id,
      openclaw_decision_id: ids.openclaw_decision_id,
      performance_eligibility_basis: "V3_LOCAL_PAPER_EXIT_MATCHED_TO_ENTRY",
      bootstrap_live_risk_unit_usdt: round(riskUnitUsdt, 6),
      v3_paper_entry_id: trimOrNull(entry.v3_paper_entry_id),
      v3_paper_exit_id: trimOrNull(exit.v3_paper_exit_id),
      profile_id: upper(entry.profile_id),
      cohort_key: trimOrNull(entry.cohort_key),
      signal_price: toNumberOrNull(entry.signal_price),
      stop_price: toNumberOrNull(entry.stop_price),
      target_price: toNumberOrNull(entry.target_price),
    }),
  });
}

function analyzePendingOpenEntries({
  entryRows = [],
  exitRows = [],
  signalLookup = {},
} = {}) {
  const closedSignalIds = buildClosedSignalIdSet(exitRows);
  const missingFieldCounts = Object.create(null);
  const preview = [];
  let pendingOpenEntryN = 0;
  let pendingOpenEntryLiveSeedReadyN = 0;
  let pendingOpenEntryContextIncompleteN = 0;

  for (const baseEntry of Array.isArray(entryRows) ? entryRows : []) {
    if (upper(baseEntry && baseEntry.status) !== "OPEN") continue;
    const signalId = trimOrNull(baseEntry && baseEntry.signal_id);
    if (signalId && closedSignalIds.has(signalId)) continue;
    pendingOpenEntryN += 1;
    const entry = hydrateEntryContext(baseEntry, signalLookup);
    const missingFields = listMissingBootstrapContextFields(entry);
    const contextComplete = missingFields.length === 0;
    if (contextComplete) pendingOpenEntryLiveSeedReadyN += 1;
    else {
      pendingOpenEntryContextIncompleteN += 1;
      for (const field of missingFields) incrementCounter(missingFieldCounts, field);
    }
    preview.push(Object.freeze({
      signal_id: signalId,
      symbol: upper(entry.symbol),
      side: upper(entry.side),
      setup_type: upper(entry.setup_type),
      structural_regime: upper(entry.structural_regime),
      edge_cohort: upper(entry.edge_cohort),
      entry_grade: upper(entry.entry_grade),
      context_complete: contextComplete,
      missing_fields: missingFields,
    }));
  }

  return Object.freeze({
    pending_open_entry_n: pendingOpenEntryN,
    pending_open_entry_live_seed_ready_n: pendingOpenEntryLiveSeedReadyN,
    pending_open_entry_context_incomplete_n: pendingOpenEntryContextIncompleteN,
    pending_open_entry_missing_field_counts: Object.freeze(missingFieldCounts),
    pending_open_entry_preview: Object.freeze(preview.slice(0, 20)),
  });
}

function buildV3BootstrapLiveSeedReport({
  entryRows = [],
  exitRows = [],
  staticSeedRows = [],
  explicitRiskUnitUsdt = null,
  signalLookup = {},
} = {}) {
  const riskUnitUsdt = resolveLiveRiskUnitUsdt({
    staticSeedRows,
    explicitRiskUnitUsdt,
  });
  const entryLookup = buildEntryLookup(entryRows);
  const blockedReasonCounts = Object.create(null);
  const seenSignalIds = new Set();
  const liveSeedRows = [];
  const pendingOpenEntries = analyzePendingOpenEntries({
    entryRows,
    exitRows,
    signalLookup,
  });

  for (const exit of Array.isArray(exitRows) ? exitRows : []) {
    if (upper(exit && exit.status) !== "CLOSED") continue;
    const signalId = trimOrNull(exit && exit.signal_id);
    if (!signalId) {
      incrementCounter(blockedReasonCounts, "V3_LIVE_SEED_SIGNAL_ID_MISSING");
      continue;
    }
    if (seenSignalIds.has(signalId)) {
      incrementCounter(blockedReasonCounts, "V3_LIVE_SEED_DUPLICATE_SIGNAL_ID");
      continue;
    }
    seenSignalIds.add(signalId);
    const baseEntry = entryLookup.get(signalId);
    if (!baseEntry) {
      incrementCounter(blockedReasonCounts, "V3_LIVE_SEED_ENTRY_MISSING");
      continue;
    }
    const entry = hydrateEntryContext(baseEntry, signalLookup);
    if (!hasCompleteBootstrapContext(entry)) {
      incrementCounter(blockedReasonCounts, "V3_LIVE_SEED_CONTEXT_INCOMPLETE");
      continue;
    }
    const liveRow = buildLiveSeedRow(entry, exit, { riskUnitUsdt });
    if (!liveRow) {
      incrementCounter(blockedReasonCounts, "V3_LIVE_SEED_REALIZED_R_MISSING");
      continue;
    }
    liveSeedRows.push(liveRow);
  }

  return Object.freeze({
    ok: true,
    source_entry_n: Array.isArray(entryRows) ? entryRows.length : 0,
    source_exit_n: Array.isArray(exitRows) ? exitRows.length : 0,
    live_seed_row_n: liveSeedRows.length,
    risk_unit_usdt: round(riskUnitUsdt, 6),
    blocked_reason_counts: Object.freeze(blockedReasonCounts),
    ...pendingOpenEntries,
    live_seed_rows: Object.freeze(liveSeedRows),
  });
}

module.exports = Object.freeze({
  buildV3BootstrapLiveSeedReport,
  __test: {
    resolveLiveRiskUnitUsdt,
    buildStableLiveSeedId,
    buildEntryLookup,
    hasCompleteBootstrapContext,
    listMissingBootstrapContextFields,
    buildLiveSeedRow,
    analyzePendingOpenEntries,
  },
});
