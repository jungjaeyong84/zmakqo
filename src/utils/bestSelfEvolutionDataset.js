"use strict";

const { summarizePineSignalQuality } = require("../services/pineSignalQuality");
const { classifySignalReasonStage } = require("./signalReasonView");
const {
  isEntryTierEvent,
  canonicalExternalEntryEvent,
  resolveActiveEntryFamily,
  resolveLegacyEntryFamily,
} = require("./liveEntryTaxonomy");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMs(value) {
  const direct = toNum(value);
  if (Number.isFinite(direct)) return direct;
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function toUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

function resolveFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object" && !Array.isArray(row.features_json)) {
    return row.features_json;
  }
  if (row && row.features && typeof row.features === "object" && !Array.isArray(row.features)) {
    return row.features;
  }
  return {};
}

function mergeFeatures(...objects) {
  const out = {};
  for (const obj of objects) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined || value === "") continue;
      if (out[key] === null || out[key] === undefined || out[key] === "") out[key] = value;
    }
  }
  return out;
}

function hasValue(value) {
  return !(value === null || value === undefined || value === "");
}

function countPresentKeys(obj, keys = []) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 0;
  let n = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    const value = obj[key];
    if (value === null || value === undefined || value === "") continue;
    n += 1;
  }
  return n;
}

const FEBT_FEATURE_KEYS = Object.freeze([
  "febt_shadow_verdict",
  "febt_shadow_fallback_to_legacy",
  "febt_shadow_fallback_reason",
  "febt_shadow_disagrees_legacy_wait",
  "febt_shadow_disagreement_reason",
  "febt_shadow_legacy_wait_action",
  "febt_shadow_legacy_wait_trigger_path",
  "febt_mode",
  "febt_phase",
  "febt_calc_ok",
  "febt_calc_reason",
  "febt_timing_action",
  "febt_authority",
  "febt_payload_missing",
  "febt_lock_score",
  "febt_delay_cost",
  "febt_late_risk",
  "febt_failure_risk",
  "febt_edge",
  "late_by_bars",
]);

function featureRichnessScore(row) {
  const features = resolveFeatures(row);
  const keysN = Object.keys(features).length;
  const febtN = countPresentKeys(features, FEBT_FEATURE_KEYS);
  const updatedMs = parseMs(row && (row.updated_at || row.created_at)) || 0;
  return (febtN * 1000) + keysN + (updatedMs / 1e15);
}

function sortRowsByFeatureRichness(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => featureRichnessScore(b) - featureRichnessScore(a));
}

function extractChainBackfillFeatures(chainRow) {
  if (!chainRow || typeof chainRow !== "object" || Array.isArray(chainRow)) return {};
  const out = {};
  for (const key of FEBT_FEATURE_KEYS) {
    const value = chainRow[key];
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  const extraKeys = [
    "market_state_summary_state",
    "market_state_summary_action",
    "wait_one_bar_market_state_action",
    "legacy_wait_action",
    "legacy_wait_trigger_path",
  ];
  for (const key of extraKeys) {
    const value = chainRow[key];
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  return out;
}

function normalizeEvResolvedSignalKey(row) {
  const direct = String(row && row.signalId || "").trim().toUpperCase();
  if (direct) return direct;
  return buildCompositeSignalKey({
    market: String(row && row.symbol || row && row.market || "").trim().toUpperCase(),
    tf: String(row && row.tf || "15m").trim(),
    barMs: toNum(row && row.signalBarCloseMs),
    event: String(row && row.event || "").trim().toUpperCase(),
  });
}

function buildEvResolvedCounterfactualMap(evTunerReport = null) {
  const raw = evTunerReport && typeof evTunerReport === "object"
    ? (evTunerReport.raw && typeof evTunerReport.raw === "object" ? evTunerReport.raw : evTunerReport)
    : {};
  const rows = Array.isArray(raw.recent_resolved_examples) ? raw.recent_resolved_examples : [];
  const out = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (String(row.stage4Source || "").trim().toUpperCase() !== "EV_DROP") continue;
    const signalKey = normalizeEvResolvedSignalKey(row);
    if (!signalKey) continue;
    if (!out.has(signalKey)) out.set(signalKey, row);
  }
  return out;
}

function resolveProvider(row) {
  const ex = toUpper(row && row.exchange, "");
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return ex;
}

function matchProvider(row, providerNorm) {
  if (!providerNorm) return true;
  const raw = toUpper(row && row.exchange, "");
  if (raw) return raw === providerNorm;
  return resolveProvider(row) === providerNorm;
}

function resolveMarket(row) {
  return String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
}

function resolveTf(row) {
  return String((row && row.tf) || "").trim();
}

function resolveSide(row) {
  const side = toUpper(row && row.side, "");
  if (side === "BUY" || side === "LONG") return "LONG";
  if (side === "SELL" || side === "SHORT") return "SHORT";
  return null;
}

function resolveEvent(row) {
  const features = resolveFeatures(row);
  return toUpper(
    row && (row.entry_signal_type || row.entrySignalType || row.event)
    || features.entry_signal_type
    || features.entrySignalType,
    ""
  );
}

function resolveSignalBarCloseMs(row) {
  return (
    toNum(row && row.signal_bar_close_time_utc_ms)
    ?? toNum(row && row.bar_close_time_utc_ms)
    ?? toNum(row && row.exec_bar_close_time_utc_ms)
    ?? parseMs(row && row.created_at)
    ?? parseMs(row && row.updated_at)
  );
}

function resolveSignalId(row) {
  const features = resolveFeatures(row);
  const signalDocId = String(
    (row && (row.signal_doc_id || row.signalDocId))
    || features.signal_doc_id
    || features.signalDocId
    || ""
  ).trim();
  const signalId = String(
    (row && (row.signal_id || row.signalId))
    || features.signal_id
    || features.signalId
    || ""
  ).trim();
  if (signalDocId.startsWith("SIG__")) return signalDocId;
  if (signalId.startsWith("SIG__")) return signalId;
  return signalId || signalDocId || null;
}

function resolveEntryEventId(row) {
  const features = resolveFeatures(row);
  const direct = String(
    (row && (row.entry_event_id || row.entryEventId))
    || features.entry_event_id
    || features.entryEventId
    || ""
  ).trim();
  return direct || null;
}

function parseEntryEventIdParts(entryEventId) {
  const raw = String(entryEventId || "").trim();
  if (!raw) return null;

  if (raw.startsWith("ENTRY__")) {
    const parts = raw.split("__");
    if (parts.length < 6) return null;
    const provider = String(parts[1] || "").trim().toUpperCase();
    const market = String(parts[2] || "").trim().toUpperCase();
    const tf = String(parts[3] || "").trim();
    const barMs = toNum(parts[4]);
    const event = String(parts.slice(5).join("__") || "").trim().toUpperCase();
    if (!provider || !market || !tf || !Number.isFinite(barMs) || !event) return null;
    return { provider, market, tf, barMs, event };
  }

  if (raw.includes("|")) {
    const parts = raw.split("|");
    if (parts.length < 6) return null;
    const provider = String(parts[0] || "").trim().toUpperCase();
    const market = String(parts[1] || "").trim().toUpperCase();
    const tf = String(parts[2] || "").trim();
    const barMs = toNum(parts[3]);
    const event = String(parts[4] || "").trim().toUpperCase();
    if (!provider || !market || !tf || !Number.isFinite(barMs) || !event) return null;
    return { provider, market, tf, barMs, event };
  }

  return null;
}

function normalizeEntryEventId(entryEventId) {
  const parts = parseEntryEventIdParts(entryEventId);
  return parts ? buildEntryEventId(parts) : null;
}

function buildEntryEventId({ provider, market, tf, barMs, event }) {
  if (!provider || !market || !tf || !event || !Number.isFinite(barMs)) return null;
  return `ENTRY__${provider}__${market}__${tf}__${barMs}__${event}`;
}

function buildCompositeSignalKey({ market, tf, barMs, event }) {
  if (!market || !tf || !event || !Number.isFinite(barMs)) return null;
  return `${market}__${tf}__${barMs}__${event}`;
}

function resolveSignalKey(row) {
  const signalId = resolveSignalId(row);
  if (signalId) return signalId;
  return buildCompositeSignalKey({
    market: resolveMarket(row),
    tf: resolveTf(row),
    barMs: resolveSignalBarCloseMs(row),
    event: resolveEvent(row),
  });
}

function resolveSourceSignalKeyFromEntryEventId(entryEventId) {
  const parts = parseEntryEventIdParts(entryEventId);
  if (!parts) return null;
  return buildCompositeSignalKey(parts);
}

function resolveSourceSignalKeyFromSignalId(signalId) {
  const raw = String(signalId || "").trim();
  if (!raw) return null;
  const parts = raw.split("__");
  if (parts.length < 6 || parts[0] !== "SIG") return null;
  const market = String(parts[2] || "").trim().toUpperCase();
  const tf = String(parts[3] || "").trim();
  const barMs = toNum(parts[4]);
  const event = String(parts.slice(5).join("__") || "").trim().toUpperCase();
  if (!event || event.startsWith("EXIT_")) return null;
  return buildCompositeSignalKey({ market, tf, barMs, event });
}

function resolveSyntheticEntryEventId(row) {
  const explicit = resolveEntryEventId(row);
  if (explicit) return normalizeEntryEventId(explicit) || explicit;
  const signalId = resolveSignalId(row);
  const sourceSignalKey = resolveSourceSignalKeyFromSignalId(signalId);
  if (sourceSignalKey) {
    const [market, tf, barRaw, ...eventParts] = sourceSignalKey.split("__");
    return buildEntryEventId({
      provider: resolveProvider(row),
      market,
      tf,
      barMs: toNum(barRaw),
      event: eventParts.join("__"),
    });
  }
  return buildEntryEventId({
    provider: resolveProvider(row),
    market: resolveMarket(row),
    tf: resolveTf(row),
    barMs: resolveSignalBarCloseMs(row),
    event: (() => {
      const event = resolveEvent(row);
      return event && !event.startsWith("EXIT_") ? event : null;
    })(),
  });
}

function resolveIntentStatus(row) {
  return toUpper(row && row.status, "UNKNOWN");
}

function resolveRejectReason(row) {
  return String(
    (row && (row.reject_reason || row.status_reason || row.cancel_reason || row.reason))
    || ""
  ).trim() || null;
}

function resolveDropReason(row) {
  return String((row && (row.drop_reason_code || row.reason)) || "").trim() || null;
}

function resolveFallbackReason(features, row) {
  const candidates = [
    features && features.fallback_reason,
    features && features.febt_shadow_fallback_reason,
    features && features.signals_fallback_force_open_reason,
    row && row.fallback_reason,
  ];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text && text.toUpperCase() !== "UNKNOWN") return text;
  }
  return null;
}

