#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  readJsonSafe,
  appendV3SourceFeedRows,
  buildV3SourceFeedCheckpoint,
  resolveAdaptiveKlineLimit,
} = require("../src/v3/sourceFeed");
const { generateV3SourceSignalsForSymbolWindow } = require("../src/v3/rawSignalGenerator");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_source_feed_latest.json");
const FEED_PATH = path.join(OPS_RUNTIME, "v3_raw_signal_feed.jsonl");
const CHECKPOINT_PATH = path.join(OPS_RUNTIME, "v3_source_feed_checkpoint.json");

const SYMBOLS = String(process.env.V3_SOURCE_GENERATOR_SYMBOLS || "BTCUSDT,ETHUSDT,BNBUSDT,XRPUSDT,SOLUSDT,AXSUSDT,DOGEUSDT,LINKUSDT,WLDUSDT,TAOUSDT,ARBUSDT,INJUSDT,SUIUSDT,AAVEUSDT,SANDUSDT,TIAUSDT")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

const KLINE_LIMIT_15M = (() => {
  const n = Number(process.env.V3_SOURCE_KLINE_LIMIT_15M);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 260;
})();

const KLINE_LIMIT_1H = (() => {
  const n = Number(process.env.V3_SOURCE_KLINE_LIMIT_1H);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 260;
})();

async function fetchKlines(symbol, interval, limit) {
  const url = new URL("https://fapi.binance.com/fapi/v1/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`V3_SOURCE_KLINE_FETCH_FAILED:${symbol}:${interval}:${res.status}`);
  return res.json();
}

async function fetchAllBookTickers() {
  const url = new URL("https://fapi.binance.com/fapi/v1/ticker/bookTicker");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`V3_SOURCE_BOOK_TICKER_FETCH_FAILED:${res.status}`);
  return res.json();
}

async function fetchAllPremiumIndex() {
  const url = new URL("https://fapi.binance.com/fapi/v1/premiumIndex");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`V3_SOURCE_PREMIUM_INDEX_FETCH_FAILED:${res.status}`);
  return res.json();
}

function upper(value) {
  const text = String(value == null ? "" : value).trim().toUpperCase();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildBookTickerLookup(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = upper(row && row.symbol);
    if (!symbol) continue;
    const bid = toNumberOrNull(row && row.bidPrice);
    const ask = toNumberOrNull(row && row.askPrice);
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    const spreadBps = bid !== null && ask !== null && mid && mid > 0
      ? ((ask - bid) / mid) * 10000
      : null;
    map.set(symbol, Object.freeze({
      bid_price: bid,
      ask_price: ask,
      spread_bps: spreadBps,
    }));
  }
  return map;
}

function buildPremiumIndexLookup(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = upper(row && row.symbol);
    if (!symbol) continue;
    map.set(symbol, Object.freeze({
      funding_rate: toNumberOrNull(row && row.lastFundingRate),
      mark_price: toNumberOrNull(row && row.markPrice),
      index_price: toNumberOrNull(row && row.indexPrice),
    }));
  }
  return map;
}

async function generateForSymbol(symbol, marketMeta = {}, {
  sinceCreatedAt = null,
  klineLimit15m = KLINE_LIMIT_15M,
  klineLimit1h = KLINE_LIMIT_1H,
} = {}) {
  const nowMs = Date.now();
  const [bars15m, bars1h] = await Promise.all([
    fetchKlines(symbol, "15m", klineLimit15m),
    fetchKlines(symbol, "1h", klineLimit1h),
  ]);
  return generateV3SourceSignalsForSymbolWindow({
    symbol,
    bars15m,
    bars1h,
    marketMeta,
    nowMs,
    sinceCreatedAt,
  });
}

function isStrictlyAfterIso(value, floorIso) {
  const valueMs = Date.parse(String(value || ""));
  const floorMs = Date.parse(String(floorIso || ""));
  if (!Number.isFinite(valueMs)) return false;
  if (!Number.isFinite(floorMs)) return true;
  return valueMs > floorMs;
}

