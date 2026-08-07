"use strict";

const fs = require("fs");

const { normalizeSignalForV3, evaluateV3SignalPolicy } = require("./signalPolicy");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function readExistingQueueIds(queuePath) {
  try {
    const raw = fs.readFileSync(queuePath, "utf8");
    const ids = new Set();
    raw.split(/\r?\n/).forEach((line) => {
      const text = line.trim();
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        const id = trimOrNull(parsed && parsed.signal_id);
        if (id) ids.add(id);
      } catch (_) {
        // ignore malformed old rows
      }
    });
    return ids;
  } catch (_) {
    return new Set();
  }
}

function appendQueueRows(queuePath, rows = []) {
  if (!rows.length) return 0;
  const existingIds = readExistingQueueIds(queuePath);
  const payloads = [];
  for (const row of rows) {
    const id = trimOrNull(row && row.signal_id);
    if (!id || existingIds.has(id)) continue;
    payloads.push(JSON.stringify(row));
    existingIds.add(id);
  }
  if (!payloads.length) return 0;
  fs.appendFileSync(queuePath, `${payloads.join("\n")}\n`);
  return payloads.length;
}

function incrementCounter(map, key) {
  map[key] = Number(map[key] || 0) + 1;
}

function sortRowsByCreatedAtDesc(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const aMs = Date.parse(String(a && a.created_at || ""));
    const bMs = Date.parse(String(b && b.created_at || ""));
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  });
}

function buildV3LocalPaperLaneReport(signalRows = [], { queuePath = null } = {}) {
  const normalized = [];
  const allowed = [];
  const activeAllowed = [];
  const shadowAllowed = [];
  const blocked = [];
  const blockedReasonCounts = Object.create(null);

  for (const row of Array.isArray(signalRows) ? signalRows : []) {
    const signal = normalizeSignalForV3(row);
    const verdict = evaluateV3SignalPolicy(signal);
    const entry = Object.freeze({ ...signal, verdict });
    normalized.push(entry);
    if (verdict.ok) {
      allowed.push(entry);
      if (verdict.apply_mode === "SHADOW_ONLY") shadowAllowed.push(entry);
      else activeAllowed.push(entry);
    }
    else {
      blocked.push(entry);
      incrementCounter(blockedReasonCounts, verdict.reason);
    }
  }

  const queueRows = activeAllowed.map((row) => Object.freeze({
    signal_id: row.signal_id,
    created_at: row.created_at,
    symbol: row.symbol,
    exchange: row.exchange,
    tf: row.tf,
    side: row.side,
    setup_type: row.setup_type,
    structural_regime: row.verdict && row.verdict.cohort_context ? row.verdict.cohort_context.structural_regime : row.structural_regime,
    edge_cohort: row.verdict && row.verdict.cohort_context ? row.verdict.cohort_context.edge_cohort : row.edge_cohort,
    cohort_key: row.verdict ? row.verdict.cohort_key : null,
    profile_id: row.verdict ? row.verdict.profile_id : null,
    trigger_type: row.trigger_type,
    entry_grade: row.entry_grade,
    market_state: row.market_state,
    htf_bias: row.htf_bias,
    opportunity_score: row.opportunity_score,
    confidence: row.confidence,
    setup_quality_score: row.setup_quality_score,
    structure_alignment: row.structure_alignment,
    htf_alignment_score: row.htf_alignment_score,
    market_quality_score: row.market_quality_score,
    spread_bps: row.spread_bps,
    funding_rate: row.funding_rate,
    btc_1h_trend: row.btc_1h_trend,
    mtf_1h_direction: row.mtf_1h_direction,
    feature_lineage_source: row.feature_lineage_source,
    rr: row.rr,
    signal_price: row.signal_price,
    stop_price: row.stop_price,
    target_price: row.target_price,
    decision_reason: "V3_SIGNAL_ALLOWED",
  }));

  const shadowRows = shadowAllowed.map((row) => Object.freeze({
    signal_id: row.signal_id,
    created_at: row.created_at,
    symbol: row.symbol,
    exchange: row.exchange,
    tf: row.tf,
    side: row.side,
    setup_type: row.setup_type,
    structural_regime: row.verdict && row.verdict.cohort_context ? row.verdict.cohort_context.structural_regime : row.structural_regime,
    edge_cohort: row.verdict && row.verdict.cohort_context ? row.verdict.cohort_context.edge_cohort : row.edge_cohort,
    cohort_key: row.verdict ? row.verdict.cohort_key : null,
    profile_id: row.verdict ? row.verdict.profile_id : null,
    trigger_type: row.trigger_type,
    entry_grade: row.entry_grade,
    market_state: row.market_state,
    htf_bias: row.htf_bias,
    opportunity_score: row.opportunity_score,
    confidence: row.confidence,
    setup_quality_score: row.setup_quality_score,
    structure_alignment: row.structure_alignment,
    htf_alignment_score: row.htf_alignment_score,
    market_quality_score: row.market_quality_score,
    spread_bps: row.spread_bps,
    funding_rate: row.funding_rate,
    btc_1h_trend: row.btc_1h_trend,
    mtf_1h_direction: row.mtf_1h_direction,
    feature_lineage_source: row.feature_lineage_source,
    rr: row.rr,
    signal_price: row.signal_price,
    stop_price: row.stop_price,
    target_price: row.target_price,
    decision_reason: "V3_SIGNAL_ALLOWED_SHADOW",
  }));

  const appendedQueueN = queuePath ? appendQueueRows(queuePath, queueRows) : 0;

  return Object.freeze({
    ok: true,
    source_signal_n: normalized.length,
    allowed_signal_n: allowed.length,
    active_signal_n: activeAllowed.length,
    shadow_signal_n: shadowAllowed.length,
    blocked_signal_n: blocked.length,
    appended_queue_n: appendedQueueN,
    blocked_reason_counts: Object.freeze(blockedReasonCounts),
    allowed_signals: Object.freeze(sortRowsByCreatedAtDesc(queueRows).slice(0, 50)),
    shadow_signals: Object.freeze(sortRowsByCreatedAtDesc(shadowRows).slice(0, 50)),
  });
}

module.exports = Object.freeze({
  buildV3LocalPaperLaneReport,
});
