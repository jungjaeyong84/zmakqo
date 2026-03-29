const BINANCE_ONLY_PROVIDER = "BINANCEFUT";

function normalizeProviderId(raw, fallback = BINANCE_ONLY_PROVIDER) {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return fallback;
  if (v.includes("BINANCE")) return BINANCE_ONLY_PROVIDER;
  return fallback;
}

function pickProviderEntry(map, provider) {
  if (!map || typeof map !== "object") return null;
  const key = normalizeProviderId(provider);
  if (map[key]) return map[key];
  const alt = Object.keys(map).find((k) => String(k || "").trim().toUpperCase().includes("BINANCE"));
  return alt ? map[alt] : null;
}

module.exports = { BINANCE_ONLY_PROVIDER, normalizeProviderId, pickProviderEntry };
