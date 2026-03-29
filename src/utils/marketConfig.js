const { TF_15M, TF_60M, BAR_INTERVAL_MS_15M, BAR_INTERVAL_MS_60M } = require("../config/frozen");
const { BINANCE_ONLY_PROVIDER } = require("./providerUtils");

const SUPPORTED_TF = [TF_15M, TF_60M];
const PRIMARY_TF = defaultExecTfFromEnv() || TF_15M;
const PRIMARY_TF_MS = tfToMs(PRIMARY_TF) || BAR_INTERVAL_MS_15M;
const BINANCEFUT_CORE_MARKETS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "AXSUSDT",
  "DOGEUSDT",
];
const BINANCEFUT_BLOCKED_MARKETS = (() => {
  const base = [];
  const raw = String(process.env.BINANCEFUT_BLOCKED_MARKETS || "").trim();
  if (!raw) return new Set(base);
  for (const part of raw.split(",")) {
    const v = String(part || "").trim().toUpperCase();
    if (v) base.push(v);
  }
  return new Set(base);
})();

function tfToMs(tf) {
  const t = String(tf || "").trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)([mhd])$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2] === "m") return n * 60 * 1000;
  if (m[2] === "h") return n * 60 * 60 * 1000;
  if (m[2] === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}

function normalizeTf(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return "";
  if (/^\d+$/.test(t)) return `${t}m`;
  const ms = tfToMs(t);
  if (ms === BAR_INTERVAL_MS_15M) return TF_15M;
  if (ms === BAR_INTERVAL_MS_60M) return TF_60M;
  if (ms === PRIMARY_TF_MS) return PRIMARY_TF;
  return t;
}

function normalizeMarketSymbol(raw) {
  return normalizeMarketSymbolForProvider(raw, BINANCE_ONLY_PROVIDER);
}

function isBinanceFuturesProvider(provider) {
  const p = String(provider || BINANCE_ONLY_PROVIDER).trim().toUpperCase();
  return p === BINANCE_ONLY_PROVIDER || p === "BINANCE";
}

function normalizeMarketSymbolForProvider(raw, provider) {
  const p = String(provider || BINANCE_ONLY_PROVIDER).trim().toUpperCase();
  if (p !== BINANCE_ONLY_PROVIDER && p !== "BINANCE") return "";
  let t = String(raw || "").trim().toUpperCase();
  if (!t) return "";
  if (t.includes(":")) t = t.split(":").pop() || t;
  if (t.includes("-")) t = t.split("-").pop() || t;
  if (t.endsWith(".P")) t = t.slice(0, -2);
  t = t.replace(/PERP$/g, "");
  t = t.replace(/[^A-Z0-9]/g, "");
  if (!t) return "";
  if (!t.endsWith("USDT") && /^[A-Z0-9]+$/.test(t)) t = `${t}USDT`;
  return /^[A-Z0-9]+USDT$/.test(t) ? t : "";
}

function isBlockedMarketSymbol(raw, provider) {
  const p = String(provider || BINANCE_ONLY_PROVIDER).trim().toUpperCase();
  if (p !== BINANCE_ONLY_PROVIDER && p !== "BINANCE") return false;
  const sym = normalizeMarketSymbolForProvider(raw, p);
  if (!sym) return false;
  return BINANCEFUT_BLOCKED_MARKETS.has(sym);
}

