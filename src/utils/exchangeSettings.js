const { getExchangesSettingsCached, getRiskBudgetCached } = require("../storage/settings");
const { getBinanceFuturesAccountSummary } = require("../services/binanceFuturesAccountSummary");
const {
  normalizeMarketsList,
  filterSupportedTf,
  defaultMarketsFromEnv,
  defaultTfAllowlistFromEnv,
  defaultExecTfFromEnv,
  normalizeTf,
  listFromRaw,
  normalizeMarketSymbolForProvider,
  BINANCEFUT_CORE_MARKETS,
  isBlockedMarketSymbol,
  ensureProviderMarkets,
} = require("./marketConfig");
const { normalizeProviderId, pickProviderEntry } = require("./providerUtils");

function detectProviderFromMarkets(rawMarkets) {
  const s = String(rawMarkets || "").toUpperCase();
  if (s.includes("USDT")) return "BINANCEFUT";
  return "BINANCEFUT";
}

function parseBoolEnv(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  return !(s === "0" || s === "false" || s === "no" || s === "off");
}

function getEnvExchangeOverride() {
  if (process.env.EXCHANGE_PROVIDERS) return null;
  const rawProvider = process.env.EXCHANGE_PROVIDER;
  const rawMarkets = process.env.EXCHANGE_MARKETS;
  const rawTf = process.env.EXCHANGE_TF_ALLOWLIST;
  const rawExecTf = process.env.EXCHANGE_EXEC_TF || process.env.EXECUTION_TF || process.env.EXEC_TF;
  const rawEnabled = process.env.EXCHANGE_ENABLED;
  const hasOverride = !!(rawProvider || rawMarkets || rawExecTf || rawEnabled);
  if (!hasOverride) return null;

  let provider = normalizeProviderId(rawProvider || "");
  if (!rawProvider) provider = detectProviderFromMarkets(rawMarkets);

  const marketsRaw = listFromRaw(rawMarkets);
  const markets = marketsRaw.length ? normalizeMarketsList(marketsRaw, provider) : [];
  const { supported: tfAllowSupported } = filterSupportedTf(listFromRaw(rawTf));
  const enabled = parseBoolEnv(rawEnabled);
  const execTf = normalizeTf(rawExecTf || defaultExecTfFromEnv());

  return {
    provider,
    markets,
    tf_allowlist: tfAllowSupported,
    exec_tf: execTf,
    enabled,
    locked_by_env: true,
  };
}

function getForcedProviderEnvOverride(provider) {
  const target = normalizeProviderId(provider || "");
  const forcedProviders = parseExchangeProviders(process.env.EXCHANGE_PROVIDERS || "");
  if (!target || !forcedProviders.length || !forcedProviders.includes(target)) return null;

  const marketsEnv = envMarketsForProvider(target);
  const tfRaw = process.env.EXCHANGE_TF_ALLOWLIST || process.env.SIGNAL_TF_ALLOWLIST;
  const { supported: tfAllowSupported } = filterSupportedTf(listFromRaw(tfRaw));
  const rawExecTf = process.env.EXCHANGE_EXEC_TF || process.env.EXECUTION_TF || process.env.EXEC_TF;
  const enabled = parseBoolEnv(process.env.EXCHANGE_ENABLED);

  return {
    provider: target,
    enabled,
    markets: marketsEnv,
    tf_allowlist: tfAllowSupported,
    exec_tf: normalizeTf(rawExecTf || defaultExecTfFromEnv()),
    locked_by_env: true,
  };
}

function ensureBinanceCoreMarkets(markets, provider) {
  return ensureProviderMarkets(markets, provider);
}

function harmonizeTfAllowlist(tfAllowlist, execTf) {
  const exec = normalizeTf(execTf || defaultExecTfFromEnv()) || "15m";
  const { supported } = filterSupportedTf(tfAllowlist);
  if (!supported.length) return [exec];
  if (supported.includes(exec)) return supported;
  if (supported.length === 1 && supported[0] === "60m" && exec !== "60m") return [exec];
  return [exec, ...supported.filter((tf) => tf !== exec)];
}

