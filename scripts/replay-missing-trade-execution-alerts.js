#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { sendTradeExecutionAlert } = require("../src/services/tradeExecutionAlert");
const { __test: crossAuditTest } = require("./report-trade-execution-alert-cross-audit");

const REPO_ROOT = path.resolve(__dirname, "..");
const CROSS_AUDIT_PATH = path.join(REPO_ROOT, "ops", "daily", "trade_execution_alert_cross_audit_latest.json");
const TELEGRAM_LOG_PATH = path.join(REPO_ROOT, "noye", "telegram_send.log");
const MATCH_WINDOW_MS = Math.max(60_000, Number(process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_MATCH_WINDOW_MS || 15 * 60 * 1000));

function trimOrNull(value) {
  return String(value || "").trim() || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildReplayIssueGroupKey(issue = {}) {
  return [
    upper(issue.symbol) || "UNKNOWN",
    crossAuditTest.normalizeComparableEvent(issue.event) || upper(issue.event) || "UNKNOWN",
    trimOrNull(issue.fill_created_at) || "NO_TS",
  ].join("|");
}

function selectReplayIssues(crossAudit = {}, { includeNonActionable = false } = {}) {
  const primary = includeNonActionable === true
    ? (Array.isArray(crossAudit.issues) ? crossAudit.issues : [])
    : (Array.isArray(crossAudit.actionable_issues) && crossAudit.actionable_issues.length
      ? crossAudit.actionable_issues
      : (Array.isArray(crossAudit.issues) ? crossAudit.issues : []));
  return primary.filter((issue) => trimOrNull(issue && issue.fill_id));
}

function groupReplayIssues(issues = []) {
  const grouped = [];
  const seen = new Set();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const key = buildReplayIssueGroupKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    grouped.push({
      key,
      issue,
    });
  }
  return grouped;
}

function deriveExitRules(fill = {}) {
  const base = fill.exit_rules && typeof fill.exit_rules === "object"
    ? { ...fill.exit_rules }
    : ((fill.exitRules && typeof fill.exitRules === "object") ? { ...fill.exitRules } : {});
  const feat = fill.features_json && typeof fill.features_json === "object" ? fill.features_json : {};
  if (!Number.isFinite(Number(base.SL)) && Number.isFinite(Number(feat.ev_gate_sl_pct))) {
    base.SL = -(Math.abs(Number(feat.ev_gate_sl_pct)) / 100);
  }
  if (!Number.isFinite(Number(base.TP_P1)) && Number.isFinite(Number(feat.ev_gate_tp1_pct))) {
    base.TP_P1 = Math.abs(Number(feat.ev_gate_tp1_pct)) / 100;
  }
  if (!Number.isFinite(Number(base.TRAIL_R_MULTIPLE)) && Number.isFinite(Number(feat.ev_gate_trail_r_multiple)) && Number(feat.ev_gate_trail_r_multiple) > 0) {
    base.TRAIL_R_MULTIPLE = Number(feat.ev_gate_trail_r_multiple);
  }
  if (!Number.isFinite(Number(base.TRAIL_PCT)) && Number.isFinite(Number(feat.ev_gate_trail_pct)) && Number(feat.ev_gate_trail_pct) > 0) {
    base.TRAIL_PCT = Math.abs(Number(feat.ev_gate_trail_pct)) / 100;
  }
  if (!Number.isFinite(Number(base.RUNNER_MIN_PROFIT_PCT)) && Number.isFinite(Number(feat.ev_gate_runner_min_profit_pct))) {
    base.RUNNER_MIN_PROFIT_PCT = Math.abs(Number(feat.ev_gate_runner_min_profit_pct)) / 100;
  }
  if (!Number.isFinite(Number(base.BE_PCT)) && Number.isFinite(Number(feat.ev_gate_be_pct))) {
    base.BE_PCT = Math.abs(Number(feat.ev_gate_be_pct)) / 100;
  }
  if (!Number.isFinite(Number(base.TP_P0_QTY)) && Number.isFinite(Number(feat.ev_gate_tp0_qty_ratio))) {
    base.TP_P0_QTY = Number(feat.ev_gate_tp0_qty_ratio);
  }
  if (!Number.isFinite(Number(base.TP_P1_QTY)) && Number.isFinite(Number(feat.ev_gate_tp1_qty_ratio))) {
    base.TP_P1_QTY = Number(feat.ev_gate_tp1_qty_ratio);
  }
  return Object.keys(base).length ? base : null;
}

