"use strict";

const { queryBars } = require("../storage/barsSnapshots");
const { tfToMs } = require("./marketConfig");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function computeMfeMae({ entry, bars, side }) {
  const entryNum = Number(entry);
  const sideUpper = upper(side);
  if (!Number.isFinite(entryNum) || !Array.isArray(bars) || !bars.length || !["LONG", "SHORT"].includes(sideUpper)) {
    return { mfe: null, mae: null };
  }
  let mfe = null;
  let mae = null;
  for (const bar of bars) {
    const high = Number(bar && bar.high);
    const low = Number(bar && bar.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    if (sideUpper === "LONG") {
      const gain = (high - entryNum) / entryNum;
      const loss = (low - entryNum) / entryNum;
      mfe = mfe === null || gain > mfe ? gain : mfe;
      mae = mae === null || loss < mae ? loss : mae;
    } else {
      const gain = (entryNum - low) / entryNum;
      const loss = (entryNum - high) / entryNum;
      mfe = mfe === null || gain > mfe ? gain : mfe;
      mae = mae === null || loss < mae ? loss : mae;
    }
  }
  return { mfe, mae };
}

function normalizeBarsByMarket(input) {
  if (input instanceof Map) return input;
  if (input && typeof input === "object") return new Map(Object.entries(input));
  return new Map();
}

function estimateBarLimit({ fromMs, toMs, tf, bufferBars = 16, minLimit = 200 }) {
  const tfMs = Number(tfToMs(String(tf || "").trim()));
  const spanMs = Math.max(0, Number(toMs) - Number(fromMs));
  if (!(Number.isFinite(tfMs) && tfMs > 0)) return minLimit;
  return Math.max(minLimit, Math.ceil(spanMs / tfMs) + bufferBars);
}

async function loadBarsForChainRows(chainRows = [], { exchange, tf, minLimit = 200 } = {}) {
  const ex = upper(exchange || "BINANCEFUT");
  const timeframe = String(tf || "").trim();
  const perMarket = new Map();
  for (const row of Array.isArray(chainRows) ? chainRows : []) {
    const market = upper(row && row.market);
    const entryBarMs = toNum(row && row.entry_bar_ms);
    const pathEndMs =
      toNum(row && row.path_end_ms) ??
      toNum(row && row.last_exit_ms) ??
      toNum(row && row.first_exit_ms) ??
      toNum(row && row.tp1_ms) ??
      toNum(row && row.sl_ms);
    if (!market || !Number.isFinite(entryBarMs) || !Number.isFinite(pathEndMs) || pathEndMs <= entryBarMs) continue;
    const current = perMarket.get(market) || { fromMs: entryBarMs, toMs: pathEndMs };
    current.fromMs = Math.min(current.fromMs, entryBarMs);
    current.toMs = Math.max(current.toMs, pathEndMs);
    perMarket.set(market, current);
  }

  const out = new Map();
  for (const [market, range] of perMarket.entries()) {
    const bars = await queryBars({
      exchange: ex,
      symbol: market,
      tf: timeframe,
      limit: estimateBarLimit({ fromMs: range.fromMs, toMs: range.toMs, tf: timeframe, minLimit }),
    });
    out.set(
      market,
      (Array.isArray(bars) ? bars : []).filter((bar) => {
        const ts = toNum(bar && (bar.timestamp ?? bar.closeTimeUtcMs));
        return Number.isFinite(ts) && ts >= range.fromMs && ts <= range.toMs;
      })
    );
  }
  return out;
}

module.exports = {
  computeMfeMae,
  loadBarsForChainRows,
  normalizeBarsByMarket,
  __test: {
    estimateBarLimit,
  },
};
