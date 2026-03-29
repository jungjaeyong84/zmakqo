"use strict";

const { summarizePineSignalQuality } = require("../services/pineSignalQuality");
const { classifySignalReasonStage } = require("./signalReasonView");

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

function resolveProvider(row) {
  const ex = toUpper(row && row.exchange, "");
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return ex;
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
  const direct = String(
    (row && (row.signal_id || row.signalId || row.signal_doc_id || row.signalDocId))
    || features.signal_id
    || features.signalId
    || ""
  ).trim();
  return direct || null;
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
  const raw = String(entryEventId || "").trim();
  if (!raw) return null;
  const parts = raw.split("__");
  if (parts.length < 6 || parts[0] !== "ENTRY") return null;
  const market = String(parts[2] || "").trim().toUpperCase();
  const tf = String(parts[3] || "").trim();
  const barMs = toNum(parts[4]);
  const event = String(parts.slice(5).join("__") || "").trim().toUpperCase();
  return buildCompositeSignalKey({ market, tf, barMs, event });
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
  const entryEventId = resolveEntryEventId(row);
  const signalId = resolveSignalId(row);
  const signalKey = resolveSignalKey(row);
  const sourceSignalKey = resolveSourceSignalKeyFromEntryEventId(entryEventId);
  const candidates = [signalId, signalKey, sourceSignalKey, entryEventId].filter(Boolean);
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
} = {}) {
  const providerNorm = String(provider || "").trim().toUpperCase();
  const tfNorm = String(tf || "").trim();
  const buckets = [];
  const aliasMap = new Map();

  const inScope = (row) => {
    const rowProvider = resolveProvider(row);
    const rowTf = resolveTf(row);
    const barMs = resolveSignalBarCloseMs(row);
    if (providerNorm && rowProvider && rowProvider !== providerNorm) return false;
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
  const chainByEntryEvent = new Map(
    chainRows
      .filter((row) => row && row.entry_event_id)
      .map((row) => [String(row.entry_event_id).trim(), row])
  );

  const rows = buckets.map((bucket) => {
    const signalRow = bucket.signals[0] || null;
    const dropRow = bucket.drops[0] || null;
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
    const entryFill = entryFills[0] || bucket.fills[0] || null;
    const tradeRow = tradeRows[tradeRows.length - 1] || null;
    const baseRow = signalRow || dropRow || latestIntent || entryFill || tradeRow || null;
    const features = mergeFeatures(
      resolveFeatures(dropRow),
      resolveFeatures(signalRow),
      resolveFeatures(latestIntent),
      resolveFeatures(entryFill),
      resolveFeatures(tradeRow)
    );

    const signalId = resolveSignalId(baseRow);
    const event = resolveEvent(baseRow);
    const entryEventId = resolveEntryEventId(baseRow);
    const signalKey = resolveSignalKey(baseRow) || resolveSourceSignalKeyFromEntryEventId(entryEventId) || signalId || bucket.bucket_id;
    const chainRow = entryEventId ? (chainByEntryEvent.get(entryEventId) || null) : null;

    const dropReason = resolveDropReason(dropRow) || resolveRejectReason(latestIntent);
    const dropStageKey = buildDropStageKey(dropReason);
    const fallbackReason = resolveFallbackReason(features, baseRow);
    const partialFill = tradeRows.some((row) => String(row && row.close_type || "").toUpperCase() === "PARTIAL_CLOSE");
    const intentStatus = resolveIntentStatus(latestIntent);
    const hasFill = bucket.fills.length > 0;
    const hasTrade = tradeRows.length > 0;
    const fallback = hasFallback(features, baseRow);

    let sourceRowType = "MISSED";
    if ((hasTrade || hasFill) && fallback) sourceRowType = "FALLBACK";
    else if (partialFill) sourceRowType = "PARTIAL";
    else if (hasTrade || hasFill) sourceRowType = "EXECUTED";
    else if (dropRow && fallback) sourceRowType = "FALLBACK";
    else if (dropRow) sourceRowType = "DROP";
    else if (intentStatus === "CANCELED" || intentStatus === "REJECTED" || intentStatus === "FAILED") sourceRowType = "REJECTED";

    const exitKinds = exitFills
      .map((row) => ({ kind: classifyExitEvent(row && row.event), ms: toNum(row && row.exec_bar_close_time_utc_ms) }))
      .filter((row) => row.kind);
    const firstTp1Idx = exitKinds.findIndex((row) => row.kind === "TP1");
    const firstSlIdx = exitKinds.findIndex((row) => row.kind === "SL");
    const tp1First = firstTp1Idx >= 0 && (firstSlIdx < 0 || firstTp1Idx < firstSlIdx);
    const slFirst = firstSlIdx >= 0 && (firstTp1Idx < 0 || firstSlIdx < firstTp1Idx);

    const fillCreatedAtMs = parseMs(entryFill && entryFill.created_at);
    const tradeClosedAtMs = toNum(tradeRow && (tradeRow.close_ms || tradeRow.exec_bar_close_time_utc_ms));
    const realizedPnlQuote = tradeRows.length
      ? tradeRows.reduce((acc, row) => acc + (toNum(row && row.pnl_krw) || 0), 0)
      : null;
    const realizedNotional = tradeRows.length
      ? tradeRows.reduce((acc, row) => acc + (toNum(row && row.notional_krw) || 0), 0)
      : null;
    const realizedRetNet = Number.isFinite(realizedNotional) && realizedNotional > 0 && Number.isFinite(realizedPnlQuote)
      ? (realizedPnlQuote / realizedNotional)
      : (chainRow && Number.isFinite(toNum(chainRow.realized_ret_net)) ? toNum(chainRow.realized_ret_net) : null);

    const holdMinutes = Number.isFinite(fillCreatedAtMs) && Number.isFinite(tradeClosedAtMs)
      ? ((tradeClosedAtMs - fillCreatedAtMs) / 60000)
      : null;
    const verdicts = resolveVerdictByStage(dropStageKey, features, hasTrade || hasFill);

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

      features_json: Object.keys(features).length ? features : null,
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
      realized_pnl_quote: realizedPnlQuote,
      hold_minutes: holdMinutes,

      chain_realized: chainRow ? chainRow.realized === true : false,
      chain_first_exit_kind: chainRow ? chainRow.first_exit_kind || null : null,
      chain_tp1_hit: chainRow ? chainRow.tp1_hit === true : false,
      chain_sl_before_tp1: chainRow ? chainRow.sl_before_tp1 === true : false,
      chain_trail_after_tp1: chainRow ? chainRow.trail_after_tp1 === true : false,
      intent_status: intentStatus,
      fills_n: bucket.fills.length,
      trades_n: tradeRows.length,
      drops_n: bucket.drops.length,
    };
  });

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
  const executedRows = scoped.filter((row) => row.source_row_type === "EXECUTED" || row.source_row_type === "PARTIAL" || row.source_row_type === "FALLBACK");
  const realizedRows = scoped.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const withFeatures = scoped.filter((row) => row.features_json && typeof row.features_json === "object");
  const withFebt = scoped.filter((row) => row.features_json && (
    row.features_json.febt_phase !== undefined
    || row.features_json.febt_edge !== undefined
    || row.features_json.febt_lock_score !== undefined
  ));
  return {
    rows_n: scoped.length,
    executed_n: scoped.filter((row) => row.source_row_type === "EXECUTED").length,
    drop_n: scoped.filter((row) => row.source_row_type === "DROP").length,
    missed_n: scoped.filter((row) => row.source_row_type === "MISSED").length,
    fallback_n: scoped.filter((row) => row.source_row_type === "FALLBACK").length,
    rejected_n: scoped.filter((row) => row.source_row_type === "REJECTED").length,
    partial_n: scoped.filter((row) => row.source_row_type === "PARTIAL").length,
    realized_n: realizedRows.length,
    features_coverage_rate: scoped.length > 0 ? (withFeatures.length / scoped.length) : null,
    febt_coverage_rate: scoped.length > 0 ? (withFebt.length / scoped.length) : null,
    avg_realized_ret_net: mean(realizedRows.map((row) => row.realized_ret_net)),
    avg_realized_pnl_quote: mean(realizedRows.map((row) => row.realized_pnl_quote)),
    avg_hold_minutes: mean(executedRows.map((row) => row.hold_minutes)),
    by_source_row_type: countBy(scoped, (row) => row.source_row_type),
    by_market: countBy(scoped, (row) => row.market),
    by_side: countBy(scoped, (row) => row.side),
    by_event: countBy(scoped, (row) => row.event),
    by_drop_stage: countBy(scoped.filter((row) => row.drop_stage_key), (row) => row.drop_stage_key),
    by_drop_reason: countBy(scoped.filter((row) => row.drop_reason), (row) => row.drop_reason).slice(0, 20),
    by_fallback_reason: countBy(scoped.filter((row) => row.fallback_reason), (row) => row.fallback_reason).slice(0, 20),
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
  });
  return {
    quality,
    rows,
    summary: summarizeBestSelfEvolutionDataset(rows),
  };
}

module.exports = {
  buildBestSelfEvolutionDataset,
  buildUnifiedLearningRows,
  summarizeBestSelfEvolutionDataset,
  __test: {
    buildCompositeSignalKey,
    resolveSourceSignalKeyFromEntryEventId,
    buildDropStageKey,
    resolveVerdictByStage,
    classifyExitEvent,
  },
};
