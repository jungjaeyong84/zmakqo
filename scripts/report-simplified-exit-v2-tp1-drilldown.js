#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_LOOKBACK_HOURS || 48));
const PAGE_SIZE = Math.max(100, Number(process.env.SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_PAGE_SIZE || 1000));
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

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function toOptionalNum(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function isSimplifiedExitV2Position(row = {}) {
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  return meta.simplified_exit_v2_enabled === true || meta.simplifiedExitV2Enabled === true;
}

function isTp1Event(event) {
  const ev = upper(event);
  return !!(ev && ev.startsWith("EXIT_TP_P1"));
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

function summarizePosition(row = {}) {
  const meta = row && typeof row.meta === "object" ? row.meta : {};
  return {
    symbol: upper(row.symbol_or_pair_id || row.symbol),
    state: upper(row.state || row.position_state),
    updated_at: row.updated_at || null,
    tp_p1_done: meta.tp_p1_done === true,
    tp_p1_pending: meta.tp_p1_pending === true,
    trail_active: meta.trail_active === true,
    canonical_exit_stage: upper(meta.canonical_exit_stage || meta.authoritative_exit_stage),
    native_tp_order_id: trimOrNull(meta.native_protection_tp_order_id),
    native_tp_status: upper(meta.native_protection_tp_status),
    native_tp_price: toOptionalNum(meta.native_protection_tp_price),
    native_tp_qty_ratio: toOptionalNum(meta.native_protection_tp_qty_ratio),
  };
}

function summarizeIntent(row = {}) {
  const createdAt = row.updated_at || row.created_at || null;
  return {
    intent_id: trimOrNull(row.intent_id || row.id),
    symbol: upper(row.symbol || row.symbol_or_pair_id),
    event: upper(row.event),
    status: upper(row.status),
    status_reason: upper(row.status_reason || row.cancel_reason || row.decision_reason),
    created_at: createdAt,
    created_ms: toMs(createdAt),
    live_submit_state: upper(row.live_submit_state),
    live_submit_started_at_ms: toOptionalNum(row.live_submit_started_at_ms),
    live_submit_ack_at_ms: toOptionalNum(row.live_submit_ack_at_ms),
    live_submit_order_id: trimOrNull(row.live_submit_order_id),
    live_submit_client_order_id: trimOrNull(row.live_submit_client_order_id),
    last_error: trimOrNull(row.last_error || row.live_submit_error),
  };
}

function summarizeFill(row = {}) {
  return {
    fill_id: trimOrNull(row.fill_id || row.id),
    symbol: upper(row.symbol || row.symbol_or_pair_id),
    event: upper(row.event),
    created_at: row.created_at || null,
    created_ms: toMs(row.created_at),
    transitions: parseTransitionEvents(row),
  };
}

function summarizeAlertRow(row = {}) {
  return {
    ts: row.ts || row.sent_at || row.updated_at || row.created_at || null,
    ts_ms: toMs(row.ts || row.sent_at || row.updated_at || row.created_at),
    symbol: upper(row.symbol),
    event: upper(row.event),
    source_fill_id: trimOrNull(row.source_fill_id),
    title: row.title || row.last_title || null,
    transitions: parseTransitionEvents(row),
  };
}

function hasNativeTpArmed(position = {}) {
  return !!(
    position.native_tp_order_id
    || position.native_tp_status === "OK"
    || (position.native_tp_price != null && position.native_tp_qty_ratio != null)
  );
}

function isTerminalTp1IntentFailure(intent = {}) {
  const status = upper(intent.status);
  const reason = upper(intent.status_reason);
  if (!intent || !status) return false;
  if (status !== "CANCELED" && status !== "FAILED") return false;
  return reason === "LIVE_EXCEPTION"
    || reason === "LIVE_FAILED"
    || reason === "FAILED_INTERNAL"
    || reason === "TP1_ACK_TIMEOUT"
    || reason === "PENDING_TERMINAL_LIVE_FAILURE";
}

function isTp1AlertRow(row = {}) {
  if (isTp1Event(row.event)) return true;
  return Array.isArray(row.transitions) && row.transitions.includes("TP1_REACHED");
}

function isTp1IntentAcked(intent = {}) {
  if (!intent) return false;
  return upper(intent.live_submit_state) === "ACKED"
    || Number.isFinite(Number(intent.live_submit_ack_at_ms))
    || !!trimOrNull(intent.live_submit_order_id);
}

function collectTp1Drilldown({
  symbol,
  position = null,
  intents = [],
  fills = [],
  alertRows = [],
} = {}) {
  const normalizedSymbol = upper(symbol);
  const tp1Intents = (Array.isArray(intents) ? intents : [])
    .map((row) => (row && Object.prototype.hasOwnProperty.call(row, "live_submit_state") ? row : summarizeIntent(row)))
    .filter((row) => row.symbol === normalizedSymbol && isTp1Event(row.event))
    .sort((a, b) => Number(b.created_ms || 0) - Number(a.created_ms || 0));
  const tp1Fills = (Array.isArray(fills) ? fills : [])
    .map((row) => (Array.isArray(row && row.transitions) ? row : summarizeFill(row)))
    .filter((row) => row.symbol === normalizedSymbol && isTp1Event(row.event))
    .sort((a, b) => Number(b.created_ms || 0) - Number(a.created_ms || 0));
  const normalizedAlerts = (Array.isArray(alertRows) ? alertRows : [])
    .map((row) => (Array.isArray(row && row.transitions) ? row : summarizeAlertRow(row)))
    .filter((row) => row.symbol === normalizedSymbol)
    .sort((a, b) => Number(b.ts_ms || 0) - Number(a.ts_ms || 0));

  const latestIntent = tp1Intents[0] || null;
  const latestFill = tp1Fills[0] || null;
  const latestTransitionRow = tp1Fills.find((row) => row.transitions.includes("TP1_REACHED"))
    || normalizedAlerts.find((row) => Array.isArray(row.transitions) && row.transitions.includes("TP1_REACHED"))
    || null;
  const latestAlert = normalizedAlerts.find((row) => isTp1AlertRow(row)) || null;

  const nativeTpArmed = hasNativeTpArmed(position || {});
  const stateClaimsTp1 = !!(
    position
    && (position.tp_p1_done === true
      || position.trail_active === true
      || position.canonical_exit_stage === "TP1"
      || position.canonical_exit_stage === "TRAIL")
  );

  const issues = [];
  if (stateClaimsTp1 && !latestFill) {
    issues.push({
      code: "V2_TP1_STATE_WITHOUT_FILL",
      detail: "position state claims TP1/TRAIL progression but no TP1 fill exists",
    });
  }
  if (latestFill && !latestTransitionRow) {
    issues.push({
      code: "V2_TP1_FILL_WITHOUT_TRANSITION",
      detail: "TP1 fill exists without canonical TP1_REACHED transition evidence",
    });
  }
  if (latestTransitionRow && !latestAlert) {
    issues.push({
      code: "V2_TP1_TRANSITION_WITHOUT_ALERT",
      detail: "canonical TP1 transition exists without TP1 alert evidence",
    });
  }
  if (position && position.tp_p1_pending === true && !latestIntent) {
    issues.push({
      code: "V2_TP1_PENDING_WITHOUT_INTENT",
      detail: "position still marks tp1 pending but no TP1 intent is present",
    });
  }
  if (latestIntent && isTerminalTp1IntentFailure(latestIntent)) {
    issues.push({
      code: "V2_TP1_TERMINAL_INTENT_FAILURE",
      detail: `latest TP1 intent failed terminally (${latestIntent.status_reason || latestIntent.status || "UNKNOWN"})`,
    });
  }
  if (latestIntent && isTp1IntentAcked(latestIntent) && !(position && position.native_tp_order_id)) {
    issues.push({
      code: "V2_TP1_ACK_WITHOUT_META_SYNC",
      detail: "TP1 intent shows ACK/order id but position meta does not carry native TP order id",
    });
  }
  if (latestIntent && latestIntent.live_submit_order_id && position && position.native_tp_order_id && latestIntent.live_submit_order_id !== position.native_tp_order_id) {
    issues.push({
      code: "V2_TP1_ORDER_ID_MISMATCH",
      detail: "intent ACK order id and position native TP order id diverge",
    });
  }
  if (nativeTpArmed && latestIntent && latestIntent.live_submit_state === "SUBMITTING" && !latestIntent.live_submit_ack_at_ms) {
    issues.push({
      code: "V2_TP1_NATIVE_ARMED_WITHOUT_ACK_EVIDENCE",
      detail: "native TP appears armed while latest TP1 intent still lacks ACK evidence",
    });
  }

  return {
    symbol: normalizedSymbol,
    native_tp_armed: nativeTpArmed,
    state_claims_tp1: stateClaimsTp1,
    latest_intent: latestIntent,
    latest_fill: latestFill,
    latest_transition: latestTransitionRow
      ? {
          source: latestTransitionRow.fill_id ? "FILL" : "ALERT",
          at: latestTransitionRow.created_at || latestTransitionRow.ts || null,
          event: latestTransitionRow.event || null,
        }
      : null,
    latest_alert: latestAlert
      ? {
          at: latestAlert.ts || null,
          event: latestAlert.event || null,
          title: latestAlert.title || null,
        }
      : null,
    tp1_intent_n: tp1Intents.length,
    tp1_fill_n: tp1Fills.length,
    tp1_alert_n: normalizedAlerts.filter((row) => isTp1AlertRow(row)).length,
    issues,
  };
}

function buildReport({
  positions = [],
  intents = [],
  fills = [],
  alertRows = [],
} = {}) {
  const v2Positions = (Array.isArray(positions) ? positions : []).filter((row) => isSimplifiedExitV2Position(row));
  const symbols = Array.from(new Set(v2Positions.map((row) => upper(row.symbol_or_pair_id || row.symbol)).filter(Boolean))).sort();
  const symbolRows = symbols.map((symbol) => {
    const rawPosition = v2Positions.find((row) => upper(row.symbol_or_pair_id || row.symbol) === symbol) || null;
    const position = rawPosition ? summarizePosition(rawPosition) : null;
    return {
      symbol,
      position,
      tp1: collectTp1Drilldown({
        symbol,
        position,
        intents,
        fills,
        alertRows,
      }),
    };
  });

  const actionableRows = symbolRows.filter((row) => Array.isArray(row.tp1.issues) && row.tp1.issues.length > 0);
  return {
    generated_at: nowIso(),
    lookback_hours: LOOKBACK_HOURS,
    exchange: EXCHANGE,
    simplified_exit_v2_symbol_n: symbolRows.length,
    actionable_symbol_n: actionableRows.length,
    actionable_symbols: actionableRows.map((row) => row.symbol),
    issue_code_counts: actionableRows.reduce((acc, row) => {
      for (const issue of row.tp1.issues) {
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
  lines.push("# Simplified Exit V2 TP1 Drilldown");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- lookback_hours: ${report.lookback_hours ?? "N/A"}`);
  lines.push(`- simplified_exit_v2_symbol_n: ${report.simplified_exit_v2_symbol_n ?? 0}`);
  lines.push(`- actionable_symbol_n: ${report.actionable_symbol_n ?? 0}`);
  lines.push("");
  for (const row of Array.isArray(report.symbols) ? report.symbols : []) {
    const position = row.position || {};
    const tp1 = row.tp1 || {};
    lines.push(`## ${row.symbol}`);
    lines.push(`- state=${position.state || "N/A"} tp_p1_done=${position.tp_p1_done === true ? "1" : "0"} trail_active=${position.trail_active === true ? "1" : "0"} pending=${position.tp_p1_pending === true ? "1" : "0"}`);
    lines.push(`- native_tp_armed=${tp1.native_tp_armed ? "1" : "0"} intent_n=${tp1.tp1_intent_n ?? 0} fill_n=${tp1.tp1_fill_n ?? 0} alert_n=${tp1.tp1_alert_n ?? 0}`);
    if (tp1.latest_intent) lines.push(`- latest_intent=${tp1.latest_intent.intent_id || "N/A"} status=${tp1.latest_intent.status || "N/A"} reason=${tp1.latest_intent.status_reason || "N/A"} submit=${tp1.latest_intent.live_submit_state || "N/A"}`);
    if (tp1.latest_fill) lines.push(`- latest_fill=${tp1.latest_fill.fill_id || "N/A"} event=${tp1.latest_fill.event || "N/A"} at=${tp1.latest_fill.created_at || "N/A"}`);
    if (tp1.latest_transition) lines.push(`- latest_transition=${tp1.latest_transition.source || "N/A"} event=${tp1.latest_transition.event || "N/A"} at=${tp1.latest_transition.at || "N/A"}`);
    if (tp1.latest_alert) lines.push(`- latest_alert=${tp1.latest_alert.event || "N/A"} at=${tp1.latest_alert.at || "N/A"}`);
    if (Array.isArray(tp1.issues) && tp1.issues.length) {
      lines.push("- issues:");
      for (const issue of tp1.issues) lines.push(`  - ${issue.code}: ${issue.detail}`);
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

async function fetchRecentTp1Intents(db, sinceIso) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection("order_intents_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      if (upper(row.exchange) !== EXCHANGE) continue;
      if (String(row.created_at || "") < sinceIso) continue;
      if (!isTp1Event(row.event)) continue;
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
  const intents = await fetchRecentTp1Intents(db, sinceIso);
  const outboxRows = await fetchRecentTradeAlertOutboxRows(db, sinceIso);
  const runtimeAuditPath = path.join(process.cwd(), "ops", "runtime", "trade_execution_alert_audit.jsonl");
  const runtimeAuditRows = readJsonl(runtimeAuditPath).filter((row) => {
    const tsMs = toMs(row.ts);
    return Number.isFinite(tsMs) && tsMs >= Date.parse(sinceIso) && upper(row.exchange) === EXCHANGE;
  });

  const report = buildReport({
    positions,
    intents,
    fills,
    alertRows: dedupeAlertRows([...runtimeAuditRows, ...outboxRows]),
  });

  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const latestJson = path.join(outDir, "simplified_exit_v2_tp1_drilldown_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_simplified_exit_v2_tp1_drilldown.md`);
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
    console.error("SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      isSimplifiedExitV2Position,
      isTp1Event,
      parseTransitionEvents,
      dedupeAlertRows,
      summarizePosition,
      summarizeIntent,
      summarizeFill,
      summarizeAlertRow,
      hasNativeTpArmed,
      isTerminalTp1IntentFailure,
      isTp1IntentAcked,
      collectTp1Drilldown,
      buildReport,
    },
  };
}
