#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const DEFAULT_TARGETS = ["BNBUSDT", "DOGEUSDT", "ETHUSDT", "BTCUSDT", "XRPUSDT"];
const TARGETS = String(process.env.TARGET_SYMBOLS || DEFAULT_TARGETS.join(","))
  .split(",")
  .map((value) => String(value || "").trim().toUpperCase())
  .filter(Boolean);
const TARGET_SET = new Set(TARGETS);
const FILL_SCAN_LIMIT = Math.max(500, Number(process.env.TARGET_EXIT_INVESTIGATION_FILL_SCAN_LIMIT || 2500));
const FILL_PER_SYMBOL_LIMIT = Math.max(5, Number(process.env.TARGET_EXIT_INVESTIGATION_FILL_PER_SYMBOL_LIMIT || 12));

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function summarizePosition(pos) {
  const meta = pos && typeof pos.meta === "object" ? pos.meta : {};
  const qtyBase = toNum(pos.qty_base, 0) || 0;
  const state = upper(pos.state || pos.position_state);
  return {
    symbol: upper(pos.symbol_or_pair_id || pos.symbol),
    state,
    position_side: upper(pos.position_side || meta.position_side || meta.external_side),
    qty_base: qtyBase,
    avg_price: toNum(pos.avg_price),
    tp_p0_done: meta.tp_p0_done === true,
    tp_p1_done: meta.tp_p1_done === true,
    trail_active: meta.trail_active === true,
    tp0_price: toNum(meta.tp_p0_price),
    tp1_price: toNum(meta.native_protection_tp_price),
    tp1_qty_base: toNum(meta.native_protection_tp_qty_base),
    tp1_qty_ratio: toNum(meta.native_protection_tp_qty_ratio),
    stop_price: toNum(meta.native_protection_stop_price),
    native_refresh_status: upper(meta.native_protection_refresh_status),
    exchange_projection_in_sync: meta.exchange_projection_in_sync === true,
    updated_at: pos.updated_at || null,
  };
}

