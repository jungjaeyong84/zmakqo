const { fetchFuturesIncomeHistory } = require("../exchanges/binanceFuturesPrivate");
const { normalizeMarketSymbolForProvider } = require("../utils/marketConfig");
const { getFirestore } = require("../storage/firestore");
const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000;
const BINANCE_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 - 1000;

const syncState = {
  lastRunAt: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function resolveEnvBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (!s) return def;
  return ["1", "true", "yes", "y", "on"].includes(s);
}

async function resolveBinanceKeys() {
  const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
  const apiKey = String(keys && keys.apiKey || "").trim();
  const apiSecret = String(keys && keys.apiSecret || "").trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret, source: keys && keys.source ? keys.source : "shared" };
}

function cursorDocId(symbol) {
  return `FUNDING_SYNC__BINANCEFUT__${symbol}`;
}

function normalizeSymbol(raw) {
  return normalizeMarketSymbolForProvider(raw, "BINANCEFUT");
}

function fundingDocId({ symbol, tranId, timeMs, income }) {
  if (tranId) return `FUNDING__BINANCEFUT__${symbol}__${tranId}`;
  const t = Number.isFinite(timeMs) ? timeMs : Date.now();
  const inc = Number.isFinite(income) ? String(income).replace(/[^\d.-]/g, "") : "NA";
  return `FUNDING__BINANCEFUT__${symbol}__${t}__${inc || "NA"}`;
}

async function upsertFundingFee(db, row) {
  const docId = fundingDocId(row);
  const ref = db.collection("funding_fees").doc(docId);
  const payload = {
    exchange: "BINANCEFUT",
    symbol: row.symbol,
    income_type: row.incomeType || "FUNDING_FEE",
    income: Number(row.income),
    asset: row.asset || "USDT",
    time_ms: Number(row.timeMs),
    time_utc: row.timeMs ? new Date(row.timeMs).toISOString() : null,
    tran_id: row.tranId ? String(row.tranId) : null,
    info: row.info || null,
    external_source: "BINANCE_INCOME",
    created_at: nowIso(),
  };
  await ref.set(payload, { merge: true });
}

async function syncFundingForSymbol({
  apiKey,
  apiSecret,
  symbol,
  lookbackMs,
  maxPages = 6,
} = {}) {
  const db = getFirestore();
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, reason: "SYMBOL_INVALID" };

  const cursorId = cursorDocId(sym);
  const cursorRef = db.collection("processed_cursors").doc(cursorId);
  const cursorSnap = await cursorRef.get();
  const cursor = cursorSnap.exists ? cursorSnap.data() : null;
  const lastMsRaw = Number(cursor && cursor.last_income_time_ms);
  const lastIdRaw = cursor && cursor.last_income_id ? String(cursor.last_income_id) : null;
  const lookbackStart = Date.now() - (lookbackMs || DEFAULT_LOOKBACK_MS);
  const hasCursorMs = Number.isFinite(lastMsRaw) && lastMsRaw > 0;
  const startMs = hasCursorMs ? Math.max(lastMsRaw, lookbackStart) : lookbackStart;
  const endMs = Date.now();

  let fetched = 0;
  let inserted = 0;
  let lastIncomeMs = hasCursorMs ? lastMsRaw : null;
  let lastIncomeId = lastIdRaw;
  let pageStartMs = startMs;

  for (let page = 0; page < maxPages; page += 1) {
    const windowEndMs = Math.min(endMs, pageStartMs + BINANCE_MAX_WINDOW_MS);
    const list = await fetchFuturesIncomeHistory({
      apiKey,
      apiSecret,
      symbol: sym,
      incomeType: "FUNDING_FEE",
      startTime: pageStartMs,
      endTime: windowEndMs,
      limit: 1000,
    });
    const rows = Array.isArray(list) ? list : [];
    if (!rows.length) break;
    rows.sort((a, b) => Number(a.time) - Number(b.time));
    fetched += rows.length;

    for (const item of rows) {
      const timeMs = Number(item.time);
      if (Number.isFinite(lastIncomeMs)) {
        if (timeMs < lastIncomeMs) continue;
        if (timeMs === lastIncomeMs && lastIncomeId && String(item.tranId || "") <= lastIncomeId) continue;
      }
      const income = Number(item.income);
      if (!Number.isFinite(timeMs) || !Number.isFinite(income)) continue;

      await upsertFundingFee(db, {
        symbol: sym,
        timeMs,
        tranId: item.tranId ? String(item.tranId) : null,
        income,
        incomeType: item.incomeType,
        asset: item.asset,
        info: item.info,
      });
      inserted += 1;

      if (!Number.isFinite(lastIncomeMs) || timeMs > lastIncomeMs) {
        lastIncomeMs = timeMs;
        lastIncomeId = item.tranId ? String(item.tranId) : lastIncomeId;
      } else if (timeMs === lastIncomeMs && item.tranId) {
        lastIncomeId = String(item.tranId);
      }
    }

    const lastInPage = rows[rows.length - 1];
    const lastMsInPage = Number(lastInPage && lastInPage.time);
    if (!Number.isFinite(lastMsInPage) || lastMsInPage <= pageStartMs) break;
    pageStartMs = lastMsInPage + 1;
    if (rows.length < 1000) break;
  }

  if (Number.isFinite(lastIncomeMs)) {
    await cursorRef.set({
      cursor_id: cursorId,
      exchange: "BINANCEFUT",
      symbol: sym,
      tf: "FUNDING_SYNC",
      last_income_time_ms: lastIncomeMs,
      last_income_time_utc: new Date(lastIncomeMs).toISOString(),
      last_income_id: lastIncomeId || null,
      updated_at: nowIso(),
    }, { merge: true });
  }

  return { ok: true, symbol: sym, fetched, inserted };
}

