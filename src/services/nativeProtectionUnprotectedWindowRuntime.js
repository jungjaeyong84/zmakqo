"use strict";

// 2026-04-20 senior-audit P2 runtime service.
//
// Purpose: compute the cancel→ack duration (the "unprotected window") for
// every active exchange position, so the exit-integrity deploy gate and
// ops dashboards can detect regressions where the naked window blows out
// past its normal ~few hundred ms into seconds or tens of seconds.
//
// Context: `refreshBinanceNativeProtection` is architecturally cancel-first
// because Binance has no atomic "replace closePosition STOP_MARKET"
// primitive — we DELETE the old orders, then POST new ones. During that
// interval the position sits on the exchange with no resting protection,
// and if the mark price breaches the would-be SL during that window, the
// position takes the full uncapped loss.
//
// Prior to this file:
//   - The window existed but was completely unmeasurable — cancel and
//     placement were wrapped in try/catch with no timestamps, so ops had
//     no way to tell a healthy 300 ms refresh from a pathological 20 s
//     refresh without scraping Cloud Logging and hand-correlating events.
//   - The only signal we had was UNPROTECTED_ACTIVE_POSITION, which fires
//     ONLY when the placement outright failed after cancel succeeded —
//     the "window was wide but eventually closed" case was invisible.
//
// This module consumes the new `positions_paper.meta.native_protection_{
// cancel,stop_ack,tp_ack}_ms` fields stamped by
// `buildNativeProtectionMetaPatch` and classifies each position into one
// of five buckets (below). The deploy gate uses the counts to decide
// PASS/BLOCK.

const { listExchangePositionReadViews } = require("./positionReadModel");

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Like toNum but additionally requires > 0. Used for timestamp/ms fields
// where 0 is never a valid value — Number(null) evaluates to 0, which
// without this guard would mask a null stop_ack_ms as "acked at epoch".
function toPosMs(value) {
  const n = toNum(value);
  return n != null && n > 0 ? n : null;
}

// Default threshold: 3 seconds. Healthy refresh timings observed in
// production are typically under 500ms (two sequential Binance futures API
// calls round-tripping from us-central1 to the Binance edge). 3s is a
// generous ceiling — anything past that is either network degradation,
// rate-limit throttling, or a placement-retry path — all of which ops
// should see. Tunable via env so the gate can be tightened/loosened
// without a code change.
const DEFAULT_THRESHOLD_MS = 3000;
// Stale max_age: don't flag positions that haven't had a refresh in a long
// time (the timing meta is an artifact of the last refresh, not a liveness
// signal). Default 24h — any position with a cancel_ms older than this is
// "STALE" (= not in the last-known-healthy refresh cycle) and excluded
// from breach counts. Still surfaced in rows for ops visibility.
const DEFAULT_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isActivePosition(row = null) {
  const pos = row && typeof row === "object" ? row : {};
  const state = upper(pos.position_state || pos.state);
  const sizePct = toNum(pos.size_pct);
  const qtyBase = toNum(pos.qty_base);
  const hasSize = (Number.isFinite(sizePct) && sizePct > 0) || (Number.isFinite(qtyBase) && qtyBase > 0);
  return hasSize && state !== "FLAT";
}

