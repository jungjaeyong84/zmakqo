"use strict";

function toMs(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toKstString(value) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return null;
  const kst = new Date(ms + (9 * 60 * 60 * 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())} KST`;
}

function pickDocs(input) {
  if (Array.isArray(input)) return input.slice();
  if (input && Array.isArray(input.docs)) return input.docs.slice();
  if (input && Array.isArray(input.rows)) return input.rows.slice();
  if (input && Array.isArray(input.data)) return input.data.slice();
  return [];
}

function sourceOf(row) {
  if (!row || typeof row !== "object") return "UNKNOWN";
  const source = String(row.source || "").trim().toUpperCase();
  if (row.authoritative === true || source === "SERVER") return "SERVER";
  if (source === "PINE_SHADOW") return "PINE_SHADOW";
  const reason = String(row.reason || "").trim().toUpperCase();
  if (reason === "TV_WEBHOOK") return "PINE_SHADOW";
  if (reason) return "SERVER";
  return source || "UNKNOWN";
}

function bump(map, key) {
  map.set(key, Number(map.get(key) || 0) + 1);
}

function topRows(map, limit = 5) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(0, limit))
    .map(([key, count]) => ({ key, count }));
}

function driftStatus(paritySummary = {}) {
  const observed = Number(paritySummary.shadow_observed_n);
  const mismatchRate = Number(paritySummary.parity_mismatch_rate);
  if (!Number.isFinite(observed) || observed <= 0) return "NO_SHADOW_OBSERVED";
  if (!Number.isFinite(mismatchRate)) return "PARITY_UNKNOWN";
  if (mismatchRate <= 0.1) return "PARITY_STABLE";
  if (mismatchRate <= 0.3) return "PARITY_WATCH";
  return "PARITY_DRIFT";
}

function executionAuthorityForSourceMode(sourceMode) {
  const mode = String(sourceMode || "").trim().toUpperCase();
  if (mode === "SERVER_PRIMARY") return "SERVER_PRIMARY_AUTHORITATIVE";
  if (mode === "PINE_PRIMARY") return "PINE_PRIMARY_AUTHORITATIVE";
  return "SOURCE_AUTHORITY_UNKNOWN";
}

function pineRoleForSourceMode(sourceMode) {
  const mode = String(sourceMode || "").trim().toUpperCase();
  if (mode === "SERVER_PRIMARY") return "VISUAL_SHADOW_ONLY";
  if (mode === "PINE_PRIMARY") return "EXECUTION_AUTHORITY";
  return "UNKNOWN";
}

function parityClaimForStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized === "PARITY_STABLE" ? "PARITY_STABLE" : "DO_NOT_CLAIM_PINE_SERVER_IDENTICAL";
}

function deriveServerSignalAuthority({ signalsRecent = null, parityReport = null, nowMs = Date.now() } = {}) {
  const docs = pickDocs(signalsRecent);
  const dayAgoMs = Number(nowMs) - (24 * 60 * 60 * 1000);

  let serverN = 0;
  let shadowN = 0;
  let otherN = 0;
  let server24hN = 0;
  let shadow24hN = 0;
  let latestServerMs = null;
  let latestShadowMs = null;
  const byMarketServer = new Map();
  const byMarketShadow = new Map();

  for (const row of docs) {
    const source = sourceOf(row);
    const market = String(row.symbol_or_pair_id || row.symbol || row.market || "UNKNOWN").trim() || "UNKNOWN";
    const createdMs = toMs(row.created_at || row.created_kst || row.bar_close_time_utc_ms);
    if (source === "SERVER") {
      serverN += 1;
      bump(byMarketServer, market);
      if (Number.isFinite(createdMs) && createdMs >= dayAgoMs) server24hN += 1;
      if (!Number.isFinite(latestServerMs) || createdMs > latestServerMs) latestServerMs = createdMs;
    } else if (source === "PINE_SHADOW") {
      shadowN += 1;
      bump(byMarketShadow, market);
      if (Number.isFinite(createdMs) && createdMs >= dayAgoMs) shadow24hN += 1;
      if (!Number.isFinite(latestShadowMs) || createdMs > latestShadowMs) latestShadowMs = createdMs;
    } else {
      otherN += 1;
    }
  }

  const paritySummary = (parityReport && parityReport.summary) || {};
  const sourceMode = paritySummary.source_mode || null;
  const status = driftStatus(paritySummary);
  const summary = {
    docs_n: docs.length,
    authoritative_server_n: serverN,
    pine_shadow_n: shadowN,
    other_source_n: otherN,
    authoritative_server_24h_n: server24hN,
    pine_shadow_24h_n: shadow24hN,
    latest_authoritative_signal_at_kst: toKstString(latestServerMs),
    latest_shadow_signal_at_kst: toKstString(latestShadowMs),
    parity_match_n: Number(paritySummary.parity_match_n) || 0,
    parity_mismatch_n: Number(paritySummary.parity_mismatch_n) || 0,
    parity_mismatch_rate: Number.isFinite(Number(paritySummary.parity_mismatch_rate)) ? Number(paritySummary.parity_mismatch_rate) : null,
    shadow_observed_n: Number(paritySummary.shadow_observed_n) || 0,
    source_parity_match_n: Number(paritySummary.source_parity_match_n) || 0,
    source_parity_mismatch_n: Number(paritySummary.source_parity_mismatch_n) || 0,
    source_mode: sourceMode,
    execution_authority: executionAuthorityForSourceMode(sourceMode),
    pine_role: pineRoleForSourceMode(sourceMode),
    drift_status: status,
    parity_claim: parityClaimForStatus(status),
  };

  return {
    ok: true,
    summary,
    rows: {
      by_market_server: topRows(byMarketServer, 5),
      by_market_shadow: topRows(byMarketShadow, 5),
    },
  };
}

module.exports = {
  deriveServerSignalAuthority,
  sourceOf,
  __test: {
    sourceOf,
    driftStatus,
    executionAuthorityForSourceMode,
    pineRoleForSourceMode,
    parityClaimForStatus,
    toKstString,
  },
};
