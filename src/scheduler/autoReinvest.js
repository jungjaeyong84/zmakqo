"use strict";

const env = require("../config/env");
const { clamp } = require("./helpers");

function reinvestScanLimit(lastMs) {
  const boot = Number(env.reinvest.bootLimit || 5000);
  const steady = Number(env.reinvest.scanLimit || 600);
  const pick = (Number(lastMs || 0) > 0) ? steady : boot;
  const capped = clamp(pick, 100, 20000);
  return Number.isFinite(capped) ? Math.trunc(capped) : 5000;
}

async function computeReinvestDelta({ exchange, markets, sinceMs, tf }) {
  return {
    exchange: String(exchange || "").toUpperCase() || "BINANCEFUT",
    markets: Array.isArray(markets) ? markets : [],
    sinceMs: Number(sinceMs || 0) || 0,
    tf: String(tf || ""),
    totalProfit: 0,
    perMarketProfit: {},
    maxCloseMs: Number(sinceMs || 0) || 0,
  };
}

async function maybeAutoReinvest({ exchanges, sys }) {
  return {
    ok: true,
    skipped: true,
    reason: "UPBIT_RUNTIME_REMOVED",
    exchanges: Array.isArray(exchanges) ? exchanges.length : 0,
    reinvest_enabled: Boolean(sys && sys.reinvest_enabled),
  };
}

module.exports = {
  reinvestScanLimit,
  computeReinvestDelta,
  maybeAutoReinvest,
};
