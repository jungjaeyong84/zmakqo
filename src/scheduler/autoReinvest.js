"use strict";

const env = require("../config/env");
const { getRiskBudgetForProvider, getExchangesSettingsCached } = require("../utils/exchangeSettings");
const { pickProviderEntry } = require("../utils/providerUtils");
const { getUpbitAccountSummary } = require("../services/upbitAccountSummary");
const { defaultMarketsFromEnv, defaultExecTfFromEnv, normalizeTf } = require("../utils/marketConfig");
const { fetchRecentNewFills, buildTradesFromFillsWithFunding } = require("../services/tradesFromFills");
const { invalidateRiskBudgetCache } = require("../storage/settings");
const { getFirestore } = require("../storage/firestore");
const { clamp } = require("./helpers");
const { normalizeProviderId } = require("../utils/providerUtils");

function reinvestScanLimit(lastMs) {
  const boot = Number(env.reinvest.bootLimit || 5000);
  const steady = Number(env.reinvest.scanLimit || 600);
  const pick = (Number(lastMs || 0) > 0) ? steady : boot;
  const capped = clamp(pick, 100, 20000);
  return Number.isFinite(capped) ? Math.trunc(capped) : 5000;
}

async function computeReinvestDelta({ exchange, markets, sinceMs, tf }) {
  const lastMs = Number(sinceMs || 0) || 0;
  const tfFinal = normalizeTf(tf || defaultExecTfFromEnv()) || "15m";
  let maxCloseMs = lastMs;
  let totalProfit = 0;
  const perMarketProfit = {};
  const limitN = reinvestScanLimit(lastMs);

  for (const market of markets) {
    const fills = await fetchRecentNewFills({
      exchange,
      symbol: market,
      tf: tfFinal,
      limitN,
    });
    const { trades } = await buildTradesFromFillsWithFunding(fills, { exchange, symbol: market });
    for (const t of trades) {
      const closeMs = Number(t.close_ms);
      if (!Number.isFinite(closeMs) || closeMs <= lastMs) continue;
      if (closeMs > maxCloseMs) maxCloseMs = closeMs;
      const pnl = Number(t.pnl_krw);
      if (!Number.isFinite(pnl) || pnl <= 0) continue;
      totalProfit += pnl;
      perMarketProfit[market] = (perMarketProfit[market] || 0) + pnl;
    }
  }

  return { totalProfit, perMarketProfit, maxCloseMs };
}

