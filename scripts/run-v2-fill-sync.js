#!/usr/bin/env node
"use strict";

const { syncBinanceFuturesFills } = require("../src/services/binanceFuturesFillsSync");
const { getExchangeSettingsForProvider } = require("../src/utils/exchangeSettings");
const { defaultExecTfFromEnv } = require("../src/utils/marketConfig");

function parseSymbols(raw) {
  return String(raw || "")
    .split(/[|,]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

async function main({ env = process.env } = {}) {
  const ex = await getExchangeSettingsForProvider("BINANCEFUT", 5000);
  const symbols = parseSymbols(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS);
  const markets = symbols.length
    ? symbols
    : (Array.isArray(ex && ex.markets)
      ? ex.markets.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
      : []);
  const lookbackHours = Number(env.BINANCEFUT_FILLS_SYNC_CRON_LOOKBACK_HOURS) || 12;
  const result = await syncBinanceFuturesFills({
    markets,
    execTf: ex && ex.exec_tf ? ex.exec_tf : (defaultExecTfFromEnv() || "15m"),
    executionMode: "LIVE",
    liveEnabled: true,
    lookbackMs: lookbackHours * 60 * 60 * 1000,
    minIntervalMs: 0,
    force: true,
    reprocessExisting: String(env.BINANCEFUT_FILLS_SYNC_CRON_REPROCESS_EXISTING || "0") === "1",
  });
  return Object.freeze({
    ok: result && result.ok === true,
    market_n: markets.length,
    result,
  });
}

if (require.main === module) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result || result.ok !== true) process.exit(1);
    })
    .catch((error) => {
      const payload = {
        ok: false,
        reason: "V2_FILL_SYNC_RUNNER_FAILED",
        message: error && error.message ? error.message : String(error),
      };
      process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exit(1);
    });
} else {
  module.exports = { main };
}
