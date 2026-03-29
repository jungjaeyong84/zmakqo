const { getEffectiveExchangesSettings, getMultiExchangesSettings, getExchangeSettingsForProvider } = require("./exchangeSettings");
const { normalizeProviderId, BINANCE_ONLY_PROVIDER } = require("./providerUtils");
const { normalizeTf, defaultExecTfFromEnv } = require("./marketConfig");

function normalizeExchangeId(raw, fallback = BINANCE_ONLY_PROVIDER) {
  return normalizeProviderId(raw || "", fallback);
}

function parseForcedProviders(raw) {
  const text = String(raw || "");
  if (!text.trim()) return [];
  const seen = new Set();
  const out = [];
  for (const token of text.split(/[\n,\s]+/)) {
    const norm = normalizeProviderId(token, "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function parseRequestedExchange(raw) {
  const norm = normalizeProviderId(raw || "", "");
  if (norm === BINANCE_ONLY_PROVIDER) return norm;
  return null;
}

async function resolveExchangeFromReq(req, ttlMs = 2000) {
  const exCfg = await getEffectiveExchangesSettings(ttlMs);
  const fallback = normalizeExchangeId(exCfg && exCfg.provider ? exCfg.provider : BINANCE_ONLY_PROVIDER);
  const rawQuery = String((req && req.query && req.query.exchange) || "").trim();
  let rawCookie = "";
  try {
    const cookie = String((req && req.headers && req.headers.cookie) || "");
    const m = cookie.match(/(?:^|;\s*)db_exchange_mode=([^;]+)/i);
    rawCookie = m ? decodeURIComponent(m[1]) : "";
  } catch (_) {
    rawCookie = "";
  }
  const raw = rawQuery || rawCookie;
  const forcedProviders = parseForcedProviders(process.env.EXCHANGE_PROVIDERS);
  const forcedFallback = forcedProviders.includes(fallback) ? fallback : (forcedProviders[0] || fallback);

  if (!raw) return { exchange: fallback, exCfg, override: false };
  const requested = parseRequestedExchange(raw);
  if (!requested) {
    return { exchange: forcedFallback, exCfg, override: false, forced: !!forcedProviders.length };
  }

  if (forcedProviders.length) {
    if (!forcedProviders.includes(requested)) {
      return { exchange: forcedFallback, exCfg, override: false, forced: true };
    }
    return { exchange: requested, exCfg, override: requested !== forcedFallback, forced: true };
  }

  const multi = await getMultiExchangesSettings(ttlMs);
  const allowed = new Set();
  if (multi && Array.isArray(multi.exchanges)) {
    for (const e of multi.exchanges) {
      const p = normalizeExchangeId(e && e.provider ? e.provider : "");
      if (p) allowed.add(p);
    }
  }
  if (allowed.size && !allowed.has(requested)) {
    return { exchange: fallback, exCfg, override: false };
  }
  return { exchange: requested, exCfg, override: requested !== fallback };
}

async function resolveMarketsForExchange(exchange, ttlMs = 2000) {
  const ex = await getExchangeSettingsForProvider(exchange, ttlMs);
  return (ex && Array.isArray(ex.markets) && ex.markets.length) ? ex.markets : [];
}

async function resolveRuntimeMarketsForExchange(exchange, ttlMs = 2000) {
  const requested = normalizeExchangeId(exchange || "");
  const effective = await getEffectiveExchangesSettings(ttlMs);
  const effectiveExchange = normalizeExchangeId(effective && effective.provider ? effective.provider : "");
  if (requested && requested === effectiveExchange) {
    const effectiveMarkets = Array.isArray(effective && effective.markets) ? effective.markets.filter(Boolean) : [];
    if (effectiveMarkets.length) return effectiveMarkets;
  }
  return resolveMarketsForExchange(requested || effectiveExchange, ttlMs);
}

async function resolveExecTfForExchange(exchange, fallback = defaultExecTfFromEnv(), ttlMs = 2000) {
  const ex = await getExchangeSettingsForProvider(exchange, ttlMs);
  if (ex && ex.exec_tf) return ex.exec_tf;
  return fallback;
}

function schedulerMatchesExchange(schedulerStatus, exchange) {
  const target = normalizeExchangeId(exchange || "");
  const raw = String((schedulerStatus && schedulerStatus.exchange) || "").toUpperCase();
  if (!target || !raw) return false;
  return raw.split("+").map((s) => normalizeExchangeId(s || "")).includes(target);
}

async function resolveRuntimeTfContext(req, exchange, { fallback = defaultExecTfFromEnv(), ttlMs = 2000 } = {}) {
  const target = normalizeExchangeId(exchange || "");
  let signalTf = null;
  let execTf = null;

  try {
    const sched = req && req.app && req.app.locals && req.app.locals.scheduler && typeof req.app.locals.scheduler.status === "function"
      ? req.app.locals.scheduler.status()
      : null;
    if (sched && schedulerMatchesExchange(sched, target)) {
      signalTf = normalizeTf(sched.signal_tf || sched.tf || (sched.lastTick && sched.lastTick.tf) || "");
      execTf = normalizeTf(sched.exec_tf || (sched.lastTick && sched.lastTick.exec_tf) || signalTf || "");
    }
  } catch (_) {}

  const ex = await getExchangeSettingsForProvider(target, ttlMs);
  const tfRaw = ex && ex.tf_allowlist;
  const tfList = Array.isArray(tfRaw)
    ? tfRaw
    : String(tfRaw || "").split(",").map((s) => s.trim()).filter(Boolean);
  const configSignalTf = tfList.map((t) => normalizeTf(t)).filter(Boolean)[0] || null;
  const configExecTf = normalizeTf((ex && ex.exec_tf) || "") || null;

  signalTf = signalTf || configSignalTf || configExecTf || normalizeTf(fallback) || "15m";
  execTf = execTf || configExecTf || signalTf || normalizeTf(fallback) || "15m";

  return { signalTf, execTf };
}

module.exports = {
  resolveExchangeFromReq,
  resolveMarketsForExchange,
  resolveRuntimeMarketsForExchange,
  resolveExecTfForExchange,
  resolveRuntimeTfContext,
  normalizeExchangeId,
};