async function syncBinanceFuturesFundingFees({
  markets = [],
  executionMode = "PAPER",
  liveEnabled = true,
  lookbackMs,
  minIntervalMs,
  force = false,
  maxPages,
} = {}) {
  const enabled = resolveEnvBool(process.env.BINANCEFUT_FUNDING_SYNC_ENABLED, true);
  if (!enabled) return { ok: false, skipped: true, reason: "FUNDING_SYNC_DISABLED" };

  const now = Date.now();
  const minIntervalSafe = Number.isFinite(Number(minIntervalMs))
    ? Number(minIntervalMs)
    : Number(process.env.BINANCEFUT_FUNDING_SYNC_INTERVAL_MS) || DEFAULT_MIN_INTERVAL_MS;
  if (!force && (now - syncState.lastRunAt < minIntervalSafe)) {
    return { ok: true, skipped: true, reason: "FUNDING_SYNC_THROTTLED" };
  }

  const keys = await resolveBinanceKeys();
  if (!keys) return { ok: false, skipped: true, reason: "BINANCEFUT_KEYS_MISSING" };

  const marketList = Array.isArray(markets) && markets.length ? markets : [];
  const lookback = Number.isFinite(Number(lookbackMs))
    ? Number(lookbackMs)
    : Number(process.env.BINANCEFUT_FUNDING_SYNC_LOOKBACK_MS) || DEFAULT_LOOKBACK_MS;
  const maxPagesEnv = Math.floor(Number(process.env.BINANCEFUT_FUNDING_SYNC_MAX_PAGES) || 0);
  const maxPagesInput = Math.floor(Number(maxPages) || 0);
  const maxPagesByLookback = Math.max(6, Math.ceil(lookback / BINANCE_MAX_WINDOW_MS) + 2);
  const maxPagesSafe = maxPagesInput > 0
    ? Math.max(maxPagesInput, maxPagesByLookback)
    : (maxPagesEnv > 0 ? Math.max(maxPagesEnv, maxPagesByLookback) : maxPagesByLookback);
  const results = [];
  for (const m of marketList) {
    try {
      const r = await syncFundingForSymbol({
        apiKey: keys.apiKey,
        apiSecret: keys.apiSecret,
        symbol: m,
        lookbackMs: lookback,
        maxPages: maxPagesSafe,
      });
      results.push(r);
    } catch (e) {
      results.push({ ok: false, symbol: m, error: (e && e.message) ? e.message : String(e) });
    }
  }

  syncState.lastRunAt = now;
  return { ok: true, execution_mode: executionMode, live_enabled: !!liveEnabled, results };
}

module.exports = { syncBinanceFuturesFundingFees };
