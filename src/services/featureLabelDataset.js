"use strict";

const crypto = require("crypto");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { resolveRegimeRecord } = require("../utils/regime");
const { fetchRecentImmutableFills, buildTradesFromFillsWithFunding } = require("./tradesFromFills");
const { labelOutcome } = require("./outcomeLabeler");

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildStableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function buildRowProvenance({
  exchange = null,
  market = null,
  tf = null,
  trade = null,
} = {}) {
  const item = trade && typeof trade === "object" ? trade : {};
  const sourceEventRefs = Array.isArray(item.source_event_refs)
    ? item.source_event_refs
        .map((row) => ({
          unified_event_id: row && row.unified_event_id ? String(row.unified_event_id).trim() : null,
          source_document_id: row && row.source_document_id ? String(row.source_document_id).trim() : null,
          event_kind: row && row.event_kind ? String(row.event_kind).trim().toUpperCase() : null,
          ts_ms: toNum(row && row.ts_ms),
        }))
        .filter((row) => row.unified_event_id)
    : [];
  const sourceEventIds = []
    .concat(Array.isArray(item.source_event_ids) ? item.source_event_ids : [])
    .concat(Array.isArray(item.fill_ids) ? item.fill_ids : [])
    .concat(Array.isArray(item.source_fill_ids) ? item.source_fill_ids : [])
    .concat(sourceEventRefs.map((row) => row.unified_event_id))
    .filter(Boolean);
  return {
    provenance_version: "FEATURE_LABEL_PROVENANCE_V2",
    source_collection: "UNIFIED_EVENT_TIMELINE",
    immutable_source: true,
    strict_event_truth_only: true,
    exchange: String(exchange || "").toUpperCase() || null,
    market: String(market || "").toUpperCase() || null,
    tf: String(tf || "").trim() || null,
    entry_event_id: item.entry_event_id || null,
    source_event_ids: [...new Set(sourceEventIds)],
    source_event_refs: sourceEventRefs,
    source_event_manifest_hash: buildStableHash(sourceEventRefs),
    source_trade_hash: buildStableHash({
      exchange: String(exchange || "").toUpperCase() || null,
      market: String(market || "").toUpperCase() || null,
      tf: String(tf || "").trim() || null,
      entry_event_id: item.entry_event_id || null,
      close_ms: toNum(item.close_ms),
      close_type: String(item.close_type || "").trim().toUpperCase() || null,
      pnl_krw_gross: toNum(item.pnl_krw_gross),
      fee_value: toNum(item.fee_value),
      funding_paid: toNum(item.funding_paid),
      notional_krw: toNum(item.notional_krw),
      fill_ids: [...new Set(sourceEventIds)],
      source_event_refs: sourceEventRefs,
    }),
  };
}

function buildDatasetManifest({
  exchange = null,
  markets = [],
  tf = null,
  limitN = null,
  fromMs = null,
  rows = [],
} = {}) {
  const itemRows = Array.isArray(rows) ? rows : [];
  const rowHashes = itemRows.map((row) => ({
    entry_event_id: row.entry_event_id || null,
    close_ms: toNum(row.close_ms),
    row_hash: buildStableHash({
      exchange: row.exchange || null,
      market: row.market || null,
      tf: row.tf || null,
      close_ms: toNum(row.close_ms),
      close_type: row.close_type || null,
      feature_snapshot: row.feature_snapshot || null,
      label_snapshot: row.label_snapshot || null,
      provenance: row.provenance || null,
    }),
  }));
  const sourceEventIds = [...new Set(itemRows.flatMap((row) => (
    row && row.provenance && Array.isArray(row.provenance.source_event_ids)
      ? row.provenance.source_event_ids
      : []
  )).filter(Boolean))];
  const sourceEventRefs = itemRows.flatMap((row) => (
    row && row.provenance && Array.isArray(row.provenance.source_event_refs)
      ? row.provenance.source_event_refs
      : []
  )).filter((row) => row && row.unified_event_id);
  const manifest = {
    manifest_version: "FEATURE_LABEL_PROVENANCE_V2",
    source_collection: "UNIFIED_EVENT_TIMELINE",
    immutable_source: true,
    strict_event_truth_only: true,
    feature_spec_version: "FEATURE_LABEL_FEATURES_V2",
    label_spec_version: "FEATURE_LABEL_OUTCOME_V1",
    exchange: String(exchange || "").toUpperCase() || null,
    markets: (Array.isArray(markets) ? markets : []).map((row) => String(row || "").toUpperCase()).filter(Boolean),
    tf: String(tf || "").trim() || null,
    limit_n: Number(limitN) || null,
    from_ms: Number.isFinite(Number(fromMs)) ? Number(fromMs) : null,
    rows_n: itemRows.length,
    source_event_ids: sourceEventIds,
    source_event_manifest_hash: buildStableHash(sourceEventRefs),
    row_hashes: rowHashes,
  };
  return {
    ...manifest,
    manifest_hash: buildStableHash(manifest),
  };
}

