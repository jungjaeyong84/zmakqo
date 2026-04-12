#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.BINANCE_EXIT_EXECUTION_DRILLDOWN_LOOKBACK_DAYS || 7));
const PAGE_SIZE = Math.max(100, Number(process.env.BINANCE_EXIT_EXECUTION_DRILLDOWN_PAGE_SIZE || 1000));

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function classifyExitEvent(event) {
  const ev = upper(event);
  if (!ev) return "OTHER";
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return "OTHER";
}

function resolveQtyPct(fill = {}) {
  const qtyPct = toNum(fill.qty_pct);
  if (Number.isFinite(qtyPct)) return qtyPct;
  const qtyFraction = toNum(fill.qty_fraction);
  return Number.isFinite(qtyFraction) ? qtyFraction : null;
}

async function fetchRecentBinanceExitFills(db) {
  const out = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const fill = doc.data() || {};
      if (upper(fill.exchange) !== "BINANCEFUT") continue;
      if (String(fill.created_at || "") < sinceIso) continue;
      const stage = classifyExitEvent(fill.event);
      if (stage === "OTHER") continue;
      out.push({ id: doc.id, ...fill, _stage: stage, _qty_pct: resolveQtyPct(fill) });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

function buildIssueMaps(exitQtyAudit = {}) {
  const unresolvedBySymbol = new Map();
  const totalBySymbol = new Map();
  const unresolvedRows = Array.isArray(exitQtyAudit.issues) ? exitQtyAudit.issues : [];
  const totalRows = Array.isArray(exitQtyAudit.issues_total) ? exitQtyAudit.issues_total : unresolvedRows;
  for (const row of totalRows) {
    const symbol = upper(row && row.symbol) || "UNKNOWN";
    totalBySymbol.set(symbol, (totalBySymbol.get(symbol) || 0) + 1);
  }
  for (const row of unresolvedRows) {
    const symbol = upper(row && row.symbol) || "UNKNOWN";
    unresolvedBySymbol.set(symbol, (unresolvedBySymbol.get(symbol) || 0) + 1);
  }
  return { unresolvedBySymbol, totalBySymbol };
}

function summarizeSymbolRows(fills = [], exitQtyAudit = {}) {
  const bySymbol = new Map();
  const { unresolvedBySymbol, totalBySymbol } = buildIssueMaps(exitQtyAudit);
  for (const fill of fills) {
    const symbol = upper(fill.symbol || fill.symbol_or_pair_id) || "UNKNOWN";
    const row = bySymbol.get(symbol) || {
      symbol,
      exit_fill_n: 0,
      tp0_fill_n: 0,
      tp1_fill_n: 0,
      trail_fill_n: 0,
      sl_fill_n: 0,
      force_exit_fill_n: 0,
      tp0_qty_pct_sum: 0,
      tp1_qty_pct_sum: 0,
      trail_qty_pct_sum: 0,
      latest_exit_at: null,
      latest_event: null,
    };
    row.exit_fill_n += 1;
    const qty = toNum(fill._qty_pct, 0) || 0;
    if (fill._stage === "TP0") {
      row.tp0_fill_n += 1;
      row.tp0_qty_pct_sum += qty;
    } else if (fill._stage === "TP1") {
      row.tp1_fill_n += 1;
      row.tp1_qty_pct_sum += qty;
    } else if (fill._stage === "TRAIL") {
      row.trail_fill_n += 1;
      row.trail_qty_pct_sum += qty;
    } else if (fill._stage === "SL") {
      row.sl_fill_n += 1;
    } else if (fill._stage === "FORCE_EXIT_ALL" || fill._stage === "FORCE_EXIT_HALF") {
      row.force_exit_fill_n += 1;
    }
    const createdAt = String(fill.created_at || "");
    if (!row.latest_exit_at || createdAt > row.latest_exit_at) {
      row.latest_exit_at = createdAt || null;
      row.latest_event = upper(fill.event);
    }
    bySymbol.set(symbol, row);
  }
  const rows = Array.from(bySymbol.values()).map((row) => {
    const unresolvedIssueChainN = unresolvedBySymbol.get(row.symbol) || 0;
    const totalIssueChainN = totalBySymbol.get(row.symbol) || 0;
    return {
      ...row,
      tp0_qty_pct_sum: Number(row.tp0_qty_pct_sum.toFixed(6)),
      tp1_qty_pct_sum: Number(row.tp1_qty_pct_sum.toFixed(6)),
      trail_qty_pct_sum: Number(row.trail_qty_pct_sum.toFixed(6)),
      unresolved_issue_chain_n: unresolvedIssueChainN,
      issue_chain_total_n: totalIssueChainN,
      contract_state: unresolvedIssueChainN > 0 ? "UNRESOLVED_ISSUE" : (totalIssueChainN > 0 ? "BACKFILLED_ONLY" : "CLEAN"),
    };
  });
  rows.sort((a, b) =>
    Number(b.unresolved_issue_chain_n || 0) - Number(a.unresolved_issue_chain_n || 0)
    || Number(b.issue_chain_total_n || 0) - Number(a.issue_chain_total_n || 0)
    || Number(b.exit_fill_n || 0) - Number(a.exit_fill_n || 0)
    || String(a.symbol).localeCompare(String(b.symbol))
  );
  return rows;
}

function buildReport(fills = [], exitQtyAudit = {}) {
  const symbolRows = summarizeSymbolRows(fills, exitQtyAudit);
  return {
    generated_at_iso: nowIso(),
    lookback_days: LOOKBACK_DAYS,
    symbol_n: symbolRows.length,
    unresolved_symbol_n: symbolRows.filter((row) => row.unresolved_issue_chain_n > 0).length,
    backfilled_only_symbol_n: symbolRows.filter((row) => row.unresolved_issue_chain_n === 0 && row.issue_chain_total_n > 0).length,
    clean_symbol_n: symbolRows.filter((row) => row.issue_chain_total_n === 0).length,
    symbols: symbolRows,
    top_unresolved_symbols: symbolRows.filter((row) => row.unresolved_issue_chain_n > 0).slice(0, 20),
    top_historical_symbols: symbolRows.filter((row) => row.issue_chain_total_n > 0).slice(0, 20),
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Binance Exit Execution Drilldown");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso}`);
  lines.push(`- lookback_days: ${report.lookback_days}`);
  lines.push(`- symbol_n: ${report.symbol_n}`);
  lines.push(`- unresolved_symbol_n: ${report.unresolved_symbol_n}`);
  lines.push(`- backfilled_only_symbol_n: ${report.backfilled_only_symbol_n}`);
  lines.push(`- clean_symbol_n: ${report.clean_symbol_n}`);
  lines.push("");
  lines.push("## Top Historical Symbols");
  if (!Array.isArray(report.top_historical_symbols) || !report.top_historical_symbols.length) {
    lines.push("- none");
  } else {
    for (const row of report.top_historical_symbols) {
      lines.push(`- ${row.symbol} | state=${row.contract_state} | unresolved=${row.unresolved_issue_chain_n} | total=${row.issue_chain_total_n} | TP0=${row.tp0_fill_n}/${row.tp0_qty_pct_sum} | TP1=${row.tp1_fill_n}/${row.tp1_qty_pct_sum} | TRAIL=${row.trail_fill_n}/${row.trail_qty_pct_sum} | latest=${row.latest_event || "N/A"} @ ${row.latest_exit_at || "N/A"}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const db = getFirestore();
  const fills = await fetchRecentBinanceExitFills(db);
  const auditPath = path.join(process.cwd(), "ops", "daily", "binance_exit_qty_contract_audit_latest.json");
  const exitQtyAudit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, "utf8")) : {};
  const report = buildReport(fills, exitQtyAudit);
  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const latestJson = path.join(outDir, "binance_exit_execution_drilldown_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_binance_exit_execution_drilldown.md`);
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMd, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({
    ok: true,
    symbol_n: report.symbol_n,
    unresolved_symbol_n: report.unresolved_symbol_n,
    backfilled_only_symbol_n: report.backfilled_only_symbol_n,
    top_historical_symbols: report.top_historical_symbols.slice(0, 10),
    output_json: latestJson,
    output_md: datedMd,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BINANCE_EXIT_EXECUTION_DRILLDOWN_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    classifyExitEvent,
    resolveQtyPct,
    summarizeSymbolRows,
    buildReport,
  },
};
