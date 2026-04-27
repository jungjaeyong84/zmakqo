"use strict";

// 2026-04-27 — bumped per-symbol budget from 11~42 USDT to ≥100 USDT so that
// the TP1 50% partial close (now ≥50 USDT) clears Binance Futures'
// MIN_NOTIONAL filter (50 USDT). Below the bump, partial TP1 orders were
// silently rejected on small symbols (LINKUSDT seen at 41 USDT entry → 20.4
// USDT TP1 partial → MIN_NOTIONAL fail), leaving the position protected only
// by SL with no automated profit-taking. BTCUSDT stays at 155 because it
// already cleared the threshold and hold-out budget is meaningful for it.
const DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP = Object.freeze({
  BTCUSDT: 155,
  ETHUSDT: 100,
  LINKUSDT: 100,
  BNBUSDT: 100,
  XRPUSDT: 100,
  SOLUSDT: 100,
  AXSUSDT: 100,
  DOGEUSDT: 100,
});

const DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT = Object.entries(
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
).map(([symbol, notional]) => `${symbol}:${notional}`).join("|");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseSymbolNotionalMap(value) {
  const text = trimOrNull(value);
  const source = text || DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT;
  const out = {};
  for (const token of source.split(/[|,]/)) {
    const [rawSymbol, rawNotional] = String(token || "").split(/[:=]/);
    const symbol = upper(rawSymbol);
    const notional = toNumberOrNull(rawNotional);
    if (symbol && Number.isFinite(notional) && notional > 0) out[symbol] = notional;
  }
  return Object.freeze(out);
}

function resolveDiscoverySymbolNotionalQuoteMap(env = process.env) {
  return parseSymbolNotionalMap(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP);
}

function resolveDiscoverySymbolNotionalQuote({ env = process.env, symbol = null, fallback = null } = {}) {
  const sym = upper(symbol);
  const map = resolveDiscoverySymbolNotionalQuoteMap(env);
  const mapped = sym ? toNumberOrNull(map[sym]) : null;
  if (Number.isFinite(mapped) && mapped > 0) return mapped;
  const fb = toNumberOrNull(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : null;
}

module.exports = {
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT,
  parseSymbolNotionalMap,
  resolveDiscoverySymbolNotionalQuoteMap,
  resolveDiscoverySymbolNotionalQuote,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
  },
};
