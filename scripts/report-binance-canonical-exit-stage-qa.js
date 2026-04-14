#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { fetchBinanceFuturesAccount, fetchFuturesOpenOrders, fetchFuturesAlgoOpenOrders } = require("../src/exchanges/binanceFuturesPrivate");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { listExchangePositionReadViews } = require("../src/services/positionReadModel");
const { getPositionRuntimeObservation, resolveTrailObservationSnapshot } = require("../src/storage/positionRuntimeObservations");
const { __test: watchdogTest } = require("../src/services/binanceActiveExitWatchdog");

const ROOT = path.resolve(__dirname, "..");
const OUT_JSON = path.join(ROOT, "ops", "daily", "binance_canonical_exit_stage_qa_latest.json");
const OUT_MD = path.join(ROOT, "ops", "daily", "binance_canonical_exit_stage_qa_latest.md");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isActiveInternalPosition(row = {}) {
  const state = upper(row.position_state || row.state);
  const qtyBase = toNum(row.qty_base, 0);
  return qtyBase > 0 && state !== "FLAT";
}

function groupBySymbol(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = upper(row && row.symbol);
    if (!symbol) continue;
    if (!map.has(symbol)) map.set(symbol, []);
    map.get(symbol).push(row);
  }
  return map;
}

function computeCurrentProfitPct({ avgPrice, stopPrice, side, leverage }) {
  const avg = toNum(avgPrice);
  const stop = toNum(stopPrice);
  const lev = Math.max(1, toNum(leverage, 1));
  if (!(Number.isFinite(avg) && avg > 0 && Number.isFinite(stop) && stop > 0)) return null;
  const sideUpper = upper(side) === "SHORT" ? "SHORT" : "LONG";
  if (sideUpper === "SHORT") return ((avg - stop) / avg) * lev;
  return ((stop - avg) / avg) * lev;
}

