#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { resolveExitStageAbsoluteContractQtyRatio } = require("../src/utils/exitQtyContract");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.EXIT_QTY_CONTRACT_AUDIT_LOOKBACK_DAYS || 7));
const PAGE_SIZE = Math.max(100, Number(process.env.EXIT_QTY_CONTRACT_AUDIT_PAGE_SIZE || 1000));
const ISSUE_LIMIT = Math.max(50, Number(process.env.EXIT_QTY_CONTRACT_AUDIT_ISSUE_LIMIT || 300));
const QTY_TOL = Math.max(0.01, Number(process.env.EXIT_QTY_CONTRACT_AUDIT_TOL || 0.03));

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function isExternalFill(fillId) {
  return String(fillId || "").trim().toUpperCase().startsWith("EXT__");
}

function resolveQtyPct(fill = {}) {
  const qtyPct = toNum(fill.qty_pct);
  if (Number.isFinite(qtyPct)) return qtyPct;
  const qtyFraction = toNum(fill.qty_fraction);
  return Number.isFinite(qtyFraction) ? qtyFraction : null;
}

function buildChainKey(fill = {}) {
  const exchange = upper(fill.exchange) || "UNKNOWN";
  const symbol = upper(fill.symbol || fill.symbol_or_pair_id) || "UNKNOWN";
  const entryEventId = String(fill.entry_event_id || "").trim();
  if (entryEventId) return `${exchange}__${symbol}__${entryEventId}`;
  const signalDocId = String(fill.signal_doc_id || "").trim();
  if (signalDocId) return `${exchange}__${symbol}__SIG__${signalDocId}`;
  const liveOrderId = String(fill.live_order_id || fill.external_order_id || fill.order_id || "").trim();
  if (liveOrderId) return `${exchange}__${symbol}__ORD__${liveOrderId}`;
  const tradeId = String(fill.trade_id || "").trim();
  if (tradeId) return `${exchange}__${symbol}__TRADE__${tradeId}`;
  return `${exchange}__${symbol}__FILL__${String(fill.fill_id || fill.id || "").trim() || "UNKNOWN"}`;
}

function buildChainSummary(fill = {}) {
  const rules = resolveExitRulesForPosition({
    exchange: upper(fill.exchange) || "BINANCEFUT",
    position: {
      meta: (fill.features_json && typeof fill.features_json === "object") ? fill.features_json : {},
    },
  });
  return {
    chain_key: buildChainKey(fill),
    exchange: upper(fill.exchange),
    symbol: upper(fill.symbol || fill.symbol_or_pair_id),
    entry_event_id: String(fill.entry_event_id || "").trim() || null,
    expected_tp0_qty: toNum(rules.TP_P0_QTY),
    expected_tp1_qty: toNum(rules.TP_P1_QTY),
    fills: [],
    tp0_qty: 0,
    tp1_qty: 0,
    trail_qty: 0,
    sl_qty: 0,
    force_exit_all_qty: 0,
    force_exit_half_qty: 0,
    other_exit_qty: 0,
    total_exit_qty: 0,
  };
}

function addFillToChain(chain, fill) {
  const stage = classifyExitEvent(fill.event);
  const qty = resolveQtyPct(fill);
  const row = {
    fill_id: fill.fill_id || fill.id || null,
    created_at: fill.created_at || null,
    event: upper(fill.event),
    stage,
    source_kind: isExternalFill(fill.fill_id || fill.id) ? "EXTERNAL" : "INTERNAL",
    qty_pct: qty,
    exec_price: toNum(fill.exec_price),
    decision_reason: fill.decision_reason || null,
    execution_mode: fill.execution_mode || null,
    live_order_id: fill.live_order_id || null,
  };
  chain.fills.push(row);
  if (!Number.isFinite(qty)) return;
  chain.total_exit_qty += qty;
  if (stage === "TP0") chain.tp0_qty += qty;
  else if (stage === "TP1") chain.tp1_qty += qty;
  else if (stage === "TRAIL") chain.trail_qty += qty;
  else if (stage === "SL") chain.sl_qty += qty;
  else if (stage === "FORCE_EXIT_ALL") chain.force_exit_all_qty += qty;
  else if (stage === "FORCE_EXIT_HALF") chain.force_exit_half_qty += qty;
  else if (stage !== "OTHER") chain.other_exit_qty += qty;
}

function buildAuthoritativeFillSet(fills = []) {
  const groups = new Map();
  for (const fill of fills) {
    const liveOrderId = String(fill.live_order_id || "").trim() || "NO_ORDER";
    const key = liveOrderId !== "NO_ORDER"
      ? [fill.stage || "OTHER", liveOrderId].join("__")
      : [
        fill.stage || "OTHER",
        liveOrderId,
        Number.isFinite(Number(fill.exec_price)) ? Number(fill.exec_price).toFixed(8) : "NO_PRICE",
        String(fill.created_at || "").slice(0, 19),
      ].join("__");
    const rows = groups.get(key) || [];
    rows.push(fill);
    groups.set(key, rows);
  }
  const out = [];
  for (const rows of groups.values()) {
    const hasExternal = rows.some((row) => row.source_kind === "EXTERNAL");
    if (!hasExternal) {
      out.push(...rows);
      continue;
    }
    out.push(...rows.filter((row) => row.source_kind === "EXTERNAL"));
  }
  return out.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.fill_id || "").localeCompare(String(b.fill_id || "")));
}