function summarizeFill(docId, fill) {
  return {
    id: docId,
    created_at: fill.created_at || null,
    event: upper(fill.event),
    intent_id: fill.intent_id || null,
    source: upper(fill.source || fill.external_source),
    side: upper(fill.side),
    exec_qty_base: toNum(fill.exec_qty_base),
    qty_pct: toNum(fill.qty_pct),
    qty_fraction: toNum(fill.qty_fraction),
    exec_price: toNum(fill.exec_price),
    notional: toNum(fill.notional),
    classification_verified: fill.classification_verified !== false,
    classification_issues: Array.isArray(fill.classification_issues) ? fill.classification_issues : [],
    extra: fill.extra || null,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Binance Targeted Exit Investigation");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- targets: ${report.targets.join(", ")}`);
  lines.push(`- duplicate_group_n: ${report.duplicate_group_n}`);
  lines.push(`- unresolved_duplicate_group_n: ${report.unresolved_duplicate_group_n}`);
  lines.push("");
  for (const row of report.symbols) {
    lines.push(`## ${row.symbol}`);
    lines.push(`- active_position: ${row.active_position ? "yes" : "no"}`);
    if (row.position) {
      lines.push(`- state=${row.position.state} side=${row.position.position_side} qty=${row.position.qty_base} avg=${row.position.avg_price}`);
      lines.push(`- tp_p0_done=${row.position.tp_p0_done ? "1" : "0"} tp_p1_done=${row.position.tp_p1_done ? "1" : "0"} trail_active=${row.position.trail_active ? "1" : "0"}`);
      lines.push(`- native_tp_qty=${row.position.tp1_qty_base ?? "N/A"} native_tp_ratio=${row.position.tp1_qty_ratio ?? "N/A"} stop=${row.position.stop_price ?? "N/A"} refresh=${row.position.native_refresh_status || "N/A"}`);
    }
    if (row.execution_drilldown) {
      lines.push(`- drilldown_state=${row.execution_drilldown.contract_state} latest=${row.execution_drilldown.latest_event || "N/A"} @ ${row.execution_drilldown.latest_exit_at || "N/A"}`);
    }
    if (row.duplicate_groups.length) {
      lines.push(`- duplicate_groups=${row.duplicate_groups.length}`);
      for (const group of row.duplicate_groups) {
        lines.push(`  - key=${group.key} fill_count=${group.fill_count} backfilled=${group.backfilled ? "1" : "0"} first=${group.first_at} last=${group.last_at}`);
      }
    } else {
      lines.push("- duplicate_groups=0");
    }
    if (row.recent_fills.length) {
      lines.push("- recent_fills:");
      for (const fill of row.recent_fills) {
        lines.push(`  - ${fill.created_at} | ${fill.event} | qty=${fill.exec_qty_base ?? "N/A"} | pct=${fill.qty_pct ?? fill.qty_fraction ?? "N/A"} | verified=${fill.classification_verified ? "1" : "0"}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const repoRoot = process.cwd();
  const db = getFirestore();
  const outDir = path.join(repoRoot, "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });

  const positionsSnap = await db.collection("positions_paper").where("exchange", "==", "BINANCEFUT").get();
  const positionsBySymbol = new Map();
  for (const doc of positionsSnap.docs) {
    const row = doc.data() || {};
    const symbol = upper(row.symbol_or_pair_id || row.symbol);
    if (!symbol || !TARGET_SET.has(symbol)) continue;
    positionsBySymbol.set(symbol, summarizePosition(row));
  }

  const fillsSnap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(FILL_SCAN_LIMIT).get();
  const fillsBySymbol = new Map();
  for (const doc of fillsSnap.docs) {
    const fill = doc.data() || {};
    if (upper(fill.exchange) !== "BINANCEFUT") continue;
    const symbol = upper(fill.symbol || fill.symbol_or_pair_id);
    if (!symbol || !TARGET_SET.has(symbol)) continue;
    const bucket = fillsBySymbol.get(symbol) || [];
    if (bucket.length >= FILL_PER_SYMBOL_LIMIT) continue;
    bucket.push(summarizeFill(doc.id, fill));
    fillsBySymbol.set(symbol, bucket);
  }

  const drilldown = readJsonIfExists(path.join(outDir, "binance_exit_execution_drilldown_latest.json"), {});
  const drilldownRows = new Map((Array.isArray(drilldown.symbols) ? drilldown.symbols : []).map((row) => [upper(row.symbol), row]));
  const duplication = readJsonIfExists(path.join(outDir, "fill_sync_alert_duplication_latest.json"), {});
  const duplicateRows = Array.isArray(duplication.top_duplicate_groups) ? duplication.top_duplicate_groups : [];

  const symbols = TARGETS.map((symbol) => ({
    symbol,
    active_position: !!(positionsBySymbol.get(symbol) && positionsBySymbol.get(symbol).state !== "FLAT" && Number(positionsBySymbol.get(symbol).qty_base || 0) > 0),
    position: positionsBySymbol.get(symbol) || null,
    execution_drilldown: drilldownRows.get(symbol) || null,
    duplicate_groups: duplicateRows.filter((row) => upper(row.symbol) === symbol),
    recent_fills: fillsBySymbol.get(symbol) || [],
  }));

  const report = {
    generated_at: nowIso(),
    targets: TARGETS.slice(),
    duplicate_group_n: duplicateRows.filter((row) => TARGET_SET.has(upper(row.symbol))).length,
    unresolved_duplicate_group_n: duplicateRows.filter((row) => TARGET_SET.has(upper(row.symbol)) && row.backfilled !== true).length,
    symbols,
  };

  const latestJson = path.join(outDir, "binance_targeted_exit_investigation_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_binance_targeted_exit_investigation.md`);
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMd, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({
    ok: true,
    output_json: latestJson,
    output_md: datedMd,
    duplicate_group_n: report.duplicate_group_n,
    unresolved_duplicate_group_n: report.unresolved_duplicate_group_n,
  }, null, 2));
}

main().catch((err) => {
  console.error("BINANCE_TARGETED_EXIT_INVESTIGATION_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
