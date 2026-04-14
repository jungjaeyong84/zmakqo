"use strict";

const { getExchangesSettingsCached } = require("../storage/settings");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

async function resolveBinanceKeys() {
  const raw = await getExchangesSettingsCached(5000).catch(() => null);
  const data = raw && raw.data ? raw.data : {};
  const entry = data && data.exchanges && typeof data.exchanges === "object"
    ? (data.exchanges.BINANCEFUT || data.exchanges.binancefut || null)
    : null;
  const legacy = !entry && upper(data.provider) === "BINANCEFUT" ? data : null;
  const apiKey = String(process.env.BINANCEFUT_API_KEY || (entry && entry.api_key) || (legacy && legacy.api_key) || "").trim();
  const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (entry && entry.api_secret) || (legacy && legacy.api_secret) || "").trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

module.exports = {
  resolveBinanceKeys,
};
