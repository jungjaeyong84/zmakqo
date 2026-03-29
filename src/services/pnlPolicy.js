const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { fetchRecentNewFills, buildTradesFromFillsWithFunding, buildExternalPnlRowsFromFills } = require("./tradesFromFills");
const { fetchFundingFees } = require("./fundingFees");
const { kstStartOfDayMs } = require("../utils/timeKst");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCOPE_DAYS = 730;
const DEFAULT_SCOPE_DAYS = 730;
const DEFAULT_POLICY = "BINANCEFUT_EXTERNAL_FIRST_FALLBACK";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseScopeDays(raw) {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCOPE_DAYS;
  if (n > MAX_SCOPE_DAYS) return MAX_SCOPE_DAYS;
  return n;
}

function getPnlScopeDays() {
  return parseScopeDays(process.env.DASHBOARD_PNL_SCOPE_DAYS);
}

function getPnlSourcePolicy() {
  return DEFAULT_POLICY;
}

function isBinanceFutExchange(exchange) {
  const ex = String(exchange || "").toUpperCase();
  return ex.includes("BINANCE");
}

function getScopeFromMs(nowMs = Date.now(), scopeDays = getPnlScopeDays()) {
  const dayStartMs = kstStartOfDayMs(nowMs);
  if (!Number.isFinite(dayStartMs)) return null;
  const days = parseScopeDays(scopeDays);
  return dayStartMs - (days - 1) * DAY_MS;
}

function withinRange(ms, fromMs, toMs) {
  if (!Number.isFinite(ms)) return false;
  if (Number.isFinite(fromMs) && ms < fromMs) return false;
  if (Number.isFinite(toMs) && ms >= toMs) return false;
  return true;
}

function normalizeRows(rows, { fromMs = null, toMs = null, source = "UNKNOWN" } = {}) {
  const out = [];
  for (const row of (rows || [])) {
    const closeMs = toNum(row && row.close_ms);
    if (!Number.isFinite(closeMs) || !withinRange(closeMs, fromMs, toMs)) continue;
    const pnl = toNum(row && row.pnl_krw);
    if (pnl == null) continue;
    out.push({
      close_ms: closeMs,
      pnl_krw: pnl,
      notional_krw: toNum(row && row.notional_krw),
      source,
    });
  }
  return out;
}

function summarizeRows(rows) {
  let total = 0;
  let trades = 0;
  for (const row of (rows || [])) {
    const pnl = toNum(row && row.pnl_krw);
    if (pnl == null) continue;
    total += pnl;
    trades += 1;
  }
  return { total, trades };
}

function classifySourceMode(exchange, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "NONE";
  const seen = new Set();
  for (const row of rows) {
    seen.add(String(row && row.source || "UNKNOWN").toUpperCase());
  }
  if (seen.size > 1) return "MIXED";
  const only = Array.from(seen)[0];
  if (only === "EXTERNAL") return "EXTERNAL";
  if (isBinanceFutExchange(exchange)) return "FALLBACK";
  return "TRADE_RECON";
}

