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

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  const entryKey = trimOrNull(row.position_cycle_id)
    || trimOrNull(row.entry_event_id)
    || trimOrNull(row.canonical_exit_chain_key)
    || trimOrNull(row.signal_doc_id)
    || trimOrNull(row.trade_id)
    || trimOrNull(row.id)
    || `${symbol}__${positionSide}__${entry.entry_ms}`;
  const positionCycleId = trimOrNull(row.position_cycle_id) || buildPositionCycleId({
    symbol,
    positionSide,
    entryEventId: entryKey,
  });
  const decisionId = trimOrNull(row.openclaw_decision_id)
    || `OCDV2__RECONCILED_BROKER_SYNC__${hash12(`${entryKey}__${exitGroup.key}`)}`;
  const signalIntentId = trimOrNull(row.signal_intent_id || row.intent_id)
    || `SIGINTV2__RECONCILED_BROKER_SYNC__${symbol}__${positionSide}__${hash12(entryKey)}`;
  return Object.freeze({
    openclawDecisionId: decisionId,
    signalIntentId,
    positionCycleId,
    entryKey,
  });
}

function buildAdjudicationFromExitGroup({ exitGroup, entry, nowMs = null } = {}) {
  if (!exitGroup || !entry) return null;
  const ids = syntheticOpenClawIds({ entry, exitGroup });
  const at = isoFromMs(exitGroup.latest_ms) || isoFromMs(nowMs) || new Date().toISOString();
  const family = exitGroup.operator_external ? "OPERATOR" : "MODEL";
  let label = "OUTCOME_UNKNOWN";
  if (family === "OPERATOR") {
    label = "EXTERNAL_SYNC";
  } else if (exitGroup.realized_pnl > 0) {
    label = "MODEL_WIN";
  } else if (exitGroup.realized_pnl < 0) {
    label = "MODEL_ERROR";
  }
  const entryRow = asObject(entry.row) || {};
  const fillIds = exitGroup.fills.map((row) => trimOrNull(row.id || row.trade_id)).filter(Boolean);
  return Object.freeze(buildOpenClawOutcomeAdjudicationDoc({
    openclawDecisionId: ids.openclawDecisionId,
    signalIntentId: ids.signalIntentId,
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
      lineage_quality: "BROKER_SYNC_RECONCILED",
      lineage_reconciled: true,
      broker_sync_reconciled: true,
      performance_eligibility_basis: family === "MODEL" ? "V2_PROTECTED_ENTRY_MATCHED_TO_CANONICAL_EXIT_FILL" : "OPERATOR_EXTERNAL_SYNC_EXCLUDED",
      symbol: entry.symbol,
      side: entry.position_side,
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
      exit_actions: exitGroup.fills.map(normalizeAction).filter(Boolean),
      exit_canonical_transition_events: Array.from(new Set(exitGroup.fills.flatMap((row) => asArray(row.canonical_transition_events).map(upper).filter(Boolean)))),
      source_fill_count: exitGroup.fills.length,
      realized_pnl_source: "BINANCE_USER_TRADES_REALIZED_PNL",
      openclaw_decision_id: ids.openclawDecisionId,
      signal_intent_id: ids.signalIntentId,
      position_cycle_id: ids.positionCycleId,
    },
  }));
}

function collectOpenClawOutcomeAdjudicationsFromFills({
  fills = [],
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
    docs.push(buildAdjudicationFromExitGroup({ exitGroup: group, entry, nowMs }));
  }
  return Object.freeze({
    ok: true,
    reason: "V2_OPENCLAW_OUTCOME_ADJUDICATIONS_COLLECTED",
    source: "FILLS_PAPER_BROKER_SYNC",
    lookback_hours: Number(lookbackHours),
    scanned_fill_n: rows.length,
    protected_entry_fill_n: Array.from(entryIndex.values()).reduce((sum, list) => sum + list.length, 0),
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
  matchExitGroupToEntry,
  buildAdjudicationFromExitGroup,
  collectOpenClawOutcomeAdjudicationsFromFills,
  __test: {
    trimOrNull,
    upper,
    asArray,
    asObject,
    toNumberOrNull,
    hash12,
    timestampMs,
    normalizeAction,
    normalizeSide,
    realizedPnl,
    mapExitEvent,
    positionSideFromEntrySide,
    oppositeExitSideForPosition,
    syntheticOpenClawIds,
  },
};