async function main() {
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  fs.mkdirSync(OPS_RUNTIME, { recursive: true });
  if (!fs.existsSync(FEED_PATH)) fs.writeFileSync(FEED_PATH, "");

  const checkpoint = readJsonSafe(CHECKPOINT_PATH, null);
  const lastImportedCreatedAt = checkpoint && checkpoint.last_imported_created_at ? String(checkpoint.last_imported_created_at) : null;
  const now = new Date();
  const adaptiveKlineLimit15m = resolveAdaptiveKlineLimit({
    checkpoint,
    now,
    intervalMs: 15 * 60 * 1000,
    fallbackLimit: KLINE_LIMIT_15M,
    minHistoryBars: KLINE_LIMIT_15M,
    maxLimit: 1500,
  });
  const adaptiveKlineLimit1h = resolveAdaptiveKlineLimit({
    checkpoint,
    now,
    intervalMs: 60 * 60 * 1000,
    fallbackLimit: KLINE_LIMIT_1H,
    minHistoryBars: KLINE_LIMIT_1H,
    maxLimit: 1500,
  });
  const [bookTickers, premiumIndexRows] = await Promise.all([
    fetchAllBookTickers(),
    fetchAllPremiumIndex(),
  ]);
  const bookTickerLookup = buildBookTickerLookup(bookTickers);
  const premiumIndexLookup = buildPremiumIndexLookup(premiumIndexRows);
  const decisions = [];
  for (const symbol of SYMBOLS) {
    const marketMeta = Object.freeze({
      ...(bookTickerLookup.get(symbol) || {}),
      ...(premiumIndexLookup.get(symbol) || {}),
    });
    decisions.push(await generateForSymbol(symbol, marketMeta, {
      sinceCreatedAt: lastImportedCreatedAt,
      klineLimit15m: adaptiveKlineLimit15m,
      klineLimit1h: adaptiveKlineLimit1h,
    }));
  }
  const readySignals = decisions.flatMap((decision) => Array.isArray(decision && decision.signals) ? decision.signals : []);
  const freshSignals = lastImportedCreatedAt
    ? readySignals.filter((row) => isStrictlyAfterIso(row && row.created_at, lastImportedCreatedAt))
    : readySignals;
  const appendedRowN = appendV3SourceFeedRows(FEED_PATH, freshSignals);
  const nextCheckpoint = buildV3SourceFeedCheckpoint({
    previousCheckpoint: checkpoint,
    fetchedRows: readySignals,
    importedRows: freshSignals,
    now,
    lookbackMinutes: 180,
    overlapMinutes: 15,
  });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(nextCheckpoint, null, 2));

  const reasonCounts = Object.create(null);
  for (const decision of decisions) {
    const summaries = Array.isArray(decision && decision.decision_summaries) ? decision.decision_summaries : [];
    if (!summaries.length) {
      const reason = String(decision && decision.reason || "UNKNOWN");
      reasonCounts[reason] = Number(reasonCounts[reason] || 0) + 1;
      continue;
    }
    for (const summary of summaries) {
      const reason = String(summary && summary.reason || "UNKNOWN");
      reasonCounts[reason] = Number(reasonCounts[reason] || 0) + 1;
    }
  }

  const payload = {
    generated_at: now.toISOString(),
    source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
    feed_path: FEED_PATH,
    checkpoint_path: CHECKPOINT_PATH,
    kline_limit_15m: adaptiveKlineLimit15m,
    kline_limit_1h: adaptiveKlineLimit1h,
    symbol_n: SYMBOLS.length,
    market_meta_source: "BINANCE_FAPI_BOOK_TICKER_AND_PREMIUM_INDEX",
    generated_signal_n: freshSignals.length,
    duplicate_or_old_signal_n: Math.max(0, readySignals.length - freshSignals.length),
    appended_row_n: appendedRowN,
    decision_reason_counts: reasonCounts,
    signal_preview: freshSignals.slice(0, 20),
    symbol_decisions: decisions.slice(0, 50),
    checkpoint: nextCheckpoint,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    symbol_n: payload.symbol_n,
    generated_signal_n: payload.generated_signal_n,
    appended_row_n: payload.appended_row_n,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V3_SOURCE_GENERATOR_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
