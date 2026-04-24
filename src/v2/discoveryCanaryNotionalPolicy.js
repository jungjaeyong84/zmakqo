"use strict";

const DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP = Object.freeze({
  BTCUSDT: 100,
  ETHUSDT: 40,
  LINKUSDT: 40,
  BNBUSDT: 10,
  XRPUSDT: 10,
  SOLUSDT: 10,
  AXSUSDT: 10,
  DOGEUSDT: 10,
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
