#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.FILL_SYNC_ALERT_EVENT_CONSISTENCY_LOOKBACK_HOURS || 24));
const PAGE_SIZE = Math.max(100, Number(process.env.FILL_SYNC_ALERT_EVENT_CONSISTENCY_PAGE_SIZE || 1000));

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function classifyStage(event) {
  const ev = upper(event);
  if (!ev) return "UNKNOWN";
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev === "EXIT_EXTERNAL_SYNC") return "EXTERNAL_SYNC";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return "NON_EXIT";
}

function inferForcedEventFromRefs(...values) {
  for (const value of values) {
    const raw = upper(value);
    if (!raw) continue;
    if (raw === "FORCE_EXIT_HALF" || raw.includes("FORCE_EXIT_HALF")) return "FORCE_EXIT_HALF";
    if (raw === "FORCE_EXIT_ALL" || raw.includes("FORCE_EXIT_ALL")) return "FORCE_EXIT_ALL";
    if (raw === "EXIT_FORCE_ALL" || raw.includes("EXIT_FORCE_ALL")) return "FORCE_EXIT_ALL";
    if (raw === "ACTIVE_NATIVE_STOP_MISSING_FORCE_EXIT") return "FORCE_EXIT_ALL";
  }
  return null;
}

function shouldCompareIntentStage(intentStage) {
  return intentStage === "TP0"
    || intentStage === "TP1"
    || intentStage === "TRAIL"
    || intentStage === "FORCE_EXIT_ALL"
    || intentStage === "FORCE_EXIT_HALF";
}

function stageRank(stage) {
  if (stage === "TP0") return 1;
  if (stage === "TP1") return 2;
  if (stage === "TRAIL") return 3;
  if (stage === "FORCE_EXIT_HALF") return 4;
  if (stage === "FORCE_EXIT_ALL") return 5;
  return 0;
}

function buildIssueRows(fill = {}, intentEvent = null) {
  const rows = [];
  const fillEvent = upper(fill.event);
  const fillStage = classifyStage(fillEvent);
  const canonicalStage = upper(
    (fill.extra && fill.extra.canonical_exit_stage)
    || fill.canonical_exit_stage
    || null
  );
  const intentStage = classifyStage(intentEvent);
  const forcedEvent = inferForcedEventFromRefs(
    intentEvent,
    fill.intent_id,
    fill.signal_id,
    fill.signal_doc_id,
    fill.run_id,
    fill.request_id,
    fill.decision_reason
  );

  if (forcedEvent && classifyStage(forcedEvent) !== fillStage) {
    rows.push({
      code: "FORCE_EXIT_REF_EVENT_MISMATCH",
      expected_event: forcedEvent,
      expected_stage: classifyStage(forcedEvent),
      actual_event: fillEvent,
      actual_stage: fillStage,
      detail: "forced-exit ref 또는 decision_reason 과 fill event stage 불일치",
    });
  }

  if (
    shouldCompareIntentStage(intentStage)
    && fillStage !== "EXTERNAL_SYNC"
    && !(canonicalStage && canonicalStage === fillStage)
    && !(stageRank(fillStage) > 0 && stageRank(intentStage) > 0 && stageRank(fillStage) >= stageRank(intentStage))
    && intentStage !== fillStage
  ) {
    rows.push({
      code: "INTENT_EVENT_STAGE_MISMATCH",
      expected_event: upper(intentEvent),
      expected_stage: intentStage,
      actual_event: fillEvent,
      actual_stage: fillStage,
      detail: "intent.event 기준 stage 와 fill event stage 불일치",
    });
  }

  return rows;
}

async function fetchRecentRows(db) {
  const rows = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_HOURS * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...(doc.data() || {}) };
      if (upper(row.exchange) !== "BINANCEFUT") continue;
      if (String(row.created_at || "") < sinceIso) continue;
      if (classifyStage(row.event) === "NON_EXIT") continue;
      rows.push(row);
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function loadIntentEvent(db, intentId, cache) {
  const id = String(intentId || "").trim();
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  const snap = await db.collection("order_intents_paper").doc(id).get();
  const event = snap.exists ? upper((snap.data() || {}).event) : null;
  cache.set(id, event);
  return event;
}

