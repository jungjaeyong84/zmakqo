#!/usr/bin/env node
"use strict";

const { repairLiveTrailingStageForSymbol } = require("../src/services/liveTrailingStageRepair");
const { resolveBinanceKeys: resolveBinanceKeysShared } = require("../src/services/binanceApiKeys");
const { fetchBinanceFuturesAccount } = require("../src/exchanges/binanceFuturesPrivate");

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function parseSymbolsArg(argv) {
  const raw = argv.find((item) => String(item || "").startsWith("--symbols="));
  if (!raw) return [];
  return String(raw.split("=")[1] || "")
    .split(",")
    .map(normalizeSymbol)
    .filter(Boolean);
}

async function resolveBinanceKeys() {
  const resolved = await resolveBinanceKeysShared().catch(() => null);
  if (!resolved || !resolved.apiKey || !resolved.apiSecret) {
    throw new Error("BINANCE_KEYS_MISSING");
  }
  return resolved;
}

async function main() {
  const symbolFilter = parseSymbolsArg(process.argv.slice(2));
  const keys = await resolveBinanceKeys();
  const account = await fetchBinanceFuturesAccount(keys);
  const activeSymbols = (account.positions || [])
    .filter((row) => Number(row.positionAmt || 0) !== 0)
    .map((row) => normalizeSymbol(row.symbol))
    .filter((symbol) => !symbolFilter.length || symbolFilter.includes(symbol));

  const results = [];
  for (const symbol of activeSymbols) {
    results.push(await repairLiveTrailingStageForSymbol({ exchange: "BINANCEFUT", symbol, keys }));
  }
  console.log(JSON.stringify({
    ok: true,
    repaired_at: new Date().toISOString(),
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err && err.message ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