async function maybeAutoReinvest({ exchanges, sys }) {
  try {
    if (normalizeProviderId(process.env.EXCHANGE_PROVIDERS || "BINANCEFUT") === "BINANCEFUT") {
      return { ok: true, skipped: true, reason: "BINANCE_ONLY_RUNTIME" };
    }
    if (!sys || sys.reinvest_enabled !== true) {
      return { ok: true, skipped: true, reason: "DISABLED" };
    }
    const ratio = Number(sys.reinvest_ratio);
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return { ok: true, skipped: true, reason: "BAD_RATIO" };
    }

    const exCfg = Array.isArray(exchanges)
      ? exchanges.find((x) => String(x.provider || "").toUpperCase() === "UPBIT" && x.enabled !== false)
      : null;
    if (!exCfg) return { ok: true, skipped: true, reason: "NO_UPBIT" };

    const markets = Array.isArray(exCfg.markets) && exCfg.markets.length
      ? exCfg.markets
      : defaultMarketsFromEnv("UPBIT");
    if (!markets.length) return { ok: true, skipped: true, reason: "NO_MARKETS" };

    const rb = await getRiskBudgetForProvider("UPBIT", 0);
    const risk = rb && rb.data ? rb.data : null;
    if (!risk || risk.enabled !== true) return { ok: true, skipped: true, reason: "RISK_BUDGET_DISABLED" };

    const reinvestState = (risk.reinvest && typeof risk.reinvest === "object") ? risk.reinvest : {};
    const lastCloseMs = Number(reinvestState.last_close_ms || 0) || 0;

    const { totalProfit, perMarketProfit, maxCloseMs } = await computeReinvestDelta({
      exchange: "UPBIT",
      markets,
      sinceMs: lastCloseMs,
      tf: exCfg && exCfg.exec_tf ? exCfg.exec_tf : defaultExecTfFromEnv(),
    });

    if (maxCloseMs <= lastCloseMs) {
      return { ok: true, skipped: true, reason: "NO_NEW_TRADES" };
    }

    const reinvestTotal = totalProfit * ratio;
    const nowIsoStr = new Date().toISOString();

    let accountTotalKrw = null;
    try {
      const exRes = await getExchangesSettingsCached(0);
      const exData = exRes && exRes.data ? exRes.data : {};
      const entry = pickProviderEntry(exData.exchanges, "UPBIT");
      const useLegacy = !entry && normalizeProviderId(exData.provider || "") === "UPBIT";
      const accessKey = String((entry && entry.api_key) || (useLegacy ? (exData.api_key || "") : ""));
      const secretKey = String((entry && entry.api_secret) || (useLegacy ? (exData.api_secret || "") : ""));
      if (accessKey && secretKey) {
        const summary = await getUpbitAccountSummary({ accessKey, secretKey });
        accountTotalKrw = Number(summary && summary.total_krw) || null;
      }
    } catch (_) {}

    const baseTotal = Number(risk.total_max_krw || 0);
    let nextTotal = (Number.isFinite(baseTotal) && baseTotal > 0 && reinvestTotal > 0)
      ? Math.round(baseTotal + reinvestTotal)
      : baseTotal;

    const byMarket = (risk.by_market && typeof risk.by_market === "object")
      ? { ...risk.by_market }
      : {};

    if (reinvestTotal > 0) {
      for (const [mk, pnl] of Object.entries(perMarketProfit)) {
        const add = Number(pnl) * ratio;
        if (!Number.isFinite(add) || add <= 0) continue;
        const base = Number(byMarket[mk] ?? risk.default_max_krw ?? 0) || 0;
        byMarket[mk] = Math.round(base + add);
      }
    }

    const nextState = {
      last_close_ms: maxCloseMs,
      last_close_iso: new Date(maxCloseMs).toISOString(),
      total_profit_krw: totalProfit,
    };

    const db = getFirestore();
    const payload = {
      enabled: true,
      execution_mode: risk.execution_mode || "PAPER",
      total_max_krw: nextTotal,
      default_max_krw: risk.default_max_krw,
      by_market: byMarket,
      unit: risk.unit || "KRW",
      reinvest: nextState,
      updated_at: nowIsoStr,
      updated_by: "auto_reinvest",
    };
    await db.collection("settings").doc("risk_budget").set(payload, { merge: true });
    try { invalidateRiskBudgetCache(); } catch (_) {}

    const snapshot = {
      ...risk,
      by_market: byMarket,
      total_max_krw: nextTotal,
      updated_at: nowIsoStr,
      updated_by: "auto_reinvest",
    };

    await db.collection("risk_budget_history").add({
      created_at: nowIsoStr,
      created_by: "auto_reinvest",
      source: "auto_reinvest",
      delta_total_krw: reinvestTotal > 0 ? Math.round(reinvestTotal) : 0,
      ratio,
      exchange: "UPBIT",
      markets,
      per_market_profit: perMarketProfit,
      reinvest_state: nextState,
      snapshot,
    });

    return {
      ok: true,
      applied: reinvestTotal > 0,
      reinvest_total_krw: reinvestTotal > 0 ? Math.round(reinvestTotal) : 0,
      last_close_ms: maxCloseMs,
      markets: Object.keys(perMarketProfit),
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

module.exports = {
  reinvestScanLimit,
  computeReinvestDelta,
  maybeAutoReinvest,
};