function hasFallback(features, row) {
  if (features && features.febt_shadow_fallback_to_legacy === true) return true;
  if (resolveFallbackReason(features, row)) return true;
  return false;
}

function classifyExitEvent(eventRaw) {
  const ev = toUpper(eventRaw, "");
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_BE")) return "BE";
  if (ev.startsWith("EXIT_")) return "EXIT_OTHER";
  return null;
}

function hasChainExitEvidence(chainRow) {
  if (!chainRow || typeof chainRow !== "object") return false;
  if (chainRow.realized === true) return true;
  if (String(chainRow.first_exit_kind || "").trim()) return true;
  if (chainRow.tp1_hit === true) return true;
  if (chainRow.sl_before_tp1 === true) return true;
  if (chainRow.trail_after_tp1 === true) return true;
  return false;
}

function resolveOutcomeState({
  sourceRowType,
  event,
  entryEventId,
  realizedRetNet,
  fillsN,
  tradesN,
  exitFillsN,
  realizedTradesN,
  chainRow,
} = {}) {
  if (Number.isFinite(realizedRetNet)) return "REALIZED";

  const rowType = toUpper(sourceRowType, "UNKNOWN");
  if (rowType === "DROP") return "DROP";
  if (rowType === "MISSED") return "MISSED";
  if (rowType === "REJECTED") return "REJECTED";
  if (rowType === "FALLBACK") return "FALLBACK_PENDING";

  const eventUpper = toUpper(event, "");
  const exitOnlyEvent = eventUpper.startsWith("EXIT_");
  const hasEntryEvent = !!String(entryEventId || "").trim();
  const hasExecutionEvidence = Number(fillsN || 0) > 0 || Number(tradesN || 0) > 0;
  const hasExitEvidence = Number(exitFillsN || 0) > 0 || Number(realizedTradesN || 0) > 0 || hasChainExitEvidence(chainRow);

  if (!hasExecutionEvidence) {
    if (exitOnlyEvent && !hasEntryEvent) return "EXIT_ONLY_SIGNAL";
    return "LINK_MISSING";
  }
  if (hasExitEvidence) return "EXIT_PRESENT_UNLABELED";
  if (exitOnlyEvent && !hasEntryEvent) return "EXIT_ONLY_OPEN";
  return "OPEN_PENDING";
}

function isRealizedTradeRow(row) {
  if (!row || typeof row !== "object") return false;
  const closeType = toUpper(row.close_type, "");
  const exitEvent = toUpper(row.exit_event || row.event, "");
  if (closeType === "FULL_CLOSE" || closeType === "PARTIAL_CLOSE" || closeType === "EXTERNAL_REALIZED") return true;
  if (exitEvent.startsWith("EXIT_")) return true;
  if (Number.isFinite(resolveTradePnlQuote(row))) return true;
  if (Number.isFinite(resolveTradeRetNet(row))) return true;
  return false;
}

function resolveTradePnlQuote(row) {
  return (
    toNum(row && row.pnl_krw)
    ?? toNum(row && row.pnl)
    ?? toNum(row && row.net_pnl_quote)
  );
}

function resolveTradeRetNet(row) {
  return (
    toNum(row && row.pnl_pct)
    ?? toNum(row && row.ret_net)
    ?? toNum(row && row.realized_ret_net)
  );
}

