#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.SIMPLIFIED_EXIT_V2_LIVE_FLOW_LOOKBACK_HOURS || 48));
const PAGE_SIZE = Math.max(100, Number(process.env.SIMPLIFIED_EXIT_V2_LIVE_FLOW_PAGE_SIZE || 1000));
const EXCHANGE = "BINANCEFUT";

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

function toOptionalNum(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return String(fs.readFileSync(filePath, "utf8") || "")
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
    .filter(Boolean);
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isSimplifiedExitV2Position(row = {}) {
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  return meta.simplified_exit_v2_enabled === true || meta.simplifiedExitV2Enabled === true;
}

function normalizeFillStage(event) {
  const ev = upper(event);
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P1") || ev.startsWith("EXIT_TP_C")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_SL")) return "SL";
  return null;
}

function normalizeTransitionEvent(value) {
  const ev = upper(value);
  if (!ev) return null;
  if (ev === "TRAIL_ACTIVE") return "TRAIL_ACTIVATED";
  return ev;
}

function parseTransitionEvents(row = {}) {
  const values = [];
  if (Array.isArray(row.canonical_transition_events)) values.push(...row.canonical_transition_events);
  if (Array.isArray(row.canonicalTransitionEvents)) values.push(...row.canonicalTransitionEvents);
  if (row.canonical_primary_transition_event) values.push(row.canonical_primary_transition_event);
  if (row.canonicalTransitionEvent) values.push(row.canonicalTransitionEvent);
  const seen = new Set();
  return values
    .map((item) => normalizeTransitionEvent(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function summarizePosition(row = {}) {
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  return {
    symbol: upper(row.symbol_or_pair_id || row.symbol),
    state: upper(row.state || row.position_state),
    position_side: upper(row.position_side || meta.position_side || meta.external_side),
    qty_base: toNum(row.qty_base, 0) || 0,
    avg_price: toNum(row.avg_price),
    tp_p1_done: meta.tp_p1_done === true,
    trail_active: meta.trail_active === true,
    native_tp_order_id: meta.native_protection_tp_order_id || null,
    native_tp_status: upper(meta.native_protection_tp_status),
    native_tp_price: toOptionalNum(meta.native_protection_tp_price),
    native_tp_qty_base: toOptionalNum(meta.native_protection_tp_qty_base),
    native_tp_qty_ratio: toOptionalNum(meta.native_protection_tp_qty_ratio),
    native_stop_order_id: meta.native_protection_stop_order_id || null,
    native_refresh_status: upper(meta.native_protection_refresh_status),
    canonical_exit_stage: upper(meta.canonical_exit_stage || meta.authoritative_exit_stage),
    updated_at: row.updated_at || null,
    tp0_meta_leak: !!(
      meta.native_protection_tp0_order_id
      || toOptionalNum(meta.native_protection_tp0_price) != null
      || toOptionalNum(meta.native_protection_tp0_qty_ratio) != null
      || upper(meta.native_protection_tp0_status)
    ),
  };
}

function summarizeFill(row = {}) {
  return {
    fill_id: row.fill_id || row.id || null,
    symbol: upper(row.symbol || row.symbol_or_pair_id),
    event: upper(row.event),
    stage: normalizeFillStage(row.event),
    created_at: row.created_at || null,
    created_ms: toMs(row.created_at),
    transitions: parseTransitionEvents(row),
  };
}

function summarizeAlertAuditRow(row = {}) {
  return {
    ts: row.ts || null,
    ts_ms: toMs(row.ts),
    symbol: upper(row.symbol),
    event: upper(row.event),
    source_fill_id: String(row.source_fill_id || "").trim() || null,
    transitions: parseTransitionEvents(row),
    title: row.title || null,
  };
}

function dedupeAlertRows(rows = []) {
  const seen = new Set();
  const deduped = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = [
      trimOrNull(row && row.ts),
      upper(row && row.symbol),
      upper(row && row.event),
      trimOrNull(row && row.source_fill_id),
      trimOrNull(row && row.title),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function hasNativeTpArmed(position = {}) {
  return !!(
    position.native_tp_order_id
    || position.native_tp_status === "OK"
    || (toOptionalNum(position.native_tp_price) != null && toOptionalNum(position.native_tp_qty_ratio) != null)
  );
}

function collectSymbolFlow({
  symbol,
  position = null,
  fills = [],
  alertAuditRows = [],
} = {}) {
  const fillRows = (Array.isArray(fills) ? fills : [])
    .map((row) => (Array.isArray(row && row.transitions) ? row : summarizeFill(row)))
    .filter((row) => upper(row.symbol) === symbol)
    .sort((a, b) => Number(a.created_ms || 0) - Number(b.created_ms || 0));
  const auditRows = (Array.isArray(alertAuditRows) ? alertAuditRows : [])
    .map((row) => (Array.isArray(row && row.transitions) ? row : summarizeAlertAuditRow(row)))
    .filter((row) => upper(row.symbol) === symbol)
    .sort((a, b) => Number(a.ts_ms || 0) - Number(b.ts_ms || 0));

  const tp1Fill = fillRows.find((row) => row.stage === "TP1");
  const trailFill = fillRows.find((row) => row.stage === "TRAIL");
  const tp1Transition = fillRows.find((row) => row.transitions.includes("TP1_REACHED"))
    || auditRows.find((row) => row.transitions.includes("TP1_REACHED"));
  const trailTransition = fillRows.find((row) => row.transitions.includes("TRAIL_ACTIVATED") || row.transitions.includes("TRAIL_FINAL_EXIT") || row.transitions.includes("TRAIL_PARTIAL"))
    || auditRows.find((row) => row.transitions.includes("TRAIL_ACTIVATED") || row.transitions.includes("TRAIL_FINAL_EXIT") || row.transitions.includes("TRAIL_PARTIAL"));

  const issues = [];
  const nativeTpArmed = hasNativeTpArmed(position || {});
  const hasTp1Seen = !!(tp1Fill || tp1Transition || (position && position.tp_p1_done === true));
  const hasTrailSeen = !!(trailFill || trailTransition || (position && position.trail_active === true));
  const activePreTp1 = !!(position && position.state !== "FLAT" && position.tp_p1_done !== true && position.trail_active !== true);

  if (activePreTp1 && nativeTpArmed !== true) {
    issues.push({
      code: "V2_NATIVE_TP_MISSING_PRE_TP1",
      detail: "active pre-TP1 simplified-exit-v2 position is missing native TP1 protection",
    });
  }
  if (hasTp1Seen && nativeTpArmed !== true) {
    issues.push({
      code: "V2_TP1_TRANSITION_WITHOUT_NATIVE_TP",
      detail: "TP1 transition/fill exists without native TP1 armed evidence",
    });
  }
  if (hasTrailSeen && hasTp1Seen !== true) {
    issues.push({
      code: "V2_TRAIL_WITHOUT_TP1_TRANSITION",
      detail: "trail transition/fill exists without TP1 transition/fill evidence",
    });
  }
  if (position && position.tp0_meta_leak === true) {
    issues.push({
      code: "V2_TP0_NATIVE_META_LEAK",
      detail: "simplified-exit-v2 position still contains tp0 native protection metadata",
    });
  }

  return {
    symbol,
    native_tp_armed: nativeTpArmed,
    tp1_fill_seen: !!tp1Fill,
    tp1_transition_seen: !!tp1Transition,
    trail_fill_seen: !!trailFill,
    trail_transition_seen: !!trailTransition,
    latest_fill_event: fillRows.length ? fillRows[fillRows.length - 1].event : null,
    latest_alert_title: auditRows.length ? auditRows[auditRows.length - 1].title : null,
    fill_n: fillRows.length,
    alert_audit_n: auditRows.length,
    issues,
  };
}

function buildReport({
  positions = [],
  fills = [],
  alertAuditRows = [],
} = {}) {
  const v2Positions = (Array.isArray(positions) ? positions : []).filter((row) => isSimplifiedExitV2Position(row));
  const symbols = Array.from(new Set(v2Positions.map((row) => upper(row.symbol_or_pair_id || row.symbol)).filter(Boolean))).sort();
  const symbolRows = symbols.map((symbol) => {
    const rawPosition = v2Positions.find((row) => upper(row.symbol_or_pair_id || row.symbol) === symbol) || null;
    const position = rawPosition ? summarizePosition(rawPosition) : null;
    return {
      symbol,
      position,
      flow: collectSymbolFlow({
        symbol,
        position,
        fills: (Array.isArray(fills) ? fills : []).map(summarizeFill),
        alertAuditRows: (Array.isArray(alertAuditRows) ? alertAuditRows : []).map(summarizeAlertAuditRow),
      }),
    };
  });
  const actionableRows = symbolRows.filter((row) => Array.isArray(row.flow.issues) && row.flow.issues.length > 0);
  return {
    generated_at: nowIso(),
    lookback_hours: LOOKBACK_HOURS,
    exchange: EXCHANGE,
    simplified_exit_v2_symbol_n: symbolRows.length,
    actionable_symbol_n: actionableRows.length,
    actionable_symbols: actionableRows.map((row) => row.symbol),
    issue_code_counts: actionableRows.reduce((acc, row) => {
      for (const issue of row.flow.issues) {
        const code = String(issue.code || "UNKNOWN");
        acc[code] = (acc[code] || 0) + 1;
      }
      return acc;
    }, {}),
    symbols: symbolRows,
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Simplified Exit V2 Live Flow");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- lookback_hours: ${report.lookback_hours ?? "N/A"}`);
  lines.push(`- simplified_exit_v2_symbol_n: ${report.simplified_exit_v2_symbol_n ?? 0}`);
  lines.push(`- actionable_symbol_n: ${report.actionable_symbol_n ?? 0}`);
  lines.push("");
  for (const row of Array.isArray(report.symbols) ? report.symbols : []) {
    lines.push(`## ${row.symbol}`);
    const pos = row.position || {};
    const flow = row.flow || {};
    lines.push(`- state=${pos.state || "N/A"} side=${pos.position_side || "N/A"} qty=${pos.qty_base ?? "N/A"} avg=${pos.avg_price ?? "N/A"}`);
    lines.push(`- native_tp_armed=${flow.native_tp_armed ? "1" : "0"} tp1_fill_seen=${flow.tp1_fill_seen ? "1" : "0"} tp1_transition_seen=${flow.tp1_transition_seen ? "1" : "0"}`);
    lines.push(`- trail_fill_seen=${flow.trail_fill_seen ? "1" : "0"} trail_transition_seen=${flow.trail_transition_seen ? "1" : "0"}`);
    lines.push(`- native_tp_order_id=${pos.native_tp_order_id || "N/A"} native_tp_status=${pos.native_tp_status || "N/A"} native_refresh_status=${pos.native_refresh_status || "N/A"}`);
    if (Array.isArray(flow.issues) && flow.issues.length) {
      lines.push("- issues:");
      for (const issue of flow.issues) {
        lines.push(`  - ${issue.code}: ${issue.detail}`);
      }
    } else {
      lines.push("- issues: none");
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function fetchRecentBinanceFillRows(db, sinceIso) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      if (upper(row.exchange) !== EXCHANGE) continue;
      if (String(row.created_at || "") < sinceIso) continue;
      rows.push({ id: doc.id, ...row });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function fetchRecentTradeAlertOutboxRows(db, sinceIso) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection("trade_alert_outbox").orderBy("__name__").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      if (upper(row.type) !== "TRADE_EXECUTION_ALERT") continue;
      if (upper(row.status) !== "SENT") continue;
      if (upper(row.exchange) && upper(row.exchange) !== EXCHANGE) continue;
      const ts = row.sent_at || row.updated_at || row.created_at || null;
      if (String(ts || "") < sinceIso) continue;
      rows.push({
        ts,
        symbol: upper(row.symbol),
        event: upper(row.event),
        source_fill_id: row.source_fill_id || null,
        title: row.last_title || null,
        canonical_transition_events: Array.isArray(row.canonical_transition_events) ? row.canonical_transition_events : [],
        canonical_primary_transition_event: row.canonical_primary_transition_event || null,
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function fetchSimplifiedExitV2Positions(db) {
  const rows = [];
  const snap = await db.collection("positions_paper").where("exchange", "==", EXCHANGE).get();
  snap.forEach((doc) => {
    const row = doc.data() || {};
    if (!isSimplifiedExitV2Position(row)) return;
    rows.push({ id: doc.id, ...row });
  });
  return rows;
}

async function main() {
  const db = getFirestore();
  const sinceIso = new Date(Date.now() - (LOOKBACK_HOURS * 60 * 60 * 1000)).toISOString();
  const positions = await fetchSimplifiedExitV2Positions(db);
  const fills = await fetchRecentBinanceFillRows(db, sinceIso);
  const outboxRows = await fetchRecentTradeAlertOutboxRows(db, sinceIso);
  const auditPath = path.join(process.cwd(), "ops", "runtime", "trade_execution_alert_audit.jsonl");
  const runtimeAuditRows = readJsonl(auditPath).filter((row) => {
    const tsMs = toMs(row.ts);
    return Number.isFinite(tsMs) && tsMs >= Date.parse(sinceIso) && upper(row.exchange) === EXCHANGE;
  });
  const alertAuditRows = dedupeAlertRows([
    ...runtimeAuditRows,
    ...outboxRows,
  ]);

  const report = buildReport({
    positions,
    fills,
    alertAuditRows,
  });

  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const latestJson = path.join(outDir, "simplified_exit_v2_live_flow_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_simplified_exit_v2_live_flow.md`);
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMd, buildMarkdown(report), "utf8");

  console.log(JSON.stringify({
    ok: true,
    actionable_symbol_n: report.actionable_symbol_n,
    actionable_symbols: report.actionable_symbols,
    issue_code_counts: report.issue_code_counts,
    output_json: latestJson,
    output_md: datedMd,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SIMPLIFIED_EXIT_V2_LIVE_FLOW_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      isSimplifiedExitV2Position,
      normalizeFillStage,
      parseTransitionEvents,
      summarizePosition,
      summarizeFill,
      summarizeAlertAuditRow,
      dedupeAlertRows,
      hasNativeTpArmed,
      toOptionalNum,
      collectSymbolFlow,
      buildReport,
    },
  };
}