function allowedMarketsForProvider(provider) {
  if (!isBinanceFuturesProvider(provider)) return [];
  const out = [];
  const seen = new Set();
  for (const mk of BINANCEFUT_CORE_MARKETS) {
    const norm = normalizeMarketSymbolForProvider(mk, BINANCE_ONLY_PROVIDER);
    if (!norm || seen.has(norm) || isBlockedMarketSymbol(norm, BINANCE_ONLY_PROVIDER)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function listFromRaw(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null) return [];
  return String(raw)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeMarketsList(list, provider) {
  if (!Array.isArray(list)) return [];
  const p = String(provider || BINANCE_ONLY_PROVIDER).trim().toUpperCase();
  const normalized = list.map((m) => normalizeMarketSymbolForProvider(m, p)).filter(Boolean);
  const filtered = normalized.filter((m) => /^[A-Z0-9]+USDT$/.test(String(m)) && !isBlockedMarketSymbol(m, p));
  if (!isBinanceFuturesProvider(p)) return filtered;
  const allowedSet = new Set(allowedMarketsForProvider(p));
  return filtered.filter((m) => allowedSet.has(m));
}

function ensureProviderMarkets(markets, provider) {
  const p = String(provider || BINANCE_ONLY_PROVIDER).trim().toUpperCase();
  const normalized = normalizeMarketsList(Array.isArray(markets) ? markets : [], p);
  if (!isBinanceFuturesProvider(p)) {
    const out = [];
    const seen = new Set();
    for (const mk of normalized) {
      if (seen.has(mk)) continue;
      seen.add(mk);
      out.push(mk);
    }
    return out;
  }
  return allowedMarketsForProvider(p);
}

function normalizeTfList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((m) => normalizeTf(m)).filter(Boolean);
}

function filterSupportedTf(list) {
  const rawList = Array.isArray(list) ? list : listFromRaw(list);
  const normalized = normalizeTfList(rawList);
  const supportedSet = new Set(SUPPORTED_TF);
  const supported = [];
  const unsupported = [];
  const seen = new Set();
  const seenUnsupported = new Set();

  for (const tf of normalized) {
    if (supportedSet.has(tf)) {
      if (!seen.has(tf)) {
        supported.push(tf);
        seen.add(tf);
      }
    } else if (!seenUnsupported.has(tf)) {
      unsupported.push(tf);
      seenUnsupported.add(tf);
    }
  }

  return { supported, unsupported };
}

function defaultMarketsFromEnv(provider = BINANCE_ONLY_PROVIDER) {
  const rawFut = String(
    process.env.BINANCEFUT_MARKETS ||
    BINANCEFUT_CORE_MARKETS.join(",")
  ).trim();
  const parsed = rawFut.split(",").map((s) => normalizeMarketSymbolForProvider(s, BINANCE_ONLY_PROVIDER)).filter(Boolean);
  if (isBinanceFuturesProvider(provider)) {
    return ensureProviderMarkets(parsed, provider);
  }
  const merged = [];
  const seen = new Set();
  for (const mk of parsed.concat(BINANCEFUT_CORE_MARKETS)) {
    const norm = normalizeMarketSymbolForProvider(mk, BINANCE_ONLY_PROVIDER);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    merged.push(norm);
  }
  return merged.filter((m) => !isBlockedMarketSymbol(m, BINANCE_ONLY_PROVIDER));
}

function defaultTfAllowlistFromEnv() {
  const execTfDefault = normalizeTf(defaultExecTfFromEnv()) || "15m";
  const raw = String(
    process.env.EXCHANGE_TF_ALLOWLIST ||
    process.env.SIGNAL_TF_ALLOWLIST ||
    execTfDefault
  ).trim();
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const { supported } = filterSupportedTf(list);
  return supported.length ? supported : [execTfDefault];
}

function defaultExecTfFromEnv() {
  const raw = String(
    process.env.EXECUTION_TF ||
    process.env.EXEC_TF ||
    process.env.EXEC_TF_ALLOWLIST ||
    "15m"
  ).trim();
  const list = raw.split(",").map((s) => normalizeTf(s)).filter(Boolean);
  return list.length ? list[0] : "15m";
}

module.exports = {
  SUPPORTED_TF,
  PRIMARY_TF,
  PRIMARY_TF_MS,
  BINANCEFUT_CORE_MARKETS,
  BINANCEFUT_BLOCKED_MARKETS,
  isBlockedMarketSymbol,
  tfToMs,
  normalizeTf,
  normalizeMarketSymbol,
  normalizeMarketSymbolForProvider,
  isBinanceFuturesProvider,
  allowedMarketsForProvider,
  listFromRaw,
  normalizeMarketsList,
  ensureProviderMarkets,
  normalizeTfList,
  filterSupportedTf,
  defaultMarketsFromEnv,
  defaultTfAllowlistFromEnv,
  defaultExecTfFromEnv,
};