async function loadRealizedRowsForMarket({
  exchange,
  symbol,
  tf = defaultExecTfFromEnv() || "15m",
  fallbackTf = defaultExecTfFromEnv() || "15m",
  mode = "EACH_SELL",
  limitN = 2000,
  fromMs = null,
  toMs = null,
  includeFunding = false,
} = {}) {
  const primaryTf = String(tf || fallbackTf || defaultExecTfFromEnv() || "15m");
  const secondaryTf = (fallbackTf && String(fallbackTf) !== primaryTf) ? String(fallbackTf) : null;
  let fills = await fetchRecentNewFills({ exchange, symbol, tf: primaryTf, limitN, fromMs });
  let secondaryFills = null;

  let rows = [];
  if (isBinanceFutExchange(exchange)) {
    const externalRows = buildExternalPnlRowsFromFills(fills, { fromMs });
    if (externalRows.length) {
      rows = normalizeRows(externalRows, { fromMs, toMs, source: "EXTERNAL" });
      let outRows = rows;
      if (includeFunding) {
        const fundingFees = await fetchFundingFees({
          exchange,
          symbol,
          startMs: Number.isFinite(fromMs) ? fromMs : 0,
          endMs: Number.isFinite(toMs) ? (toMs - 1) : Date.now(),
          limit: Math.max(5000, limitN),
        });
        const fundingRows = normalizeRows(
          (fundingFees || []).map((f) => ({
            close_ms: f.time_ms,
            pnl_krw: f.income,
            notional_krw: null,
          })),
          { fromMs, toMs, source: "FUNDING" }
        );
        if (fundingRows.length) outRows = outRows.concat(fundingRows);
      }
      return {
        rows: outRows,
        source_mode: classifySourceMode(exchange, outRows),
        fills_n: Array.isArray(fills) ? fills.length : 0,
      };
    }
    if (secondaryTf) {
      secondaryFills = await fetchRecentNewFills({ exchange, symbol, tf: secondaryTf, limitN, fromMs });
      const externalRowsSecondary = buildExternalPnlRowsFromFills(secondaryFills, { fromMs });
      if (externalRowsSecondary.length) {
        rows = normalizeRows(externalRowsSecondary, { fromMs, toMs, source: "EXTERNAL" });
        let outRows = rows;
        if (includeFunding) {
          const fundingFees = await fetchFundingFees({
            exchange,
            symbol,
            startMs: Number.isFinite(fromMs) ? fromMs : 0,
            endMs: Number.isFinite(toMs) ? (toMs - 1) : Date.now(),
            limit: Math.max(5000, limitN),
          });
          const fundingRows = normalizeRows(
            (fundingFees || []).map((f) => ({
              close_ms: f.time_ms,
              pnl_krw: f.income,
              notional_krw: null,
            })),
            { fromMs, toMs, source: "FUNDING" }
          );
          if (fundingRows.length) outRows = outRows.concat(fundingRows);
        }
        return {
          rows: outRows,
          source_mode: classifySourceMode(exchange, outRows),
          fills_n: Array.isArray(secondaryFills) ? secondaryFills.length : 0,
        };
      }
    }
  }

  if ((!fills || !fills.length) && secondaryTf) {
    if (!secondaryFills) {
      secondaryFills = await fetchRecentNewFills({ exchange, symbol, tf: secondaryTf, limitN, fromMs });
    }
    if (Array.isArray(secondaryFills) && secondaryFills.length) {
      fills = secondaryFills;
    }
  }

  const { trades } = await buildTradesFromFillsWithFunding(fills, { mode, exchange, symbol });
  rows = normalizeRows(
    (trades || []).map((t) => ({
      close_ms: t.close_ms,
      pnl_krw: t.pnl_krw,
      notional_krw: t.notional_krw,
    })),
    { fromMs, toMs, source: "FALLBACK" }
  );

  let outRows = rows;
  if (includeFunding && isBinanceFutExchange(exchange)) {
    const fundingFees = await fetchFundingFees({
      exchange,
      symbol,
      startMs: Number.isFinite(fromMs) ? fromMs : 0,
      endMs: Number.isFinite(toMs) ? (toMs - 1) : Date.now(),
      limit: Math.max(5000, limitN),
    });
    const fundingRows = normalizeRows(
      (fundingFees || []).map((f) => ({
        close_ms: f.time_ms,
        pnl_krw: f.income,
        notional_krw: null,
      })),
      { fromMs, toMs, source: "FUNDING" }
    );
    if (fundingRows.length) outRows = outRows.concat(fundingRows);
  }

  return {
    rows: outRows,
    source_mode: classifySourceMode(exchange, outRows),
    fills_n: Array.isArray(fills) ? fills.length : 0,
  };
}

module.exports = {
  DAY_MS,
  MAX_SCOPE_DAYS,
  DEFAULT_SCOPE_DAYS,
  getPnlScopeDays,
  getPnlSourcePolicy,
  getScopeFromMs,
  isBinanceFutExchange,
  summarizeRows,
  classifySourceMode,
  loadRealizedRowsForMarket,
};
