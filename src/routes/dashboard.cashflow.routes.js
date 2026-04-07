const express = require("express");
const router = express.Router();

const { resolveExchangeFromReq } = require("../utils/resolveExchange");
const { getBinanceWalletCashflow } = require("../services/binanceWalletCashflow");

const CASHFLOW_CACHE_MS = Number(process.env.DASHBOARD_CACHE_MS || 60000);
const cashflowCache = new Map();
const CASHFLOW_POLICY_VERSION = "EXTERNAL_ONLY_V1";

const RANGE_MAP = {
  d7: { key: "d7", days: 7, label: "최근 7일" },
  d30: { key: "d30", days: 30, label: "최근 30일" },
  d90: { key: "d90", days: 90, label: "최근 90일" },
};
const MAX_CUSTOM_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

function getCache(key) {
  const hit = cashflowCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CASHFLOW_CACHE_MS) {
    cashflowCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key, data) {
  cashflowCache.set(key, { at: Date.now(), data });
}

function parseKstDateToMs(raw, endOfDay = false) {
  const v = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const base = Date.parse(`${v}T00:00:00+09:00`);
  if (!Number.isFinite(base)) return null;
  return endOfDay ? (base + DAY_MS - 1) : base;
}

router.get("/dashboard/cashflow", async (req, res) => {
  const rangeKeyRaw = String(req.query && req.query.range || "").toLowerCase();
  const range = RANGE_MAP[rangeKeyRaw] || RANGE_MAP.d30;
  const startRaw = String(req.query && req.query.start || "").trim();
  const endRaw = String(req.query && req.query.end || "").trim();
  const startMsRaw = parseKstDateToMs(startRaw, false);
  const endMsRaw = parseKstDateToMs(endRaw, true);
  const hasCustom = Number.isFinite(startMsRaw) && Number.isFinite(endMsRaw) && endMsRaw >= startMsRaw;
  let customStartMs = hasCustom ? startMsRaw : null;
  let customEndMs = hasCustom ? endMsRaw : null;
  let rangeWarning = null;
  let resolvedExchange = String((req.query && req.query.exchange) || "BINANCEFUT").toUpperCase();

  if (hasCustom) {
    const maxMs = customStartMs + MAX_CUSTOM_DAYS * DAY_MS - 1;
    if (customEndMs > maxMs) {
      customEndMs = maxMs;
      rangeWarning = `기간이 너무 길어서 ${MAX_CUSTOM_DAYS}일로 자동 제한했습니다.`;
    }
  }

  try {
    const { exchange } = await resolveExchangeFromReq(req, 2000);
    const ex = String(exchange || "BINANCEFUT").toUpperCase();
    resolvedExchange = ex;
    const supported = ex.includes("BINANCE");

    if (!supported) {
      return res.render(String(req.query.legacy || "").trim() === "1" ? "cashflow.legacy.ejs" : "cashflow", {
        exchange: ex,
        supported: false,
        cashflow: null,
        range,
        customRange: null,
        ranges: Object.values(RANGE_MAP),
        rangeWarning: null,
        error: "BINANCEFUT 전용 기능입니다.",
      });
    }

    const cacheKey = hasCustom
      ? `${CASHFLOW_POLICY_VERSION}:${ex}:custom:${customStartMs}:${customEndMs}`
      : `${CASHFLOW_POLICY_VERSION}:${ex}:${range.key}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.render(String(req.query.legacy || "").trim() === "1" ? "cashflow.legacy.ejs" : "cashflow", {
        exchange: ex,
        supported: true,
        cashflow: cached,
        range: hasCustom ? { key: "custom", days: null, label: "기간선택" } : range,
        customRange: hasCustom ? { start: startRaw, end: endRaw } : null,
        ranges: Object.values(RANGE_MAP),
        rangeWarning,
        error: null,
      });
    }

    const cashflow = hasCustom
      ? await getBinanceWalletCashflow({ startMs: customStartMs, endMs: customEndMs })
      : await getBinanceWalletCashflow({ rangeDays: range.days });
    setCache(cacheKey, cashflow);
    return res.render(String(req.query.legacy || "").trim() === "1" ? "cashflow.legacy.ejs" : "cashflow", {
      exchange: ex,
      supported: true,
      cashflow,
      range: hasCustom ? { key: "custom", days: null, label: "기간선택" } : range,
      customRange: hasCustom ? { start: startRaw, end: endRaw } : null,
      ranges: Object.values(RANGE_MAP),
      rangeWarning,
      error: null,
    });
  } catch (e) {
    return res.render(String(req.query.legacy || "").trim() === "1" ? "cashflow.legacy.ejs" : "cashflow", {
      exchange: resolvedExchange,
      supported: resolvedExchange.includes("BINANCE"),
      cashflow: null,
      range: hasCustom ? { key: "custom", days: null, label: "기간선택" } : range,
      customRange: hasCustom ? { start: startRaw, end: endRaw } : null,
      ranges: Object.values(RANGE_MAP),
      rangeWarning,
      error: e && e.message ? String(e.message) : "입출금 데이터를 불러오지 못했습니다.",
      _error: { code: "CASHFLOW_ROUTE_ERROR", message: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    });
  }
});

module.exports = router;
