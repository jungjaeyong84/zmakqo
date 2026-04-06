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

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value) {
  const ms = toMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function buildLineageSloDropMonitor({
  signalLineageHealth = null,
  droppedSignals = null,
} = {}) {
  const lineageDoc = signalLineageHealth && typeof signalLineageHealth === "object" ? signalLineageHealth : {};
  const lineageSummary = readSummary(signalLineageHealth);
  const dropsWrapper = droppedSignals && typeof droppedSignals === "object" ? droppedSignals : {};
  const droppedDocs = Array.isArray(dropsWrapper.docs) ? dropsWrapper.docs : [];
  const targetReason = "LINEAGE_SLO_FILL_INTENT_NULL_RATE";
  const lineageGeneratedAtMs = toMs(lineageDoc.generated_at || lineageDoc.generated_at_kst);
  const lineageDrops = droppedDocs
    .filter((row) => String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase() === targetReason)
    .map((row) => ({
      created_at: String(row && row.created_at || "").trim() || null,
      created_at_ms: toMs(row && row.created_at),
      market: String(row && (row.symbol_or_pair_id || row.symbol || row.market) || "").trim().toUpperCase() || null,
      event: String(row && row.event || "").trim().toUpperCase() || null,
    }))
    .sort((a, b) => Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0));

  const postFixDrops = lineageDrops.filter((row) => Number.isFinite(row.created_at_ms) && Number.isFinite(lineageGeneratedAtMs) && row.created_at_ms >= lineageGeneratedAtMs);
  const latestDrop = lineageDrops[0] || null;
  const entryFillIntentNullRate = toNum(
    lineageSummary.entry_fills_intent_id_null_rate != null
      ? lineageSummary.entry_fills_intent_id_null_rate
      : lineageSummary.fills_intent_id_null_rate
  );
  const externalReconciledFillIntentNullN = toNum(lineageSummary.external_reconciled_fills_intent_id_null_n) || 0;

  let evidenceStatus = "LINEAGE_SLO_DROP_MONITOR_READY";
  if (!Number.isFinite(lineageGeneratedAtMs)) evidenceStatus = "LINEAGE_REPORT_TIMESTAMP_MISSING";
  else if (lineageDrops.length === 0) evidenceStatus = "NO_LINEAGE_SLO_DROP_HISTORY";
  else if (postFixDrops.length === 0) evidenceStatus = "AWAITING_POST_FIX_DROP_CACHE";
  else evidenceStatus = "POST_FIX_LINEAGE_SLO_DROP_PRESENT";

  return {
    status: "LINEAGE_SLO_DROP_MONITOR_READY",
    evidence_status: evidenceStatus,
    monitored_reason: targetReason,
    lineage_generated_at: toIso(lineageDoc.generated_at || lineageDoc.generated_at_kst),
    entry_fills_intent_id_null_rate: entryFillIntentNullRate,
    external_reconciled_fills_intent_id_null_n: externalReconciledFillIntentNullN,
    total_lineage_slo_drop_n: lineageDrops.length,
    post_fix_lineage_slo_drop_n: postFixDrops.length,
    pre_fix_lineage_slo_drop_n: Math.max(0, lineageDrops.length - postFixDrops.length),
    latest_lineage_slo_drop_created_at: latestDrop ? latestDrop.created_at : null,
    latest_lineage_slo_drop_market: latestDrop ? latestDrop.market : null,
    latest_lineage_slo_drop_event: latestDrop ? latestDrop.event : null,
    post_fix_verification_ready: Number.isFinite(lineageGeneratedAtMs),
    post_fix_clear: Number.isFinite(lineageGeneratedAtMs) && postFixDrops.length === 0,
  };
}

module.exports = {
  buildLineageSloDropMonitor,
};
