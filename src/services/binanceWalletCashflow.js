const { fetchBinanceWalletDeposits, fetchBinanceWalletWithdrawals, fetchBinanceWalletTransfers } = require("../exchanges/binanceFuturesPrivate");
const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");

const DEFAULT_RANGE_DAYS = 30;
const MAX_LIMIT = 1000;
const MAX_PAGES = 4;
const HOUR_MS = 60 * 60 * 1000;
const MIRROR_MATCH_WINDOW_MS = 30 * 60 * 1000;
const AMOUNT_EPSILON = 1e-8;
const CASHFLOW_POLICY_VERSION = "EXTERNAL_ONLY_V1";

const DEPOSIT_STATUS = {
  0: "대기",
  1: "완료",
};

const WITHDRAW_STATUS = {
  0: "이메일 확인",
  1: "취소됨",
  2: "승인 대기",
  3: "거절",
  4: "처리중",
  5: "실패",
  6: "완료",
};

const TRANSFER_STATUS = {
  CONFIRMED: "완료",
  SUCCESS: "완료",
  COMPLETED: "완료",
  PENDING: "대기",
};

const TRANSFER_TYPE_LABEL = {
  MAIN_UMFUTURE: "Spot > USDⓈ-M Futures",
  UMFUTURE_MAIN: "USDⓈ-M Futures > Spot",
  MAIN_CMFUTURE: "Spot > COIN-M Futures",
  CMFUTURE_MAIN: "COIN-M Futures > Spot",
};

const TRANSFER_DIRECTION = {
  MAIN_UMFUTURE: "IN",
  UMFUTURE_MAIN: "OUT",
  MAIN_CMFUTURE: "IN",
  CMFUTURE_MAIN: "OUT",
};

const USDT_KRW_CACHE = new Map();

function nowMs() {
  return Date.now();
}

