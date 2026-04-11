#!/usr/bin/env node
"use strict";

const path = require("path");

const { getPosition, upsertPosition } = require("../src/storage/positions");
const {
  resolveExitRulesForPosition,
} = require("../src/engine/signalEngine");
const {
  resolveLiveFuturesConfig,
  refreshBinanceNativeProtectionWithRetry,
  buildNativeProtectionMetaPatch,
} = require("../src/engine/paperBinanceRunner");

const BOARD_LATEST_PATH = path.join(
  __dirname,
  "..",
  "ops",
  "daily",
  "best_self_evolution_openclaw_market_regime_board_latest.json"
);

function loadBoard() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(BOARD_LATEST_PATH);
}

function findBoardRow(board, symbol) {
  const upper = String(symbol || "").trim().toUpperCase();
  const rows = Array.isArray(board && board.by_market) ? board.by_market : [];
  return rows.find((row) => String(row && row.market || "").trim().toUpperCase() === upper) || null;
}

function normalizeCohort(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "KEEP_DROP" || upper === "HOLD_SAMPLE") return upper;
  return null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function applyForSymbol(symbol) {
  const upper = String(symbol || "").trim().toUpperCase();
  if (!upper) return { ok: false, symbol: upper, skipped: true, reason: "SYMBOL_MISSING" };

  const board = loadBoard();
  const boardRow = findBoardRow(board, upper);
  const cohort = normalizeCohort(boardRow && boardRow.cohort);
  if (!cohort) return { ok: false, symbol: upper, skipped: true, reason: "COHORT_MISSING" };

  const pos = await getPosition({ exchange: "BINANCEFUT", symbol: upper });
  const state = String(pos && pos.state || "").toUpperCase();
  const positionState = String(pos && pos.position_state || "").toUpperCase();
  const qtyBase = Number(pos && pos.qty_base);
  const activeLike = state === "ACTIVE" || positionState === "ACTIVE" || positionState === "COMMIT";
  if (!activeLike || !Number.isFinite(qtyBase) || qtyBase <= 0) {
    return { ok: false, symbol: upper, skipped: true, reason: "POSITION_NOT_ACTIVE", state, position_state: positionState };
  }

  const prevMeta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const nextMeta = {
    ...prevMeta,
    openclaw_market_regime_cohort: cohort,
    openclaw_market_regime_objective_score: toNum(boardRow && boardRow.objective_score),
    openclaw_market_regime_drop_verdict: boardRow ? String(boardRow.drop_verdict || "").trim().toUpperCase() || null : null,
  };

  const rules = resolveExitRulesForPosition({
    exchange: "BINANCEFUT",
    position: { ...pos, meta: nextMeta },
  });

  const liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol: upper });
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) {
    return { ok: false, symbol: upper, skipped: true, reason: "LIVE_CONFIG_MISSING" };
  }

  const nativeProtection = await refreshBinanceNativeProtectionWithRetry({
    liveCfg,
    exchange: "BINANCEFUT",
    symbol: upper,
    fallbackSide: String(pos && (pos.position_side || pos.side) || prevMeta.position_side || "").toUpperCase() === "SHORT" ? "SELL" : "BUY",
    fallbackEntryPrice: pos && pos.avg_price,
    fallbackLeverage: prevMeta.external_leverage || prevMeta.leverage || pos.leverage || liveCfg.leverage,
    exitRulesOverride: rules,
  });

  const nativePatch = buildNativeProtectionMetaPatch({
    nativeProtection,
    intent: "ENTRY",
    execBarCloseMs: prevMeta.entry_exec_bar_ms || prevMeta.entry_signal_bar_ms || null,
  }) || {};

  const mergedMeta = {
    ...nextMeta,
    ...nativePatch,
  };

  await upsertPosition({
    exchange: "BINANCEFUT",
    symbol: upper,
    state: pos && pos.state ? pos.state : "ACTIVE",
    sizePct: pos && pos.size_pct,
    avgPrice: pos && pos.avg_price,
    runId: pos && pos.run_id,
    budgetMaxKrw: pos && pos.budget_max_krw,
    budgetUsedKrw: pos && pos.budget_used_krw,
    budgetSource: pos && pos.budget_source,
    positionSide: pos && pos.position_side,
    qtyBase: pos && pos.qty_base,
    executionMode: pos && pos.execution_mode,
    meta: mergedMeta,
  });

  return {
    ok: true,
    symbol: upper,
    cohort,
    tp1_pct: rules && rules.TP_P1,
    native_tp_price: toNum(nativeProtection && nativeProtection.tp_price),
    native_tp_status: nativeProtection && nativeProtection.tp_status ? String(nativeProtection.tp_status) : null,
    native_refresh_ok: nativeProtection && nativeProtection.ok === true,
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const symbols = rawArgs.length ? rawArgs : ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const results = [];
  for (const symbol of symbols) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await applyForSymbol(symbol));
  }
  console.log(JSON.stringify({
    ok: results.every((row) => row && (row.ok === true || row.skipped === true)),
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error("APPLY_OPEN_POSITION_COHORT_BACKFILL_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
