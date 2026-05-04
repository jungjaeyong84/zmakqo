"use strict";

const crypto = require("crypto");
const {
  buildOpenClawOutcomeAdjudicationDoc,
  buildPositionCycleId,
} = require("./contracts");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseObject(value) {
  if (asObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return asObject(JSON.parse(value));
  } catch (_) {
    return null;
  }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cloneJson(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function getPath(obj, path) {
  let cursor = obj;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = cursor[key];
  }
  return cursor == null ? null : cursor;
}

function firstObject(...candidates) {
  for (const candidate of candidates) {
    const parsed = parseObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function firstValue(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
  }
  return null;
}

function hash12(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function timestampMs(row) {
  const direct = toNumberOrNull(row && (row.created_at_ms || row.ts_ms || row.time_ms || row.bar_close_time_utc_ms));
  if (direct != null) return direct;
  const text = trimOrNull(row && (row.created_at || row.updated_at || row.time));
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromMs(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeSymbol(row) {
  return upper(row && (row.symbol || row.market || row.pair));
}

function normalizeAction(row) {
  return upper(row && (row.action || row.event || row.canonical_exit_event));
}

function normalizeSide(row) {
  return upper(row && row.side);
}

function realizedPnl(row) {
  return toNumberOrNull(row && (
    row.realized_pnl
    ?? row.external_realized_pnl
    ?? row.realizedPnl
    ?? row.pnl
  ));
}

function isV2ProtectedEntryFill(row) {
  const action = normalizeAction(row);
  const pnl = realizedPnl(row);
  const signalDocId = trimOrNull(row && row.signal_doc_id);
  const key = trimOrNull(row && row.canonical_exit_chain_key);
  return action === "SYNC_FILL"
    && (pnl == null || pnl === 0)
    && (
      (signalDocId && signalDocId.includes("__V2_PROTECTED_ENTRY"))
      || (key && key.includes("__V2_PROTECTED_ENTRY"))
      || upper(row && row.entry_signal_type) === "V2_PROTECTED_ENTRY"
    );
}

function isRealizedExitFill(row) {
  const pnl = realizedPnl(row);
  const action = normalizeAction(row);
  if (!Number.isFinite(pnl) || pnl === 0) return false;
  return Boolean(action && (
    action.startsWith("EXIT_")
    || action === "SYNC_FILL"
  ));
}

function isOperatorExternalExit(row) {
  const action = normalizeAction(row);
  return action === "EXIT_EXTERNAL_SYNC" || action === "MANUAL_CLOSE_SYNC";
}

function isUnverifiedOrLineageGapExit(row) {
  const action = normalizeAction(row) || "";
  const statusReason = upper(row && (row.status_reason || row.reason || row.decision_reason)) || "";
  const lineageReason = upper(row && (row.lineage_gap_reason || row.lineage_reason)) || "";
  const text = `${action} ${statusReason} ${lineageReason}`;
  return text.includes("UNVERIFIED")
    || text.includes("MISSING_CANONICAL_EXIT_TRANSITION")
    || text.includes("LINEAGE_GAP");
}

function positionSideFromEntrySide(side) {
  const normalized = upper(side);
  if (normalized === "BUY" || normalized === "LONG") return "LONG";
  if (normalized === "SELL" || normalized === "SHORT") return "SHORT";
  return null;
}

function oppositeExitSideForPosition(positionSide) {
  const side = upper(positionSide);
  if (side === "LONG") return "SELL";
  if (side === "SHORT") return "BUY";
  return null;
}

function mapExitEvent(rows) {
  const allActions = rows.map(normalizeAction).filter(Boolean);
  const transitions = rows.flatMap((row) => asArray(row && row.canonical_transition_events).map(upper).filter(Boolean));
  const has = (token) => allActions.some((action) => action.includes(token)) || transitions.some((event) => event.includes(token));
  if (transitions.includes("TP1_FULL_EXIT")) return "TP1_FULL_EXIT";
  if (transitions.includes("TP1_REACHED") || has("TP_P1") || has("TP1")) return "TP1_REACHED";
  if (transitions.includes("TRAIL_HIT") || has("TRAIL")) return "TRAIL_HIT";
  if (transitions.includes("SL_HIT") || has("SL_")) return "SL_HIT";
  if (allActions.some((action) => action && action.includes("EXTERNAL"))) return "EXTERNAL_CLOSE_SYNC";
  if (allActions.some((action) => action && action.includes("MANUAL"))) return "MANUAL_CLOSE_SYNC";
  if (has("BE")) return "BREAKEVEN_EXIT";
  return "BROKER_SYNC_EXIT";
}

function groupKeyForExit(row) {
  const symbol = normalizeSymbol(row) || "UNKNOWN";
  const lineageKey = trimOrNull(row && (
    row.entry_event_id
    || row.position_cycle_id
    || row.canonical_exit_chain_key
    || row.authoritative_exit_chain_key
    || row.signal_id
    || row.signal_doc_id
  ));
  if (lineageKey) return `${symbol}__ENTRY__${lineageKey}`;
  const orderId = trimOrNull(row && (row.external_order_id || row.order_id || row.live_order_id));
  const action = normalizeAction(row) || "EXIT";
  if (orderId) return `${symbol}__ORDER__${orderId}`;
  return `${symbol}__${action}__${timestampMs(row) || trimOrNull(row && row.id) || hash12(JSON.stringify(row || {}))}`;
}

function groupRealizedExitFills(rows = []) {
  const groups = new Map();
  for (const row of asArray(rows).filter(isRealizedExitFill)) {
    const key = groupKeyForExit(row);
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  return Array.from(groups.entries()).map(([key, fills]) => {
    const sorted = fills.slice().sort((a, b) => (timestampMs(a) || 0) - (timestampMs(b) || 0));
    const latestMs = Math.max(...sorted.map((row) => timestampMs(row) || 0));
    const pnl = sorted.reduce((sum, row) => sum + (realizedPnl(row) || 0), 0);
    return Object.freeze({
      key,
      fills: Object.freeze(sorted),
      symbol: normalizeSymbol(sorted[0]),
      side: normalizeSide(sorted[0]),
      latest_ms: Number.isFinite(latestMs) && latestMs > 0 ? latestMs : null,
      realized_pnl: pnl,
      realized_exit_event: mapExitEvent(sorted),
      operator_external: sorted.some(isOperatorExternalExit),
      lineage_gap: sorted.some(isUnverifiedOrLineageGapExit),
    });
  }).sort((a, b) => (a.latest_ms || 0) - (b.latest_ms || 0));
}

function buildProtectedEntryLineageIndex(rows = []) {
  const bySymbol = new Map();
  for (const row of asArray(rows).filter(isV2ProtectedEntryFill)) {
    const symbol = normalizeSymbol(row);
    const entryMs = timestampMs(row);
    const positionSide = positionSideFromEntrySide(normalizeSide(row));
    if (!symbol || !Number.isFinite(entryMs) || !positionSide) continue;
    const enriched = Object.freeze({
      row,
      symbol,
      entry_ms: entryMs,
      position_side: positionSide,
      exit_side: oppositeExitSideForPosition(positionSide),
    });
    const list = bySymbol.get(symbol) || [];
    list.push(enriched);
    bySymbol.set(symbol, list);
  }
  for (const [symbol, list] of bySymbol.entries()) {
    bySymbol.set(symbol, list.sort((a, b) => a.entry_ms - b.entry_ms));
  }
  return bySymbol;
}

function matchExitGroupToEntry(exitGroup, entryIndex) {
  const symbol = upper(exitGroup && exitGroup.symbol);
  const exitMs = exitGroup && exitGroup.latest_ms;
  if (!symbol || !Number.isFinite(exitMs)) return null;
  const candidates = (entryIndex.get(symbol) || []).filter((entry) => {
    if (entry.entry_ms > exitMs) return false;
    const exitSide = upper(exitGroup.side);
    return !exitSide || !entry.exit_side || exitSide === entry.exit_side;
  });
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function syntheticOpenClawIds({ entry, exitGroup }) {
  const row = asObject(entry && entry.row) || {};
  const symbol = entry.symbol;
  const positionSide = entry.position_side;
  const exitRows = asArray(exitGroup && exitGroup.fills);
  const exitEntryEventId = trimOrNull(firstValue(...exitRows.map((fill) => fill && fill.entry_event_id)));
  const exitPositionCycleId = trimOrNull(firstValue(...exitRows.map((fill) => fill && fill.position_cycle_id)));
  const exitOpenClawDecisionId = trimOrNull(firstValue(...exitRows.map((fill) => fill && fill.openclaw_decision_id)));
  const exitSignalIntentId = trimOrNull(firstValue(...exitRows.map((fill) => fill && (fill.signal_intent_id || fill.intent_id))));
  const entryKey = trimOrNull(row.position_cycle_id)
    || exitPositionCycleId
    || exitEntryEventId
    || trimOrNull(row.entry_event_id)
    || trimOrNull(row.canonical_exit_chain_key)
    || trimOrNull(row.signal_doc_id)
    || trimOrNull(row.trade_id)
    || trimOrNull(row.id)
    || `${symbol}__${positionSide}__${entry.entry_ms}`;
  const positionCycleId = trimOrNull(row.position_cycle_id) || exitPositionCycleId || buildPositionCycleId({
    symbol,
    positionSide,
    entryEventId: entryKey,
  });
  const decisionId = trimOrNull(row.openclaw_decision_id)
    || exitOpenClawDecisionId
    || `OCDV2__RECONCILED_BROKER_SYNC__${hash12(`${entryKey}__${exitGroup.key}`)}`;
  const signalIntentId = trimOrNull(row.signal_intent_id || row.intent_id)
    || exitSignalIntentId
    || `SIGINTV2__RECONCILED_BROKER_SYNC__${symbol}__${positionSide}__${hash12(entryKey)}`;
  return Object.freeze({
    openclawDecisionId: decisionId,
    signalIntentId,
    positionCycleId,
    entryKey,
  });
}

function appendIndexKey(map, key, row) {
  const text = trimOrNull(key);
  if (!text || !map || !row) return;
  if (!map.has(text)) {
    map.set(text, row);
    return;
  }
  const existing = map.get(text);
  const existingHasCriteria = !!(
    existing && (
      existing.signal_criteria
      || existing.signalCriteria
      || (existing.bundle_payload && (existing.bundle_payload.signalCriteria || existing.bundle_payload.signal_criteria))
      || (existing.payload && (existing.payload.signalCriteria || existing.payload.signal_criteria))
    )
  );
  const nextHasCriteria = !!(
    row && (
      row.signal_criteria
      || row.signalCriteria
      || (row.bundle_payload && (row.bundle_payload.signalCriteria || row.bundle_payload.signal_criteria))
      || (row.payload && (row.payload.signalCriteria || row.payload.signal_criteria))
    )
  );
  if (!existingHasCriteria && nextHasCriteria) map.set(text, row);
}

function extractDecisionPayload(row) {
  const source = asObject(row) || {};
  return firstObject(
    source.bundle_payload,
    source.payload,
    source.decision_bundle,
    source.bundle,
  ) || source;
}

function extractSignalCriteriaFromDecisionEvidence(row) {
  const source = asObject(row) || {};
  const payload = extractDecisionPayload(source);
  return firstObject(
    source.signal_criteria,
    source.signalCriteria,
    getPath(source, ["canonical_evidence_summary", "signal_criteria"]),
    getPath(source, ["canonicalEvidenceSummary", "signal_criteria"]),
    getPath(source, ["evidence", "signal_criteria"]),
    getPath(source, ["bundle_payload", "signalCriteria"]),
    getPath(source, ["bundle_payload", "signal_criteria"]),
    getPath(source, ["bundle_payload", "canonicalEvidenceSummary", "signal_criteria"]),
    getPath(source, ["bundle_payload", "canonical_evidence_summary", "signal_criteria"]),
    getPath(source, ["bundle_payload", "openclawDecision", "canonical_evidence_summary", "signal_criteria"]),
    getPath(payload, ["signalCriteria"]),
    getPath(payload, ["signal_criteria"]),
    getPath(payload, ["canonicalEvidenceSummary", "signal_criteria"]),
    getPath(payload, ["canonical_evidence_summary", "signal_criteria"]),
    getPath(payload, ["openclawDecision", "canonical_evidence_summary", "signal_criteria"]),
  );
}

function extractCanonicalEvidenceFromDecisionEvidence(row) {
  const source = asObject(row) || {};
  const payload = extractDecisionPayload(source);
  return firstObject(
    source.canonical_evidence_summary,
    source.canonicalEvidenceSummary,
    getPath(source, ["bundle_payload", "canonicalEvidenceSummary"]),
    getPath(source, ["bundle_payload", "canonical_evidence_summary"]),
    getPath(source, ["bundle_payload", "openclawDecision", "canonical_evidence_summary"]),
    getPath(payload, ["canonicalEvidenceSummary"]),
    getPath(payload, ["canonical_evidence_summary"]),
    getPath(payload, ["openclawDecision", "canonical_evidence_summary"]),
  );
}

function extractSignalIntentFromDecisionEvidence(row) {
  const source = asObject(row) || {};
  const payload = extractDecisionPayload(source);
  return firstObject(
    source.signal_intent,
    source.signalIntent,
    getPath(source, ["bundle_payload", "signalIntent"]),
    getPath(source, ["bundle_payload", "signal_intent"]),
    getPath(payload, ["signalIntent"]),
    getPath(payload, ["signal_intent"]),
  );
}

function extractOpenClawDecisionFromDecisionEvidence(row) {
  const source = asObject(row) || {};
  const payload = extractDecisionPayload(source);
  return firstObject(
    source.openclaw_decision,
    source.openclawDecision,
    getPath(source, ["bundle_payload", "openclawDecision"]),
    getPath(source, ["bundle_payload", "openclaw_decision"]),
    getPath(payload, ["openclawDecision"]),
    getPath(payload, ["openclaw_decision"]),
  );
}

function resolveRecoveredDecisionIds({ ids, decisionEvidence = null } = {}) {
  const source = asObject(decisionEvidence) || {};
  const openclawDecision = extractOpenClawDecisionFromDecisionEvidence(source);
  const signalIntent = extractSignalIntentFromDecisionEvidence(source);
  return Object.freeze({
    openclawDecisionId: trimOrNull(firstValue(
      source.openclaw_decision_id,
      openclawDecision && openclawDecision.openclaw_decision_id,
      ids && ids.openclawDecisionId,
    )),
    signalIntentId: trimOrNull(firstValue(
      source.signal_intent_id,
      source.intent_id,
      signalIntent && signalIntent.signal_intent_id,
      signalIntent && signalIntent.intent_id,
      ids && ids.signalIntentId,
    )),
  });
}

function extractMarketDataQualityFromDecisionEvidence(row) {
  const source = asObject(row) || {};
  const payload = extractDecisionPayload(source);
  return firstObject(
    source.market_data_quality,
    source.marketDataQuality,
    getPath(source, ["bundle_payload", "marketDataQuality"]),
    getPath(source, ["bundle_payload", "market_data_quality"]),
    getPath(payload, ["marketDataQuality"]),
    getPath(payload, ["market_data_quality"]),
  );
}

function buildDecisionEvidenceIndex(rows = []) {
  const byOpenClawDecisionId = new Map();
  const bySignalIntentId = new Map();
  const bySignalLineageId = new Map();
  const byPositionCycleId = new Map();
  const byEntryEventId = new Map();
  for (const row of asArray(rows)) {
    const source = asObject(row);
    if (!source) continue;
    const payload = extractDecisionPayload(source);
    const signalIntent = extractSignalIntentFromDecisionEvidence(source);
    const openclawDecision = extractOpenClawDecisionFromDecisionEvidence(source);
    appendIndexKey(byOpenClawDecisionId, source.openclaw_decision_id, source);
    appendIndexKey(byOpenClawDecisionId, openclawDecision && openclawDecision.openclaw_decision_id, source);
    appendIndexKey(bySignalIntentId, source.signal_intent_id, source);
    appendIndexKey(bySignalIntentId, signalIntent && signalIntent.signal_intent_id, source);
    appendIndexKey(bySignalLineageId, source.signal_lineage_id, source);
    appendIndexKey(bySignalLineageId, signalIntent && signalIntent.signal_lineage_id, source);
    appendIndexKey(bySignalLineageId, signalIntent && signalIntent.signal_id, source);
    appendIndexKey(byPositionCycleId, source.position_cycle_id, source);
    appendIndexKey(byEntryEventId, source.entry_event_id, source);
  }
  return Object.freeze({
    byOpenClawDecisionId,
    bySignalIntentId,
    bySignalLineageId,
    byPositionCycleId,
    byEntryEventId,
    row_n: asArray(rows).length,
  });
}

function resolveDecisionEvidenceForEntry({ entryRow, ids, decisionEvidenceIndex = null } = {}) {
  const index = decisionEvidenceIndex || {};
  const features = parseObject(entryRow && entryRow.features_json) || parseObject(entryRow && entryRow.features) || {};
  const candidates = [
    trimOrNull(entryRow && entryRow.openclaw_decision_id),
    trimOrNull(features && features.openclaw_decision_id),
    trimOrNull(ids && ids.openclawDecisionId),
  ];
  for (const id of candidates) {
    const row = id && index.byOpenClawDecisionId && index.byOpenClawDecisionId.get(id);
    if (row) return row;
  }
  const positionCycleCandidates = [
    trimOrNull(entryRow && entryRow.position_cycle_id),
    trimOrNull(features && features.position_cycle_id),
    trimOrNull(ids && ids.positionCycleId),
  ];
  for (const id of positionCycleCandidates) {
    const row = id && index.byPositionCycleId && index.byPositionCycleId.get(id);
    const linkedDecisionId = trimOrNull(row && row.openclaw_decision_id);
    const linkedBundle = linkedDecisionId && index.byOpenClawDecisionId && index.byOpenClawDecisionId.get(linkedDecisionId);
    if (linkedBundle) return linkedBundle;
    if (row) return row;
  }
  const entryEventCandidates = [
    trimOrNull(entryRow && entryRow.entry_event_id),
    trimOrNull(features && features.entry_event_id),
  ];
  for (const id of entryEventCandidates) {
    const row = id && index.byEntryEventId && index.byEntryEventId.get(id);
    const linkedDecisionId = trimOrNull(row && row.openclaw_decision_id);
    const linkedBundle = linkedDecisionId && index.byOpenClawDecisionId && index.byOpenClawDecisionId.get(linkedDecisionId);
    if (linkedBundle) return linkedBundle;
    if (row) return row;
  }
  const signalCandidates = [
    trimOrNull(entryRow && (entryRow.signal_intent_id || entryRow.intent_id)),
    trimOrNull(features && (features.signal_intent_id || features.intent_id)),
    trimOrNull(ids && ids.signalIntentId),
  ];
  for (const id of signalCandidates) {
    const row = id && index.bySignalIntentId && index.bySignalIntentId.get(id);
    if (row) return row;
  }
  const lineageCandidates = [
    trimOrNull(entryRow && entryRow.signal_doc_id),
    trimOrNull(entryRow && entryRow.signal_id),
    trimOrNull(features && (features.signal_doc_id || features.signal_id || features.signal_lineage_id)),
  ];
  for (const id of lineageCandidates) {
    const row = id && index.bySignalLineageId && index.bySignalLineageId.get(id);
    if (row) return row;
  }
  return null;
}

function extractGateObject(criteria, gateKey) {
  const gate = criteria && criteria[gateKey];
  return asObject(gate) || {};
}

function buildEntryFeatureEvidence({ entryFeatures = null, decisionEvidence = null } = {}) {
  const features = asObject(entryFeatures) || null;
  const criteria = extractSignalCriteriaFromDecisionEvidence(decisionEvidence);
  const canonical = extractCanonicalEvidenceFromDecisionEvidence(decisionEvidence);
  const marketDataQuality = extractMarketDataQualityFromDecisionEvidence(decisionEvidence);
  const setupGate = extractGateObject(criteria, "setup_gate");
  const triggerGate = extractGateObject(criteria, "trigger_gate");
  const noTradeGate = extractGateObject(criteria, "no_trade_gate");
  const expectedEdgeGate = extractGateObject(criteria, "expected_edge_gate");
  const regimeProfile = firstObject(
    criteria && criteria.regime_profile,
    canonical && canonical.signal_regime_profile,
    canonical && canonical.regime_profile,
  ) || {};
  const expectedEdgeModel = firstObject(
    criteria && criteria.expected_edge_model,
    canonical && canonical.expected_edge_model,
  ) || {};
  const source = features && criteria
    ? "ENTRY_FEATURES_AND_OPENCLAW_DECISION"
    : (criteria || canonical || marketDataQuality ? "OPENCLAW_DECISION" : (features ? "ENTRY_FEATURES" : "MISSING"));
  const topLevel = {
    setup_type: upper(firstValue(features && features.setup_type, setupGate.setup_type, canonical && canonical.setup_type)),
    structural_regime: upper(firstValue(
      features && (features.structural_regime || features.htf_regime || features.market_regime),
      regimeProfile.structural_regime,
      canonical && (canonical.structural_regime || canonical.htf_regime || canonical.market_regime),
    )),
    regime_cohort: upper(firstValue(features && features.regime_cohort, regimeProfile.regime_cohort, canonical && canonical.regime_cohort)),
    edge_cohort: upper(firstValue(features && features.edge_cohort, expectedEdgeModel.edge_cohort, canonical && canonical.edge_cohort)),
    signal_score: toNumberOrNull(firstValue(features && (features.signal_score ?? features.score_norm), criteria && criteria.signal_score, canonical && canonical.signal_score)),
    trigger_confirmed: firstValue(features && features.trigger_confirmed, triggerGate.trigger_confirmed) === true,
    trigger_type: upper(firstValue(features && features.trigger_type, triggerGate.trigger_type, criteria && criteria.trigger_type, canonical && canonical.trigger_type)),
    volume_zscore: toNumberOrNull(firstValue(features && (features.volume_zscore ?? features.volume_ratio), triggerGate.volume_zscore)),
    expected_net_r_after_cost: toNumberOrNull(firstValue(
      features && features.expected_net_r_after_cost,
      expectedEdgeGate.expected_net_r_after_cost,
      expectedEdgeModel.net_r_multiple,
      criteria && criteria.expected_net_r_after_cost,
      canonical && canonical.expected_net_r_after_cost,
    )),
    entry_grade: upper(firstValue(features && features.entry_grade, criteria && criteria.entry_grade, canonical && canonical.entry_grade)),
    timing_bucket: upper(firstValue(features && features.timing_bucket, criteria && criteria.timing_bucket, canonical && canonical.timing_bucket)),
    btc_1h_trend: upper(firstValue(
      features && (features.btc_1h_trend || features.btc_1h_direction || features.btc_htf_trend),
      canonical && (canonical.btc_1h_trend || canonical.btc_1h_direction || canonical.btc_htf_trend),
      getPath(marketDataQuality, ["metrics", "btc_1h_trend"]),
      getPath(marketDataQuality, ["metrics", "btc_1h_direction"]),
    )),
    mtf_1h_direction: upper(firstValue(
      features && (features.mtf_1h_direction || features.htf_1h_direction || features.one_hour_direction),
      canonical && (canonical.mtf_1h_direction || canonical.htf_1h_direction || canonical.one_hour_direction),
      getPath(marketDataQuality, ["metrics", "mtf_1h_direction"]),
      getPath(marketDataQuality, ["metrics", "htf_1h_direction"]),
    )),
    funding_penalty_bps: toNumberOrNull(firstValue(
      features && features.funding_penalty_bps,
      noTradeGate.funding_penalty_bps,
      expectedEdgeGate.funding_penalty_bps,
      getPath(marketDataQuality, ["metrics", "funding_penalty_bps"]),
    )),
    funding_rate: toNumberOrNull(firstValue(
      features && (features.funding_rate ?? features.funding_rate_current),
      getPath(marketDataQuality, ["metrics", "funding_rate"]),
      getPath(marketDataQuality, ["metrics", "fundingRate"]),
    )),
    market_quality_score: toNumberOrNull(firstValue(
      features && features.market_quality_score,
      noTradeGate.market_quality_score,
      getPath(marketDataQuality, ["metrics", "market_quality_score"]),
      getPath(marketDataQuality, ["metrics", "quality_score"]),
      marketDataQuality && marketDataQuality.quality_score,
    )),
    spread_bps: toNumberOrNull(firstValue(
      features && features.spread_bps,
      noTradeGate.spread_bps,
      expectedEdgeGate.spread_bps,
      getPath(marketDataQuality, ["metrics", "spread_bps"]),
    )),
    mark_index_gap_bps: toNumberOrNull(firstValue(
      features && features.mark_index_gap_bps,
      noTradeGate.mark_index_gap_bps,
      expectedEdgeGate.mark_index_gap_bps,
      getPath(marketDataQuality, ["metrics", "mark_index_gap_bps"]),
    )),
    orderbook_imbalance_top5: toNumberOrNull(firstValue(
      features && (features.orderbook_imbalance_top5 ?? features.order_book_imbalance_top5),
      getPath(marketDataQuality, ["metrics", "orderbook_imbalance_top5"]),
      getPath(marketDataQuality, ["metrics", "order_book_imbalance_top5"]),
    )),
    open_interest_delta_pct: toNumberOrNull(firstValue(
      features && (features.open_interest_delta_pct ?? features.open_interest_change_pct),
      getPath(marketDataQuality, ["metrics", "open_interest_delta_pct"]),
      getPath(marketDataQuality, ["metrics", "open_interest_change_pct"]),
    )),
    liquidation_notional_5m_quote: toNumberOrNull(firstValue(
      features && (features.liquidation_notional_5m_quote ?? features.liquidation_notional_5m),
      getPath(marketDataQuality, ["metrics", "liquidation_notional_5m_quote"]),
      getPath(marketDataQuality, ["metrics", "liquidation_notional_5m"]),
    )),
  };
  return Object.freeze({
    ...topLevel,
    entry_features: features ? cloneJson(features) : null,
    signal_criteria: criteria ? cloneJson(criteria) : null,
    canonical_evidence_summary: canonical ? cloneJson(canonical) : null,
    market_data_quality: marketDataQuality ? cloneJson(marketDataQuality) : null,
    feature_lineage_source: source,
    feature_lineage_recovered: source === "OPENCLAW_DECISION" || source === "ENTRY_FEATURES_AND_OPENCLAW_DECISION",
  });
}

function buildAdjudicationFromExitGroup({ exitGroup, entry, nowMs = null, decisionEvidenceIndex = null } = {}) {
  if (!exitGroup || !entry) return null;
  const ids = syntheticOpenClawIds({ entry, exitGroup });
  const at = isoFromMs(exitGroup.latest_ms) || isoFromMs(nowMs) || new Date().toISOString();
  const family = (exitGroup.operator_external || exitGroup.lineage_gap) ? "OPERATOR" : "MODEL";
  let label = "OUTCOME_UNKNOWN";
  if (exitGroup.lineage_gap) {
    label = "LINEAGE_GAP";
  } else if (family === "OPERATOR") {
    label = "EXTERNAL_SYNC";
  } else if (exitGroup.realized_pnl > 0) {
    label = "MODEL_WIN";
  } else if (exitGroup.realized_pnl < 0) {
    label = "MODEL_ERROR";
  }
  const entryRow = asObject(entry.row) || {};
  const entryFeatures = parseObject(entryRow.features_json) || parseObject(entryRow.features) || null;
  const decisionEvidence = resolveDecisionEvidenceForEntry({ entryRow, ids, decisionEvidenceIndex });
  const resolvedIds = resolveRecoveredDecisionIds({ ids, decisionEvidence });
  const featureEvidence = buildEntryFeatureEvidence({ entryFeatures, decisionEvidence });
  const fillIds = exitGroup.fills.map((row) => trimOrNull(row.id || row.trade_id)).filter(Boolean);
  const exitActions = exitGroup.fills.map(normalizeAction).filter(Boolean);
  const exitReasons = Array.from(new Set(exitGroup.fills.map((row) => upper(row && (
    row.status_reason || row.reason || row.decision_reason || row.lineage_gap_reason
  ))).filter(Boolean)));
  return Object.freeze(buildOpenClawOutcomeAdjudicationDoc({
    openclawDecisionId: resolvedIds.openclawDecisionId,
    signalIntentId: resolvedIds.signalIntentId,
    positionCycleId: ids.positionCycleId,
    adjudicationLabel: label,
    adjudicationFamily: family,
    realizedExitEvent: exitGroup.realized_exit_event,
    realizedPnl: exitGroup.realized_pnl,
    executionOk: true,
    protectionOk: true,
    modelOk: label === "MODEL_WIN",
    source: "V2_OUTCOME_ADJUDICATION_COLLECTOR",
    adjudicatedAt: at,
    evidence: {
      source: "V2_OUTCOME_ADJUDICATION_COLLECTOR",
      lineage_quality: exitGroup.lineage_gap ? "LINEAGE_GAP_EXCLUDED" : "BROKER_SYNC_RECONCILED",
      lineage_reconciled: exitGroup.lineage_gap !== true,
      broker_sync_reconciled: true,
      performance_eligibility_basis: family === "MODEL" ? "V2_PROTECTED_ENTRY_MATCHED_TO_CANONICAL_EXIT_FILL" : "OPERATOR_OR_LINEAGE_GAP_EXCLUDED",
      lineage_gap: exitGroup.lineage_gap === true,
      symbol: entry.symbol,
      side: entry.position_side,
      ...featureEvidence,
      exit_side: exitGroup.side,
      entry_fill_id: trimOrNull(entryRow.id),
      entry_trade_id: trimOrNull(entryRow.trade_id),
      entry_order_id: trimOrNull(entryRow.external_order_id || entryRow.order_id || entryRow.live_order_id),
      entry_signal_doc_id: trimOrNull(entryRow.signal_doc_id),
      entry_canonical_exit_chain_key: trimOrNull(entryRow.canonical_exit_chain_key),
      entry_observed_at: isoFromMs(entry.entry_ms),
      exit_group_key: exitGroup.key,
      exit_fill_ids: fillIds,
      exit_order_id: trimOrNull(exitGroup.fills[0] && (exitGroup.fills[0].external_order_id || exitGroup.fills[0].order_id || exitGroup.fills[0].live_order_id)),
      exit_actions: exitActions,
      exit_status_reasons: exitReasons,
      exit_canonical_transition_events: Array.from(new Set(exitGroup.fills.flatMap((row) => asArray(row.canonical_transition_events).map(upper).filter(Boolean)))),
      source_fill_count: exitGroup.fills.length,
      realized_pnl_source: "BINANCE_USER_TRADES_REALIZED_PNL",
      openclaw_decision_id: resolvedIds.openclawDecisionId,
      signal_intent_id: resolvedIds.signalIntentId,
      synthetic_openclaw_decision_id: resolvedIds.openclawDecisionId === ids.openclawDecisionId ? null : ids.openclawDecisionId,
      synthetic_signal_intent_id: resolvedIds.signalIntentId === ids.signalIntentId ? null : ids.signalIntentId,
      position_cycle_id: ids.positionCycleId,
    },
  }));
}

function collectOpenClawOutcomeAdjudicationsFromFills({
  fills = [],
  decisionEvidenceRows = [],
  lookbackHours = 72,
  now = null,
} = {}) {
  const nowMs = now ? Date.parse(now) : Date.now();
  const lookbackMs = Math.max(0, Number(lookbackHours) || 0) * 60 * 60 * 1000;
  const rows = asArray(fills).filter((row) => {
    const ms = timestampMs(row);
    if (!Number.isFinite(ms)) return false;
    return lookbackMs <= 0 || ms >= nowMs - lookbackMs;
  });
  const entryIndex = buildProtectedEntryLineageIndex(rows);
  const decisionEvidenceIndex = buildDecisionEvidenceIndex(decisionEvidenceRows);
  const exitGroups = groupRealizedExitFills(rows);
  const docs = [];
  const skipped = [];
  for (const group of exitGroups) {
    const entry = matchExitGroupToEntry(group, entryIndex);
    if (!entry) {
      skipped.push(Object.freeze({
        reason: "MISSING_V2_PROTECTED_ENTRY_LINEAGE",
        symbol: group.symbol,
        exit_group_key: group.key,
        realized_exit_event: group.realized_exit_event,
        realized_pnl: group.realized_pnl,
        latest_at: isoFromMs(group.latest_ms),
      }));
      continue;
    }
    docs.push(buildAdjudicationFromExitGroup({ exitGroup: group, entry, nowMs, decisionEvidenceIndex }));
  }
  return Object.freeze({
    ok: true,
    reason: "V2_OPENCLAW_OUTCOME_ADJUDICATIONS_COLLECTED",
    source: "FILLS_PAPER_BROKER_SYNC",
    lookback_hours: Number(lookbackHours),
    scanned_fill_n: rows.length,
    protected_entry_fill_n: Array.from(entryIndex.values()).reduce((sum, list) => sum + list.length, 0),
    decision_evidence_row_n: decisionEvidenceIndex.row_n,
    realized_exit_group_n: exitGroups.length,
    adjudication_n: docs.length,
    skipped_n: skipped.length,
    skipped,
    adjudications: Object.freeze(docs),
  });
}

module.exports = {
  isV2ProtectedEntryFill,
  isRealizedExitFill,
  groupRealizedExitFills,
  buildProtectedEntryLineageIndex,
  buildDecisionEvidenceIndex,
  buildEntryFeatureEvidence,
  matchExitGroupToEntry,
  buildAdjudicationFromExitGroup,
  collectOpenClawOutcomeAdjudicationsFromFills,
  __test: {
    trimOrNull,
    upper,
    asArray,
    asObject,
    parseObject,
    toNumberOrNull,
    cloneJson,
    getPath,
    firstObject,
    firstValue,
    hash12,
    timestampMs,
    normalizeAction,
    normalizeSide,
    realizedPnl,
    isOperatorExternalExit,
    isUnverifiedOrLineageGapExit,
    mapExitEvent,
    positionSideFromEntrySide,
    oppositeExitSideForPosition,
    syntheticOpenClawIds,
    extractSignalCriteriaFromDecisionEvidence,
    extractCanonicalEvidenceFromDecisionEvidence,
    extractOpenClawDecisionFromDecisionEvidence,
    extractSignalIntentFromDecisionEvidence,
    extractMarketDataQualityFromDecisionEvidence,
    resolveRecoveredDecisionIds,
    resolveDecisionEvidenceForEntry,
  },
};