function buildFeatureSnapshot({
  market = null,
  tf = null,
  trade = null,
} = {}) {
  const item = trade && typeof trade === "object" ? trade : {};
  const features = item.features_json && typeof item.features_json === "object" ? item.features_json : {};
  const canonicalRegime = resolveRegimeRecord({
    ...item,
    features_json: features,
  });
  return {
    market: String(market || "").toUpperCase(),
    tf: String(tf || "").trim() || null,
    pnl_krw_gross: toNum(item.pnl_krw_gross),
    fee_value: toNum(item.fee_value),
    funding_paid: toNum(item.funding_paid),
    notional_krw: toNum(item.notional_krw),
    entry_tier: String(
      features.entry_tier
      || features.entry_grade
      || features.signal_tier
      || item.entry_signal_type
      || ""
    ).trim().toUpperCase() || null,
    position_side: String(item.position_side || features.position_side || "").trim().toUpperCase() || null,
    close_type: String(item.close_type || "").trim().toUpperCase() || null,
    exit_event: String(item.exit_event || "").trim().toUpperCase() || null,
    confidence: toNum(features.confidence ?? features.conf ?? features.signal_confidence),
    posterior: toNum(
      features.posterior
      ?? features.long_posterior
      ?? features.short_posterior
      ?? features.buy_posterior
      ?? features.sell_posterior
    ),
    regime: String(
      canonicalRegime
      || features.market_regime
      || features.regime
      || features.pro_regime_state
      || features.regime_state
      || ""
    ).trim().toUpperCase() || null,
    openclaw_market_regime_cohort: String(
      features.openclaw_market_regime_cohort
      || features.market_regime_cohort
      || canonicalRegime
      || ""
    ).trim().toUpperCase() || null,
  };
}

function assertImmutableEventProvenance(rows = []) {
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const provenance = row && row.provenance && typeof row.provenance === "object" ? row.provenance : null;
    const eventIds = provenance && Array.isArray(provenance.source_event_ids) ? provenance.source_event_ids.filter(Boolean) : [];
    const eventRefs = provenance && Array.isArray(provenance.source_event_refs) ? provenance.source_event_refs.filter((item) => item && item.unified_event_id) : [];
    if (!provenance || provenance.immutable_source !== true || provenance.source_collection !== "UNIFIED_EVENT_TIMELINE") {
      throw new Error("FEATURE_LABEL_DATASET_PROVENANCE_SOURCE_INVALID");
    }
    if (!eventIds.length || !eventRefs.length) {
      throw new Error("FEATURE_LABEL_DATASET_PROVENANCE_EVENT_MISSING");
    }
  }
}

async function buildFeatureLabelDataset({
  exchange,
  markets,
  tf = defaultExecTfFromEnv() || "15m",
  limitN = 2000,
  fromMs = null,
} = {}) {
  const rows = [];
  for (const market of (Array.isArray(markets) ? markets : [])) {
    const fills = await fetchRecentImmutableFills({
      exchange,
      symbol: market,
      tf,
      limitN,
      fromMs,
    });
    if (!Array.isArray(fills) || !fills.length) continue;
    const built = await buildTradesFromFillsWithFunding(fills, {
      mode: String(process.env.TRADE_PNL_MODE || "EACH_SELL"),
      exchange,
      symbol: market,
    });
    for (const trade of (built.trades || [])) {
      const outcome = labelOutcome(trade);
      const provenance = buildRowProvenance({
        exchange,
        market,
        tf,
        trade,
      });
      rows.push({
        exchange: String(exchange || "").toUpperCase(),
        market: String(market || "").toUpperCase(),
        tf: String(tf || "").trim() || null,
        close_ms: toNum(trade.close_ms),
        close_type: String(trade.close_type || "").trim().toUpperCase() || null,
        entry_event_id: trade.entry_event_id || null,
        feature_snapshot: buildFeatureSnapshot({ market, tf, trade }),
        label_snapshot: outcome,
        provenance,
      });
    }
  }
  rows.sort((a, b) => Number(a.close_ms || 0) - Number(b.close_ms || 0));
  const strictProvenance = !["0", "false", "off", "no"].includes(String(process.env.FEATURE_LABEL_DATASET_STRICT_EVENT_PROVENANCE || "1").trim().toLowerCase());
  if (strictProvenance) assertImmutableEventProvenance(rows);
  const manifest = buildDatasetManifest({
    exchange,
    markets,
    tf,
    limitN,
    fromMs,
    rows,
  });
  return {
    schema_version: "FEATURE_LABEL_DATASET_V2",
    created_at: new Date().toISOString(),
    source_collection: "UNIFIED_EVENT_TIMELINE",
    immutable_source: true,
    dataset_hash: buildStableHash({
      schema_version: "FEATURE_LABEL_DATASET_V2",
      rows_n: rows.length,
      manifest_hash: manifest.manifest_hash,
      rows,
    }),
    source_manifest: manifest,
    rows_n: rows.length,
    rows,
  };
}

module.exports = {
  buildFeatureLabelDataset,
  __test: {
    buildRowProvenance,
    buildDatasetManifest,
    buildFeatureSnapshot,
    buildStableHash,
    assertImmutableEventProvenance,
  },
};
