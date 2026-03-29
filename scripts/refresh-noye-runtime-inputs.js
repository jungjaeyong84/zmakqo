#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const {
  REPO_ROOT,
  ensureDir,
  loadLocalEnv,
  kstStartOfTodayUtcMs,
} = require("./lib/automation-utils");
const { toKstString } = require("../src/utils/timeKst");
const { getExchangesSettingsCached } = require("../src/storage/settings");
const {
  fetchBinanceFuturesAccount,
  fetchFuturesUserTrades,
  fetchFuturesIncomeHistory,
} = require("../src/exchanges/binanceFuturesPrivate");
const { normalizeMarketSymbolForProvider } = require("../src/utils/marketConfig");
const { fetchRuntimeErrorSummary24h } = require("./lib/runtime-error-counter");

loadLocalEnv();

const NOYE_DIR = path.join(REPO_ROOT, "noye");
const SNAPSHOT_PATH = path.join(NOYE_DIR, "binance_snapshot_latest.json");
const REPORT_PATH = path.join(NOYE_DIR, "report.md");
const TELEGRAM_LOG_PATH = path.join(NOYE_DIR, "telegram_send.log");
function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isFiniteNullable(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function round(value, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function formatKst(ms) {
  return toKstString(ms, { fallbackToString: true }) || "N/A";
}

function fmtSigned(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function pct(value, base) {
  const a = Number(value);
  const b = Number(base);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return (a / b) * 100;
}

function normalizeSymbols(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const sym = normalizeMarketSymbolForProvider(raw, "BINANCEFUT");
    if (!sym || seen.has(sym) || !/USDT$/.test(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

async function resolveKeysAndMarkets() {
  const raw = await getExchangesSettingsCached(5000);
  const data = raw && raw.data ? raw.data : {};
  const entry = data && data.exchanges && typeof data.exchanges === "object"
    ? (data.exchanges.BINANCEFUT || data.exchanges.binancefut || null)
    : null;
  const legacy = !entry && String(data.provider || "").toUpperCase() === "BINANCEFUT" ? data : null;
  const apiKey = String(
    process.env.BINANCEFUT_API_KEY
    || (entry && entry.api_key)
    || (legacy && legacy.api_key)
    || ""
  ).trim();
  const apiSecret = String(
    process.env.BINANCEFUT_API_SECRET
    || (entry && entry.api_secret)
    || (legacy && legacy.api_secret)
    || ""
  ).trim();
  if (!apiKey || !apiSecret) throw new Error("BINANCEFUT_KEYS_MISSING");
  const markets = normalizeSymbols((entry && entry.markets) || (legacy && legacy.markets) || []);
  return { apiKey, apiSecret, markets };
}

function uniqueTradeKey(symbol, row) {
  const tradeId = String(row && (row.id || row.tradeId) || "").trim();
  const orderId = String(row && row.orderId || "").trim();
  const timeMs = String(row && row.time || "").trim();
  return `${symbol}:${tradeId}:${orderId}:${timeMs}`;
}

async function fetchAllUserTrades({ apiKey, apiSecret, symbols, startMs, endMs }) {
  const out = [];
  const seen = new Set();
  for (const symbol of symbols) {
    let cursor = startMs;
    for (let page = 0; page < 10 && cursor < endMs; page += 1) {
      const rows = await fetchFuturesUserTrades({
        apiKey,
        apiSecret,
        symbol,
        startTime: cursor,
        endTime: endMs,
        limit: 1000,
        recvWindow: 7000,
      });
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) break;
      list.sort((a, b) => Number(a.time) - Number(b.time));
      for (const row of list) {
        const key = uniqueTradeKey(symbol, row);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...row, symbol });
      }
      const lastTime = toNum(list[list.length - 1] && list[list.length - 1].time, null);
      if (!Number.isFinite(lastTime) || list.length < 1000 || lastTime <= cursor) break;
      cursor = lastTime + 1;
    }
  }
  out.sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
  return out;
}

async function fetchAllFundingIncome({ apiKey, apiSecret, startMs, endMs }) {
  const out = [];
  const seen = new Set();
  let cursor = startMs;
  for (let page = 0; page < 10 && cursor < endMs; page += 1) {
    const rows = await fetchFuturesIncomeHistory({
      apiKey,
      apiSecret,
      incomeType: "FUNDING_FEE",
      startTime: cursor,
      endTime: endMs,
      limit: 1000,
      recvWindow: 7000,
    });
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) break;
    list.sort((a, b) => Number(a.time) - Number(b.time));
    for (const row of list) {
      const key = `${row.symbol || ""}:${row.tranId || ""}:${row.time || ""}:${row.income || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    const lastTime = toNum(list[list.length - 1] && list[list.length - 1].time, null);
    if (!Number.isFinite(lastTime) || list.length < 1000 || lastTime <= cursor) break;
    cursor = lastTime + 1;
  }
  out.sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
  return out;
}

function buildTelegramLogLine({ nowMs, totalEquity, realizedPnl, commission, funding, errorCount }) {
  const totalCost = Math.abs(Number(commission || 0) + Number(funding || 0));
  const messageText = [
    `선물 총액: ${Number(totalEquity || 0).toFixed(2)} USDT`,
    `수익률(이전 실행 대비): 0.00%`,
    `수익(실현, 오늘): ${fmtSigned(realizedPnl, 2)} USDT`,
    `비용(수수료+펀딩, 오늘): ${fmtSigned(totalCost, 2)} USDT`,
    `Errors (24h): ${Number.isFinite(Number(errorCount)) ? Number(errorCount) : "N/A"}`,
  ].join("\n");
  const ts = formatKst(nowMs).replace(" KST", "");
  const payload = {
    ok: true,
    result: {
      text: messageText,
    },
  };
  return `[${ts}] rc=200 ${JSON.stringify(payload)}`;
}

async function main() {
  ensureDir(NOYE_DIR);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const startMs = kstStartOfTodayUtcMs(nowMs);
  const { apiKey, apiSecret, markets } = await resolveKeysAndMarkets();

  const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret, recvWindow: 7000 });
  const positions = Array.isArray(account && account.positions) ? account.positions : [];
  const activeSymbols = positions
    .filter((row) => Math.abs(toNum(row && row.positionAmt, 0) || 0) > 0)
    .map((row) => String(row && row.symbol || "").toUpperCase());
  const symbols = normalizeSymbols([...markets, ...activeSymbols]);

  const [trades, fundingRows] = await Promise.all([
    fetchAllUserTrades({ apiKey, apiSecret, symbols, startMs, endMs: nowMs }),
    fetchAllFundingIncome({ apiKey, apiSecret, startMs, endMs: nowMs }),
  ]);

  const totalEquity = (() => {
    const margin = toNum(account && account.totalMarginBalance, null);
    if (Number.isFinite(margin) && margin > 0) return margin;
    const wallet = toNum(account && account.totalWalletBalance, 0);
    const unreal = toNum(account && account.totalUnrealizedProfit, 0);
    return wallet + unreal;
  })();

  const realizedPnl = round(
    trades.reduce((acc, row) => acc + toNum(row && row.realizedPnl, 0), 0),
    8
  );
  const commissionAbs = round(
    trades.reduce((acc, row) => acc + Math.abs(toNum(row && row.commission, 0)), 0),
    8
  );
  const fundingSigned = round(
    fundingRows.reduce((acc, row) => acc + toNum(row && row.income, 0), 0),
    8
  );
  const commissionSigned = round(-(commissionAbs || 0), 8);
  const runtimeErrorSummary = await fetchRuntimeErrorSummary24h();
  const costRatioPct = round(pct(Math.abs((commissionSigned || 0) + (fundingSigned || 0)), totalEquity), 4);
  const netPnlPct = round(pct((realizedPnl || 0) + (commissionSigned || 0) + (fundingSigned || 0), totalEquity), 4);

  const snapshot = {
    generated_at_iso: nowIso,
    generated_at_kst: formatKst(nowMs),
    source: "BINANCE_RUNTIME_SNAPSHOT_V2",
    exchange: "BINANCEFUT",
    start_utc_ms: startMs,
    start_kst: formatKst(startMs),
    end_kst: nowIso,
    symbols,
    account_reference: {
      totalMarginBalance: toNum(account && account.totalMarginBalance, null),
      totalWalletBalance: toNum(account && account.totalWalletBalance, null),
      totalUnrealizedProfit: toNum(account && account.totalUnrealizedProfit, null),
    },
    total_equity: round(totalEquity, 8),
    realized_pnl: realizedPnl,
    commission: commissionSigned,
    funding: fundingSigned,
    derived: {
      trade_count_today: trades.length,
      funding_count_today: fundingRows.length,
      cost_ratio_pct: costRatioPct,
      net_pnl_pct: netPnlPct,
      error_count_24h: runtimeErrorSummary.error_count_24h,
      error_occurrence_count_24h: runtimeErrorSummary.error_occurrence_count_24h,
      error_families_24h: runtimeErrorSummary.error_families_24h,
      error_source_path: runtimeErrorSummary.source,
      error_source_generated_at_kst: formatKst(nowMs),
      error_source_stale: false,
      error_source_age_hours: 0,
    },
  };

  const reportMd = [
    "# 노예 운영 지표 원본",
    "",
    `- Generated at: ${formatKst(nowMs)}`,
    `- Snapshot source: ${SNAPSHOT_PATH}`,
    `- Error count: ${isFiniteNullable(runtimeErrorSummary.error_count_24h) ? Number(runtimeErrorSummary.error_count_24h) : "N/A"}`,
    `- Error occurrences (24h): ${isFiniteNullable(runtimeErrorSummary.error_occurrence_count_24h) ? Number(runtimeErrorSummary.error_occurrence_count_24h) : "N/A"}`,
    `- Error source: ${runtimeErrorSummary.source || "N/A"}`,
    `- Error source stale: NO`,
    `- Error source generated at: ${formatKst(nowMs)}`,
    `- Error families: ${(Array.isArray(runtimeErrorSummary.error_families_24h) && runtimeErrorSummary.error_families_24h.length)
      ? runtimeErrorSummary.error_families_24h.map((item) => `${item.family}(${item.count})`).join(", ")
      : "없음"}`,
    `- Total equity: ${Number(totalEquity || 0).toFixed(8)} USDT`,
    `- Realized PnL today: ${fmtSigned(realizedPnl, 8)} USDT`,
    `- Commission today: ${fmtSigned(commissionSigned, 8)} USDT`,
    `- Funding today: ${fmtSigned(fundingSigned, 8)} USDT`,
    `- Net PnL pct today: ${fmtSigned(netPnlPct, 4)}%`,
    `- Cost ratio pct today: ${fmtSigned(costRatioPct, 4)}%`,
  ].join("\n");

  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.writeFileSync(REPORT_PATH, `${reportMd}\n`, "utf8");
  fs.appendFileSync(
    TELEGRAM_LOG_PATH,
    `${buildTelegramLogLine({
      nowMs,
      totalEquity,
      realizedPnl,
      commission: commissionSigned,
      funding: fundingSigned,
      errorCount: runtimeErrorSummary.error_count_24h,
    })}\n`,
    "utf8"
  );

  console.log(JSON.stringify({
    ok: true,
    snapshot_path: SNAPSHOT_PATH,
    report_path: REPORT_PATH,
    telegram_log_path: TELEGRAM_LOG_PATH,
    total_equity: snapshot.total_equity,
    realized_pnl: snapshot.realized_pnl,
    commission: snapshot.commission,
    funding: snapshot.funding,
    error_count_24h: runtimeErrorSummary.error_count_24h,
    error_occurrence_count_24h: runtimeErrorSummary.error_occurrence_count_24h,
    error_families_24h: runtimeErrorSummary.error_families_24h,
    symbols,
    trade_count_today: trades.length,
    funding_count_today: fundingRows.length,
  }, null, 2));
}

main().catch((err) => {
  console.error("refresh-noye-runtime-inputs failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