function resolveRangeDays(rangeDays) {
  const n = Number(rangeDays);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RANGE_DAYS;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

async function resolveBinanceKeys() {
  const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
  const apiKey = String(keys && keys.apiKey || "").trim();
  const apiSecret = String(keys && keys.apiSecret || "").trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

function parseTimeMs(raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  if (!raw) return null;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function depositTimeMs(item) {
  return parseTimeMs(item && item.insertTime);
}

function withdrawTimeMs(item) {
  const success = parseTimeMs(item && item.successTime);
  if (Number.isFinite(success)) return success;
  return parseTimeMs(item && item.applyTime);
}

function transferTimeMs(item) {
  return parseTimeMs(item && item.timestamp);
}

function bucketHourMs(ms) {
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function isSummaryEligibleRow(row) {
  if (!row || row.completed !== true) return false;
  if (row.excluded_from_summary === true) return false;
  return row.type === "DEPOSIT" || row.type === "WITHDRAW";
}

function findMirrorTransferInRows(entries) {
  const deposits = [];
  const transfersIn = [];
  entries.forEach((row, idx) => {
    if (!row || row.completed !== true) return;
    const coin = String(row.coin || "").toUpperCase();
    const amount = Number(row.amount);
    const timeMs = Number(row.time_ms);
    if (!coin || !Number.isFinite(amount) || !Number.isFinite(timeMs)) return;
    if (row.type === "DEPOSIT") {
      deposits.push({ idx, coin, amount, timeMs });
      return;
    }
    if (row.type === "TRANSFER" && row.direction === "IN") {
      transfersIn.push({ idx, coin, amount, timeMs });
    }
  });

  if (!deposits.length || !transfersIn.length) return entries;

  const transferUsed = new Set();
  deposits.forEach((dep) => {
    let chosen = null;
    for (let i = 0; i < transfersIn.length; i += 1) {
      if (transferUsed.has(i)) continue;
      const tr = transfersIn[i];
      if (tr.coin !== dep.coin) continue;
      if (Math.abs(tr.amount - dep.amount) > AMOUNT_EPSILON) continue;
      const dt = Math.abs(tr.timeMs - dep.timeMs);
      if (dt > MIRROR_MATCH_WINDOW_MS) continue;
      if (!chosen || dt < chosen.dt) {
        chosen = { i, dt };
      }
    }
    if (!chosen) return;
    transferUsed.add(chosen.i);
    const row = entries[dep.idx];
    if (!row) return;
    row.excluded_from_summary = true;
    row.exclude_reason = "MIRROR_TRANSFER_IN";
  });

  return entries;
}

async function fetchUpbitKrwBtcAt(ms) {
  const iso = new Date(ms).toISOString().replace(".000Z", "Z");
  const url = "https://api.upbit.com/v1/candles/minutes/60?market=KRW-BTC&count=1&to=" + encodeURIComponent(iso);
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  const price = row && Number(row.trade_price);
  return Number.isFinite(price) ? price : null;
}

async function fetchBinanceBtcUsdtAt(ms) {
  const url = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=1&endTime=" + encodeURIComponent(String(ms));
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  const price = row && Number(row[4]);
  return Number.isFinite(price) ? price : null;
}

async function getUsdtKrwRateAt(ms) {
  const bucket = bucketHourMs(ms);
  if (!Number.isFinite(bucket)) return null;
  if (USDT_KRW_CACHE.has(bucket)) return USDT_KRW_CACHE.get(bucket);
  const [krwBtc, btcUsdt] = await Promise.all([
    fetchUpbitKrwBtcAt(ms),
    fetchBinanceBtcUsdtAt(ms),
  ]);
  if (!Number.isFinite(krwBtc) || !Number.isFinite(btcUsdt) || btcUsdt <= 0) {
    USDT_KRW_CACHE.set(bucket, null);
    return null;
  }
  const rate = krwBtc / btcUsdt;
  USDT_KRW_CACHE.set(bucket, rate);
  return rate;
}

async function applyUsdtKrw(entries, coins, summary) {
  const usdtRows = entries.filter((row) => row && row.coin === "USDT" && Number.isFinite(row.time_ms) && Number.isFinite(row.amount));
  if (!usdtRows.length) return { entries, coins, summary };

  const buckets = new Set();
  usdtRows.forEach((row) => {
    const b = bucketHourMs(row.time_ms);
    if (Number.isFinite(b)) buckets.add(b);
  });

  const rates = new Map();
  await Promise.all(Array.from(buckets).map(async (b) => {
    const rate = await getUsdtKrwRateAt(b + HOUR_MS - 1);
    rates.set(b, rate);
  }));

  let krwDeposit = 0;
  let krwWithdraw = 0;
  let krwNet = 0;

  usdtRows.forEach((row) => {
    const b = bucketHourMs(row.time_ms);
    const rate = rates.get(b);
    if (!Number.isFinite(rate)) return;
    const amt = Number(row.amount);
    if (!Number.isFinite(amt)) return;
    const sign = row.type === "DEPOSIT"
      ? 1
      : (row.type === "WITHDRAW" ? -1 : (row.direction === "IN" ? 1 : (row.direction === "OUT" ? -1 : 0)));
    if (!sign) return;
    const krw = amt * rate * sign;
    row.krw_rate = rate;
    row.krw_amount = krw;
    if (!isSummaryEligibleRow(row)) return;
    if (row.type === "DEPOSIT") {
      krwDeposit += Math.abs(krw);
      krwNet += Math.abs(krw);
      return;
    }
    if (row.type === "WITHDRAW") {
      krwWithdraw += Math.abs(krw);
      krwNet -= Math.abs(krw);
    }
  });

  if (summary && summary.coin === "USDT") {
    summary.krw_deposit = krwDeposit || null;
    summary.krw_withdraw = krwWithdraw || null;
    summary.krw_net = krwNet || null;
  }

  const usdtCoin = coins.find((c) => c.coin === "USDT");
  if (usdtCoin) {
    usdtCoin.krw_deposit = krwDeposit || null;
    usdtCoin.krw_withdraw = krwWithdraw || null;
    usdtCoin.krw_net = krwNet || null;
  }

  return { entries, coins, summary };
}

async function fetchPaged(fetchFn, { startTime, endTime, limit = MAX_LIMIT, maxPages = MAX_PAGES, timeResolver } = {}) {
  const out = [];
  let cursor = Number.isFinite(startTime) ? startTime : null;
  const endMs = Number.isFinite(endTime) ? endTime : null;

  for (let page = 0; page < maxPages; page += 1) {
    const list = await fetchFn({ startTime: cursor, endTime: endMs, limit });
    const rows = Array.isArray(list) ? list : [];
    if (!rows.length) break;
    rows.sort((a, b) => {
      const ta = timeResolver(a) || 0;
      const tb = timeResolver(b) || 0;
      return ta - tb;
    });
    out.push(...rows);
    if (rows.length < limit) break;
    const lastMs = timeResolver(rows[rows.length - 1]);
    if (!Number.isFinite(lastMs)) break;
    if (cursor != null && lastMs <= cursor) break;
    cursor = lastMs + 1;
  }
  return out;
}

async function fetchTransferPaged(fetchFn, { startTime, endTime, size = 100, maxPages = MAX_PAGES } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchFn({ startTime, endTime, current: page, size });
    const rows = res && Array.isArray(res.rows) ? res.rows : (Array.isArray(res) ? res : []);
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < size) break;
    const total = Number(res && res.total);
    if (Number.isFinite(total) && out.length >= total) break;
  }
  return out;
}

function normalizeDepositRow(item) {
  const amount = Number(item && item.amount);
  const status = Number(item && item.status);
  return {
    type: "DEPOSIT",
    coin: String(item && item.coin || "").toUpperCase(),
    amount: Number.isFinite(amount) ? amount : null,
    time_ms: depositTimeMs(item),
    status,
    status_label: DEPOSIT_STATUS[status] || "기타",
    completed: status === 1,
    txid: item && (item.txId || item.txid) ? String(item.txId || item.txid) : null,
    address: item && item.address ? String(item.address) : null,
    fee: null,
  };
}

function normalizeWithdrawRow(item) {
  const amount = Number(item && item.amount);
  const fee = Number(item && item.transactionFee);
  const status = Number(item && item.status);
  return {
    type: "WITHDRAW",
    coin: String(item && item.coin || "").toUpperCase(),
    amount: Number.isFinite(amount) ? amount : null,
    time_ms: withdrawTimeMs(item),
    status,
    status_label: WITHDRAW_STATUS[status] || "기타",
    completed: status === 6,
    txid: item && (item.txId || item.txid) ? String(item.txId || item.txid) : null,
    address: item && item.address ? String(item.address) : null,
    fee: Number.isFinite(fee) ? fee : null,
  };
}

function normalizeTransferRow(item) {
  const amount = Number(item && item.amount);
  const rawType = String(item && item.type || "").toUpperCase();
  const statusRaw = String(item && item.status || "").toUpperCase();
  const direction = TRANSFER_DIRECTION[rawType] || null;
  const statusLabel = TRANSFER_STATUS[statusRaw] || (statusRaw ? statusRaw : "기타");
  const completed = statusLabel === "완료";
  return {
    type: "TRANSFER",
    coin: String(item && item.asset || "").toUpperCase(),
    amount: Number.isFinite(amount) ? amount : null,
    time_ms: transferTimeMs(item),
    status: statusRaw,
    status_label: statusLabel,
    completed,
    txid: item && item.tranId ? String(item.tranId) : null,
    address: null,
    fee: null,
    transfer_type: rawType,
    direction,
    remark: TRANSFER_TYPE_LABEL[rawType] || rawType || "Transfer",
  };
}

function buildCoinSummary(entries) {
  const byCoin = new Map();
  for (const row of entries) {
    if (!isSummaryEligibleRow(row)) continue;
    const coin = String(row.coin || "").toUpperCase();
    if (!coin) continue;
    if (!byCoin.has(coin)) {
      byCoin.set(coin, { coin, deposit: 0, withdraw: 0, net: 0, n_deposit: 0, n_withdraw: 0 });
    }
    const agg = byCoin.get(coin);
    const amt = Number(row.amount);
    if (!Number.isFinite(amt)) continue;
    if (row.type === "DEPOSIT") {
      agg.deposit += amt;
      agg.net += amt;
      agg.n_deposit += 1;
    } else if (row.type === "WITHDRAW") {
      agg.withdraw += amt;
      agg.net -= amt;
      agg.n_withdraw += 1;
    }
  }
  const coins = Array.from(byCoin.values()).sort((a, b) => a.coin.localeCompare(b.coin));
  return coins;
}

function pickSummaryCoin(coins) {
  if (!coins.length) return null;
  const usdt = coins.find((c) => c.coin === "USDT");
  if (usdt) return usdt;
  if (coins.length === 1) return coins[0];
  return null;
}

async function getBinanceWalletCashflow({ rangeDays, startMs, endMs } = {}) {
  const keys = await resolveBinanceKeys();
  if (!keys) {
    const err = new Error("BINANCEFUT_KEYS_MISSING");
    err.code = "BINANCEFUT_KEYS_MISSING";
    throw err;
  }

  const days = resolveRangeDays(rangeDays);
  const toMs = Number.isFinite(endMs) ? endMs : nowMs();
  const fromMs = Number.isFinite(startMs) ? startMs : (toMs - days * 24 * 60 * 60 * 1000);

  const [depositRaw, withdrawRaw, transferRaw] = await Promise.all([
    fetchPaged((params) => fetchBinanceWalletDeposits({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, ...params }), {
      startTime: fromMs,
      endTime: toMs,
      limit: MAX_LIMIT,
      maxPages: MAX_PAGES,
      timeResolver: depositTimeMs,
    }),
    fetchPaged((params) => fetchBinanceWalletWithdrawals({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, ...params }), {
      startTime: fromMs,
      endTime: toMs,
      limit: MAX_LIMIT,
      maxPages: MAX_PAGES,
      timeResolver: withdrawTimeMs,
    }),
    (async () => {
      const types = ["MAIN_UMFUTURE", "UMFUTURE_MAIN"];
      const out = [];
      for (const t of types) {
        try {
          const rows = await fetchTransferPaged(
            (params) => fetchBinanceWalletTransfers({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, type: t, ...params }),
            { startTime: fromMs, endTime: toMs, size: 100, maxPages: MAX_PAGES }
          );
          out.push(...rows);
        } catch (_) {
          continue;
        }
      }
      return out;
    })(),
  ]);

  const deposits = Array.isArray(depositRaw) ? depositRaw.map(normalizeDepositRow) : [];
  const withdrawals = Array.isArray(withdrawRaw) ? withdrawRaw.map(normalizeWithdrawRow) : [];
  const transfers = Array.isArray(transferRaw) ? transferRaw.map(normalizeTransferRow) : [];

  const entries = deposits.concat(withdrawals, transfers)
    .filter((x) => Number.isFinite(Number(x.time_ms)))
    .sort((a, b) => Number(b.time_ms) - Number(a.time_ms));
  findMirrorTransferInRows(entries);

  const coins = buildCoinSummary(entries);
  const summaryCoin = pickSummaryCoin(coins);
  const summary = summaryCoin ? {
    coin: summaryCoin.coin,
    deposit: summaryCoin.deposit,
    withdraw: summaryCoin.withdraw,
    net: summaryCoin.net,
    n_deposit: summaryCoin.n_deposit,
    n_withdraw: summaryCoin.n_withdraw,
  } : null;

  await applyUsdtKrw(entries, coins, summary);

  return {
    ok: true,
    policy_version: CASHFLOW_POLICY_VERSION,
    range: {
      days,
      from_ms: fromMs,
      to_ms: toMs,
    },
    entries,
    coins,
    summary,
  };
}

module.exports = { getBinanceWalletCashflow };
