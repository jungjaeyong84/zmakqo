#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { fetchBinanceFuturesAccount, fetchFuturesOpenOrders, fetchFuturesAlgoOpenOrders } = require("../src/exchanges/binanceFuturesPrivate");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { listExchangePositionReadViews } = require("../src/services/positionReadModel");
const { getPositionRuntimeObservation, resolveTrailObservationSnapshot } = require("../src/storage/positionRuntimeObservations");
const { resolveCanonicalAlertExitStage } = require("../src/services/positionStateMachine");
const { __test: watchdogTest } = require("../src/services/binanceActiveExitWatchdog");

const ROOT = path.resolve(__dirname, "..");
const OUT_JSON = path.join(ROOT, "ops", "daily", "binance_canonical_exit_stage_qa_latest.json");
const OUT_MD = path.join(ROOT, "ops", "daily", "binance_canonical_exit_stage_qa_latest.md");
const LOOKBACK_HOURS = Math.max(1, Number(process.env.BINANCE_CANONICAL_EXIT_STAGE_QA_LOOKBACK_HOURS || 72));
const FILL_SCAN_LIMIT = Math.max(20, Number(process.env.BINANCE_CANONICAL_EXIT_STAGE_QA_FILL_SCAN_LIMIT || 400));
const TRANSITION_SCAN_LIMIT = Math.max(20, Number(process.env.BINANCE_CANONICAL_EXIT_STAGE_QA_TRANSITION_SCAN_LIMIT || 400));
const QA_FILL_SELECT_FIELDS = Object.freeze([
  "exchange",
  "symbol",
  "symbol_or_pair_id",
  "fill_id",
  "trade_id",
  "created_at",
  "event",
  "canonical_exit_event",
  "canonical_exit_stage",
  "canonical_primary_transition_event",
  "canonical_transition_events",
]);
const QA_TRANSITION_SELECT_FIELDS = Object.freeze([
  "exchange",
  "symbol",
  "canonical_transition_event",
  "canonical_event",
  "canonical_exit_chain_key",
  "fill_id",
  "created_at",
]);

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
  const guaranteePassRaw = Number.isFinite(minGuaranteedPct) && Number.isFinite(currentProfitPct)
    ? currentProfitPct + 1e-9 >= minGuaranteedPct
    : null;
  const guaranteePass = Array.isArray(watchdogRow.actionable_issue_codes)
    ? !watchdogRow.actionable_issue_codes.includes("RUNNER_MIN_GUARANTEE_MISSED")
    : guaranteePassRaw;
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
    guarantee_pass_raw: guaranteePassRaw,
    guarantee_pass: guaranteePass,
    open_order_n: Array.isArray(openOrders) ? openOrders.length : 0,
    algo_order_n: Array.isArray(algoOrders) ? algoOrders.length : 0,
    actionable_issue_n: watchdogRow.actionable_issue_n,
    actionable_issue_codes: watchdogRow.actionable_issue_codes || [],
    issues: Array.isArray(watchdogRow.issues) ? watchdogRow.issues : [],
    verdict: Number(watchdogRow.actionable_issue_n || 0) > 0 ? "FAIL" : "PASS",
  };
}

function resolveWatchdogCanonicalStage(stage) {
  const current = upper(stage);
  if (current === "BETWEEN_TP0_TP1") return "TP0";
  if (current === "RUNNER") return "TP1";
  if (current === "TP1_DONE_NOT_TRAIL") return "TP1";
  if (current === "TRAIL") return "TRAIL";
  return null;
}

