"use strict";

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

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
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

function isExitEvent(event) {
  return toUpper(event).startsWith("EXIT_");
}

function inferEntrySignalTypeFromEvent(event) {
  const ev = toUpper(event);
  if (!ev) return null;
  if (ev.includes("SHORT")) return ev;
  if (ev.includes("LONG")) return ev;
  return null;
}

function resolvePositionSide(row = {}) {
  const ev = toUpper(row.event);
  const side = toUpper(row.side);
  if (isExitEvent(ev)) {
    if (side === "SELL") return "LONG";
    if (side === "BUY") return "SHORT";
    return null;
  }
  if (ev.includes("SHORT")) return "SHORT";
  if (ev.includes("LONG")) return "LONG";
  if (side === "SELL") return "SHORT";
  if (side === "BUY") return "LONG";
  return null;
}

function resolveEntryLineage(row = {}) {
  const features = resolveFeatures(row);
  const entryEventId = String(
    row.entry_event_id
    || row.entryEventId
    || features.entry_event_id
    || ""
  ).trim() || null;
  const entrySignalType = toUpper(
    row.entry_signal_type
    || row.entrySignalType
    || features.entry_signal_type
    || inferEntrySignalTypeFromEvent(row.event)
    || ""
  ) || null;
  const entryGrade = toUpper(
    row.entry_grade
    || features.entry_grade
    || features.entry_timing_tier
    || features.entry_tier
    || ""
  ) || null;
  const entryQtyProfile = toUpper(
    row.entry_qty_profile
    || features.entry_qty_profile
    || features.entry_qty_tier
    || features.qty_profile
    || ""
  ) || null;
  const entrySignalBarMs = toNum(row.signal_bar_close_time_utc_ms) ?? toNum(row.bar_close_time_utc_ms);
  const entryExecBarMs = toNum(row.exec_bar_close_time_utc_ms);
  return {
    entry_event_id: entryEventId,
    entry_signal_type: entrySignalType,
    entry_grade: entryGrade,
    entry_qty_profile: entryQtyProfile,
    entry_signal_bar_ms: Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null,
    entry_exec_bar_ms: Number.isFinite(entryExecBarMs) ? entryExecBarMs : null,
  };
}

function hasLineage(lineage = {}) {
  return !!String(lineage.entry_event_id || "").trim();
}

function buildScopeKey(row = {}) {
  const exchange = toUpper(row.exchange);
  const symbol = toUpper(row.symbol || row.symbol_or_pair_id || row.market);
  const side = resolvePositionSide(row);
  if (!exchange || !symbol || !side) return null;
  return `${exchange}__${symbol}__${side}`;
}

function resolveRowMs(row = {}) {
  return (
    toNum(row.exec_bar_close_time_utc_ms)
    ?? toNum(row.signal_bar_close_time_utc_ms)
    ?? toNum(row.bar_close_time_utc_ms)
    ?? parseMs(row.created_at)
    ?? parseMs(row.updated_at)
    ?? 0
  );
}

function applyLineage(row = {}, lineage = {}) {
  if (!hasLineage(lineage)) return row;
  const out = { ...(row || {}) };
  if (!String(out.entry_event_id || out.entryEventId || "").trim()) out.entry_event_id = lineage.entry_event_id;
  if (!toUpper(out.entry_signal_type || out.entrySignalType || "")) out.entry_signal_type = lineage.entry_signal_type;
  if (!toUpper(out.entry_grade || "")) out.entry_grade = lineage.entry_grade;
  if (!toUpper(out.entry_qty_profile || "")) out.entry_qty_profile = lineage.entry_qty_profile;
  if (!Number.isFinite(toNum(out.signal_bar_close_time_utc_ms)) && Number.isFinite(Number(lineage.entry_signal_bar_ms))) {
    out.signal_bar_close_time_utc_ms = Number(lineage.entry_signal_bar_ms);
  }
  if (out.features_json && typeof out.features_json === "object" && !Array.isArray(out.features_json)) {
    out.features_json = { ...out.features_json };
    if (!String(out.features_json.entry_event_id || "").trim()) out.features_json.entry_event_id = lineage.entry_event_id;
    if (!toUpper(out.features_json.entry_signal_type || "")) out.features_json.entry_signal_type = lineage.entry_signal_type;
    if (!toUpper(out.features_json.entry_grade || "")) out.features_json.entry_grade = lineage.entry_grade;
    if (!toUpper(out.features_json.entry_qty_profile || "")) out.features_json.entry_qty_profile = lineage.entry_qty_profile;
  }
  return out;
}

function backfillRecentEntryLineage(rows = []) {
  const ordered = (Array.isArray(rows) ? rows : []).map((row, index) => ({
    row: row && typeof row === "object" ? row : {},
    index,
    ms: resolveRowMs(row),
  })).sort((a, b) => (a.ms - b.ms) || (a.index - b.index));

  const activeLineageByScope = new Map();
  const output = new Array(ordered.length);

  for (const item of ordered) {
    const { row, index } = item;
    const scopeKey = buildScopeKey(row);
    let nextRow = row;
    const lineage = resolveEntryLineage(row);
    const exitEvent = isExitEvent(row.event);

    if (scopeKey && exitEvent && !hasLineage(lineage) && activeLineageByScope.has(scopeKey)) {
      nextRow = applyLineage(row, activeLineageByScope.get(scopeKey));
    }

    const nextLineage = resolveEntryLineage(nextRow);
    if (scopeKey && !exitEvent && hasLineage(nextLineage)) {
      activeLineageByScope.set(scopeKey, nextLineage);
    }

    output[index] = nextRow;
  }

  return output;
}

module.exports = {
  backfillRecentEntryLineage,
  __test: {
    resolvePositionSide,
    resolveEntryLineage,
    buildScopeKey,
    applyLineage,
  },
};
