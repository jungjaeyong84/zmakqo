"use strict";

// 2026-04-29 P0-4 — Broker = single source of truth, helper module.
//
// Design principle: in this codebase, *the broker* (Binance Futures
// `/fapi/v2/account.positions[]`) is the authoritative state for
// every active position. Firestore (positions_paper, position read
// view, exit_order_contracts, V2 authority artifacts) is a *cache*
// that lags broker truth by anywhere from 0 ms to several minutes
// depending on which sync path last touched it (WS user-data stream,
// fillSync poll, runOneMarket reconciler, manual repair). When the
// cache and the broker disagree, the broker wins.
//
// Until today the principle was implicit and several callers
// duplicated the broker fetch with their own ad-hoc caching:
//
//   - binanceTickExit.js (R2): 5-s cache + isFlat per-symbol filter
//   - liveTrailingStageRepair.js: ad-hoc fetch per repair attempt
//   - binanceLiveStateSelfHeal.js: ad-hoc fetch per heal cycle
//   - binanceFuturesFillsSync.js: ad-hoc fetch per poll
//
// Each caller paid the same Binance weight (≈5 per fetch) and could
// see a different snapshot of the same broker state at the same wall
// clock instant — a textbook cache-coherence failure.
//
// This module extracts the R2 cache + classifier so all callers share
// one in-process snapshot per TTL window. Side-effects:
//   1. Binance weight reduced from N×caller fetches to 1 per TTL.
//   2. Every caller sees the same broker truth for the same wall-clock
//      window, eliminating split-state classification mistakes.
//   3. The principle is now namespaced: future code that reads broker
//      position state goes through this module, not through ad-hoc
//      fetchBinanceFuturesAccount calls.
//
// API contract:
//   getBrokerPositionSnapshot({ liveCfg, nowMs }) → null | { fetchedAt, byMap }
//     - byMap: Map<symbol, { positionAmt, positionSide, isFlat }>
//     - returns null when liveCfg lacks API keys (caller must fall
//       through to its legacy path); otherwise returns the cached
//       snapshot (populating it on cache miss).
//   invalidateBrokerPositionSnapshotCache() → void
//     - forces the next getBrokerPositionSnapshot to re-fetch. Call
//       this after a place_fail (-2022) or any other event that
//       suggests the cached snapshot is older than reality.
//   buildBrokerPositionSnapshot(account) → Map (pure)
//     - testing-only entry point that takes a raw
//       fetchBinanceFuturesAccount response and produces the byMap.
//
// TTL is operator-tunable per service through the env var
// BROKER_POSITION_SNAPSHOT_TTL_MS, with a 5 s default. Setting TTL to
// 0 disables caching entirely (fetch every call) for emergency
// debugging; otherwise 5 s is the sweet spot — short enough that a
// fresh broker fill is visible within one tick, long enough that
// 16-symbol cron + 15-s tick_exit + WS-driven syncs don't multiply
// the weight cost.

const { fetchBinanceFuturesAccount } = require("../exchanges/binanceFuturesPrivate");

const BROKER_POSITION_SNAPSHOT_TTL_MS = (() => {
  const raw = Number(process.env.BROKER_POSITION_SNAPSHOT_TTL_MS
    // 2026-04-29 — back-compat: the same TTL was previously named
    // TICK_EXIT_BROKER_SNAPSHOT_TTL_MS while the snapshot only lived
    // inside binanceTickExit. Honour both names so an operator's
    // existing override on the legacy var keeps working.
    || process.env.TICK_EXIT_BROKER_SNAPSHOT_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 5_000;
})();

let brokerPositionSnapshotCache = null;

function buildBrokerPositionSnapshot(account = {}) {
  const byMap = new Map();
  const rows = Array.isArray(account && account.positions) ? account.positions : [];
  for (const row of rows) {
    const sym = String(row && row.symbol || "").trim().toUpperCase();
    if (!sym) continue;
    const positionAmt = Number(row && row.positionAmt);
    if (!Number.isFinite(positionAmt)) continue;
    const positionSide = String(row && row.positionSide || "").trim().toUpperCase();
    byMap.set(sym, {
      positionAmt,
      positionSide: positionSide || (positionAmt > 0 ? "LONG" : positionAmt < 0 ? "SHORT" : "FLAT"),
      isFlat: positionAmt === 0,
    });
  }
  return byMap;
}

async function getBrokerPositionSnapshot({ liveCfg, nowMs = Date.now() } = {}) {
  if (
    brokerPositionSnapshotCache
    && Number.isFinite(brokerPositionSnapshotCache.fetchedAt)
    && (nowMs - brokerPositionSnapshotCache.fetchedAt) < BROKER_POSITION_SNAPSHOT_TTL_MS
  ) {
    return brokerPositionSnapshotCache;
  }
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) return null;
  const account = await fetchBinanceFuturesAccount({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
  });
  brokerPositionSnapshotCache = {
    fetchedAt: nowMs,
    byMap: buildBrokerPositionSnapshot(account || {}),
  };
  return brokerPositionSnapshotCache;
}

function invalidateBrokerPositionSnapshotCache() {
  brokerPositionSnapshotCache = null;
}

module.exports = {
  BROKER_POSITION_SNAPSHOT_TTL_MS,
  buildBrokerPositionSnapshot,
  getBrokerPositionSnapshot,
  invalidateBrokerPositionSnapshotCache,
};
