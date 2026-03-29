const { getFirestore } = require("../storage/firestore");

function normalizeExchangeId(v) {
  const raw = String(v || "").toUpperCase();
  if (raw.includes("BINANCE")) return "BINANCEFUT";
  if (raw.includes("KIWOOM")) return "KIWOOM";
  return "UPBIT";
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildFundingIndex(fees) {
  const list = Array.isArray(fees) ? fees : [];
  const times = [];
  const prefix = [];
  let sum = 0;
  for (const f of list) {
    const t = toNum(f.time_ms);
    const income = toNum(f.income);
    if (t == null || income == null) continue;
    times.push(t);
    sum += income;
    prefix.push(sum);
  }
  return { times, prefix };
}

function sumFunding(index, startMs, endMs) {
  if (!index || !Array.isArray(index.times) || !index.times.length) return 0;
  const s = toNum(startMs);
  const e = toNum(endMs);
  if (s == null || e == null || e < s) return 0;
  const startIdx = lowerBound(index.times, s);
  const endIdx = upperBound(index.times, e) - 1;
  if (startIdx > endIdx || endIdx < 0) return 0;
  const total = index.prefix[endIdx] - (startIdx > 0 ? index.prefix[startIdx - 1] : 0);
  return Number.isFinite(total) ? total : 0;
}

async function fetchFundingFees({ exchange, symbol, startMs, endMs, limit = 5000 } = {}) {
  const ex = normalizeExchangeId(exchange);
  if (ex !== "BINANCEFUT") return [];
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return [];
  const s = toNum(startMs);
  const e = toNum(endMs);
  if (s == null || e == null || e < s) return [];

  const db = getFirestore();
  let snap = null;
  try {
    snap = await db.collection("funding_fees")
      .where("exchange", "==", ex)
      .where("symbol", "==", sym)
      .where("time_ms", ">=", s)
      .where("time_ms", "<=", e)
      .orderBy("time_ms", "asc")
      .limit(limit)
      .get();
  } catch (_) {
    snap = await db.collection("funding_fees")
      .where("exchange", "==", ex)
      .where("symbol", "==", sym)
      .orderBy("time_ms", "asc")
      .limit(limit)
      .get();
  }

  const out = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const t = toNum(d.time_ms);
    const income = toNum(d.income);
    if (t == null || income == null) return;
    if (t < s || t > e) return;
    out.push({ time_ms: t, income, asset: d.asset || "USDT", id: doc.id });
  });
  out.sort((a, b) => a.time_ms - b.time_ms);
  return out;
}

async function buildFundingIndexForFills({ exchange, symbol, fills, limit = 5000 } = {}) {
  const ex = normalizeExchangeId(exchange);
  if (ex !== "BINANCEFUT") return null;
  const sym = String(symbol || "").toUpperCase();
  if (!sym || !Array.isArray(fills) || !fills.length) return null;
  const times = fills
    .map((f) => {
      const t = toNum(f.exec_bar_close_time_utc_ms);
      if (t != null) return t;
      const alt = toNum(f._exec_ms);
      if (alt != null) return alt;
      const created = Date.parse(String(f.created_at || ""));
      return Number.isFinite(created) ? created : null;
    })
    .filter((x) => x != null);
  if (!times.length) return null;
  const startMs = Math.min(...times);
  const endMs = Math.max(...times);
  const fees = await fetchFundingFees({ exchange: ex, symbol: sym, startMs, endMs, limit });
  if (!fees.length) return null;
  return buildFundingIndex(fees);
}

module.exports = {
  normalizeExchangeId,
  fetchFundingFees,
  buildFundingIndex,
  sumFunding,
  buildFundingIndexForFills,
};