async function getEffectiveExchangesSettings(ttlMs = 5000) {
  const res = await getExchangesSettingsCached(ttlMs);
  const data = res && res.data ? res.data : {};
  const envOverride = getEnvExchangeOverride();
  const forcedProviders = parseExchangeProviders(process.env.EXCHANGE_PROVIDERS || "");
  let provider = envOverride
    ? normalizeProviderId(envOverride.provider, normalizeProviderId(data.provider))
    : normalizeProviderId(data.provider || resolveProviderFromMap(data.exchanges));
  if (forcedProviders.length && !forcedProviders.includes(provider)) {
    provider = forcedProviders[0];
  }
  let entry = pickProviderEntry(data.exchanges, provider);
  if (!entry && data.exchanges && typeof data.exchanges === "object") {
    provider = resolveProviderFromMap(data.exchanges, provider);
    if (forcedProviders.length && !forcedProviders.includes(provider)) {
      provider = forcedProviders[0];
    }
    entry = pickProviderEntry(data.exchanges, provider);
  }
  const enabled = envOverride && typeof envOverride.enabled === "boolean"
    ? envOverride.enabled
    : (entry && typeof entry.enabled === "boolean" ? entry.enabled : (data.enabled !== false));

  const marketsFromData = normalizeMarketsList(entry && entry.markets ? entry.markets : data.markets, provider);
  const markets = ensureBinanceCoreMarkets(envOverride && envOverride.markets.length
    ? envOverride.markets
    : (marketsFromData.length ? marketsFromData : defaultMarketsFromEnv(provider)), provider);

  const execTf = envOverride && envOverride.exec_tf
    ? normalizeTf(envOverride.exec_tf)
    : normalizeTf((entry && entry.exec_tf) || data.exec_tf || defaultExecTfFromEnv());
  const tfRaw = envOverride && envOverride.tf_allowlist.length
    ? envOverride.tf_allowlist
    : (entry && entry.tf_allowlist ? entry.tf_allowlist : data.tf_allowlist);
  const tfAllow = harmonizeTfAllowlist(tfRaw, execTf);

  return {
    provider,
    enabled,
    markets,
    tf_allowlist: tfAllow,
    exec_tf: execTf,
    locked_by_env: !!envOverride || forcedProviders.length > 0,
    multi_enabled: forcedProviders.length > 1 || !!(data.exchanges && Object.keys(data.exchanges || {}).length > 1),
  };
}

async function getMarketsExpected(ttlMs = 5000) {
  const cfg = await getEffectiveExchangesSettings(ttlMs);
  return cfg.markets;
}

async function getTfAllowlist(ttlMs = 5000) {
  const cfg = await getEffectiveExchangesSettings(ttlMs);
  return cfg.tf_allowlist;
}

function parseExchangeProviders(raw) {
  const list = listFromRaw(raw);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const norm = normalizeProviderId(item);
    if (!seen.has(norm)) {
      out.push(norm);
      seen.add(norm);
    }
  }
  return out;
}

