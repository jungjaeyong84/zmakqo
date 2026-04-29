"use strict";

// 2026-04-29 P1-1.13 — thirteenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three small pure scalar/list/symbol utilities that are unrelated
// in domain but share three properties: pure functions, ≤10 LOC
// each, zero external callers (audited 2026-04-29 by grep). They
// are the leaf-tier small utilities the runner accumulated over
// time and never had a home for. Bundling them here removes them
// from the runner's top-of-file clutter.
//
//   pickMarketOverride          (map, symbol, fallback) → number|fallback
//                               Look up `symbol` in `map`; return
//                               Number(map[symbol]) if present,
//                               else fallback. Used by callers
//                               that read per-symbol overrides
//                               (e.g. per-symbol leverage caps).
//   parseUpperList              (raw, fallback) → string[]
//                               Comma/whitespace-delimited string
//                               or array → uppercased, deduped,
//                               non-empty entries. Differs from
//                               splitRuntimeList (P1-1.6): this
//                               variant DEDUPS while splitRuntimeList
//                               does NOT. Pinning that distinction
//                               in tests so a future "merge them"
//                               change requires explicit decision.
//   normalizeFuturesSymbolKey   raw → "BTCUSDT" form (uppercased,
//                               trimmed, .P suffix stripped). Used
//                               to derive a canonical symbol key
//                               from TradingView Pine signals
//                               (which carry "BTCUSDT.P" for
//                               perpetual futures).
//
// Cohesion note: the three are NOT a tight semantic group. They
// are co-located here only because each is too small to deserve
// its own module and none of them fit any of the other extracted
// modules' themes. Future P1-1.x sub-steps may pull individual
// helpers from this module into their proper homes once a tighter
// theme materializes (e.g. if a "futures-symbol normalization"
// module emerges, normalizeFuturesSymbolKey should move there).

// pickMarketOverride — read a per-symbol number from a map with
// a fallback. Returns fallback when map is missing or not an
// object, or when the symbol entry is null/undefined. Coerces to
// Number on hit (so caller doesn't double-coerce).
function pickMarketOverride(map, symbol, fallback) {
  if (!map || typeof map !== "object") return fallback;
  if (symbol && map[symbol] != null) return Number(map[symbol]);
  return fallback;
}

// parseUpperList — comma- or whitespace-delimited string → array
// of trimmed uppercased entries. Array input is supported (each
// entry trimmed/uppercased). Empty entries dropped.
//
// CRITICAL: this function DEDUPS (uses out.includes() check).
// That is the contract pin — distinct from splitRuntimeList
// (P1-1.6) which preserves duplicates. Both forms exist
// historically because different callers rely on each.
function parseUpperList(raw, fallback = []) {
  const src = raw == null ? fallback : raw;
  const list = Array.isArray(src) ? src : String(src || "").split(/[,\s]+/);
  const out = [];
  for (const v of list) {
    const s = String(v || "").trim().toUpperCase();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

// normalizeFuturesSymbolKey — produce the canonical broker-side
// symbol key from a Pine/TradingView raw string. Pine emits
// "BTCUSDT.P" for perpetual futures; the broker (Binance Futures)
// expects "BTCUSDT". This function strips the trailing ".P" and
// upper-cases the result. Empty input returns empty string (NOT
// null) so callers can use it directly as a Firestore doc-id
// without null-guarding.
function normalizeFuturesSymbolKey(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  return s.replace(/\.P$/, "");
}

module.exports = {
  pickMarketOverride,
  parseUpperList,
  normalizeFuturesSymbolKey,
};