function resolveFillPnlQuote(row) {
  const features = resolveFeatures(row);
  return (
    toNum(row && row.external_realized_pnl)
    ?? toNum(row && row.pnl_krw)
    ?? toNum(row && row.pnl)
    ?? toNum(features && features.pnl_krw)
    ?? toNum(features && features.pnl)
  );
}

function resolveFillRetNet(row) {
  const features = resolveFeatures(row);
  return (
    toNum(row && row.pnl_pct)
    ?? toNum(row && row.ret_net)
    ?? toNum(features && features.pnl_pct)
    ?? toNum(features && features.trigger_pnl_pct)
  );
}

function resolveFillNotional(row) {
  return (
    toNum(row && row.notional_krw)
    ?? toNum(row && row.notional)
  );
}

function resolveFeatureRetNet(row, features) {
  return (
    toNum(row && row.pnl_pct)
    ?? toNum(row && row.ret_net)
    ?? toNum(features && features.pnl_pct)
    ?? toNum(features && features.trigger_pnl_pct)
    ?? toNum(features && features.avg_ret_net)
    ?? toNum(features && features.ret_net)
  );
}

function estimateRetNetFromFillPrices({ side, entryFill, exitFills }) {
  const normalizedSide = toUpper(side, "");
  const entryPrice = toNum(entryFill && entryFill.exec_price);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const scopedExitFills = Array.isArray(exitFills) ? exitFills : [];
  if (!scopedExitFills.length) return null;

  let weightedExitNumerator = 0;
  let weightedExitDenominator = 0;
  for (const row of scopedExitFills) {
    const px = toNum(row && row.exec_price);
    if (!Number.isFinite(px) || px <= 0) continue;
    const weight = resolveFillNotional(row) ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weightedExitNumerator += (px * weight);
    weightedExitDenominator += weight;
  }
  if (!Number.isFinite(weightedExitDenominator) || weightedExitDenominator <= 0) return null;
  const avgExitPrice = weightedExitNumerator / weightedExitDenominator;
  if (!Number.isFinite(avgExitPrice) || avgExitPrice <= 0) return null;

  if (normalizedSide === "SHORT") return (entryPrice - avgExitPrice) / entryPrice;
  if (normalizedSide === "LONG") return (avgExitPrice - entryPrice) / entryPrice;
  return null;
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

function mean(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

function registerBucketAlias(aliasMap, bucket, value) {
  const key = String(value || "").trim();
  if (!key) return;
  aliasMap.set(key, bucket);
}

function getOrCreateBucket({ aliasMap, buckets, row, rowType }) {
  const entryEventIdRaw = resolveEntryEventId(row);
  const entryEventId = normalizeEntryEventId(entryEventIdRaw) || entryEventIdRaw;
  const signalId = resolveSignalId(row);
  const signalKey = resolveSignalKey(row);
  const sourceSignalKey = resolveSourceSignalKeyFromEntryEventId(entryEventId);
  const sourceSignalKeyFromSignalId = resolveSourceSignalKeyFromSignalId(signalId);
  const syntheticEntryEventId = resolveSyntheticEntryEventId(row);
  const candidates = [
    signalId,
    signalKey,
    sourceSignalKey,
    sourceSignalKeyFromSignalId,
    entryEventId,
    entryEventIdRaw,
    syntheticEntryEventId,
  ].filter(Boolean);
  let bucket = null;
  for (const key of candidates) {
    if (aliasMap.has(key)) {
      bucket = aliasMap.get(key);
      break;
    }
  }
  if (!bucket) {
    const synthetic = `${rowType}__${buckets.length + 1}`;
    bucket = {
      bucket_id: synthetic,
      signals: [],
      drops: [],
      intents: [],
      fills: [],
      trades: [],
    };
    buckets.push(bucket);
  }
  for (const key of candidates) registerBucketAlias(aliasMap, bucket, key);
  return bucket;
}

function buildDropStageKey(reason) {
  const stage = classifySignalReasonStage(reason);
  return stage && stage.key ? stage.key : null;
}

function resolveVerdictByStage(stageKey, features, hasDownstream) {
  const base = {
    integrity_verdict: hasDownstream ? "PASS" : "UNKNOWN",
    quality_verdict: hasDownstream ? "PASS" : "UNKNOWN",
    state_soft_sizing_verdict: String(
      (features && (features.market_state_summary_action || features.market_physics_action))
      || (hasDownstream ? "ALLOW" : "UNKNOWN")
    ).trim().toUpperCase() || "UNKNOWN",
    ev_verdict: String(
      (features && features.ev_gate_action)
      || (hasDownstream ? "ALLOW" : "UNKNOWN")
    ).trim().toUpperCase() || "UNKNOWN",
    wait_verdict: String(
      (features && (features.wait_one_bar_action || features.legacy_wait_action || features.febt_shadow_legacy_wait_action))
      || (hasDownstream ? "ALLOW" : "UNKNOWN")
    ).trim().toUpperCase() || "UNKNOWN",
  };
  if (stageKey === "QUALITY") base.integrity_verdict = "DROP";
  else if (stageKey === "AI") base.quality_verdict = "DROP";
  else if (stageKey === "MARKET") base.state_soft_sizing_verdict = "DROP";
  else if (stageKey === "EV") base.ev_verdict = "DROP";
  else if (stageKey === "TIMING") base.wait_verdict = "DROP";
  return base;
}

function buildUnifiedLearningRows({
  signals = [],
  drops = [],
  intents = [],
  fills = [],
  trades = [],
  provider = null,
  tf = null,
  fromMs = null,
  toMs = null,
  qualitySummary = null,
  evTunerReport = null,
} = {}) {
  const providerNorm = String(provider || "").trim().toUpperCase();
  const tfNorm = String(tf || "").trim();
  const buckets = [];
  const aliasMap = new Map();

  const inScope = (row) => {
    const rowTf = resolveTf(row);
    const barMs = resolveSignalBarCloseMs(row);
    if (!matchProvider(row, providerNorm)) return false;
    if (tfNorm && rowTf && rowTf !== tfNorm) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(barMs) && barMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(barMs) && barMs >= toMs) return false;
    return true;
  };

  for (const row of Array.isArray(signals) ? signals : []) {
    if (!inScope(row)) continue;
    getOrCreateBucket({ aliasMap, buckets, row, rowType: "SIGNAL" }).signals.push(row);
  }
  for (const row of Array.isArray(drops) ? drops : []) {
    if (!inScope(row)) continue;
    getOrCreateBucket({ aliasMap, buckets, row, rowType: "DROP" }).drops.push(row);
  }
  for (const row of Array.isArray(intents) ? intents : []) {
    if (!inScope(row)) continue;
    getOrCreateBucket({ aliasMap, buckets, row, rowType: "INTENT" }).intents.push(row);
  }
  for (const row of Array.isArray(fills) ? fills : []) {
    if (!inScope(row)) continue;
    getOrCreateBucket({ aliasMap, buckets, row, rowType: "FILL" }).fills.push(row);
  }
  for (const row of Array.isArray(trades) ? trades : []) {
    if (!inScope(row)) continue;
    getOrCreateBucket({ aliasMap, buckets, row, rowType: "TRADE" }).trades.push(row);
  }

  const quality = qualitySummary && typeof qualitySummary === "object"
    ? qualitySummary
    : null;
  const chainRows = Array.isArray(quality && quality.chain_rows) ? quality.chain_rows : [];
  const chainByEntryEvent = new Map();
  const chainBySignalKey = new Map();
  for (const row of chainRows) {
    const rawEntryEventId = row && row.entry_event_id ? String(row.entry_event_id).trim() : "";
    if (!rawEntryEventId) continue;
    chainByEntryEvent.set(rawEntryEventId, row);
    const normalizedEntryEventId = normalizeEntryEventId(rawEntryEventId);
    if (normalizedEntryEventId) chainByEntryEvent.set(normalizedEntryEventId, row);
    const signalKey = buildCompositeSignalKey({
      market: String(row && row.market || "").trim().toUpperCase(),
      tf: String(row && row.tf || "").trim(),
      barMs: toNum(row && row.entry_bar_ms),
      event: String(row && row.entry_signal_type || "").trim().toUpperCase(),
    });
    if (signalKey) chainBySignalKey.set(signalKey, row);
  }
  const evResolvedCounterfactualBySignalKey = buildEvResolvedCounterfactualMap(evTunerReport);

  const rows = buckets.map((bucket) => {
    const signalRows = sortRowsByFeatureRichness(bucket.signals);
    const dropRows = sortRowsByFeatureRichness(bucket.drops);
    const signalRow = signalRows[0] || null;
    const dropRow = dropRows[0] || null;
    const latestIntent = bucket.intents.slice().sort((a, b) => parseMs(b && b.updated_at) - parseMs(a && a.updated_at))[0] || null;
    const entryFills = bucket.fills.filter((row) => {
      const ev = toUpper(row && row.event, "");
      return ev && !ev.startsWith("EXIT_");
    }).sort((a, b) => (toNum(a && a.exec_bar_close_time_utc_ms) || 0) - (toNum(b && b.exec_bar_close_time_utc_ms) || 0));
    const exitFills = bucket.fills.filter((row) => {
      const ev = toUpper(row && row.event, "");
      return ev.startsWith("EXIT_");
    }).sort((a, b) => (toNum(a && a.exec_bar_close_time_utc_ms) || 0) - (toNum(b && b.exec_bar_close_time_utc_ms) || 0));
    const tradeRows = bucket.trades.slice().sort((a, b) => (toNum(a && (a.close_ms || a.exec_bar_close_time_utc_ms)) || 0) - (toNum(b && (b.close_ms || b.exec_bar_close_time_utc_ms)) || 0));
    const realizedTradeRows = tradeRows.filter((row) => isRealizedTradeRow(row));
    const entryFill = entryFills[0] || bucket.fills[0] || null;
    const tradeRow = realizedTradeRows[realizedTradeRows.length - 1] || tradeRows[tradeRows.length - 1] || null;
    const baseRow = signalRow || dropRow || latestIntent || entryFill || tradeRow || null;
    const baseEvent = resolveEvent(baseRow);
    const hasEntryContext = Boolean(
      (signalRow && isEntryTierEvent(resolveEvent(signalRow)))
      || (dropRow && isEntryTierEvent(resolveEvent(dropRow)))
      || (latestIntent && isEntryTierEvent(resolveEvent(latestIntent)))
      || entryFills.some((row) => isEntryTierEvent(resolveEvent(row)))
    );
    const exitOnlySignal = Boolean(baseEvent && baseEvent.startsWith("EXIT_") && !hasEntryContext);
    const signalId = resolveSignalId(baseRow);
    const event = resolveEvent(baseRow);
    const rawEntryEventId = resolveEntryEventId(baseRow);
    const entryEventId = normalizeEntryEventId(rawEntryEventId)
      || resolveSyntheticEntryEventId(baseRow);
    const signalKey = resolveSourceSignalKeyFromEntryEventId(entryEventId)
      || resolveSourceSignalKeyFromSignalId(signalId)
      || resolveSignalKey(baseRow)
      || signalId
      || bucket.bucket_id;
    const chainRow = entryEventId
      ? (chainByEntryEvent.get(entryEventId) || chainByEntryEvent.get(rawEntryEventId) || null)
      : null;
    const matchedChainRow = chainRow || chainBySignalKey.get(signalKey) || null;
    const evResolvedCounterfactual = evResolvedCounterfactualBySignalKey.get(String(signalKey || "").trim().toUpperCase()) || null;
    const chainBackfillFeatures = extractChainBackfillFeatures(matchedChainRow);
    const features = mergeFeatures(
      ...dropRows.map((row) => resolveFeatures(row)),
      ...signalRows.map((row) => resolveFeatures(row)),
      resolveFeatures(latestIntent),
      resolveFeatures(entryFill),
      resolveFeatures(tradeRow),
      chainBackfillFeatures
    );

    const dropReason = resolveDropReason(dropRow) || resolveRejectReason(latestIntent);
    const dropStageKey = buildDropStageKey(dropReason);
    const fallbackReason = resolveFallbackReason(features, baseRow);
    const partialFill = realizedTradeRows.some((row) => String(row && row.close_type || "").toUpperCase() === "PARTIAL_CLOSE");
    const intentStatus = resolveIntentStatus(latestIntent);
    const hasFill = bucket.fills.length > 0;
    const hasTrade = tradeRows.length > 0;
    const fallback = hasFallback(features, baseRow);

    let sourceRowType = "MISSED";
    if (exitOnlySignal) sourceRowType = "EXIT_ONLY";
    else if ((hasTrade || hasFill) && fallback) sourceRowType = "FALLBACK";
    else if (partialFill) sourceRowType = "PARTIAL";
    else if (hasTrade || hasFill) sourceRowType = "EXECUTED";
    else if (dropRow && fallback) sourceRowType = "FALLBACK";
    else if (dropRow) sourceRowType = "DROP";
    else if (intentStatus === "CANCELED" || intentStatus === "REJECTED" || intentStatus === "FAILED") sourceRowType = "REJECTED";

    const exitKindsFromFills = exitFills
      .map((row) => ({ kind: classifyExitEvent(row && row.event), ms: toNum(row && row.exec_bar_close_time_utc_ms) }))
      .filter((row) => row.kind);
    const exitKindsFromTrades = realizedTradeRows
      .map((row) => ({
        kind: classifyExitEvent(row && (row.exit_event || row.event)),
        ms: toNum(row && (row.close_ms || row.exec_bar_close_time_utc_ms)),
      }))
      .filter((row) => row.kind);
    const exitKinds = (exitKindsFromFills.length ? exitKindsFromFills : exitKindsFromTrades)
      .slice()
      .sort((a, b) => (Number(a.ms || 0) - Number(b.ms || 0)));
    const firstTp1Idx = exitKinds.findIndex((row) => row.kind === "TP1");
    const firstSlIdx = exitKinds.findIndex((row) => row.kind === "SL");
    const tp1First = firstTp1Idx >= 0 && (firstSlIdx < 0 || firstTp1Idx < firstSlIdx);
    const slFirst = firstSlIdx >= 0 && (firstTp1Idx < 0 || firstSlIdx < firstTp1Idx);

    const fillCreatedAtMs = parseMs(entryFill && entryFill.created_at);
    const lastExitFill = exitFills[exitFills.length - 1] || null;
    const lastExitFillMs = toNum(lastExitFill && (lastExitFill.exec_bar_close_time_utc_ms || lastExitFill.signal_bar_close_time_utc_ms))
      ?? parseMs(lastExitFill && lastExitFill.created_at);
    const realizedTradeRow = realizedTradeRows[realizedTradeRows.length - 1] || null;
    const tradeClosedAtMs = toNum(realizedTradeRow && (realizedTradeRow.close_ms || realizedTradeRow.exec_bar_close_time_utc_ms))
      ?? lastExitFillMs;
    const tradeOpenAtMs = toNum((tradeRows[0] || tradeRow) && (tradeRows[0] || tradeRow).open_ms);
    const realizedPnlValues = realizedTradeRows.map((row) => resolveTradePnlQuote(row)).filter((value) => Number.isFinite(value));
    const realizedPnlQuote = realizedPnlValues.length
      ? realizedPnlValues.reduce((acc, value) => acc + value, 0)
      : null;
    const realizedNotionalValues = realizedTradeRows.map((row) => toNum(row && row.notional_krw)).filter((value) => Number.isFinite(value));
    const realizedNotional = realizedNotionalValues.length
      ? realizedNotionalValues.reduce((acc, value) => acc + value, 0)
      : null;
    const tradeRetFallback = (() => {
      const tradeRetValues = realizedTradeRows.map((row) => resolveTradeRetNet(row)).filter((value) => Number.isFinite(value));
      if (tradeRetValues.length) return tradeRetValues.reduce((acc, value) => acc + value, 0) / tradeRetValues.length;
      return null;
    })();
    const exitFillPnlValues = exitFills.map((row) => resolveFillPnlQuote(row)).filter((value) => Number.isFinite(value));
    const exitFillPnlQuote = exitFillPnlValues.length
      ? exitFillPnlValues.reduce((acc, value) => acc + value, 0)
      : null;
    const exitFillNotionalValues = exitFills
      .map((row) => toNum(row && row.notional_krw) ?? toNum(row && row.notional))
      .filter((value) => Number.isFinite(value) && value > 0);
    const exitFillNotional = exitFillNotionalValues.length
      ? exitFillNotionalValues.reduce((acc, value) => acc + value, 0)
      : null;
    const exitFillRetFallback = (() => {
      const fillRetValues = exitFills.map((row) => resolveFillRetNet(row)).filter((value) => Number.isFinite(value));
      if (fillRetValues.length) return fillRetValues.reduce((acc, value) => acc + value, 0) / fillRetValues.length;
      return null;
    })();
    const priceMoveRetFallback = estimateRetNetFromFillPrices({
      side: resolveSide(baseRow),
      entryFill,
      exitFills,
    });
    let realizedRetNet = null;
    let realizedSource = null;
    if (Number.isFinite(realizedNotional) && realizedNotional > 0 && Number.isFinite(realizedPnlQuote)) {
      realizedRetNet = (realizedPnlQuote / realizedNotional);
      realizedSource = "TRADE_PNL";
    } else if (tradeRetFallback != null) {
      realizedRetNet = tradeRetFallback;
      realizedSource = "TRADE_RET";
    } else if (Number.isFinite(exitFillNotional) && exitFillNotional > 0 && Number.isFinite(exitFillPnlQuote)) {
      realizedRetNet = (exitFillPnlQuote / exitFillNotional);
      realizedSource = "EXIT_FILL_PNL";
    } else if (exitFillRetFallback != null) {
      realizedRetNet = exitFillRetFallback;
      realizedSource = "EXIT_FILL_RET";
    } else if (Number.isFinite(priceMoveRetFallback)) {
      realizedRetNet = priceMoveRetFallback;
      realizedSource = "PRICE_MOVE_ESTIMATE";
    } else if (matchedChainRow && Number.isFinite(toNum(matchedChainRow.realized_ret_net))) {
      realizedRetNet = toNum(matchedChainRow.realized_ret_net);
      realizedSource = "QUALITY_CHAIN";
    } else if (evResolvedCounterfactual && Number.isFinite(toNum(evResolvedCounterfactual.realizedRetNet))) {
      realizedRetNet = toNum(evResolvedCounterfactual.realizedRetNet);
      realizedSource = "EV_TUNER_COUNTERFACTUAL";
    } else if (hasChainExitEvidence(matchedChainRow)) {
      const featureRetFallback = resolveFeatureRetNet(baseRow, features);
      if (Number.isFinite(featureRetFallback)) {
        realizedRetNet = featureRetFallback;
        realizedSource = "ENTRY_FEATURE_RET";
      }
    }
    const realizedPnlQuoteFinal = realizedPnlQuote ?? exitFillPnlQuote ?? toNum(evResolvedCounterfactual && evResolvedCounterfactual.realizedPnlQuote);

    const holdStartMs = Number.isFinite(fillCreatedAtMs) ? fillCreatedAtMs : tradeOpenAtMs;
    const holdMinutes = Number.isFinite(holdStartMs) && Number.isFinite(tradeClosedAtMs)
      ? ((tradeClosedAtMs - holdStartMs) / 60000)
      : null;
    const verdicts = resolveVerdictByStage(dropStageKey, features, hasTrade || hasFill);
    const tradeExitKind = classifyExitEvent(realizedTradeRow && (realizedTradeRow.exit_event || realizedTradeRow.event));
    const outcomeState = resolveOutcomeState({
      sourceRowType,
      event,
      entryEventId,
      realizedRetNet,
      fillsN: bucket.fills.length,
      tradesN: tradeRows.length,
      exitFillsN: exitFills.length,
      realizedTradesN: realizedTradeRows.length,
      chainRow: matchedChainRow,
    });
    const featuresWithIdentity = mergeFeatures(features, {
      entry_event_id: entryEventId,
      entry_signal_type: event,
      signal_id: signalId,
      signal_key: signalKey,
    });

    return {
      signal_id: signalId,
      signal_key: signalKey,
      provider: resolveProvider(baseRow),
      market: resolveMarket(baseRow),
      tf: resolveTf(baseRow),
      side: resolveSide(baseRow),
      event,
      entry_event_id: entryEventId,
      signal_bar_close_time_utc_ms: resolveSignalBarCloseMs(baseRow),
      source_row_type: sourceRowType,

      features_json: Object.keys(featuresWithIdentity).length ? featuresWithIdentity : null,
      entry_grade: String(
        features.entry_grade
        || features.entry_tier
        || event
        || ""
      ).trim().toUpperCase() || null,
      market_state_summary_state: String(features.market_state_summary_state || "").trim().toUpperCase() || null,
      market_state_summary_action: String(features.market_state_summary_action || "").trim().toUpperCase() || null,
      febt_mode: String(features.febt_mode || "").trim().toUpperCase() || null,
      febt_phase: String(features.febt_phase || "").trim().toUpperCase() || null,
      febt_calc_ok: features.febt_calc_ok === true,
      febt_timing_action: String(features.febt_timing_action || "").trim().toUpperCase() || null,
      febt_authority: String(features.febt_authority || "").trim().toUpperCase() || null,
      febt_lock_score: toNum(features.febt_lock_score),
      febt_delay_cost: toNum(features.febt_delay_cost),
      febt_late_risk: toNum(features.febt_late_risk),
      febt_failure_risk: toNum(features.febt_failure_risk),
      febt_edge: toNum(features.febt_edge),

      integrity_verdict: verdicts.integrity_verdict,
      quality_verdict: verdicts.quality_verdict,
      state_soft_sizing_verdict: verdicts.state_soft_sizing_verdict,
      ev_verdict: verdicts.ev_verdict,
      wait_verdict: verdicts.wait_verdict,
      drop_stage_key: dropStageKey,
      drop_reason: dropReason,
      fallback_reason: fallbackReason,

      intent_created_at_ms: parseMs(latestIntent && latestIntent.created_at),
      fill_created_at_ms: fillCreatedAtMs,
      trade_closed_at_ms: tradeClosedAtMs,
      fill_status: hasFill ? "FILLED" : intentStatus,
      partial_fill: partialFill,
      reject_reason: resolveRejectReason(latestIntent),

      tp1_first: tp1First,
      sl_first: slFirst,
      mfe_pct: null,
      mae_pct: null,
      realized_ret_net: realizedRetNet,
      realized_pnl_quote: realizedPnlQuoteFinal,
      realized_source: realizedSource,
      outcome_state: outcomeState,
      hold_minutes: holdMinutes,

      chain_realized: matchedChainRow ? (matchedChainRow.realized === true || Number.isFinite(realizedRetNet)) : Number.isFinite(realizedRetNet),
      chain_first_exit_kind: matchedChainRow ? matchedChainRow.first_exit_kind || null : tradeExitKind,
      chain_tp1_hit: matchedChainRow ? matchedChainRow.tp1_hit === true : tp1First,
      chain_sl_before_tp1: matchedChainRow ? matchedChainRow.sl_before_tp1 === true : slFirst,
      chain_trail_after_tp1: matchedChainRow ? matchedChainRow.trail_after_tp1 === true : false,
      intent_status: intentStatus,
      fills_n: bucket.fills.length,
      trades_n: tradeRows.length,
      drops_n: bucket.drops.length,
    };
  }).filter(Boolean);

  rows.sort((a, b) => {
    const ams = Number(a.signal_bar_close_time_utc_ms || 0);
    const bms = Number(b.signal_bar_close_time_utc_ms || 0);
    if (ams !== bms) return ams - bms;
    return String(a.signal_key || "").localeCompare(String(b.signal_key || ""));
  });
  return rows;
}

function summarizeBestSelfEvolutionDataset(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  const resolveActiveFamily = (row) => resolveActiveEntryFamily(row, resolveFeatures(row), row && row.side);
  const resolveLegacyFamily = (row) => resolveLegacyEntryFamily(row, resolveFeatures(row), row && row.side);
  const resolveCanonicalEvent = (row) => canonicalExternalEntryEvent(row, row && row.side) || toUpper(row && row.event, "UNKNOWN");
  const executedRows = scoped.filter((row) => row.source_row_type === "EXECUTED" || row.source_row_type === "PARTIAL" || row.source_row_type === "FALLBACK");
  const realizedRows = executedRows.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const allRealizedRows = scoped.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const withFeatures = scoped.filter((row) => row.features_json && typeof row.features_json === "object");
  const hasFebt = (row) => {
    const features = resolveFeatures(row);
    if (!features || typeof features !== "object") return false;
    if (features.febt_payload_missing === true) return false;
    const phase = toUpper(features.febt_phase, "");
    const mode = toUpper(features.febt_mode, "");
    const authority = toUpper(features.febt_authority, "");
    const timingAction = toUpper(features.febt_timing_action, "");
    const calcReason = toUpper(features.febt_calc_reason, "");
    return (
      Number.isFinite(toNum(features.febt_edge))
      || Number.isFinite(toNum(features.febt_lock_score))
      || Number.isFinite(toNum(features.febt_delay_cost))
      || Number.isFinite(toNum(features.febt_late_risk))
      || Number.isFinite(toNum(features.febt_failure_risk))
      || features.febt_calc_ok === true
      || (phase && phase !== "UNKNOWN")
      || (mode && mode !== "UNKNOWN")
      || (authority && authority !== "UNKNOWN")
      || (timingAction && timingAction !== "UNKNOWN")
      || (calcReason && calcReason !== "UNKNOWN")
    );
  };
  const withFebt = scoped.filter((row) => row.features_json && (
    row.features_json.febt_phase !== undefined
    || row.features_json.febt_edge !== undefined
    || row.features_json.febt_lock_score !== undefined
  ));
  const febtEligibleRows = scoped.filter((row) => {
    const rowType = toUpper(row && row.source_row_type, "UNKNOWN");
    const dropStage = toUpper(row && row.drop_stage_key, "");
    if (rowType === "EXIT_ONLY") return false;
    if (hasFebt(row)) return true;
    if (["EXECUTED", "PARTIAL", "FALLBACK", "MISSED", "REJECTED"].includes(rowType)) return true;
    if (rowType === "DROP" && ["EV", "TIMING", "OPS", "FILLED"].includes(dropStage)) return true;
    return false;
  });
  const hasFebtContractEvidence = (row) => {
    const features = resolveFeatures(row);
    const waitAction = String(features.wait_one_bar_market_state_action || features.legacy_wait_action || "").trim();
    return (
      hasFebt(row)
      || features.febt_payload_missing === true
      || hasValue(features.febt_shadow_verdict)
      || hasValue(features.febt_shadow_fallback_reason)
      || hasValue(features.febt_shadow_legacy_wait_action)
      || hasValue(features.febt_calc_reason)
      || hasValue(features.febt_mode)
      || hasValue(features.febt_phase)
      || hasValue(waitAction)
      || toUpper(row && row.drop_stage_key, "") === "TIMING"
    );
  };
  const nullRealizedExecuted = executedRows.filter((row) => !Number.isFinite(toNum(row.realized_ret_net)));
  const pendingEntryRows = nullRealizedExecuted.filter((row) => !String(row.event || "").toUpperCase().startsWith("EXIT_"));
  const pendingEntryExecuted = pendingEntryRows.filter((row) => {
    const rowType = toUpper(row && row.source_row_type, "UNKNOWN");
    return rowType === "EXECUTED" || rowType === "PARTIAL";
  });
  const pendingEntryFallback = pendingEntryRows.filter((row) => toUpper(row && row.source_row_type, "UNKNOWN") === "FALLBACK");
  const activeEntryRows = scoped.filter((row) => resolveActiveFamily(row));
  const legacyEntryRows = scoped.filter((row) => resolveLegacyFamily(row));
  const febtActiveEligibleRows = scoped.filter((row) => resolveActiveFamily(row) && hasFebtContractEvidence(row));
  const pendingEntryFallbackActive = pendingEntryFallback.filter((row) => resolveActiveFamily(row));
  const pendingEntryFallbackLegacy = pendingEntryFallback.filter((row) => resolveLegacyFamily(row));
  const pendingEntryFallbackPayloadMissing = pendingEntryFallback.filter((row) => toUpper(row && row.fallback_reason, "") === "PAYLOAD_MISSING");
  const pendingEntryFallbackPayloadMissingLinked = pendingEntryFallbackPayloadMissing.filter((row) => (
    hasValue(row && row.entry_event_id)
    || Number(row && row.fills_n || 0) > 0
    || Number(row && row.trades_n || 0) > 0
  ));
  const executedExitOnly = scoped.filter((row) => row.source_row_type === "EXIT_ONLY");
  const realizedSourceCounts = countBy(realizedRows.filter((row) => row.realized_source), (row) => row.realized_source);
  const allRealizedSourceCounts = countBy(allRealizedRows.filter((row) => row.realized_source), (row) => row.realized_source);
  const evCounterfactualRows = allRealizedRows.filter((row) => row.realized_source === "EV_TUNER_COUNTERFACTUAL");
  const coverageByGroup = (items = [], keyFn) => countBy(items, keyFn).map((row) => {
    const subset = items.filter((item) => {
      const value = keyFn(item);
      return (value == null ? "N/A" : value) === row.key;
    });
    const subsetWithFebt = subset.filter((item) => hasFebt(item));
    return {
      key: row.key,
      eligible_n: subset.length,
      with_febt_n: subsetWithFebt.length,
      coverage_rate: subset.length > 0 ? (subsetWithFebt.length / subset.length) : null,
    };
  });
  const summarizeCoverageGap = (rows = [], { minEligible = 5 } = {}) => {
    const qualified = (Array.isArray(rows) ? rows : [])
      .filter((row) => Number(row && row.eligible_n || 0) >= minEligible && row && row.coverage_rate != null)
      .slice()
      .sort((a, b) => {
        const diff = Number(a.coverage_rate) - Number(b.coverage_rate);
        if (diff !== 0) return diff;
        return Number(b.eligible_n || 0) - Number(a.eligible_n || 0);
      });
    if (qualified.length < 2) return null;
    const lowest = qualified[0];
    const highest = qualified[qualified.length - 1];
    const gap = Number(highest.coverage_rate) - Number(lowest.coverage_rate);
    if (!(gap > 0)) return null;
    return {
      low_key: lowest.key,
      low_eligible_n: lowest.eligible_n,
      low_with_febt_n: lowest.with_febt_n,
      low_coverage_rate: lowest.coverage_rate,
      high_key: highest.key,
      high_eligible_n: highest.eligible_n,
      high_with_febt_n: highest.with_febt_n,
      high_coverage_rate: highest.coverage_rate,
      coverage_gap: gap,
      min_eligible_n: minEligible,
    };
  };
  const classifyPayloadMissingCause = (row) => {
    const features = resolveFeatures(row);
    if (features && features._febt_trace_contract_missing === true) return "TRACE_CONTRACT_MISSING";
    if (!features || !Object.keys(features).length) return "FEATURES_OBJECT_MISSING";
    if (!hasValue(resolveSignalId(row)) && !hasValue(resolveEntryEventId(row))) return "IDENTITY_MISSING";
    if (Number(row && row.fills_n || 0) > 0 || Number(row && row.trades_n || 0) > 0 || hasValue(row && row.entry_event_id)) {
      return "LINKED_EXECUTION_ONLY";
    }
    if (resolveActiveFamily(row)) return "ACTIVE_UPSTREAM_PAYLOAD_INCOMPLETE";
    if (resolveLegacyFamily(row)) return "LEGACY_UPSTREAM_PAYLOAD_INCOMPLETE";
    return "UPSTREAM_PAYLOAD_INCOMPLETE";
  };
  const febtEligibleByCanonicalEvent = coverageByGroup(febtEligibleRows, (row) => resolveCanonicalEvent(row)).slice(0, 12);
  const febtActiveEligibleByEvent = coverageByGroup(febtActiveEligibleRows, (row) => resolveCanonicalEvent(row)).slice(0, 10);
  const febtActiveCoverageGapByEvent = summarizeCoverageGap(febtActiveEligibleByEvent, { minEligible: 5 });
  const febtActiveLowCoverageEvents = febtActiveEligibleByEvent
    .filter((row) => Number(row && row.eligible_n || 0) >= 5 && Number(row && row.coverage_rate || 0) < 0.5)
    .slice(0, 5);

  return {
    rows_n: scoped.length,
    executed_n: scoped.filter((row) => row.source_row_type === "EXECUTED").length,
    drop_n: scoped.filter((row) => row.source_row_type === "DROP").length,
    missed_n: scoped.filter((row) => row.source_row_type === "MISSED").length,
    fallback_n: scoped.filter((row) => row.source_row_type === "FALLBACK").length,
    rejected_n: scoped.filter((row) => row.source_row_type === "REJECTED").length,
    partial_n: scoped.filter((row) => row.source_row_type === "PARTIAL").length,
    exit_only_n: scoped.filter((row) => row.source_row_type === "EXIT_ONLY").length,
    realized_n: realizedRows.length,
    all_realized_n: allRealizedRows.length,
    entry_pending_total_n: pendingEntryRows.length,
    entry_executed_null_realized_n: pendingEntryExecuted.length,
    entry_fallback_pending_n: pendingEntryFallback.length,
    entry_exit_present_unlabeled_n: pendingEntryExecuted.filter((row) => row.outcome_state === "EXIT_PRESENT_UNLABELED").length,
    entry_open_pending_n: pendingEntryExecuted.filter((row) => row.outcome_state === "OPEN_PENDING").length,
    entry_link_missing_n: pendingEntryExecuted.filter((row) => row.outcome_state === "LINK_MISSING").length,
    entry_fallback_pending_by_reason: countBy(pendingEntryFallback, (row) => row.fallback_reason).slice(0, 10),
    entry_fallback_pending_by_market: countBy(pendingEntryFallback, (row) => row.market).slice(0, 10),
    entry_fallback_pending_by_event: countBy(pendingEntryFallback, (row) => row.event).slice(0, 10),
    entry_fallback_payload_missing_n: pendingEntryFallbackPayloadMissing.length,
    entry_fallback_payload_missing_linked_n: pendingEntryFallbackPayloadMissingLinked.length,
    entry_fallback_payload_missing_by_cause: countBy(pendingEntryFallbackPayloadMissing, classifyPayloadMissingCause).slice(0, 10),
    entry_fallback_payload_missing_by_market: countBy(pendingEntryFallbackPayloadMissing, (row) => row.market).slice(0, 10),
    entry_fallback_payload_missing_by_event: countBy(pendingEntryFallbackPayloadMissing, (row) => resolveCanonicalEvent(row)).slice(0, 10),
    entry_fallback_payload_missing_by_family: countBy(pendingEntryFallbackPayloadMissing, (row) => resolveActiveFamily(row) || resolveLegacyFamily(row)).slice(0, 10),
    entry_fallback_pending_active_n: pendingEntryFallbackActive.length,
    entry_fallback_pending_active_by_market: countBy(pendingEntryFallbackActive, (row) => row.market).slice(0, 10),
    entry_fallback_pending_active_by_event: countBy(pendingEntryFallbackActive, (row) => resolveCanonicalEvent(row)).slice(0, 10),
    entry_fallback_pending_active_by_family: countBy(pendingEntryFallbackActive, (row) => resolveActiveFamily(row)).slice(0, 10),
    entry_fallback_pending_legacy_n: pendingEntryFallbackLegacy.length,
    entry_fallback_pending_legacy_by_family: countBy(pendingEntryFallbackLegacy, (row) => resolveLegacyFamily(row)).slice(0, 10),
    executed_exit_only_n: executedExitOnly.length,
    features_coverage_rate: scoped.length > 0 ? (withFeatures.length / scoped.length) : null,
    febt_coverage_rate: scoped.length > 0 ? (withFebt.length / scoped.length) : null,
    febt_eligible_n: febtEligibleRows.length,
    febt_coverage_rate_eligible: febtEligibleRows.length > 0 ? (withFebt.length / febtEligibleRows.length) : null,
    febt_eligible_by_market: coverageByGroup(febtEligibleRows, (row) => row.market).slice(0, 10),
    febt_eligible_by_event: coverageByGroup(febtEligibleRows, (row) => row.event).slice(0, 12),
    febt_eligible_by_canonical_event: febtEligibleByCanonicalEvent,
    febt_active_eligible_n: febtActiveEligibleRows.length,
    febt_coverage_rate_active_eligible: febtActiveEligibleRows.length > 0
      ? (febtActiveEligibleRows.filter((row) => hasFebt(row)).length / febtActiveEligibleRows.length)
      : null,
    febt_active_missing_n: febtActiveEligibleRows.filter((row) => !hasFebt(row)).length,
    febt_active_eligible_by_event: febtActiveEligibleByEvent,
    febt_active_eligible_by_market: coverageByGroup(febtActiveEligibleRows, (row) => row.market).slice(0, 10),
    febt_active_eligible_by_family: coverageByGroup(febtActiveEligibleRows, (row) => resolveActiveFamily(row)).slice(0, 10),
    febt_active_coverage_gap_by_event: febtActiveCoverageGapByEvent,
    febt_active_low_coverage_events: febtActiveLowCoverageEvents,
    avg_realized_ret_net: mean(realizedRows.map((row) => row.realized_ret_net)),
    avg_realized_pnl_quote: mean(realizedRows.map((row) => row.realized_pnl_quote)),
    avg_hold_minutes: mean(executedRows.map((row) => row.hold_minutes)),
    active_entry_n: activeEntryRows.length,
    legacy_entry_n: legacyEntryRows.length,
    active_entry_family_counts: countBy(activeEntryRows, (row) => resolveActiveFamily(row)).slice(0, 10),
    legacy_entry_family_counts: countBy(legacyEntryRows, (row) => resolveLegacyFamily(row)).slice(0, 10),
    by_source_row_type: countBy(scoped, (row) => row.source_row_type),
    by_market: countBy(scoped, (row) => row.market),
    by_side: countBy(scoped, (row) => row.side),
    by_event: countBy(scoped, (row) => row.event),
    by_outcome_state: countBy(scoped, (row) => row.outcome_state),
    by_drop_stage: countBy(scoped.filter((row) => row.drop_stage_key), (row) => row.drop_stage_key),
    by_drop_reason: countBy(scoped.filter((row) => row.drop_reason), (row) => row.drop_reason).slice(0, 20),
    by_fallback_reason: countBy(scoped.filter((row) => row.fallback_reason), (row) => row.fallback_reason).slice(0, 20),
    realized_source_counts: realizedSourceCounts,
    all_realized_source_counts: allRealizedSourceCounts,
    ev_counterfactual_n: evCounterfactualRows.length,
  };
}

function summarizeExitOnlyDiagnostics(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  const realizedRows = scoped.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  return {
    rows_n: scoped.length,
    realized_n: realizedRows.length,
    by_event: countBy(scoped, (row) => row.event),
    by_outcome_state: countBy(scoped, (row) => row.outcome_state),
    realized_source_counts: countBy(realizedRows.filter((row) => row.realized_source), (row) => row.realized_source),
  };
}

async function buildBestSelfEvolutionDataset({
  signals = [],
  drops = [],
  intents = [],
  fills = [],
  trades = [],
  provider = null,
  tf = null,
  fromMs = null,
  toMs = null,
  evTunerReport = null,
} = {}) {
  const quality = await summarizePineSignalQuality({
    signals,
    fills,
    intents,
    exchange: provider,
    tf,
    fromMs,
    toMs,
  });
  const rows = buildUnifiedLearningRows({
    signals,
    drops,
    intents,
    fills,
    trades,
    provider,
    tf,
    fromMs,
    toMs,
    qualitySummary: quality,
    evTunerReport,
  });
  const exitOnlyRows = rows.filter((row) => row.source_row_type === "EXIT_ONLY");
  const learningRows = rows.filter((row) => row.source_row_type !== "EXIT_ONLY");
  const learningSummary = summarizeBestSelfEvolutionDataset(learningRows);
  const exitOnlySummary = summarizeExitOnlyDiagnostics(exitOnlyRows);
  return {
    quality,
    rows: learningRows,
    exit_only_rows: exitOnlyRows,
    summary: {
      ...learningSummary,
      executed_exit_only_n: exitOnlySummary.rows_n,
      exit_only_n: exitOnlySummary.rows_n,
      exit_only_realized_n: exitOnlySummary.realized_n,
      exit_only_by_event: exitOnlySummary.by_event,
      exit_only_by_outcome_state: exitOnlySummary.by_outcome_state,
      exit_only_realized_source_counts: exitOnlySummary.realized_source_counts,
    },
  };
}

module.exports = {
  buildBestSelfEvolutionDataset,
  buildUnifiedLearningRows,
  summarizeBestSelfEvolutionDataset,
  __test: {
    buildCompositeSignalKey,
    buildEntryEventId,
    resolveSourceSignalKeyFromEntryEventId,
    resolveSourceSignalKeyFromSignalId,
    resolveSyntheticEntryEventId,
    normalizeEntryEventId,
    buildDropStageKey,
    resolveVerdictByStage,
    classifyExitEvent,
    isRealizedTradeRow,
    summarizeExitOnlyDiagnostics,
    buildEvResolvedCounterfactualMap,
  },
};