function derivePositionSideBefore(fill = {}) {
  return upper(
    fill.position_side_before
    || fill.position_side
    || fill.external_position_side
    || (fill.features_json && fill.features_json.position_side)
    || null
  );
}

function derivePositionSideAfter(fill = {}) {
  return upper(
    fill.position_side_after
    || (upper(fill.event) === "LONG" ? "LONG" : null)
    || (upper(fill.event) === "SHORT" ? "SHORT" : null)
    || null
  );
}

function deriveIntent(fill = {}) {
  const ev = upper(fill.event);
  if (!ev) return null;
  if (ev.startsWith("EXIT_") || ev === "FORCE_EXIT_ALL" || ev === "FORCE_EXIT_HALF" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") {
    return "EXIT";
  }
  const rawIntent = upper(fill.intent);
  if (rawIntent === "ENTRY" || rawIntent === "ADD" || rawIntent === "EXIT") return rawIntent;
  if (ev === "LONG" || ev === "SHORT") return "ENTRY";
  return null;
}

function buildReplayPayload(fill = {}, fillId = null, tradeAlertDedupeKey = null) {
  const payload = {
    exchange: upper(fill.exchange) || "BINANCEFUT",
    symbol: upper(fill.symbol),
    event: upper(fill.event),
    side: upper(fill.side),
    intent: deriveIntent(fill),
    executionMode: upper(fill.execution_mode) || "LIVE",
    notional: toFinite(fill.notional ?? fill.notional_krw),
    execQtyBase: toFinite(fill.exec_qty_base),
    execPrice: toFinite(fill.exec_price),
    closeRatio: toFinite(fill.close_ratio ?? fill.qty_fraction ?? fill.qty_pct),
    qtyPct: toFinite(fill.qty_pct),
    fullExit: toFinite(fill.close_ratio ?? fill.qty_fraction ?? fill.qty_pct) >= 0.999,
    realizedPnl: toFinite(fill.external_realized_pnl)
      ?? ((fill.extra && Number.isFinite(Number(fill.extra.external_realized_pnl))) ? Number(fill.extra.external_realized_pnl) : null),
    appliedLeverage: toFinite(fill.applied_leverage ?? fill.leverage_applied),
    leverageReason: trimOrNull(fill.leverage_reason),
    positionSideBefore: derivePositionSideBefore(fill),
    positionSideAfter: derivePositionSideAfter(fill),
    exitRules: deriveExitRules(fill),
    reason: trimOrNull(fill.decision_reason),
    decisionReason: trimOrNull(fill.decision_reason),
    entryEventId: trimOrNull(fill.entry_event_id),
    entrySignalType: trimOrNull(fill.entry_signal_type),
    signalId: trimOrNull(fill.signal_id),
    intentId: trimOrNull(fill.intent_id),
    runId: trimOrNull(fill.run_id),
    rawEvidenceEvent: trimOrNull(fill.raw_evidence_event),
    canonicalExitEvent: trimOrNull(fill.canonical_exit_event),
    canonicalExitStage: trimOrNull(fill.canonical_exit_stage),
    canonicalTransitionEvent: trimOrNull(fill.canonical_primary_transition_event),
    canonicalTransitionEvents: Array.isArray(fill.canonical_transition_events) ? fill.canonical_transition_events : [],
    canonicalExitChainKey: trimOrNull(fill.canonical_exit_chain_key),
    contractEntryQtyAbs: toFinite(fill.contract_entry_qty_abs),
    contractTp0AllowedAbs: toFinite(fill.contract_tp0_allowed_abs),
    contractTp0ConsumedAbs: toFinite(fill.contract_tp0_consumed_abs),
    contractTp1AllowedAbs: toFinite(fill.contract_tp1_allowed_abs),
    contractTp1ConsumedAbs: toFinite(fill.contract_tp1_consumed_abs),
    contractRunnerAllowedAbs: toFinite(fill.contract_runner_allowed_abs),
    contractRunnerRemainingAbs: toFinite(fill.contract_runner_remaining_abs),
    contractTrailConsumedAbs: toFinite(fill.contract_trail_consumed_abs),
    contractObservedQtyAbs: toFinite(fill.contract_observed_qty_abs),
    features: cloneJson(fill.features_json) || {},
    sourceFillId: trimOrNull(fillId || fill.fill_id),
    tradeAlertDedupeKey: trimOrNull(tradeAlertDedupeKey),
    replayReason: "TRADE_EXECUTION_ALERT_MISSING_FILL_REPLAY",
  };
  return payload;
}

