const { getExchangeSettingsForProvider } = require("./exchangeSettings");
const { getExchangesSettingsCached } = require("../storage/settings");

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { ts: 0, apiKey: "", apiSecret: "", source: "missing" };

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function readRawProviderKeys(raw) {
  const data = raw && raw.data ? raw.data : {};
  const exchanges = data && typeof data.exchanges === "object" ? data.exchanges : {};
  const entry = exchanges.BINANCEFUT || exchanges.BINANCE || null;
  return {
    apiKey: pickFirstNonEmpty(
      entry && entry.api_key,
      data.api_key
    ),
    apiSecret: pickFirstNonEmpty(
      entry && entry.api_secret,
      data.api_secret
    ),
  };
}

async function resolveBinanceFuturesKeys({ ttlMs = 5000, allowCache = true } = {}) {
  const envKey = pickFirstNonEmpty(process.env.BINANCEFUT_API_KEY, process.env.BINANCE_API_KEY);
  const envSecret = pickFirstNonEmpty(process.env.BINANCEFUT_API_SECRET, process.env.BINANCE_API_SECRET);
  if (envKey && envSecret) {
    cache = { ts: Date.now(), apiKey: envKey, apiSecret: envSecret, source: "env" };
    return { apiKey: envKey, apiSecret: envSecret, source: "env" };
  }

  try {
    const ex = await getExchangeSettingsForProvider("BINANCEFUT", ttlMs);
    const apiKey = pickFirstNonEmpty(ex && ex.api_key);
    const apiSecret = pickFirstNonEmpty(ex && ex.api_secret);
    if (apiKey && apiSecret) {
      process.env.BINANCEFUT_API_KEY = apiKey;
      process.env.BINANCEFUT_API_SECRET = apiSecret;
      cache = { ts: Date.now(), apiKey, apiSecret, source: "provider_settings" };
      return { apiKey, apiSecret, source: "provider_settings" };
    }
  } catch (_) {
    // Fall through to raw settings/cache.
  }

  try {
    const raw = await getExchangesSettingsCached(ttlMs);
    const keys = readRawProviderKeys(raw);
    if (keys.apiKey && keys.apiSecret) {
      process.env.BINANCEFUT_API_KEY = keys.apiKey;
      process.env.BINANCEFUT_API_SECRET = keys.apiSecret;
      cache = { ts: Date.now(), apiKey: keys.apiKey, apiSecret: keys.apiSecret, source: "raw_settings" };
      return { apiKey: keys.apiKey, apiSecret: keys.apiSecret, source: "raw_settings" };
    }
  } catch (_) {
    // Fall through to cache.
  }

  if (
    allowCache &&
    cache.apiKey &&
    cache.apiSecret &&
    (Date.now() - cache.ts) <= CACHE_TTL_MS
  ) {
    return { apiKey: cache.apiKey, apiSecret: cache.apiSecret, source: "cache" };
  }

  return { apiKey: "", apiSecret: "", source: "missing" };
}

module.exports = {
  resolveBinanceFuturesKeys,
};
