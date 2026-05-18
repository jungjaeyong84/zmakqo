#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { buildV3PaperExitLedgerReport, __test } = require("../src/v3/localPaperExitLedger");
const { readJsonlRows: readSourceFeedRows } = require("../src/v3/sourceFeed");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const ENTRY_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_entry_ledger.jsonl");
const EXIT_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_exit_ledger.jsonl");
const SOURCE_FEED_PATH = path.join(OPS_RUNTIME, "v3_raw_signal_feed.jsonl");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_paper_exit_ledger_latest.json");

function readJsonlRows(filePath) {
  return __test.readJsonlRows(filePath);
}

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseKlineIntervalMs(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  const match = /^(\d+)([mhdw])$/i.exec(text);
  if (!match) return null;
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(count) || count <= 0) return null;
  const unitMs = (
    unit === "m" ? 60 * 1000
      : unit === "h" ? 60 * 60 * 1000
        : unit === "d" ? 24 * 60 * 60 * 1000
          : unit === "w" ? 7 * 24 * 60 * 60 * 1000
            : null
  );
  return unitMs ? count * unitMs : null;
}

function computeRequiredKlinePages({
  startTimeMs,
  endTimeMs,
  intervalMs,
  klineLimit,
} = {}) {
  if (
    !Number.isFinite(startTimeMs)
    || !Number.isFinite(endTimeMs)
    || !Number.isFinite(intervalMs)
    || !(intervalMs > 0)
    || !Number.isFinite(klineLimit)
    || !(klineLimit > 0)
    || endTimeMs < startTimeMs
  ) return 1;
  const candleCount = Math.max(1, Math.ceil((endTimeMs - startTimeMs) / intervalMs) + 1);
  return Math.max(1, Math.ceil(candleCount / klineLimit));
}

function resolveKlinePageBudget({
  startTimeMs,
  endTimeMs,
  interval,
  klineLimit,
  configuredMaxPages,
  hardCapPages,
} = {}) {
  const intervalMs = parseKlineIntervalMs(interval);
  const requiredPages = computeRequiredKlinePages({
    startTimeMs,
    endTimeMs,
    intervalMs,
    klineLimit,
  });
  const effectiveHardCap = Number.isFinite(hardCapPages) && hardCapPages > 0
    ? Math.floor(hardCapPages)
    : 1000;
  if (Number.isFinite(configuredMaxPages) && configuredMaxPages > 0) {
    return Object.freeze({
      mode: "CONFIGURED_CAP",
      required_pages: requiredPages,
      page_budget: Math.min(Math.floor(configuredMaxPages), effectiveHardCap),
    });
  }
  return Object.freeze({
    mode: "ADAPTIVE_REQUIRED_RANGE",
    required_pages: requiredPages,
    page_budget: Math.max(1, Math.min(requiredPages + 1, effectiveHardCap)),
  });
}

function buildMissingLevelSignalIds(entryRows = []) {
  const ids = new Set();
  for (const row of entryRows) {
    if (String(row && row.status || "").toUpperCase() !== "OPEN") continue;
    const signalId = trimOrNull(row && row.signal_id);
    if (!signalId) continue;
    const hasAllLevels = (
      toNumberOrNull(row.signal_price) !== null
      && toNumberOrNull(row.stop_price) !== null
      && toNumberOrNull(row.target_price) !== null
    );
    if (!hasAllLevels) ids.add(signalId);
  }
  return [...ids];
}

function loadSignalLevelFallback(signalIds = []) {
  const needed = new Set(signalIds.map((value) => trimOrNull(value)).filter(Boolean));
  const lookup = Object.create(null);
  for (const row of readSourceFeedRows(SOURCE_FEED_PATH)) {
    const signalId = trimOrNull(row && row.signal_id);
    if (!signalId || !needed.has(signalId)) continue;
    const features = row && row.features_json && typeof row.features_json === "object" ? row.features_json : {};
    lookup[signalId] = Object.freeze({
      signal_price: toNumberOrNull(features.signal_price),
      stop_price: toNumberOrNull(features.stop_price),
      target_price: toNumberOrNull(features.target_price),
    });
  }
  return Object.freeze(lookup);
}