function envMarketsForProvider(provider) {
  const key = `EXCHANGE_MARKETS_${String(provider || "").toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return [];
  const marketsRaw = listFromRaw(raw);
  return normalizeMarketsList(marketsRaw, provider);
}

// pickProviderEntry provided by providerUtils

function resolveProviderFromMap(map, fallback = "BINANCEFUT") {
  if (!map || typeof map !== "object") return normalizeProviderId(fallback);
  if (map.BINANCEFUT) return "BINANCEFUT";
  const binanceKey = Object.keys(map).find((k) => String(k || "").toUpperCase().includes("BINANCE"));
  return binanceKey ? "BINANCEFUT" : normalizeProviderId(fallback);
}

async function getMultiExchangesSettings(ttlMs = 5000) {
  const providersRaw = process.env.EXCHANGE_PROVIDERS;
  if (!providersRaw) {
    const res = await getExchangesSettingsCached(ttlMs);
    const data = res && res.data ? res.data : {};
    if (data.exchanges && typeof data.exchanges === "object" && Object.keys(data.exchanges).length) {
      const exchanges = Object.entries(data.exchanges).map(([provider, entry]) => {
        const p = normalizeProviderId(provider);
        const markets = normalizeMarketsList(entry && entry.markets, p);
        const execTf = normalizeTf((entry && entry.exec_tf) || data.exec_tf || defaultExecTfFromEnv());
        const tfAllow = harmonizeTfAllowlist(
          (Array.isArray(entry && entry.tf_allowlist) && entry.tf_allowlist.length)
            ? entry.tf_allowlist
            : data.tf_allowlist,
          execTf
        );
        return {
          provider: p,
          enabled: entry && typeof entry.enabled === "boolean" ? entry.enabled : true,
          markets: ensureBinanceCoreMarkets(markets.length ? markets : defaultMarketsFromEnv(p), p),
          tf_allowlist: tfAllow,
          exec_tf: execTf,
          locked_by_env: false,
          multi_enabled: true,
        };
      });
      if (exchanges.length > 1) return { mode: "multi", exchanges };
      return { mode: "single", exchanges };
    }
    const single = await getEffectiveExchangesSettings(ttlMs);
    return { mode: "single", exchanges: [single] };
  }

  const providers = parseExchangeProviders(providersRaw);
  const execTf = normalizeTf(defaultExecTfFromEnv());
  const tfRaw = process.env.EXCHANGE_TF_ALLOWLIST || process.env.SIGNAL_TF_ALLOWLIST;
  const tfAllow = harmonizeTfAllowlist(listFromRaw(tfRaw), execTf);
  const exchanges = providers.map((provider) => {
    const marketsEnv = envMarketsForProvider(provider);
    const markets = ensureBinanceCoreMarkets(marketsEnv.length ? marketsEnv : defaultMarketsFromEnv(provider), provider);
    return {
      provider,
      enabled: true,
      markets,
      tf_allowlist: tfAllow,
      exec_tf: execTf,
      locked_by_env: true,
      multi_enabled: true,
    };
  });

  return { mode: "multi", exchanges };
}

async function getExchangeSettingsForProvider(provider, ttlMs = 5000) {
  const target = normalizeProviderId(provider || "BINANCEFUT");
  const forcedProviders = parseExchangeProviders(process.env.EXCHANGE_PROVIDERS || "");
  if (forcedProviders.length && !forcedProviders.includes(target)) {
    return {
      provider: target,
      enabled: false,
      markets: [],
      tf_allowlist: [],
      exec_tf: normalizeTf(defaultExecTfFromEnv()),
      locked_by_env: true,
    };
  }

  const forcedEnvOverride = getForcedProviderEnvOverride(target);
  if (forcedEnvOverride) {
    return {
      provider: target,
      enabled: forcedEnvOverride.enabled !== false,
      markets: ensureBinanceCoreMarkets(
        forcedEnvOverride.markets.length ? forcedEnvOverride.markets : defaultMarketsFromEnv(target),
        target
      ),
      tf_allowlist: harmonizeTfAllowlist(forcedEnvOverride.tf_allowlist, forcedEnvOverride.exec_tf),
      exec_tf: normalizeTf(forcedEnvOverride.exec_tf || defaultExecTfFromEnv()),
      locked_by_env: true,
    };
  }

  const envOverride = getEnvExchangeOverride();
  if (envOverride) {
    const envProvider = normalizeProviderId(envOverride.provider);
    if (envProvider !== target) {
      return { provider: target, enabled: false, markets: [], tf_allowlist: [], locked_by_env: true };
    }
    return {
      provider: envProvider,
      enabled: envOverride.enabled !== false,
      markets: ensureBinanceCoreMarkets(envOverride.markets.length ? envOverride.markets : defaultMarketsFromEnv(envProvider), envProvider),
      tf_allowlist: harmonizeTfAllowlist(envOverride.tf_allowlist, envOverride.exec_tf),
      exec_tf: normalizeTf(envOverride.exec_tf || defaultExecTfFromEnv()),
      locked_by_env: true,
    };
  }

  const res = await getExchangesSettingsCached(ttlMs);
  const data = res && res.data ? res.data : {};
  const activeProvider = normalizeProviderId(data.provider || resolveProviderFromMap(data.exchanges));
  const entry = pickProviderEntry(data.exchanges, target);
  const useLegacy = !entry && target === activeProvider;
  const markets = normalizeMarketsList(entry && entry.markets, target);
  const execTf = normalizeTf((entry && entry.exec_tf) || data.exec_tf || defaultExecTfFromEnv());
  const tfAllow = harmonizeTfAllowlist(
    (Array.isArray(entry && entry.tf_allowlist) && entry.tf_allowlist.length)
      ? entry.tf_allowlist
      : data.tf_allowlist,
    execTf
  );
  return {
    provider: target,
    enabled: entry && typeof entry.enabled === "boolean" ? entry.enabled : (data.enabled !== false),
    markets: ensureBinanceCoreMarkets(markets.length ? markets : defaultMarketsFromEnv(target), target),
    tf_allowlist: tfAllow,
    exec_tf: execTf,
    api_key: entry && entry.api_key ? entry.api_key : (useLegacy ? (data.api_key || null) : null),
    api_secret: entry && entry.api_secret ? entry.api_secret : (useLegacy ? (data.api_secret || null) : null),
    updated_at: entry && entry.updated_at ? entry.updated_at : (useLegacy ? (data.updated_at || null) : null),
    updated_by: entry && entry.updated_by ? entry.updated_by : (useLegacy ? (data.updated_by || null) : null),
    locked_by_env: false,
  };
}

function pickBudgetEntry(raw, provider) {
  const map = (raw && typeof raw.providers === "object") ? raw.providers
    : ((raw && typeof raw.by_provider === "object") ? raw.by_provider : null);
  return pickProviderEntry(map, provider);
}

function defaultBudgetUnit() {
  return "USDT";
}

async function getRiskBudgetForProvider(provider, ttlMs = 5000) {
  const res = await getRiskBudgetCached(ttlMs);
  const raw = res && res.data ? res.data : {};
  const target = normalizeProviderId(provider || "BINANCEFUT");
  let entry = pickBudgetEntry(raw, target);

  const legacyEnabled = raw && (raw.enabled !== undefined || raw.by_market || raw.default_max_krw !== undefined);
  const legacyProvider = normalizeProviderId(raw && raw.provider ? raw.provider : "BINANCEFUT");
  if (!entry && legacyEnabled && target === legacyProvider) {
    entry = raw;
  }

  const unit = String((entry && entry.unit) || defaultBudgetUnit(target)).toUpperCase();
  const data = entry && typeof entry === "object"
    ? { ...entry, provider: target, unit }
    : {
      enabled: false,
      on_exceed: "CLAMP",
      total_max_krw: 0,
      default_max_krw: 0,
      by_market: {},
      provider: target,
      unit,
    };

  if (target === "BINANCEFUT") {
    try {
      const ex = await getExchangeSettingsForProvider("BINANCEFUT", 3000);
      const apiKey = String(process.env.BINANCEFUT_API_KEY || (ex && ex.api_key) || "");
      const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (ex && ex.api_secret) || "");
      if (apiKey && apiSecret) {
        const summary = await getBinanceFuturesAccountSummary({ apiKey, apiSecret });
        const totalValue = Number(summary && summary.total_value);
        if (Number.isFinite(totalValue) && totalValue > 0) {
          data.total_max_krw = totalValue;
          data.total_max_source = "account_total";
          data.account_total_value = totalValue;
        }
      }
    } catch (_) {}
  }

  return { ok: true, data, source: res && res.source ? res.source : "unknown" };
}

module.exports = {
  getEffectiveExchangesSettings,
  getExchangeSettingsForProvider,
  getMarketsExpected,
  getTfAllowlist,
  getEnvExchangeOverride,
  getMultiExchangesSettings,
  getRiskBudgetForProvider,
  normalizeProviderId,
  __test: {
    harmonizeTfAllowlist,
  },
};
