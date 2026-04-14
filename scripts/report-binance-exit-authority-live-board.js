#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { listExchangePositionReadViews } = require("../src/services/positionReadModel");
const { getPositionRuntimeObservation, resolveTrailObservationSnapshot } = require("../src/storage/positionRuntimeObservations");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { resolveTp1RemainingContractQtyRatio } = require("../src/utils/exitQtyContract");

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJsonIfExists(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function isActivePosition(row = {}) {
  const state = upper(row.position_state || row.state);
  const qtyBase = toNum(row.qty_base, 0);
  return qtyBase > 0 && state !== "FLAT";
}

function buildSymbolSet(rows = []) {
  return new Set((Array.isArray(rows) ? rows : []).map((row) => upper(row && row.symbol)).filter(Boolean));
}

function isArtifactIssueCode(code) {
  return /_ARTIFACT$/.test(String(code || "").trim().toUpperCase());
}

function resolveStage(meta = {}, trailSnapshot = {}) {
  const runtimeTrailRepair = Number.isFinite(toNum(trailSnapshot.runtime_eval_at_ms))
    && Number.isFinite(toNum(trailSnapshot.runner_floor_stop))
    && Number.isFinite(toNum(trailSnapshot.native_stop_price));
  if (runtimeTrailRepair) return "TRAIL";
  if (meta.trail_active === true) return "TRAIL";
  if (meta.tp_p1_done === true) return "TP1_DONE_NOT_TRAIL";
  if (meta.tp_p0_done === true) return "BETWEEN_TP0_TP1";
  return "PRE_TP0";
}

function summarizeLivePosition(row = {}, context = {}) {
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  const observation = context.observationsBySymbol && context.observationsBySymbol[upper(row.symbol_or_pair_id || row.symbol)] || null;
  const trailSnapshot = resolveTrailObservationSnapshot({ meta, observation });
  const rules = resolveExitRulesForPosition({
    exchange: upper(row.exchange) || "BINANCEFUT",
    position: row,
  });
  const symbol = upper(row.symbol_or_pair_id || row.symbol);
  const qtyBase = toNum(row.qty_base, 0) || 0;
  const tp0Done = meta.tp_p0_done === true;
  const tp1Done = meta.tp_p1_done === true;
  const trailActive = meta.trail_active === true;
  const expectedTp1RemainingRatio = resolveTp1RemainingContractQtyRatio(rules, 0.5);
  const actualTp1Ratio = toNum(meta.native_protection_tp_qty_ratio);
  const actualTp1Base = toNum(meta.native_protection_tp_qty_base);
  const expectedTp1Base = qtyBase > 0 ? Number((qtyBase * expectedTp1RemainingRatio).toFixed(8)) : null;
  const stopPrice = toNum(trailSnapshot.native_stop_price ?? meta.native_protection_stop_price);
  const stopOrderId = trailSnapshot.native_stop_order_id || meta.native_protection_stop_order_id || null;
  const tpOrderId = meta.native_protection_tp_order_id || null;
  const refreshStatus = upper(trailSnapshot.native_refresh_status || meta.native_protection_refresh_status);
  const stage = resolveStage(meta, trailSnapshot);
  const trailStopByR = toNum(trailSnapshot.trail_stop_by_r);
  const chosenStopPrice = toNum(trailSnapshot.chosen_stop_price ?? trailSnapshot.computed_trail_stop);
  const chosenStopSource = upper(trailSnapshot.chosen_stop_source);
  const minGuaranteedProfitPct = toNum(rules.RUNNER_MIN_PROFIT_PCT);
  const currentGuaranteedProfitPct = computeCurrentProfitPct({
    avgPrice: toNum(row.avg_price),
    stopPrice,
    side: upper(row.position_side || meta.position_side || row.side),
    leverage: toNum(meta.external_leverage || meta.leverage || row.leverage || 1),
  });
  const issues = [];
  if (stage === "BETWEEN_TP0_TP1") {
    if (!tpOrderId && !Number.isFinite(actualTp1Base) && !Number.isFinite(actualTp1Ratio)) {
      issues.push({ code: "TP1_PROTECTION_MISSING", detail: "TP0 이후 TP1 native protection 메타가 없음" });
    }
    if (Number.isFinite(actualTp1Ratio) && Math.abs(actualTp1Ratio - expectedTp1RemainingRatio) > 0.03) {
      issues.push({
        code: "TP1_REMAINING_RATIO_MISMATCH",
        detail: `actual=${actualTp1Ratio.toFixed(4)} expected=${expectedTp1RemainingRatio.toFixed(4)}`,
      });
    }
    if (Number.isFinite(actualTp1Base) && Number.isFinite(expectedTp1Base) && qtyBase > 0) {
      const baseGapRatio = Math.abs(actualTp1Base - expectedTp1Base) / qtyBase;
      if (baseGapRatio > 0.03) {
        issues.push({
          code: "TP1_REMAINING_BASE_MISMATCH",
          detail: `actual=${actualTp1Base.toFixed(8)} expected=${expectedTp1Base.toFixed(8)}`,
        });
      }
    }
  }
  if (trailActive || tp1Done) {
    if (!stopOrderId && !Number.isFinite(stopPrice)) {
      issues.push({ code: "TRAIL_STOP_MISSING", detail: "TP1/Trail 단계인데 native stop 메타가 없음" });
    }
  }
  if (trailActive && tp1Done !== true) {
    issues.push({ code: "TRAIL_ACTIVE_WITHOUT_TP1_DONE", detail: "trail_active=true 인데 tp_p1_done=false" });
  }
  if (tp1Done && tp0Done !== true) {
    issues.push({ code: "TP1_DONE_WITHOUT_TP0_DONE", detail: "tp_p1_done=true 인데 tp_p0_done=false" });
  }
  if (trailActive && tp0Done !== true) {
    issues.push({ code: "TRAIL_ACTIVE_WITHOUT_TP0_DONE", detail: "trail_active=true 인데 tp_p0_done=false" });
  }
  if (tp1Done && trailActive !== true) {
    issues.push({ code: "TP1_DONE_WITHOUT_TRAIL_ACTIVE", detail: "tp_p1_done=true 인데 trail_active=false" });
  }
  if ((stage === "BETWEEN_TP0_TP1" || stage === "TRAIL" || stage === "TP1_DONE_NOT_TRAIL") && (refreshStatus === "FAILED" || refreshStatus === "MISSING")) {
    issues.push({ code: "NATIVE_REFRESH_UNHEALTHY", detail: `native_protection_refresh_status=${refreshStatus}` });
  }
  if ((stage === "TRAIL" || stage === "TP1_DONE_NOT_TRAIL") && Number.isFinite(minGuaranteedProfitPct) && Number.isFinite(currentGuaranteedProfitPct)) {
    if (currentGuaranteedProfitPct + 1e-9 < minGuaranteedProfitPct) {
      issues.push({ code: "RUNNER_MIN_GUARANTEE_MISSED", detail: `current=${currentGuaranteedProfitPct} required=${minGuaranteedProfitPct}` });
    }
  }
  if ((stage === "TRAIL" || stage === "TP1_DONE_NOT_TRAIL") && chosenStopSource === "TRAIL" && Number.isFinite(chosenStopPrice) && Number.isFinite(trailStopByR)) {
    const tolerance = Math.max(Math.abs(trailStopByR) * 0.0001, 1e-8);
    if (Math.abs(chosenStopPrice - trailStopByR) > tolerance) {
      issues.push({ code: "TRAIL_STOP_SOURCE_PRICE_INCONSISTENT", detail: `source=TRAIL chosen=${chosenStopPrice} trail_by_r=${trailStopByR}` });
    }
  }
  if ((stage === "TRAIL" || stage === "TP1_DONE_NOT_TRAIL") && chosenStopSource === "RUNNER_FLOOR" && Number.isFinite(chosenStopPrice) && Number.isFinite(toNum(trailSnapshot.runner_floor_stop))) {
    const floorStop = toNum(trailSnapshot.runner_floor_stop);
    const tolerance = Math.max(Math.abs(floorStop) * 0.0001, 1e-8);
    if (Math.abs(chosenStopPrice - floorStop) > tolerance) {
      issues.push({ code: "TRAIL_STOP_SOURCE_PRICE_INCONSISTENT", detail: `source=RUNNER_FLOOR chosen=${chosenStopPrice} floor=${floorStop}` });
    }
  }
  if (context.nativeGapSymbols.has(symbol)) {
    issues.push({ code: "NATIVE_TRAIL_GAP_LIVE", detail: "native trail protection gap live issue 존재" });
  }
  if (context.exitQtyLiveSymbols.has(symbol)) {
    issues.push({ code: "EXIT_QTY_LIVE_ISSUE", detail: "exit qty live separation issue 존재" });
  }
  if (context.trailFloorLiveSymbols.has(symbol)) {
    issues.push({ code: "TRAIL_FLOOR_LIVE_ISSUE", detail: "trail runner floor live separation issue 존재" });
  }
  if (context.duplicationLiveSymbols.has(symbol)) {
    issues.push({ code: "FILL_SYNC_DUPLICATION_LIVE_ISSUE", detail: "fill sync duplication live separation issue 존재" });
  }
  const directIssues = issues.filter((issue) => !isArtifactIssueCode(issue && issue.code));
  const artifactIssues = issues.filter((issue) => isArtifactIssueCode(issue && issue.code));
  return {
    symbol,
    state: upper(row.position_state || row.state),
    position_side: upper(row.position_side || meta.position_side || row.side),
    qty_base: qtyBase,
    avg_price: toNum(row.avg_price),
    stage,
    tp_p0_done: tp0Done,
    tp_p1_done: tp1Done,
    trail_active: trailActive,
    expected_tp1_remaining_ratio: expectedTp1RemainingRatio,
    actual_tp1_ratio: actualTp1Ratio,
    expected_tp1_base: expectedTp1Base,
    actual_tp1_base: actualTp1Base,
    native_tp_order_id: tpOrderId,
    native_stop_order_id: stopOrderId,
    native_stop_price: stopPrice,
    chosen_stop_source: chosenStopSource,
    chosen_stop_price: chosenStopPrice,
    trail_stop_by_r: trailStopByR,
    min_guaranteed_profit_pct: minGuaranteedProfitPct,
    current_guaranteed_profit_pct: currentGuaranteedProfitPct,
    native_refresh_status: refreshStatus || null,
    trail_observation_source: trailSnapshot.trail_source || null,
    trail_observation_runtime_eval_at_ms: toNum(trailSnapshot.runtime_eval_at_ms),
    updated_at: row.updated_at || null,
    direct_issue_n: directIssues.length,
    artifact_issue_n: artifactIssues.length,
    actionable_issue: directIssues.length > 0,
    issues,
  };
}

function buildLiveAuthorityBoard({ positions = [], artifacts = {} } = {}) {
  const context = {
    nativeGapSymbols: buildSymbolSet(artifacts.nativeGapRows || []),
    exitQtyLiveSymbols: buildSymbolSet(artifacts.exitQtyLiveRows || []),
    trailFloorLiveSymbols: buildSymbolSet(artifacts.trailFloorLiveRows || []),
    duplicationLiveSymbols: buildSymbolSet(artifacts.duplicationLiveRows || []),
    observationsBySymbol: artifacts.observationsBySymbol || {},
  };
  const rows = (Array.isArray(positions) ? positions : [])
    .filter((row) => isActivePosition(row))
    .map((row) => summarizeLivePosition(row, context))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const liveRows = rows.filter((row) => Array.isArray(row.issues) && row.issues.length > 0);
  const actionableRows = liveRows.filter((row) => row.actionable_issue === true);
  const artifactOnlyRows = liveRows.filter((row) => row.actionable_issue !== true);
  return {
    generated_at_iso: nowIso(),
    exchange: "BINANCEFUT",
    active_position_n: rows.length,
    live_issue_position_n: liveRows.length,
    live_issue_symbols: liveRows.map((row) => row.symbol),
    actionable_live_issue_position_n: actionableRows.length,
    actionable_live_issue_symbols: actionableRows.map((row) => row.symbol),
    artifact_only_live_issue_position_n: artifactOnlyRows.length,
    artifact_only_live_issue_symbols: artifactOnlyRows.map((row) => row.symbol),
    artifact_context: {
      native_gap_symbol_n: context.nativeGapSymbols.size,
      exit_qty_live_symbol_n: context.exitQtyLiveSymbols.size,
      trail_floor_live_symbol_n: context.trailFloorLiveSymbols.size,
      duplication_live_symbol_n: context.duplicationLiveSymbols.size,
    },
    rows,
    live_issue_rows: liveRows,
    actionable_live_issue_rows: actionableRows,
    artifact_only_live_issue_rows: artifactOnlyRows,
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Binance Exit Authority Live Board");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- exchange: ${report.exchange || "N/A"}`);
  lines.push(`- active_position_n: ${report.active_position_n || 0}`);
  lines.push(`- live_issue_position_n: ${report.live_issue_position_n || 0}`);
  lines.push(`- live_issue_symbols: ${Array.isArray(report.live_issue_symbols) && report.live_issue_symbols.length ? report.live_issue_symbols.join(", ") : "none"}`);
  lines.push(`- actionable_live_issue_position_n: ${report.actionable_live_issue_position_n || 0}`);
  lines.push(`- actionable_live_issue_symbols: ${Array.isArray(report.actionable_live_issue_symbols) && report.actionable_live_issue_symbols.length ? report.actionable_live_issue_symbols.join(", ") : "none"}`);
  lines.push(`- artifact_only_live_issue_position_n: ${report.artifact_only_live_issue_position_n || 0}`);
  lines.push(`- artifact_only_live_issue_symbols: ${Array.isArray(report.artifact_only_live_issue_symbols) && report.artifact_only_live_issue_symbols.length ? report.artifact_only_live_issue_symbols.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Live Issue Rows");
  if (!Array.isArray(report.live_issue_rows) || !report.live_issue_rows.length) {
    lines.push("- none");
  } else {
    for (const row of report.live_issue_rows.slice(0, 50)) {
      lines.push(`- ${row.symbol} | stage=${row.stage} | qty=${row.qty_base} | tp1_ratio=${row.actual_tp1_ratio ?? "N/A"} expected=${row.expected_tp1_remaining_ratio ?? "N/A"} | stop=${row.native_stop_price ?? "N/A"} | issues=${row.issues.map((issue) => issue.code).join(", ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const outDir = path.join(process.cwd(), "ops", "daily");
  const positions = await listExchangePositionReadViews({ exchange: "BINANCEFUT", limit: 500 });
  const observationsBySymbol = {};
  for (const row of positions.filter((item) => isActivePosition(item))) {
    const symbol = upper(row && (row.symbol_or_pair_id || row.symbol));
    if (!symbol) continue;
    observationsBySymbol[symbol] = await getPositionRuntimeObservation({ exchange: "BINANCEFUT", symbol }).catch(() => null);
  }
  const artifacts = {
    nativeGapRows: readJsonIfExists(path.join(outDir, "native_trail_protection_gap_latest.json"), {}).rows || [],
    exitQtyLiveRows: readJsonIfExists(path.join(outDir, "binance_exit_qty_live_separation_latest.json"), {}).live_issues || [],
    trailFloorLiveRows: readJsonIfExists(path.join(outDir, "trail_runner_floor_live_separation_latest.json"), {}).live_violations || [],
    duplicationLiveRows: readJsonIfExists(path.join(outDir, "fill_sync_alert_duplication_live_separation_latest.json"), {}).live_duplicate_groups || [],
    observationsBySymbol,
  };
  const report = buildLiveAuthorityBoard({ positions, artifacts });
  const jsonPath = path.join(outDir, "binance_exit_authority_live_board_latest.json");
  const mdPath = path.join(outDir, "binance_exit_authority_live_board_latest.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${buildMarkdown(report)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    live_issue_position_n: report.live_issue_position_n,
    live_issue_symbols: report.live_issue_symbols,
    actionable_live_issue_position_n: report.actionable_live_issue_position_n,
    actionable_live_issue_symbols: report.actionable_live_issue_symbols,
    artifact_only_live_issue_position_n: report.artifact_only_live_issue_position_n,
    artifact_only_live_issue_symbols: report.artifact_only_live_issue_symbols,
    output_json: jsonPath,
    output_md: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_BINANCE_EXIT_AUTHORITY_LIVE_BOARD_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      summarizeLivePosition,
      buildLiveAuthorityBoard,
      buildMarkdown,
    },
  };
}