function hasTelegramTradeEvidence(fill = {}, telegramRows = []) {
  const fillMs = Date.parse(String(fill.created_at || ""));
  if (!Number.isFinite(fillMs)) return false;
  const symbol = upper(fill.symbol);
  const event = upper(fill.event);
  return telegramRows.some((row) => {
    const tsMs = Date.parse(String(row.ts || ""));
    if (!Number.isFinite(tsMs) || Math.abs(tsMs - fillMs) > MATCH_WINDOW_MS) return false;
    const text = String(row.text || "");
    return text.includes(symbol) && text.includes(`이벤트: ${event}`);
  });
}

async function loadFill(db, fillId) {
  const snap = await db.collection("fills_paper").doc(String(fillId)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

async function main() {
  const apply = String(process.env.APPLY || "").trim() === "1";
  const includeNonActionable = String(process.env.REPLAY_INCLUDE_NON_ACTIONABLE || "").trim() === "1";
  const db = getFirestore();
  const crossAudit = readJson(CROSS_AUDIT_PATH);
  if (!crossAudit || !Array.isArray(crossAudit.issues)) {
    throw new Error(`CROSS_AUDIT_REPORT_MISSING:${CROSS_AUDIT_PATH}`);
  }
  const telegramRows = crossAuditTest.parseTelegramTradeAlertRows(
    fs.existsSync(TELEGRAM_LOG_PATH) ? fs.readFileSync(TELEGRAM_LOG_PATH, "utf8") : "",
    0
  );
  const rows = [];
  const candidateIssues = selectReplayIssues(crossAudit, { includeNonActionable });
  const groupedIssues = groupReplayIssues(candidateIssues);
  for (const grouped of groupedIssues) {
    const issue = grouped.issue;
    const fillId = trimOrNull(issue && issue.fill_id);
    if (!fillId) continue;
    const fill = await loadFill(db, fillId);
    if (!fill) {
      rows.push({ fill_id: fillId, replay_group_key: grouped.key, status: "SKIP", reason: "FILL_NOT_FOUND" });
      continue;
    }
    if (hasTelegramTradeEvidence(fill, telegramRows)) {
      rows.push({
        fill_id: fillId,
        replay_group_key: grouped.key,
        symbol: upper(fill.symbol),
        event: upper(fill.event),
        status: "SKIP",
        reason: "EXISTING_TELEGRAM_EVIDENCE",
      });
      continue;
    }
    const payload = buildReplayPayload(fill, fillId, grouped.key);
    if (!apply) {
      rows.push({
        fill_id: fillId,
        replay_group_key: grouped.key,
        symbol: payload.symbol,
        event: payload.event,
        status: "DRY_RUN",
        reason: null,
        title_hint: `${payload.symbol} ${payload.event}`,
      });
      continue;
    }
    const result = await sendTradeExecutionAlert(payload);
    rows.push({
      fill_id: fillId,
      replay_group_key: grouped.key,
      symbol: payload.symbol,
      event: payload.event,
      status: result && result.ok === true ? "SENT" : (result && result.skipped === true ? "SKIP" : "FAILED"),
      reason: result && result.reason ? result.reason : null,
      outbox_id: result && result.outboxId ? result.outboxId : null,
    });
  }
  console.log(JSON.stringify({
    ok: true,
    apply,
    issue_n: Array.isArray(crossAudit.issues) ? crossAudit.issues.length : 0,
    candidate_issue_n: candidateIssues.length,
    replay_group_n: groupedIssues.length,
    include_non_actionable: includeNonActionable,
    processed_n: rows.length,
    sent_n: rows.filter((row) => row.status === "SENT").length,
    dry_run_n: rows.filter((row) => row.status === "DRY_RUN").length,
    skipped_n: rows.filter((row) => row.status === "SKIP").length,
    failed_n: rows.filter((row) => row.status === "FAILED").length,
    rows,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPLAY_MISSING_TRADE_EXECUTION_ALERTS_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      buildReplayIssueGroupKey,
      selectReplayIssues,
      groupReplayIssues,
    },
  };
}