function buildReport(items = []) {
  const issueRows = [];
  const codeCounts = new Map();
  const symbolCounts = new Map();
  for (const item of items) {
    for (const issue of item.issues) {
      issueRows.push({
        fill_id: item.fill_id,
        symbol: item.symbol,
        created_at: item.created_at,
        intent_id: item.intent_id,
        intent_event: item.intent_event,
        ...issue,
      });
      codeCounts.set(issue.code, (codeCounts.get(issue.code) || 0) + 1);
      symbolCounts.set(item.symbol, (symbolCounts.get(item.symbol) || 0) + 1);
    }
  }
  issueRows.sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
    || String(a.symbol || "").localeCompare(String(b.symbol || ""))
  );
  return {
    generated_at_iso: nowIso(),
    lookback_hours: LOOKBACK_HOURS,
    scanned_fill_n: items.length,
    issue_fill_n: items.filter((item) => item.issues.length > 0).length,
    issue_n: issueRows.length,
    top_issue_codes: Array.from(codeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
    top_symbols: Array.from(symbolCounts.entries()).sort((a, b) => b[1] - a[1]).map(([symbol, count]) => ({ symbol, count })),
    issues: issueRows.slice(0, 200),
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# Fill Sync Alert Event Consistency");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at_iso || "N/A"}`);
  lines.push(`- lookback_hours: ${report.lookback_hours || 0}`);
  lines.push(`- scanned_fill_n: ${report.scanned_fill_n || 0}`);
  lines.push(`- issue_fill_n: ${report.issue_fill_n || 0}`);
  lines.push(`- issue_n: ${report.issue_n || 0}`);
  lines.push("");
  lines.push("## Top Issue Codes");
  if (!Array.isArray(report.top_issue_codes) || !report.top_issue_codes.length) {
    lines.push("- none");
  } else {
    for (const row of report.top_issue_codes) {
      lines.push(`- ${row.code}: ${row.count}`);
    }
  }
  lines.push("");
  lines.push("## Top Issues");
  if (!Array.isArray(report.issues) || !report.issues.length) {
    lines.push("- none");
  } else {
    for (const row of report.issues.slice(0, 50)) {
      lines.push(`- ${row.symbol} | fill=${row.fill_id} | code=${row.code} | actual=${row.actual_event} | expected=${row.expected_event || "N/A"} | at=${row.created_at || "N/A"}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const db = getFirestore();
  const rows = await fetchRecentRows(db);
  const intentCache = new Map();
  const audited = [];
  for (const row of rows) {
    const intentEvent = await loadIntentEvent(db, row.intent_id, intentCache);
    const issues = buildIssueRows(row, intentEvent);
    audited.push({
      fill_id: row.fill_id || row.id,
      symbol: upper(row.symbol) || "UNKNOWN",
      created_at: row.created_at || null,
      intent_id: row.intent_id || null,
      intent_event: intentEvent,
      issues,
    });
  }
  const report = buildReport(audited);
  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "fill_sync_alert_event_consistency_latest.json");
  const mdPath = path.join(outDir, `${isoDate()}_fill_sync_alert_event_consistency.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, buildMarkdown(report), "utf8");
  console.log(JSON.stringify({
    ok: true,
    scanned_fill_n: report.scanned_fill_n,
    issue_fill_n: report.issue_fill_n,
    issue_n: report.issue_n,
    top_issue_codes: report.top_issue_codes,
    top_symbols: report.top_symbols.slice(0, 10),
    output_json: jsonPath,
    output_md: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_FILL_SYNC_ALERT_EVENT_CONSISTENCY_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      classifyStage,
      inferForcedEventFromRefs,
      buildIssueRows,
      buildReport,
      buildMarkdown,
    },
  };
}
