"use strict";

const fs = require("fs");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function readJsonlRows(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((row) => row && typeof row === "object");
  } catch (_) {
    return [];
  }
}

function appendJsonlRows(filePath, rows = []) {
  if (!rows.length) return 0;
  const payload = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  fs.appendFileSync(filePath, payload);
  return rows.length;
}

function incrementCounter(map, key) {
  map[key] = Number(map[key] || 0) + 1;
}

function buildExitId(entry = {}) {
  return `V3EXIT__${trimOrNull(entry.signal_id) || trimOrNull(entry.v3_paper_entry_id) || "UNKNOWN_ENTRY"}`;
}

function buildClosedSignalIdSet(existingExitRows = []) {
  const signalIds = new Set();
  for (const row of existingExitRows) {
    const signalId = trimOrNull(row && row.signal_id);
    if (signalId) signalIds.add(signalId);
  }
  return signalIds;
}

function hydrateEntryLevels(entry = {}, signalLookup = {}) {
  const signalId = trimOrNull(entry.signal_id);
  const fallback = signalId ? (signalLookup[signalId] || null) : null;
  return Object.freeze({
    ...entry,
    signal_price: toNumberOrNull(entry.signal_price ?? (fallback && fallback.signal_price)),
    stop_price: toNumberOrNull(entry.stop_price ?? (fallback && fallback.stop_price)),
    target_price: toNumberOrNull(entry.target_price ?? (fallback && fallback.target_price)),
  });
}

function hasPriceLevels(entry = {}) {
  return (
    toNumberOrNull(entry.signal_price) !== null
    && toNumberOrNull(entry.stop_price) !== null
    && toNumberOrNull(entry.target_price) !== null
  );
}

function hasValidDirectionalLevels(entry = {}) {
  const side = upper(entry.side);
  const signalPrice = toNumberOrNull(entry.signal_price);
  const stopPrice = toNumberOrNull(entry.stop_price);
  const targetPrice = toNumberOrNull(entry.target_price);
  if (signalPrice === null || stopPrice === null || targetPrice === null) return false;
  if (signalPrice <= 0 || stopPrice <= 0 || targetPrice <= 0) return false;
  if (side === "LONG") return stopPrice < signalPrice && signalPrice < targetPrice;
  if (side === "SHORT") return targetPrice < signalPrice && signalPrice < stopPrice;
  return false;
}

function resolveExitFromCandlePath(entry = {}, candlePath = []) {
  const side = upper(entry.side);
  const stopPrice = toNumberOrNull(entry.stop_price);
  const targetPrice = toNumberOrNull(entry.target_price);
  if (side === null || stopPrice === null || targetPrice === null) {
    return null;
  }
  const candles = [...(Array.isArray(candlePath) ? candlePath : [])]
    .map((row) => Object.freeze({
      open_time: trimOrNull(row && row.open_time),
      close_time: trimOrNull(row && row.close_time),
      high: toNumberOrNull(row && row.high),
      low: toNumberOrNull(row && row.low),
    }))
    .filter((row) => row.high !== null && row.low !== null)
    .sort((a, b) => String(a.open_time || "").localeCompare(String(b.open_time || "")));
  if (!candles.length) return null;
  if (side === "LONG") {
    for (const candle of candles) {
      const hitsStop = candle.low <= stopPrice;
      const hitsTarget = candle.high >= targetPrice;
      if (hitsStop && hitsTarget) {
        return Object.freeze({
          exit_event: "SL_HIT",
          exit_price: stopPrice,
          exit_at: candle.close_time || candle.open_time || new Date().toISOString(),
          price_source: "BINANCE_FAPI_1M_KLINES_AMBIGUOUS_CONSERVATIVE_STOP",
        });
      }
      if (hitsStop) {
        return Object.freeze({
          exit_event: "SL_HIT",
          exit_price: stopPrice,
          exit_at: candle.close_time || candle.open_time || new Date().toISOString(),
          price_source: "BINANCE_FAPI_1M_KLINES_STOP_PATH",
        });
      }
      if (hitsTarget) {
        return Object.freeze({
          exit_event: "TP_HIT",
          exit_price: targetPrice,
          exit_at: candle.close_time || candle.open_time || new Date().toISOString(),
          price_source: "BINANCE_FAPI_1M_KLINES_TARGET_PATH",
        });
      }
    }
    return null;
  }
  if (side === "SHORT") {
    for (const candle of candles) {
      const hitsStop = candle.high >= stopPrice;
      const hitsTarget = candle.low <= targetPrice;
      if (hitsStop && hitsTarget) {
        return Object.freeze({
          exit_event: "SL_HIT",
          exit_price: stopPrice,
          exit_at: candle.close_time || candle.open_time || new Date().toISOString(),
          price_source: "BINANCE_FAPI_1M_KLINES_AMBIGUOUS_CONSERVATIVE_STOP",
        });
      }
      if (hitsStop) {
        return Object.freeze({
          exit_event: "SL_HIT",
          exit_price: stopPrice,
          exit_at: candle.close_time || candle.open_time || new Date().toISOString(),
          price_source: "BINANCE_FAPI_1M_KLINES_STOP_PATH",
        });
      }
      if (hitsTarget) {
        return Object.freeze({
          exit_event: "TP_HIT",
          exit_price: targetPrice,
          exit_at: candle.close_time || candle.open_time || new Date().toISOString(),
          price_source: "BINANCE_FAPI_1M_KLINES_TARGET_PATH",
        });
      }
    }
    return null;
  }
  return null;
}