// 2026-05-18 — Binance futures /fapi/v1/klines started returning 429
// under bursty per-cycle fetches (15 open positions × per-symbol pages,
// fired serially without throttle) and the script had no retry, so a
// single 429 from one symbol killed the entire exit-ledger run for
// minutes at a time. The helpers below add:
//   - retry-on-429 with exponential backoff + honor of the
//     Retry-After response header (Binance returns it as seconds);
//   - retry-on-418 (IP ban) but only once, with a long pause and
//     surface to the caller so the cycle can stop;
//   - retry on transient 5xx with shorter backoff;
//   - other non-OK statuses propagate without retry.
const KLINE_FETCH_MAX_RETRIES = (() => {
  const n = Number(process.env.V3_PAPER_EXIT_KLINE_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 4;
})();
const KLINE_FETCH_BASE_BACKOFF_MS = (() => {
  const n = Number(process.env.V3_PAPER_EXIT_KLINE_BASE_BACKOFF_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1500;
})();
const KLINE_INTER_SYMBOL_DELAY_MS = (() => {
  const n = Number(process.env.V3_PAPER_EXIT_KLINE_INTER_SYMBOL_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 250;
})();

function sleepMs(ms) {
  const clamped = Math.max(0, Math.floor(Number(ms) || 0));
  return new Promise((resolve) => setTimeout(resolve, clamped));
}

function parseRetryAfterMs(res) {
  try {
    const raw = res && res.headers && typeof res.headers.get === "function"
      ? res.headers.get("retry-after")
      : null;
    if (!raw) return null;
    const seconds = Number(String(raw).trim());
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  } catch (_) {}
  return null;
}

async function fetchKlinePageWithRetry({ url, fetchImpl, symbol }) {
  let lastStatus = null;
  for (let attempt = 0; attempt <= KLINE_FETCH_MAX_RETRIES; attempt += 1) {
    const res = await fetchImpl(url);
    if (res.ok) return res;
    lastStatus = res.status;
    // 429 = rate limited, 418 = IP banned (Binance pattern), 5xx = transient.
    const retriable = res.status === 429 || res.status === 418 || (res.status >= 500 && res.status < 600);
    if (!retriable || attempt === KLINE_FETCH_MAX_RETRIES) {
      throw new Error(`V3_EXIT_KLINE_FETCH_FAILED:${symbol}:${res.status}`);
    }
    const retryAfterMs = parseRetryAfterMs(res);
    // Exponential backoff: 1.5s, 3s, 6s, 12s. Honor Retry-After if longer.
    const computed = KLINE_FETCH_BASE_BACKOFF_MS * Math.pow(2, attempt);
    const waitMs = retryAfterMs && retryAfterMs > computed ? retryAfterMs : computed;
    await sleepMs(waitMs);
  }
  // Unreachable — loop either returns or throws — but keep the guard.
  throw new Error(`V3_EXIT_KLINE_FETCH_FAILED:${symbol}:${lastStatus || "EXHAUSTED"}`);
}

async function fetchKlinesForEntry(entry, nowMs, {
  fetchImpl = global.fetch,
  klineInterval = KLINE_INTERVAL,
  klineLimit = KLINE_LIMIT,
  klineMaxPages = KLINE_MAX_PAGES,
  klineHardCapPages = KLINE_HARD_CAP_PAGES,
} = {}) {
  const symbol = String(entry && entry.symbol || "").trim().toUpperCase();
  const signalId = trimOrNull(entry && entry.signal_id);
  const createdAtMs = toEpochMs(entry && entry.created_at);
  if (!symbol || !signalId || !Number.isFinite(createdAtMs)) return [];
  let startTime = Math.max(0, createdAtMs - 60 * 1000);
  const endTime = nowMs;
  const candles = [];
  const budget = resolveKlinePageBudget({
    startTimeMs: startTime,
    endTimeMs: endTime,
    interval: klineInterval,
    klineLimit,
    configuredMaxPages: klineMaxPages,
    hardCapPages: klineHardCapPages,
  });
  let completedRange = false;

  for (let page = 0; page < budget.page_budget && startTime <= endTime; page += 1) {
    const url = new URL("https://fapi.binance.com/fapi/v1/klines");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", klineInterval);
    url.searchParams.set("limit", String(klineLimit));
    url.searchParams.set("startTime", String(startTime));
    url.searchParams.set("endTime", String(endTime));
    const res = await fetchKlinePageWithRetry({ url, fetchImpl, symbol });
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      completedRange = true;
      break;
    }
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 7) continue;
      candles.push(Object.freeze({
        open_time: new Date(Number(row[0])).toISOString(),
        close_time: new Date(Number(row[6])).toISOString(),
        high: toNumberOrNull(row[2]),
        low: toNumberOrNull(row[3]),
      }));
    }
    const last = rows[rows.length - 1];
    const lastCloseMs = Number(Array.isArray(last) ? last[6] : 0);
    if (!Number.isFinite(lastCloseMs) || lastCloseMs >= endTime || rows.length < klineLimit) {
      completedRange = true;
      break;
    }
    startTime = lastCloseMs + 1;
  }

  if (!completedRange && startTime <= endTime) {
    throw new Error(`V3_EXIT_KLINE_PAGE_CAP_REACHED:${symbol}:${signalId}:${budget.page_budget}`);
  }

  return candles;
}

