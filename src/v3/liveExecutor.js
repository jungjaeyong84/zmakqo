"use strict";

// src/v3/liveExecutor.js — micro-live execution DECISION layer (2026-07-15).
//
// Pure logic, no network: given freshly-admitted paper entries and the live
// ledger state, decide which live orders to place. The paper entry ledger is
// the single admission authority — a signal only reaches this module if it
// already passed dedup, cooldown, symbol-side locks, symmetric quality
// filters, and portfolio risk controls. Live execution mirrors those admits
// 1:1 (same signal_id), so paper vs live slippage/fee comparison is exact.
//
// Safety model (defense in depth, ordered):
//   1. V3_LIVE_ENABLED=1 required           (default OFF)
//   2. V3_LIVE_DRY_RUN=0 required to send   (default DRY RUN — logs, no orders)
//   3. notional per trade V3_LIVE_NOTIONAL_USDT (default 10) is clamped by a
//      NON-overridable code constant LIVE_NOTIONAL_HARD_CAP_USDT=20. Fat-
//      fingered env cannot size up past the cap. Raising the cap requires a
//      code change + review, which is the point (funding criteria: post-
//      filter n>=180 AND cost-adjusted expectancy > 0).
//   4. live concurrency caps mirror paper (V3_MAX_OPEN_TOTAL/PER_SIDE).
//   5. live daily kill switch on the LIVE exit ledger (same env semantics as
//      paper: V3_DAILY_DRAWDOWN_KILL_R, default -5R).
//   6. freshness: only entries younger than V3_LIVE_MAX_ENTRY_AGE_MS
//      (default 10 min) are executable — a cold start can never replay
//      ledger history into live orders.
//   7. per-signal dedup against the live ledger (signal_id).

const LIVE_NOTIONAL_HARD_CAP_USDT = 20; // code constant — deliberately not env

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function upper(v) { const s = String(v == null ? "" : v).trim(); return s ? s.toUpperCase() : null; }

function resolveLiveEnabled() {
  return String(process.env.V3_LIVE_ENABLED || "0").trim() === "1";
}
function resolveDryRun() {
  // default DRY RUN — must explicitly set 0 to send real orders
  return String(process.env.V3_LIVE_DRY_RUN == null ? "1" : process.env.V3_LIVE_DRY_RUN).trim() !== "0";
}
function resolveNotionalUsdt() {
  const raw = num(process.env.V3_LIVE_NOTIONAL_USDT);
  const requested = raw !== null && raw > 0 ? raw : 10;
  return Math.min(requested, LIVE_NOTIONAL_HARD_CAP_USDT);
}
function resolveLeverage() {
  const raw = num(process.env.V3_LIVE_LEVERAGE);
  const v = raw !== null && raw >= 1 ? Math.floor(raw) : 1;
  return Math.min(v, 3);
}
function resolveMaxEntryAgeMs() {
  const raw = num(process.env.V3_LIVE_MAX_ENTRY_AGE_MS);
  return raw !== null && raw > 0 ? raw : 10 * 60 * 1000;
}
function resolveLiveMaxOpenTotal() {
  const raw = num(process.env.V3_MAX_OPEN_TOTAL);
  return raw !== null && raw > 0 ? Math.floor(raw) : 6;
}
function resolveLiveMaxOpenPerSide() {
  const raw = num(process.env.V3_MAX_OPEN_PER_SIDE);
  return raw !== null && raw > 0 ? Math.floor(raw) : 5;
}
function resolveLiveDailyKillR() {
  const raw = num(process.env.V3_DAILY_DRAWDOWN_KILL_R);
  return raw !== null ? raw : -5;
}

function computeLiveTodayRealizedR(liveExitRows = [], nowMs = Date.now()) {
  const dayStart = new Date(Number(nowMs) || Date.now());
  dayStart.setUTCHours(0, 0, 0, 0);
  let net = 0;
  for (const row of Array.isArray(liveExitRows) ? liveExitRows : []) {
    if (upper(row && row.status) !== "CLOSED") continue;
    const t = Date.parse(row && row.closed_at);
    if (!Number.isFinite(t) || t < dayStart.getTime()) continue;
    const r = num(row && row.realized_r);
    if (r !== null) net += r;
  }
  return net;
}

