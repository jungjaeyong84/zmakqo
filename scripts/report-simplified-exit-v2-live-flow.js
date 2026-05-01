#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.SIMPLIFIED_EXIT_V2_LIVE_FLOW_LOOKBACK_HOURS || 48));
const PAGE_SIZE = Math.max(100, Number(process.env.SIMPLIFIED_EXIT_V2_LIVE_FLOW_PAGE_SIZE || 1000));
const EXCHANGE = "BINANCEFUT";
const FILL_SELECT_FIELDS = Object.freeze([
  "exchange",
  "symbol",
  "symbol_or_pair_id",
  "event",
  "created_at",
  "canonical_transition_events",
  "canonical_primary_transition_event",
]);
const OUTBOX_SELECT_FIELDS = Object.freeze([
  "created_at",
  "updated_at",
  "sent_at",
  "type",
  "status",
  "exchange",
  "symbol",
  "event",
  "source_fill_id",
  "last_title",
  "canonical_transition_events",
  "canonical_primary_transition_event",
  "payload",
]);
const POSITION_SELECT_FIELDS = Object.freeze([
  "exchange",
  "symbol",
  "symbol_or_pair_id",
  "state",
  "qty_base",
  "avg_price",
  "updated_at",
  "meta",
]);

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

function resolveObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveRowPayload(row = {}) {
  return resolveObject(row.payload);
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
  const payload = resolveRowPayload(row);
  const values = [];
  if (Array.isArray(row.canonical_transition_events)) values.push(...row.canonical_transition_events);
  if (Array.isArray(row.canonicalTransitionEvents)) values.push(...row.canonicalTransitionEvents);
  if (Array.isArray(payload.canonical_transition_events)) values.push(...payload.canonical_transition_events);
  if (Array.isArray(payload.canonicalTransitionEvents)) values.push(...payload.canonicalTransitionEvents);
  if (row.canonical_primary_transition_event) values.push(row.canonical_primary_transition_event);
  if (row.canonicalTransitionEvent) values.push(row.canonicalTransitionEvent);
  if (payload.canonical_primary_transition_event) values.push(payload.canonical_primary_transition_event);
  if (payload.canonicalTransitionEvent) values.push(payload.canonicalTransitionEvent);
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
  const nativeTpArmed = !!(
    meta.native_protection_tp_order_id
    || upper(meta.native_protection_tp_status) === "OK"
    || (toOptionalNum(meta.native_protection_tp_price) != null && toOptionalNum(meta.native_protection_tp_qty_ratio) != null)
  );
  const nativeRefreshAtMs = toOptionalNum(meta.native_protection_refresh_at_ms);
  const nativeTpGapAgeMs = (
    meta.tp_p1_done === true
    || meta.trail_active === true
    || meta.tp_p1_pending === true
    || nativeTpArmed
  )
    ? null
    : (Number.isFinite(nativeRefreshAtMs) ? Math.max(0, Date.now() - nativeRefreshAtMs) : null);
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
    native_refresh_at_ms: nativeRefreshAtMs,
    native_tp_gap_age_ms: nativeTpGapAgeMs,
    native_tp_gap_escalated: Number.isFinite(nativeTpGapAgeMs) && nativeTpGapAgeMs >= 15000,
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
  const payload = resolveRowPayload(row);
  return {
    ts: row.ts || null,
    ts_ms: toMs(row.ts),
    symbol: upper(row.symbol || payload.symbol),
    event: upper(row.event || payload.event),
    source_fill_id: String(
      row.source_fill_id
      || payload.sourceFillId
      || payload.source_fill_id
      || payload.fillId
      || payload.fill_id
      || ""
    ).trim() || null,
    transitions: parseTransitionEvents(row),
    title: row.title || row.last_title || payload.title || null,
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
  const trailTransition = fillRows.find((row) => row.transitions.includes("TRAIL_ACTIVATED") || row.transitions.includes("TRAIL_FINAL_EXIT"))
    || auditRows.find((row) => row.transitions.includes("TRAIL_ACTIVATED") || row.transitions.includes("TRAIL_FINAL_EXIT"));
  const forbiddenTrailPartialTransition = fillRows.find((row) => row.transitions.includes("TRAIL_PARTIAL"))
    || auditRows.find((row) => row.transitions.includes("TRAIL_PARTIAL"));

  const issues = [];
  const observations = [];
  const nativeTpArmed = hasNativeTpArmed(position || {});
  const hasTp1Seen = !!(tp1Fill || tp1Transition || (position && position.tp_p1_done === true));
  const hasTrailSeen = !!(trailFill || trailTransition || (position && position.trail_active === true));
  const currentActive = !!(position && upper(position.state) !== "FLAT");
  const activePreTp1 = !!(currentActive && position.tp_p1_done !== true && position.trail_active !== true);

  if (activePreTp1 && nativeTpArmed !== true) {
    issues.push({
      code: "V2_NATIVE_TP_MISSING_PRE_TP1",
      detail: "active pre-TP1 simplified-exit-v2 position is missing native TP1 protection",
    });
    if (Number.isFinite(toOptionalNum(position && position.native_tp_gap_age_ms))) {
      issues.push({
        code: position.native_tp_gap_escalated === true ? "V2_NATIVE_TP_GAP_ESCALATED" : "V2_NATIVE_TP_GAP_ACTIVE",
        detail: `native TP gap age ${Number(position.native_tp_gap_age_ms)}ms (refresh_status=${position.native_refresh_status || "N/A"})`,
      });
    }
  }
  if (hasTp1Seen && nativeTpArmed !== true) {
    observations.push({
      code: "V2_TP1_TRANSITION_CURRENT_NATIVE_TP_ABSENT",
      detail: currentActive
        ? "TP1 transition/fill exists and current native TP1 is absent; this is expected after TP1 fill but should be covered by TP1 meta/trail checks"
        : "closed position has TP1 transition/fill history and no current native TP1 order; this is expected after close",
      actionable: false,
    });
  }
  if (hasTrailSeen && hasTp1Seen !== true) {
    issues.push({
      code: "V2_TRAIL_WITHOUT_TP1_TRANSITION",
      detail: "trail transition/fill exists without TP1 transition/fill evidence",
    });
  }
  if (forbiddenTrailPartialTransition) {
    issues.push({
      code: "V2_FORBIDDEN_TRAIL_PARTIAL_TRANSITION",
      detail: "simplified-exit-v2 flow emitted forbidden TRAIL_PARTIAL transition",
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
    native_tp_gap_age_ms: toOptionalNum(position && position.native_tp_gap_age_ms),
    native_tp_gap_escalated: position && position.native_tp_gap_escalated === true,
    tp1_fill_seen: !!tp1Fill,
    tp1_transition_seen: !!tp1Transition,
    trail_fill_seen: !!trailFill,
    trail_transition_seen: !!trailTransition,
    latest_fill_event: fillRows.length ? fillRows[fillRows.length - 1].event : null,
    latest_alert_title: auditRows.length ? auditRows[auditRows.length - 1].title : null,
    fill_n: fillRows.length,
    alert_audit_n: auditRows.length,
    observations,
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
    lines.push(`- native_tp_order_id=${pos.native_tp_order_id || "N/A"} native_tp_status=${pos.native_tp_status || "N/A"} native_refresh_status=${pos.native_refresh_status || "N/A"} native_tp_gap_age_ms=${flow.native_tp_gap_age_ms ?? "N/A"} native_tp_gap_escalated=${flow.native_tp_gap_escalated ? "1" : "0"}`);
    if (Array.isArray(flow.issues) && flow.issues.length) {
      lines.push("- issues:");
      for (const issue of flow.issues) {
        lines.push(`  - ${issue.code}: ${issue.detail}`);
      }
    } else {
      lines.push("- issues: none");
    }
    if (Array.isArray(flow.observations) && flow.observations.length) {
      lines.push("- observations:");
      for (const observation of flow.observations) {
        lines.push(`  - ${observation.code}: ${observation.detail}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function fetchRecentBinanceFillRows(db, sinceIso) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .select(...FILL_SELECT_FIELDS)
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      if (upper(row.exchange) !== EXCHANGE) continue;
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
    let q = db.collection("trade_alert_outbox")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .select(...OUTBOX_SELECT_FIELDS)
      .limit(PAGE_SIZE);
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
        payload: row.payload || null,
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function fetchSimplifiedExitV2Positions(db) {
  const rows = [];
  const snap = await db.collection("positions_paper")
    .where("exchange", "==", EXCHANGE)
    .select(...POSITION_SELECT_FIELDS)
    .get();
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
      FILL_SELECT_FIELDS,
      OUTBOX_SELECT_FIELDS,
      POSITION_SELECT_FIELDS,
    },
  };
}