async function fetchCandlePathsBySignalId(entries = [], options = {}) {
  const nowMs = Date.now();
  const lookup = Object.create(null);
  const list = Array.isArray(entries) ? entries : [];

  // 2026-05-18 — fetch by SYMBOL first, then slice per-entry, so multiple
  // open entries on the same symbol share one set of kline pages. Before
  // this, three concurrent BNBUSDT entries each fired their own paginated
  // fetch, tripling the per-symbol Binance weight and contributing to the
  // 429 cascade.
  const bySymbol = new Map();
  for (const entry of list) {
    const symbol = String(entry && entry.symbol || "").trim().toUpperCase();
    const signalId = trimOrNull(entry && entry.signal_id);
    const createdAtMs = toEpochMs(entry && entry.created_at);
    if (!symbol || !signalId || !Number.isFinite(createdAtMs)) continue;
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol).push({ entry, signalId, createdAtMs });
  }

  let isFirst = true;
  for (const [symbol, group] of bySymbol) {
    if (!isFirst && KLINE_INTER_SYMBOL_DELAY_MS > 0) {
      // Spread requests across the Binance per-minute weight budget so we
      // don't fire all symbols in a sub-second burst.
      await sleepMs(KLINE_INTER_SYMBOL_DELAY_MS);
    }
    isFirst = false;

    // Fetch once using the earliest entry on this symbol so the window
    // covers everyone, then SLICE per entry by its own created_at before
    // returning. The downstream `resolveExitFromCandlePath` scans the
    // first SL/TP hit chronologically — if a newer entry inherited the
    // shared (older-window) candles unsliced, it would false-trigger on
    // a pre-creation candle. The slice keeps each lookup entry-scoped
    // exactly as the original one-fetch-per-entry path did.
    const earliest = group.reduce(
      (acc, row) => (row.createdAtMs < acc.createdAtMs ? row : acc),
      group[0]
    );
    const sharedCandles = await fetchKlinesForEntry(earliest.entry, nowMs, options);

    for (const row of group) {
      // 60s margin matches fetchKlinesForEntry's own startTime offset so
      // a candle that opens slightly before created_at (but covers the
      // create moment in its high/low) still counts.
      const minOpenMs = row.createdAtMs - 60 * 1000;
      lookup[row.signalId] = sharedCandles.filter((c) => {
        const openMs = c && c.open_time ? Date.parse(c.open_time) : null;
        return Number.isFinite(openMs) && openMs >= minOpenMs;
      });
    }
  }
  return Object.freeze(lookup);
}

const KLINE_INTERVAL = process.env.V3_PAPER_EXIT_KLINE_INTERVAL || "1m";
const KLINE_LIMIT = (() => {
  const n = Number(process.env.V3_PAPER_EXIT_KLINE_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000;
})();
const KLINE_MAX_PAGES = (() => {
  const n = Number(process.env.V3_PAPER_EXIT_KLINE_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
})();
const KLINE_HARD_CAP_PAGES = (() => {
  const n = Number(process.env.V3_PAPER_EXIT_KLINE_HARD_CAP_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000;
})();

function toEpochMs(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  const epoch = new Date(text).getTime();
  return Number.isFinite(epoch) ? epoch : null;
}

async function main() {
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  fs.mkdirSync(OPS_RUNTIME, { recursive: true });

  const entryRows = readJsonlRows(ENTRY_LEDGER_PATH);
  const openEntries = entryRows.filter((row) => String(row && row.status || "").toUpperCase() === "OPEN");

  const missingLevelSignalIds = buildMissingLevelSignalIds(entryRows);
  const signalLookup = missingLevelSignalIds.length
    ? loadSignalLevelFallback(missingLevelSignalIds)
    : Object.freeze({});
  const candlePathsBySignalId = openEntries.length
    ? await fetchCandlePathsBySignalId(openEntries)
    : Object.freeze({});

  const summary = buildV3PaperExitLedgerReport(entryRows, {
    exitLedgerPath: EXIT_LEDGER_PATH,
    candlePathsBySignalId,
    signalLookup,
  });

  const payload = {
    generated_at: new Date().toISOString(),
    entry_ledger_path: ENTRY_LEDGER_PATH,
    exit_ledger_path: EXIT_LEDGER_PATH,
    signal_level_fallback_n: missingLevelSignalIds.length,
    candle_path_signal_n: Object.keys(candlePathsBySignalId).length,
    kline_interval: KLINE_INTERVAL,
    kline_limit: KLINE_LIMIT,
    kline_max_pages: KLINE_MAX_PAGES,
    kline_hard_cap_pages: KLINE_HARD_CAP_PAGES,
    ...summary,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    eligible_open_entry_n: payload.eligible_open_entry_n,
    appended_exit_n: payload.appended_exit_n,
    remaining_open_position_n: payload.remaining_open_position_n,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V3_PAPER_EXIT_LEDGER_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = Object.freeze({
  __test: {
    parseKlineIntervalMs,
    computeRequiredKlinePages,
    resolveKlinePageBudget,
    fetchKlinesForEntry,
    fetchKlinePageWithRetry,
    fetchCandlePathsBySignalId,
    parseRetryAfterMs,
    toEpochMs,
  },
});