function buildRow({
  position,
  externalPosition,
  observation,
  openOrders,
  algoOrders,
}) {
  const meta = (position && typeof position.meta === "object") ? position.meta : {};
  const symbol = upper(position.symbol || position.symbol_or_pair_id);
  const rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position });
  const trailSnapshot = resolveTrailObservationSnapshot({ meta, observation });
  const watchdogRow = watchdogTest.inspectExitProtection({
    symbol,
    internalPosition: position,
    externalPosition,
    observation,
    openOrders,
    algoOrders,
  });
  const leverage = toNum(meta.external_leverage || meta.leverage || position.leverage, 1);
  const currentProfitPct = computeCurrentProfitPct({
    avgPrice: position.avg_price,
    stopPrice: watchdogRow.actual_stop_price,
    side: watchdogRow.position_side,
    leverage,
  });
  const minGuaranteedPct = toNum(rules.RUNNER_MIN_PROFIT_PCT);
  const chosenStopSource = upper(watchdogRow.chosen_stop_source || trailSnapshot.chosen_stop_source);
  return {
    symbol,
    position_side: watchdogRow.position_side,
    qty_base: toNum(position.qty_base),
    avg_price: toNum(position.avg_price),
    leverage,
    canonical_stage: watchdogRow.stage,
    tp_p0_done: meta.tp_p0_done === true,
    tp_p1_done: meta.tp_p1_done === true,
    trail_active: meta.trail_active === true,
    external_position_amt: toNum(externalPosition && (externalPosition.positionAmt || externalPosition.position_amt)),
    native_stop_price: watchdogRow.actual_stop_price,
    expected_stop_price: watchdogRow.expected_stop_price,
    expected_floor_stop_price: watchdogRow.expected_floor_stop_price,
    trail_stop_by_r: watchdogRow.trail_stop_by_r,
    chosen_stop_source: chosenStopSource,
    chosen_stop_price: watchdogRow.chosen_stop_price,
    trail_r_multiple: toNum(trailSnapshot.trail_r_multiple || rules.TRAIL_R_MULTIPLE),
    min_guaranteed_profit_pct: minGuaranteedPct,
    current_guaranteed_profit_pct: currentProfitPct,
    guarantee_pass: Number.isFinite(minGuaranteedPct) && Number.isFinite(currentProfitPct)
      ? currentProfitPct + 1e-9 >= minGuaranteedPct
      : null,
    open_order_n: Array.isArray(openOrders) ? openOrders.length : 0,
    algo_order_n: Array.isArray(algoOrders) ? algoOrders.length : 0,
    actionable_issue_n: watchdogRow.actionable_issue_n,
    actionable_issue_codes: watchdogRow.actionable_issue_codes || [],
    issues: Array.isArray(watchdogRow.issues) ? watchdogRow.issues : [],
    verdict: Number(watchdogRow.actionable_issue_n || 0) > 0 ? "FAIL" : "PASS",
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Binance Canonical Exit Stage QA");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- active_position_n: ${report.active_position_n || 0}`);
  lines.push(`- fail_n: ${report.fail_n || 0}`);
  lines.push(`- failing_symbols: ${Array.isArray(report.failing_symbols) && report.failing_symbols.length ? report.failing_symbols.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Rows");
  if (!Array.isArray(report.rows) || !report.rows.length) {
    lines.push("- none");
    return `${lines.join("\n")}\n`;
  }
  for (const row of report.rows) {
    lines.push(`- ${row.symbol} | stage=${row.canonical_stage} | qty=${row.qty_base} | stop=${row.native_stop_price ?? "N/A"} | floor=${row.expected_floor_stop_price ?? "N/A"} | r_stop=${row.trail_stop_by_r ?? "N/A"} | chosen=${row.chosen_stop_source || "N/A"}:${row.chosen_stop_price ?? "N/A"} | min_gp=${row.min_guaranteed_profit_pct ?? "N/A"} | current_gp=${row.current_guaranteed_profit_pct ?? "N/A"} | issues=${(row.actionable_issue_codes || []).join(",") || "none"} | verdict=${row.verdict}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const keys = await watchdogTest.resolveBinanceKeys();
  if (!keys) {
    throw new Error("BINANCE_KEYS_MISSING");
  }
  const positions = (await listExchangePositionReadViews({ exchange: "BINANCEFUT", limit: 2000 }))
    .filter((row) => isActiveInternalPosition(row));
  const account = await fetchBinanceFuturesAccount({ ...keys });
  const externalBySymbol = new Map(
    (Array.isArray(account && account.positions) ? account.positions : [])
      .map((row) => [upper(row && row.symbol), row])
      .filter(([symbol]) => !!symbol)
  );
  const openOrdersBySymbol = groupBySymbol(await fetchFuturesOpenOrders({ ...keys }).catch(() => []));
  const rows = [];
  for (const position of positions) {
    const symbol = upper(position.symbol || position.symbol_or_pair_id);
    const observation = await getPositionRuntimeObservation({ exchange: "BINANCEFUT", symbol }).catch(() => null);
    const algoOrders = await fetchFuturesAlgoOpenOrders({ ...keys, symbol }).catch(() => []);
    rows.push(buildRow({
      position,
      externalPosition: externalBySymbol.get(symbol) || null,
      observation,
      openOrders: openOrdersBySymbol.get(symbol) || [],
      algoOrders,
    }));
  }
  rows.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  const failingRows = rows.filter((row) => row.verdict === "FAIL");
  const report = {
    generated_at: nowIso(),
    exchange: "BINANCEFUT",
    active_position_n: rows.length,
    fail_n: failingRows.length,
    failing_symbols: failingRows.map((row) => row.symbol),
    rows,
  };
  ensureDir(OUT_JSON);
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, buildMarkdown(report));
  console.log(JSON.stringify({
    ok: true,
    active_position_n: report.active_position_n,
    fail_n: report.fail_n,
    failing_symbols: report.failing_symbols,
    output_json: OUT_JSON,
    output_md: OUT_MD,
  }, null, 2));
}

main().catch((err) => {
  console.error("BINANCE_CANONICAL_EXIT_STAGE_QA_FAILED", err && err.stack ? err.stack : err);
  process.exit(1);
});