function computeRealizedPnlPct(entry = {}, exitPrice) {
  const side = upper(entry.side);
  const signalPrice = toNumberOrNull(entry.signal_price);
  const resolvedExitPrice = toNumberOrNull(exitPrice);
  if (!side || signalPrice === null || resolvedExitPrice === null || signalPrice === 0) return null;
  if (side === "LONG") return round(((resolvedExitPrice - signalPrice) / signalPrice) * 100, 4);
  if (side === "SHORT") return round(((signalPrice - resolvedExitPrice) / signalPrice) * 100, 4);
  return null;
}

function computeRealizedR(entry = {}, exitPrice) {
  const side = upper(entry.side);
  const signalPrice = toNumberOrNull(entry.signal_price);
  const stopPrice = toNumberOrNull(entry.stop_price);
  const resolvedExitPrice = toNumberOrNull(exitPrice);
  if (!side || signalPrice === null || stopPrice === null || resolvedExitPrice === null) return null;
  if (side === "LONG") {
    const risk = signalPrice - stopPrice;
    if (!(risk > 0)) return null;
    return round((resolvedExitPrice - signalPrice) / risk, 4);
  }
  if (side === "SHORT") {
    const risk = stopPrice - signalPrice;
    if (!(risk > 0)) return null;
    return round((signalPrice - resolvedExitPrice) / risk, 4);
  }
  return null;
}

const DEFAULT_ROUND_TRIP_FEE_PCT = 0.10;
const DEFAULT_ROUND_TRIP_SLIPPAGE_PCT = 0.04;

function resolveCostConfig(env = process.env) {
  const fee = toNumberOrNull(env && env.V3_COST_ROUND_TRIP_FEE_PCT);
  const slippage = toNumberOrNull(env && env.V3_COST_ROUND_TRIP_SLIPPAGE_PCT);
  return Object.freeze({
    round_trip_fee_pct: fee !== null && fee >= 0 ? fee : DEFAULT_ROUND_TRIP_FEE_PCT,
    round_trip_slippage_pct: slippage !== null && slippage >= 0 ? slippage : DEFAULT_ROUND_TRIP_SLIPPAGE_PCT,
  });
}

function computeCostR(entry = {}, costConfig = resolveCostConfig()) {
  const signalPrice = toNumberOrNull(entry.signal_price);
  const stopPrice = toNumberOrNull(entry.stop_price);
  if (signalPrice === null || stopPrice === null || signalPrice <= 0) return null;
  const riskPct = (Math.abs(signalPrice - stopPrice) / signalPrice) * 100;
  if (!(riskPct > 0)) return null;
  const costPct = Number(costConfig.round_trip_fee_pct || 0) + Number(costConfig.round_trip_slippage_pct || 0);
  return round(costPct / riskPct, 4);
}

function buildOpenEntries(entryRows = [], existingExitRows = [], signalLookup = {}) {
  const closedSignalIds = buildClosedSignalIdSet(existingExitRows);
  const openEntries = [];
  let hydratedOpenEntryN = 0;
  for (const row of entryRows) {
    if (upper(row && row.status) !== "OPEN") continue;
    const signalId = trimOrNull(row && row.signal_id);
    if (!signalId || closedSignalIds.has(signalId)) continue;
    const hydrated = hydrateEntryLevels(row, signalLookup);
    if (
      hydrated.signal_price !== toNumberOrNull(row.signal_price)
      || hydrated.stop_price !== toNumberOrNull(row.stop_price)
      || hydrated.target_price !== toNumberOrNull(row.target_price)
    ) hydratedOpenEntryN += 1;
    openEntries.push(hydrated);
  }
  return Object.freeze({ openEntries, hydratedOpenEntryN });
}