function auditChain(chain) {
  const issues = [];
  const expectedTp0 = resolveExitStageAbsoluteContractQtyRatio("TP0", {
    TP_P0_QTY: chain.expected_tp0_qty,
    TP_P1_QTY: chain.expected_tp1_qty,
  });
  const expectedTp1 = resolveExitStageAbsoluteContractQtyRatio("TP1", {
    TP_P0_QTY: chain.expected_tp0_qty,
    TP_P1_QTY: chain.expected_tp1_qty,
  });
  if (chain.tp0_qty > (expectedTp0 + QTY_TOL)) {
    issues.push({
      code: "TP0_ABS_OVER",
      detail: `tp0_qty=${chain.tp0_qty.toFixed(4)} expected<=${(expectedTp0 + QTY_TOL).toFixed(4)}`,
    });
  }
  if (chain.tp1_qty > (expectedTp1 + QTY_TOL)) {
    issues.push({
      code: "TP1_ABS_OVER",
      detail: `tp1_qty=${chain.tp1_qty.toFixed(4)} expected<=${(expectedTp1 + QTY_TOL).toFixed(4)}`,
    });
  }
  if ((chain.tp0_qty + chain.tp1_qty) > ((expectedTp0 + expectedTp1) + QTY_TOL)) {
    issues.push({
      code: "TP_CHAIN_ABS_OVER",
      detail: `tp0+tp1=${(chain.tp0_qty + chain.tp1_qty).toFixed(4)} expected<=${(expectedTp0 + expectedTp1 + QTY_TOL).toFixed(4)}`,
    });
  }
  if (chain.total_exit_qty > (1 + QTY_TOL)) {
    issues.push({
      code: "TOTAL_EXIT_OVER_100",
      detail: `total_exit_qty=${chain.total_exit_qty.toFixed(4)} expected<=${(1 + QTY_TOL).toFixed(4)}`,
    });
  }
  if ((chain.force_exit_all_qty > QTY_TOL || chain.force_exit_half_qty > QTY_TOL) && (chain.tp0_qty > QTY_TOL || chain.tp1_qty > QTY_TOL || chain.trail_qty > QTY_TOL)) {
    issues.push({
      code: "FORCE_EXIT_WITH_STAGE_EXIT",
      detail: `force_exit=${(chain.force_exit_all_qty + chain.force_exit_half_qty).toFixed(4)} tp0=${chain.tp0_qty.toFixed(4)} tp1=${chain.tp1_qty.toFixed(4)} trail=${chain.trail_qty.toFixed(4)}`,
    });
  }
  const expectedTrailAfterTp = Math.max(0, 1 - chain.tp0_qty - chain.tp1_qty - chain.sl_qty - chain.force_exit_all_qty - chain.force_exit_half_qty - chain.other_exit_qty);
  if (chain.trail_qty > (expectedTrailAfterTp + QTY_TOL)) {
    issues.push({
      code: "TRAIL_REMAINDER_OVER",
      detail: `trail_qty=${chain.trail_qty.toFixed(4)} expected<=${(expectedTrailAfterTp + QTY_TOL).toFixed(4)}`,
    });
  }
  return issues;
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
      out.push({ id: doc.id, ...fill });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

function buildReport(fills = []) {
  const chains = new Map();
  const issueRows = [];
  for (const fill of fills) {
    const key = buildChainKey(fill);
    if (!chains.has(key)) chains.set(key, buildChainSummary(fill));
    addFillToChain(chains.get(key), fill);
  }
  for (const chain of chains.values()) {
    chain.fills.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.fill_id || "").localeCompare(String(b.fill_id || "")));
    const authoritativeFills = buildAuthoritativeFillSet(chain.fills);
    const authoritativeChain = {
      ...chain,
      fills: authoritativeFills,
      tp0_qty: 0,
      tp1_qty: 0,
      trail_qty: 0,
      sl_qty: 0,
      force_exit_all_qty: 0,
      force_exit_half_qty: 0,
      other_exit_qty: 0,
      total_exit_qty: 0,
    };
    for (const fill of authoritativeFills) {
      const qty = resolveQtyPct(fill);
      if (!Number.isFinite(qty)) continue;
      authoritativeChain.total_exit_qty += qty;
      if (fill.stage === "TP0") authoritativeChain.tp0_qty += qty;
      else if (fill.stage === "TP1") authoritativeChain.tp1_qty += qty;
      else if (fill.stage === "TRAIL") authoritativeChain.trail_qty += qty;
      else if (fill.stage === "SL") authoritativeChain.sl_qty += qty;
      else if (fill.stage === "FORCE_EXIT_ALL") authoritativeChain.force_exit_all_qty += qty;
      else if (fill.stage === "FORCE_EXIT_HALF") authoritativeChain.force_exit_half_qty += qty;
      else if (fill.stage !== "OTHER") authoritativeChain.other_exit_qty += qty;
    }
    const issues = auditChain(authoritativeChain);
    if (!issues.length) continue;
    issueRows.push({
      chain_key: authoritativeChain.chain_key,
      symbol: authoritativeChain.symbol,
      entry_event_id: authoritativeChain.entry_event_id,
      tp0_qty: Number(authoritativeChain.tp0_qty.toFixed(6)),
      tp1_qty: Number(authoritativeChain.tp1_qty.toFixed(6)),
      trail_qty: Number(authoritativeChain.trail_qty.toFixed(6)),
      sl_qty: Number(authoritativeChain.sl_qty.toFixed(6)),
      force_exit_all_qty: Number(authoritativeChain.force_exit_all_qty.toFixed(6)),
      force_exit_half_qty: Number(authoritativeChain.force_exit_half_qty.toFixed(6)),
      other_exit_qty: Number(authoritativeChain.other_exit_qty.toFixed(6)),
      total_exit_qty: Number(authoritativeChain.total_exit_qty.toFixed(6)),
      issues,
      raw_fill_count: chain.fills.length,
      authoritative_fill_count: authoritativeFills.length,
      fills: authoritativeFills.slice(0, 20),
    });
  }
  const byCode = {};
  const bySymbol = {};
  for (const row of issueRows) {
    bySymbol[row.symbol] = (bySymbol[row.symbol] || 0) + 1;
    for (const issue of row.issues) byCode[issue.code] = (byCode[issue.code] || 0) + 1;
  }
  return {
    generated_at_iso: nowIso(),
    lookback_days: LOOKBACK_DAYS,
    fill_count: fills.length,
    chain_count: chains.size,
    issue_chain_count: issueRows.length,
    issue_code_counts: Object.entries(byCode).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
    top_symbols: Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([symbol, count]) => ({ symbol, count })),
    issues: issueRows.slice(0, ISSUE_LIMIT),
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Binance Exit Qty Contract Audit");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- lookback_days: ${report.lookback_days}`);
  lines.push(`- fills: ${report.fill_count}`);
  lines.push(`- chains: ${report.chain_count}`);
  lines.push(`- issue_chains: ${report.issue_chain_count}`);
  lines.push("");
  lines.push("## Issue Codes");
  if (!Array.isArray(report.issue_code_counts) || !report.issue_code_counts.length) {
    lines.push("- none");
  } else {
    for (const row of report.issue_code_counts) lines.push(`- ${row.code}: ${row.count}`);
  }
  lines.push("");
  lines.push("## Top Symbols");
  if (!Array.isArray(report.top_symbols) || !report.top_symbols.length) {
    lines.push("- none");
  } else {
    for (const row of report.top_symbols) lines.push(`- ${row.symbol}: ${row.count}`);
  }
  lines.push("");
  lines.push("## Sample Issues");
  if (!Array.isArray(report.issues) || !report.issues.length) {
    lines.push("- none");
  } else {
    for (const row of report.issues.slice(0, 30)) {
      lines.push(`- ${row.symbol} | chain=${row.chain_key}`);
      lines.push(`  total=${row.total_exit_qty} tp0=${row.tp0_qty} tp1=${row.tp1_qty} trail=${row.trail_qty} force_all=${row.force_exit_all_qty}`);
      lines.push(`  issues=${row.issues.map((x) => x.code).join(", ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const db = getFirestore();
  const fills = await fetchRecentBinanceExitFills(db);
  const report = buildReport(fills);
  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const latestJson = path.join(outDir, "binance_exit_qty_contract_audit_latest.json");
  const datedJson = path.join(outDir, `${isoDate()}_binance_exit_qty_contract_audit.json`);
  const latestMd = path.join(outDir, "binance_exit_qty_contract_audit_latest.md");
  const datedMd = path.join(outDir, `${isoDate()}_binance_exit_qty_contract_audit.md`);
  const md = buildMarkdown(report);
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestMd, `${md}\n`, "utf8");
  fs.writeFileSync(datedMd, `${md}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    fill_count: report.fill_count,
    chain_count: report.chain_count,
    issue_chain_count: report.issue_chain_count,
    top_issue_codes: report.issue_code_counts.slice(0, 10),
    top_symbols: report.top_symbols.slice(0, 10),
    output_json: latestJson,
    output_md: latestMd,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BINANCE_EXIT_QTY_CONTRACT_AUDIT_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    classifyExitEvent,
    resolveQtyPct,
    buildChainKey,
    buildChainSummary,
    addFillToChain,
    buildAuthoritativeFillSet,
    auditChain,
    buildReport,
  },
};