// classifyUnprotectedWindowRecord: pure function over a single position row.
//
// Classes (most severe → least):
//   CANCEL_WITHOUT_ACK   cancel_ms set, no ack of either leg — the last
//                        refresh opened a window that never closed (from
//                        the meta's POV). Position is either currently
//                        naked on the exchange OR the ack write was lost.
//                        Either way the deploy gate must BLOCK.
//   WINDOW_BREACH        cancel_ms and ≥1 ack set, but max(ack) - cancel
//                        exceeds threshold_ms. Indicates a slow-refresh
//                        regression — deploy gate must BLOCK.
//   PARTIAL_ACK          stop_ack_ms set but tp_ack_ms missing on a
//                        position that SHOULD have a TP leg (tp1_eligible
//                        true). Logged but does not BLOCK on its own.
//   WINDOW_OK            cancel_ms and ≥1 ack set, window within threshold.
//                        Healthy.
//   NOT_MEASURED         no cancel_ms recorded. This covers (a) positions
//                        opened before this feature shipped, (b) positions
//                        in FLAT state, and (c) positions whose refresh
//                        path hit an early skip (POSITION_CONTEXT_FETCH_FAIL
//                        etc.) before the timing stamp. The gate does NOT
//                        BLOCK on NOT_MEASURED — doing so would fail every
//                        deploy for weeks after rollout as the old-style
//                        meta rolled out of active positions.
function classifyUnprotectedWindowRecord(row = null, {
  thresholdMs = DEFAULT_THRESHOLD_MS,
  staleMaxAgeMs = DEFAULT_STALE_MAX_AGE_MS,
  nowMs = null,
} = {}) {
  const pos = row && typeof row === "object" ? row : {};
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  // toPosMs (not toNum) — timestamps must be strictly positive. Using
  // toNum here would coerce null/undefined to 0 via Number(null) and then
  // pass isFinite, masking "no ack recorded" as "acked at epoch".
  const cancelMs = toPosMs(meta.native_protection_cancel_ms);
  const stopAckMs = toPosMs(meta.native_protection_stop_ack_ms);
  const tpAckMs = toPosMs(meta.native_protection_tp_ack_ms);
  const cancelSucceeded = meta.native_protection_cancel_succeeded === true
    ? true
    : (meta.native_protection_cancel_succeeded === false ? false : null);
  const refreshStatus = upper(meta.native_protection_refresh_status || "") || null;
  // Use max(stop_ack, tp_ack) as the window-end — both legs need to be
  // live before the position is fully protected again. For paths that
  // don't place a TP (fail-closed, TP disabled/ineligible), tp_ack_ms is
  // null and we fall back to stop_ack_ms alone.
  const latestAckMs = (() => {
    if (stopAckMs == null && tpAckMs == null) return null;
    if (stopAckMs == null) return tpAckMs;
    if (tpAckMs == null) return stopAckMs;
    return Math.max(stopAckMs, tpAckMs);
  })();
  // toNum (not toPosMs) here: a pre-computed window_ms of 0 is semantically
  // possible (refresh instantaneous at the ms resolution) whereas a timestamp
  // of 0 is not. But we still reject null/undefined via the tightened toNum
  // so "missing" doesn't silently collapse to "zero window".
  const computedWindowMsRaw = toNum(meta.native_protection_unprotected_window_ms);
  const windowMs = computedWindowMsRaw != null
    ? computedWindowMsRaw
    : (cancelMs != null && latestAckMs != null && latestAckMs >= cancelMs
      ? latestAckMs - cancelMs
      : null);
  const clock = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const stale = cancelMs != null && (clock - cancelMs) > Math.max(0, Number(staleMaxAgeMs) || 0);
  // Classification.
  let cls;
  let gateBreach = false; // does this record contribute to the BLOCK count
  if (cancelMs == null) {
    cls = "NOT_MEASURED";
  } else if (cancelSucceeded === false) {
    // Cancel itself failed — old orders still on exchange, window never
    // opened. Not a breach.
    cls = "CANCEL_FAILED_NO_WINDOW";
  } else if (stale) {
    // Old data, carry forward as observability but not a live breach.
    cls = "STALE";
  } else if (latestAckMs == null) {
    cls = "CANCEL_WITHOUT_ACK";
    gateBreach = true;
  } else if (windowMs != null && windowMs > Number(thresholdMs)) {
    cls = "WINDOW_BREACH";
    gateBreach = true;
  } else {
    // Healthy numeric window. Flag PARTIAL_ACK as informational when the
    // stage shape says both legs were expected.
    const tp1Eligible = meta.tp_p1_done !== true && meta.trail_active !== true;
    if (tp1Eligible && stopAckMs != null && tpAckMs == null) {
      cls = "PARTIAL_ACK";
    } else {
      cls = "WINDOW_OK";
    }
  }
  return {
    exchange: upper(pos.exchange),
    symbol: upper(pos.symbol_or_pair_id || pos.symbol),
    state: upper(pos.position_state || pos.state) || null,
    qty_base: toNum(pos.qty_base),
    size_pct: toNum(pos.size_pct),
    refresh_status: refreshStatus,
    cancel_ms: cancelMs,
    cancel_succeeded: cancelSucceeded,
    stop_ack_ms: stopAckMs,
    tp_ack_ms: tpAckMs,
    latest_ack_ms: latestAckMs,
    window_ms: windowMs,
    threshold_ms: Number(thresholdMs),
    stale,
    class: cls,
    gate_breach: gateBreach,
    tp1_eligible: meta.tp_p1_done !== true && meta.trail_active !== true,
    tp_p1_done: meta.tp_p1_done === true,
    trail_active: meta.trail_active === true,
    updated_at: pos.updated_at || null,
  };
}