// Decide live order intents for one runner cycle.
//   paperEntries  — rows from the paper entry ledger (candidates)
//   liveEntryRows — existing live ledger rows (dedup + open state)
//   liveExitRows  — live exits (kill switch + open resolution)
// Returns { intents: [...], skipped: {reason: count}, config }
function decideLiveOrders({
  paperEntries = [],
  liveEntryRows = [],
  liveExitRows = [],
  nowMs = Date.now(),
} = {}) {
  const config = Object.freeze({
    live_enabled: resolveLiveEnabled(),
    dry_run: resolveDryRun(),
    notional_usdt: resolveNotionalUsdt(),
    notional_hard_cap_usdt: LIVE_NOTIONAL_HARD_CAP_USDT,
    leverage: resolveLeverage(),
    max_entry_age_ms: resolveMaxEntryAgeMs(),
    max_open_total: resolveLiveMaxOpenTotal(),
    max_open_per_side: resolveLiveMaxOpenPerSide(),
    daily_kill_r: resolveLiveDailyKillR(),
  });

  const skipped = Object.create(null);
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const intents = [];

  if (!config.live_enabled) {
    for (const _ of Array.isArray(paperEntries) ? paperEntries : []) skip("LIVE_DISABLED");
    return Object.freeze({ intents: Object.freeze(intents), skipped: Object.freeze(skipped), config });
  }

  // live open/dedup state
  const executedSignalIds = new Set();
  const closedSignalIds = new Set();
  for (const row of Array.isArray(liveExitRows) ? liveExitRows : []) {
    const sid = row && row.signal_id;
    if (sid && upper(row.status) === "CLOSED") closedSignalIds.add(sid);
  }
  let openTotal = 0, openLong = 0, openShort = 0;
  const openSymbolSide = new Set();
  for (const row of Array.isArray(liveEntryRows) ? liveEntryRows : []) {
    const sid = row && row.signal_id;
    if (sid) executedSignalIds.add(sid);
    if (!sid || closedSignalIds.has(sid)) continue;
    if (row.dry_run === true) continue; // dry-run rows don't hold live exposure
    openTotal += 1;
    const side = upper(row.side);
    if (side === "LONG") openLong += 1;
    else if (side === "SHORT") openShort += 1;
    openSymbolSide.add(`${upper(row.symbol)}__${side}`);
  }

  // live daily kill switch (booked live losses only)
  const todayLiveR = computeLiveTodayRealizedR(liveExitRows, nowMs);
  const killActive = config.daily_kill_r < 0 && todayLiveR <= config.daily_kill_r;

  for (const e of Array.isArray(paperEntries) ? paperEntries : []) {
    const signalId = e && e.signal_id;
    const symbol = upper(e && e.symbol);
    const side = upper(e && e.side);
    const sig = num(e && e.signal_price);
    const stop = num(e && e.stop_price);
    const target = num(e && e.target_price);
    if (!signalId || !symbol || (side !== "LONG" && side !== "SHORT")) { skip("MALFORMED_ENTRY"); continue; }
    if (sig === null || stop === null || target === null || sig <= 0) { skip("MISSING_PRICE_LEVELS"); continue; }
    if (executedSignalIds.has(signalId)) { skip("ALREADY_EXECUTED"); continue; }
    const createdMs = Date.parse(e && e.created_at);
    if (!Number.isFinite(createdMs) || (nowMs - createdMs) > config.max_entry_age_ms) { skip("ENTRY_TOO_OLD"); continue; }
    if (killActive) { skip("LIVE_DAILY_KILL"); continue; }
    if (openTotal >= config.max_open_total) { skip("LIVE_MAX_OPEN_TOTAL"); continue; }
    const sideOpen = side === "LONG" ? openLong : openShort;
    if (sideOpen >= config.max_open_per_side) { skip("LIVE_MAX_OPEN_PER_SIDE"); continue; }
    if (openSymbolSide.has(`${symbol}__${side}`)) { skip("LIVE_SYMBOL_SIDE_OPEN"); continue; }

    const rawQty = config.notional_usdt / sig; // exchange-precision rounding is the runner's job
    intents.push(Object.freeze({
      signal_id: signalId,
      symbol,
      side,
      order_side: side === "LONG" ? "BUY" : "SELL",
      close_side: side === "LONG" ? "SELL" : "BUY",
      notional_usdt: config.notional_usdt,
      leverage: config.leverage,
      raw_qty: rawQty,
      signal_price: sig,
      stop_price: stop,
      target_price: target,
      tf: e.tf || null,
      rr: num(e.rr),
      dry_run: config.dry_run,
    }));
    openTotal += 1;
    if (side === "LONG") openLong += 1; else openShort += 1;
    openSymbolSide.add(`${symbol}__${side}`);
    executedSignalIds.add(signalId);
  }

  return Object.freeze({
    intents: Object.freeze(intents),
    skipped: Object.freeze(skipped),
    config,
    live_open_total: openTotal,
    live_today_realized_r: todayLiveR,
    live_kill_active: killActive,
  });
}

module.exports = Object.freeze({
  LIVE_NOTIONAL_HARD_CAP_USDT,
  decideLiveOrders,
  __test: {
    resolveLiveEnabled,
    resolveDryRun,
    resolveNotionalUsdt,
    resolveLeverage,
    resolveMaxEntryAgeMs,
    computeLiveTodayRealizedR,
  },
});