function loadPrimaryTransitionEvents(fill = null, transition = null) {
  const events = [];
  const fillPrimary = upper(fill && fill.canonical_primary_transition_event);
  if (fillPrimary) events.push(fillPrimary);
  const transitionPrimary = upper(transition && transition.canonical_transition_event);
  if (transitionPrimary) events.push(transitionPrimary);
  const fillList = Array.isArray(fill && fill.canonical_transition_events)
    ? fill.canonical_transition_events
    : [];
  for (const item of fillList) {
    const value = upper(item);
    if (value) events.push(value);
  }
  const seen = new Set();
  return events.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function resolveCanonicalEvidenceStage({ fill = null, transition = null } = {}) {
  const transitionEvents = loadPrimaryTransitionEvents(fill, transition);
  return resolveCanonicalAlertExitStage({
    primaryTransitionEvent: upper(transition && transition.canonical_transition_event) || upper(fill && fill.canonical_primary_transition_event) || null,
    transitionEvents,
    fallbackStage: upper(fill && fill.canonical_exit_stage),
  });
}

async function loadLatestCanonicalEvidenceBySymbols({
  exchange = "BINANCEFUT",
  symbols = [],
  fillScanLimit = 400,
  transitionScanLimit = 400,
  sinceIso = null,
  db = getFirestore(),
} = {}) {
  const target = new Set((Array.isArray(symbols) ? symbols : []).map((item) => upper(item)).filter(Boolean));
  const bySymbol = new Map();
  if (!target.size) return bySymbol;

  let fillQuery = db.collection("fills_paper");
  if (sinceIso) fillQuery = fillQuery.where("created_at", ">=", sinceIso);
  const fillSnap = await fillQuery
    .orderBy("created_at", "desc")
    .select(...QA_FILL_SELECT_FIELDS)
    .limit(Math.max(1, Number(fillScanLimit) || 400))
    .get();
  fillSnap.forEach((doc) => {
    const row = doc.data() || {};
    const symbol = upper(row.symbol || row.symbol_or_pair_id);
    if (!symbol || !target.has(symbol)) return;
    if (upper(row.exchange) !== upper(exchange)) return;
    const existing = bySymbol.get(symbol) || {};
    if (existing.fill) return;
    const event = upper(row.event);
    const canonicalStage = upper(row.canonical_exit_stage);
    if (!(event && event.startsWith("EXIT_")) && !canonicalStage) return;
    bySymbol.set(symbol, {
      ...existing,
      fill: {
        fill_id: row.fill_id || null,
        trade_id: toNum(row.trade_id),
        created_at: row.created_at || null,
        event,
        canonical_exit_event: upper(row.canonical_exit_event),
        canonical_exit_stage: canonicalStage,
        canonical_primary_transition_event: upper(row.canonical_primary_transition_event),
        canonical_transition_events: Array.isArray(row.canonical_transition_events) ? row.canonical_transition_events.map((item) => upper(item)).filter(Boolean) : [],
      },
    });
  });

  let transitionQuery = db.collection("canonical_exit_transitions");
  if (sinceIso) transitionQuery = transitionQuery.where("created_at", ">=", sinceIso);
  const transitionSnap = await transitionQuery
    .orderBy("created_at", "desc")
    .select(...QA_TRANSITION_SELECT_FIELDS)
    .limit(Math.max(1, Number(transitionScanLimit) || 400))
    .get();
  transitionSnap.forEach((doc) => {
    const row = doc.data() || {};
    const symbol = upper(row.symbol);
    if (!symbol || !target.has(symbol)) return;
    if (upper(row.exchange) !== upper(exchange)) return;
    const existing = bySymbol.get(symbol) || {};
    if (existing.transition) return;
    bySymbol.set(symbol, {
      ...existing,
      transition: {
        canonical_transition_event: upper(row.canonical_transition_event),
        canonical_event: upper(row.canonical_event),
        canonical_exit_chain_key: row.canonical_exit_chain_key || null,
        fill_id: row.fill_id || null,
        created_at: row.created_at || null,
      },
    });
  });

  return bySymbol;
}

function augmentRowWithCanonicalEvidence(row = {}, evidence = null) {
  const fill = evidence && evidence.fill ? evidence.fill : null;
  const transition = evidence && evidence.transition ? evidence.transition : null;
  const watchdogStage = upper(row.canonical_stage);
  const expectedStage = resolveWatchdogCanonicalStage(watchdogStage);
  const evidenceStage = resolveCanonicalEvidenceStage({ fill, transition });
  const evidenceIssues = [];
  if (expectedStage && !evidenceStage) {
    evidenceIssues.push("CANONICAL_EVIDENCE_MISSING");
  } else if (expectedStage && evidenceStage && expectedStage !== evidenceStage) {
    evidenceIssues.push("CANONICAL_EVIDENCE_STAGE_MISMATCH");
  }
  const watchdogIssues = Array.isArray(row.actionable_issue_codes) ? row.actionable_issue_codes : [];
  const reportIssueCodes = [...watchdogIssues, ...evidenceIssues];
  return {
    ...row,
    latest_fill_event: fill && fill.event || null,
    latest_fill_canonical_exit_event: fill && fill.canonical_exit_event || null,
    latest_fill_canonical_exit_stage: fill && fill.canonical_exit_stage || null,
    latest_fill_transition_events: fill && fill.canonical_transition_events || [],
    latest_transition_event: transition && transition.canonical_transition_event || null,
    latest_transition_canonical_event: transition && transition.canonical_event || null,
    latest_transition_chain_key: transition && transition.canonical_exit_chain_key || null,
    canonical_evidence_stage: evidenceStage || null,
    canonical_evidence_issue_codes: evidenceIssues,
    report_issue_n: reportIssueCodes.length,
    report_issue_codes: reportIssueCodes,
    verdict: reportIssueCodes.length > 0 ? "FAIL" : "PASS",
  };
}

function buildReportSummary(rows = []) {
  const summary = {
    status: "PASS",
    active_position_n: Array.isArray(rows) ? rows.length : 0,
    pass_n: 0,
    fail_n: 0,
    failing_symbols: [],
    stage_counts: {
      TP0: 0,
      TP1: 0,
      TRAIL: 0,
      OTHER: 0,
    },
    canonical_evidence_fail_n: 0,
    minimum_guarantee_fail_n: 0,
    trail_hard_exit_missed_n: 0,
    stop_authority_fail_n: 0,
    top_issue_codes: [],
  };
  const issueCounts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const stage = upper(row && row.canonical_stage);
    if (stage === "TP0" || stage === "TP1" || stage === "TRAIL") summary.stage_counts[stage] += 1;
    else summary.stage_counts.OTHER += 1;

    if (String(row && row.verdict || "").trim().toUpperCase() === "FAIL") {
      summary.fail_n += 1;
      if (row && row.symbol) summary.failing_symbols.push(String(row.symbol).trim().toUpperCase());
    } else {
      summary.pass_n += 1;
    }

    const reportIssueCodes = Array.isArray(row && row.report_issue_codes) ? row.report_issue_codes : [];
    if (reportIssueCodes.some((code) => String(code || "").trim().toUpperCase().startsWith("CANONICAL_EVIDENCE_"))) {
      summary.canonical_evidence_fail_n += 1;
    }
    if (reportIssueCodes.includes("RUNNER_MIN_GUARANTEE_MISSED")) {
      summary.minimum_guarantee_fail_n += 1;
    }
    if (reportIssueCodes.includes("TRAIL_HARD_EXIT_MISSED")) {
      summary.trail_hard_exit_missed_n += 1;
    }
    if (reportIssueCodes.some((code) => [
      "TRAIL_STOP_CHOSEN_SOURCE_MISMATCH",
      "TRAIL_STOP_SOURCE_PRICE_INCONSISTENT",
      "TRAIL_STOP_SOURCE_UNDECLARED",
      "TRAIL_R_STOP_MISSING",
      "TRAIL_HARD_EXIT_MISSED",
    ].includes(String(code || "").trim().toUpperCase()))) {
      summary.stop_authority_fail_n += 1;
    }

    for (const code of reportIssueCodes) {
      const normalized = String(code || "").trim().toUpperCase();
      if (!normalized) continue;
      issueCounts.set(normalized, Number(issueCounts.get(normalized) || 0) + 1);
    }
  }
  summary.status = summary.fail_n > 0 ? "FAIL" : "PASS";
  summary.top_issue_codes = Array.from(issueCounts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([code, count]) => ({ code, count }));
  return summary;
}