async function loadUnprotectedWindowRuntime({
  exchange = "BINANCEFUT",
  limit = 200,
  thresholdMs = DEFAULT_THRESHOLD_MS,
  staleMaxAgeMs = DEFAULT_STALE_MAX_AGE_MS,
  listPositions = listExchangePositionReadViews,
  nowMs = null,
} = {}) {
  const ex = upper(exchange || "BINANCEFUT") || "BINANCEFUT";
  const rows = await listPositions({
    exchange: ex,
    limit: Math.max(20, Number(limit) || 200),
  }).catch(() => []);
  const activeRows = (Array.isArray(rows) ? rows : []).filter((row) => isActivePosition(row));
  const records = activeRows.map((row) => classifyUnprotectedWindowRecord(row, {
    thresholdMs,
    staleMaxAgeMs,
    nowMs,
  }));
  const breachRecords = records.filter((r) => r.gate_breach === true);
  const windowOkRecords = records.filter((r) => r.class === "WINDOW_OK" || r.class === "PARTIAL_ACK");
  const windowMsValues = windowOkRecords
    .map((r) => Number(r.window_ms))
    .filter((n) => Number.isFinite(n));
  const maxWindowMs = windowMsValues.length ? Math.max(...windowMsValues) : null;
  const avgWindowMs = windowMsValues.length
    ? Math.round(windowMsValues.reduce((s, v) => s + v, 0) / windowMsValues.length)
    : null;
  const byClass = records.reduce((acc, r) => {
    acc[r.class] = (acc[r.class] || 0) + 1;
    return acc;
  }, {});
  return {
    exchange: ex,
    available: true,
    generated_at_ms: Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now(),
    threshold_ms: Number(thresholdMs),
    stale_max_age_ms: Number(staleMaxAgeMs),
    active_position_count: activeRows.length,
    breach_count: breachRecords.length,
    breach_window_count: breachRecords.filter((r) => r.class === "WINDOW_BREACH").length,
    breach_cancel_without_ack_count: breachRecords.filter((r) => r.class === "CANCEL_WITHOUT_ACK").length,
    partial_ack_count: records.filter((r) => r.class === "PARTIAL_ACK").length,
    not_measured_count: records.filter((r) => r.class === "NOT_MEASURED").length,
    stale_count: records.filter((r) => r.class === "STALE").length,
    window_ok_count: records.filter((r) => r.class === "WINDOW_OK").length,
    max_window_ms: maxWindowMs,
    avg_window_ms: avgWindowMs,
    class_counts: byClass,
    rows: records.slice(0, 100),
    breach_rows: breachRecords.slice(0, 50),
  };
}

module.exports = {
  loadUnprotectedWindowRuntime,
  DEFAULT_THRESHOLD_MS,
  DEFAULT_STALE_MAX_AGE_MS,
  __test: {
    isActivePosition,
    classifyUnprotectedWindowRecord,
  },
};