function buildV3PaperExitLedgerReport(entryRows = [], {
  exitLedgerPath = null,
  candlePathsBySignalId = {},
  signalLookup = {},
} = {}) {
  const existingExitRows = exitLedgerPath ? readJsonlRows(exitLedgerPath) : [];
  const { openEntries, hydratedOpenEntryN } = buildOpenEntries(entryRows, existingExitRows, signalLookup);
  const blockedReasonCounts = Object.create(null);
  const costConfig = resolveCostConfig();
  const newExits = [];

  for (const entry of openEntries) {
    const symbol = upper(entry.symbol);
    const signalId = trimOrNull(entry.signal_id);
    const candlePath = signalId ? candlePathsBySignalId[signalId] || [] : [];
    if (!hasPriceLevels(entry)) {
      incrementCounter(blockedReasonCounts, "V3_EXIT_LEVELS_MISSING");
      continue;
    }
    if (!hasValidDirectionalLevels(entry)) {
      incrementCounter(blockedReasonCounts, "V3_EXIT_LEVELS_INVALID");
      continue;
    }
    if (!Array.isArray(candlePath) || !candlePath.length) {
      incrementCounter(blockedReasonCounts, "V3_EXIT_PATH_UNAVAILABLE");
      continue;
    }
    const exitOutcome = resolveExitFromCandlePath(entry, candlePath);
    if (!exitOutcome) continue;
    const realizedR = computeRealizedR(entry, exitOutcome.exit_price);
    const costR = computeCostR(entry, costConfig);
    newExits.push(Object.freeze({
      v3_paper_exit_id: buildExitId(entry),
      closed_at: trimOrNull(exitOutcome.exit_at) || new Date().toISOString(),
      v3_paper_entry_id: trimOrNull(entry.v3_paper_entry_id),
      signal_id: signalId,
      symbol,
      exchange: upper(entry.exchange),
      tf: trimOrNull(entry.tf),
      side: upper(entry.side),
      setup_type: upper(entry.setup_type),
      structural_regime: upper(entry.structural_regime),
      edge_cohort: upper(entry.edge_cohort),
      cohort_key: trimOrNull(entry.cohort_key),
      profile_id: upper(entry.profile_id),
      entry_grade: upper(entry.entry_grade),
      market_quality_score: toNumberOrNull(entry.market_quality_score),
      spread_bps: toNumberOrNull(entry.spread_bps),
      funding_rate: toNumberOrNull(entry.funding_rate),
      btc_1h_trend: upper(entry.btc_1h_trend),
      mtf_1h_direction: upper(entry.mtf_1h_direction),
      feature_lineage_source: upper(entry.feature_lineage_source),
      signal_price: toNumberOrNull(entry.signal_price),
      stop_price: toNumberOrNull(entry.stop_price),
      target_price: toNumberOrNull(entry.target_price),
      equity_curve_state: upper(entry.equity_curve_state),
      equity_curve_window_n: toNumberOrNull(entry.equity_curve_window_n),
      exit_price: toNumberOrNull(exitOutcome.exit_price),
      exit_event: upper(exitOutcome.exit_event),
      realized_pnl_pct: computeRealizedPnlPct(entry, exitOutcome.exit_price),
      realized_r: realizedR,
      cost_round_trip_fee_pct: costConfig.round_trip_fee_pct,
      cost_round_trip_slippage_pct: costConfig.round_trip_slippage_pct,
      cost_r: costR,
      realized_r_net: realizedR !== null && costR !== null ? round(realizedR - costR, 4) : realizedR,
      status: "CLOSED",
      price_source: trimOrNull(exitOutcome.price_source) || "BINANCE_FAPI_1M_KLINES_PATH",
      source: "V3_LOCAL_PAPER_EXIT",
    }));
  }

  const appendedExitN = exitLedgerPath ? appendJsonlRows(exitLedgerPath, newExits) : 0;
  const remainingOpenPositionN = Math.max(0, openEntries.length - newExits.length);

  return Object.freeze({
    ok: true,
    source_entry_n: Array.isArray(entryRows) ? entryRows.length : 0,
    existing_exit_n: existingExitRows.length,
    eligible_open_entry_n: openEntries.length,
    hydrated_open_entry_n: hydratedOpenEntryN,
    appended_exit_n: appendedExitN,
    remaining_open_position_n: remainingOpenPositionN,
    blocked_reason_counts: Object.freeze(blockedReasonCounts),
    new_exits: Object.freeze(newExits.slice(0, 50)),
  });
}

module.exports = Object.freeze({
  buildV3PaperExitLedgerReport,
  resolveCostConfig,
  computeCostR,
  __test: {
    readJsonlRows,
    buildExitId,
    buildClosedSignalIdSet,
    hydrateEntryLevels,
    resolveExitFromCandlePath,
    computeRealizedPnlPct,
    computeRealizedR,
    resolveCostConfig,
    computeCostR,
    hasValidDirectionalLevels,
    buildOpenEntries,
  },
});