function buildMarkdown(report) {
  const summary = report && report.summary && typeof report.summary === "object"
    ? report.summary
    : buildReportSummary(report && report.rows);
  const lines = [];
  lines.push("# Binance Canonical Exit Stage QA");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- status: ${summary.status || "PASS"}`);
  lines.push(`- active_position_n: ${summary.active_position_n || 0}`);
  lines.push(`- pass_n: ${summary.pass_n || 0}`);
  lines.push(`- fail_n: ${summary.fail_n || 0}`);
  lines.push(`- failing_symbols: ${Array.isArray(summary.failing_symbols) && summary.failing_symbols.length ? summary.failing_symbols.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- stage_counts: TP0=${summary.stage_counts && summary.stage_counts.TP0 || 0} / TP1=${summary.stage_counts && summary.stage_counts.TP1 || 0} / TRAIL=${summary.stage_counts && summary.stage_counts.TRAIL || 0} / OTHER=${summary.stage_counts && summary.stage_counts.OTHER || 0}`);
  lines.push(`- canonical_evidence_fail_n: ${summary.canonical_evidence_fail_n || 0}`);
  lines.push(`- minimum_guarantee_fail_n: ${summary.minimum_guarantee_fail_n || 0}`);
  lines.push(`- trail_hard_exit_missed_n: ${summary.trail_hard_exit_missed_n || 0}`);
  lines.push(`- stop_authority_fail_n: ${summary.stop_authority_fail_n || 0}`);
  lines.push(`- top_issue_codes: ${Array.isArray(summary.top_issue_codes) && summary.top_issue_codes.length ? summary.top_issue_codes.map((item) => `${item.code}:${item.count}`).join(", ") : "none"}`);
  lines.push("");
  lines.push("## Rows");
  if (!Array.isArray(report.rows) || !report.rows.length) {
    lines.push("- none");
    return `${lines.join("\n")}\n`;
  }
  for (const row of report.rows) {
    lines.push(`- ${row.symbol} | stage=${row.canonical_stage} | evidence=${row.canonical_evidence_stage || "N/A"} | fill=${row.latest_fill_canonical_exit_event || row.latest_fill_event || "N/A"} | transition=${row.latest_transition_event || "N/A"} | qty=${row.qty_base} | stop=${row.native_stop_price ?? "N/A"} | floor=${row.expected_floor_stop_price ?? "N/A"} | r_stop=${row.trail_stop_by_r ?? "N/A"} | chosen=${row.chosen_stop_source || "N/A"}:${row.chosen_stop_price ?? "N/A"} | min_gp=${row.min_guaranteed_profit_pct ?? "N/A"} | current_gp=${row.current_guaranteed_profit_pct ?? "N/A"} | issues=${(row.report_issue_codes || []).join(",") || "none"} | verdict=${row.verdict}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const sinceIso = new Date(Date.now() - (LOOKBACK_HOURS * 60 * 60 * 1000)).toISOString();
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
  const evidenceBySymbol = await loadLatestCanonicalEvidenceBySymbols({
    exchange: "BINANCEFUT",
    symbols: positions.map((position) => upper(position.symbol || position.symbol_or_pair_id)).filter(Boolean),
    fillScanLimit: FILL_SCAN_LIMIT,
    transitionScanLimit: TRANSITION_SCAN_LIMIT,
    sinceIso,
  }).catch(() => new Map());
  const rows = [];
  for (const position of positions) {
    const symbol = upper(position.symbol || position.symbol_or_pair_id);
    const observation = await getPositionRuntimeObservation({ exchange: "BINANCEFUT", symbol }).catch(() => null);
    const algoOrders = await fetchFuturesAlgoOpenOrders({ ...keys, symbol }).catch(() => []);
    const baseRow = buildRow({
      position,
      externalPosition: externalBySymbol.get(symbol) || null,
      observation,
      openOrders: openOrdersBySymbol.get(symbol) || [],
      algoOrders,
    });
    rows.push(augmentRowWithCanonicalEvidence(baseRow, evidenceBySymbol.get(symbol) || null));
  }
  rows.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  const summary = buildReportSummary(rows);
  const report = {
    generated_at: nowIso(),
    exchange: "BINANCEFUT",
    active_position_n: summary.active_position_n,
    fail_n: summary.fail_n,
    failing_symbols: summary.failing_symbols,
    summary,
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

module.exports = {
  __test: {
    resolveWatchdogCanonicalStage,
    resolveCanonicalEvidenceStage,
    augmentRowWithCanonicalEvidence,
    loadPrimaryTransitionEvents,
    buildReportSummary,
    QA_FILL_SELECT_FIELDS,
    QA_TRANSITION_SELECT_FIELDS,
  },
};

if (require.main === module) {
  main().catch((err) => {
    console.error("BINANCE_CANONICAL_EXIT_STAGE_QA_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
