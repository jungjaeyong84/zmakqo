#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const LOOKBACK_HOURS = Math.max(1, Number(process.env.TP1_FAIL_CLOSED_LOOKBACK_HOURS || 24));
const REPEAT_SYMBOL_THRESHOLD = Math.max(2, Number(process.env.TP1_FAIL_CLOSED_REPEAT_SYMBOL_THRESHOLD || 2));
const RUNTIME_PATH = path.join(process.cwd(), "ops", "runtime", "binance_tick_exit_audit.jsonl");
const EXIT_INTEGRITY_PATH = path.join(process.cwd(), "ops", "daily", "binance_exit_integrity_cycle_latest.json");
const TP1_DRILLDOWN_PATH = path.join(process.cwd(), "ops", "daily", "simplified_exit_v2_tp1_drilldown_latest.json");
const LIVE_FLOW_PATH = path.join(process.cwd(), "ops", "daily", "simplified_exit_v2_live_flow_latest.json");
const QUARANTINE_PATH = path.join(process.cwd(), "ops", "daily", "tp1_fail_closed_quarantine_latest.json");

function nowIso() {
  return new Date().toISOString();
}

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
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

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(String(fs.readFileSync(filePath, "utf8") || "null"));
  } catch (_err) {
    return fallback;
  }
}

function toMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildQuarantineCandidates(sortedSymbols = [], threshold = REPEAT_SYMBOL_THRESHOLD) {
  return (Array.isArray(sortedSymbols) ? sortedSymbols : [])
    .filter(([, count]) => Number(count) >= Number(threshold))
    .slice(0, 10)
    .map(([symbol, count]) => {
      const n = Number(count);
      const severe = n >= (Number(threshold) + 2);
      return {
        symbol,
        count: n,
        threshold: Number(threshold),
        severity: severe ? "HIGH" : "MEDIUM",
        quarantine_recommended: severe,
        reason: severe ? "REPEATED_TP1_FAIL_CLOSED_ESCALATED" : "REPEATED_TP1_FAIL_CLOSED_WATCH",
        action: severe
          ? "즉시 symbol quarantine 검토 및 TP1 native/meta trace 수집"
          : "다음 발생 전 TP1 native/meta trace 선수집 및 quarantine 준비",
      };
    });
}

function readSummary(doc = null) {
  if (!doc || typeof doc !== "object") return {};
  return doc.summary && typeof doc.summary === "object" ? doc.summary : doc;
}

function buildIssueCodeMap(report = null, key = "tp1") {
  const symbols = Array.isArray(report && report.symbols) ? report.symbols : [];
  const out = new Map();
  for (const row of symbols) {
    const symbol = String(row && row.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    const section = row && typeof row[key] === "object" ? row[key] : {};
    const issues = Array.isArray(section.issues) ? section.issues : [];
    out.set(symbol, issues.map((item) => String(item && item.code || "").trim().toUpperCase()).filter(Boolean));
  }
  return out;
}

function evaluateQuarantineRelease({
  symbol,
  currentFailClosedCount = 0,
  exitIntegritySummary = null,
  tp1DrilldownReport = null,
  liveFlowReport = null,
} = {}) {
  const blockers = [];
  const currentCount = Number(currentFailClosedCount) || 0;
  const upperSymbol = String(symbol || "").trim().toUpperCase() || null;
  const exitSummary = readSummary(exitIntegritySummary);
  const tp1IssueMap = buildIssueCodeMap(tp1DrilldownReport, "tp1");
  const liveFlowIssueMap = buildIssueCodeMap(liveFlowReport, "flow");

  if (currentCount > 0) blockers.push("CURRENT_FAIL_CLOSED_PRESENT");
  if (Number(exitSummary.tp1_meta_sync_gap_n || 0) > 0) blockers.push("TP1_META_SYNC_GAP_ACTIVE");
  if (upperSymbol && (tp1IssueMap.get(upperSymbol) || []).length > 0) blockers.push("TP1_DRILLDOWN_ACTIONABLE");
  if (upperSymbol && (liveFlowIssueMap.get(upperSymbol) || []).length > 0) blockers.push("LIVE_FLOW_ACTIONABLE");

  return {
    release_ready: blockers.length === 0,
    release_blockers: blockers,
  };
}

function buildEvidencePaths() {
  return {
    tp1_fail_closed_report_path: path.join(process.cwd(), "ops", "daily", "tp1_fail_closed_events_latest.json"),
    exit_integrity_report_path: EXIT_INTEGRITY_PATH,
    tp1_drilldown_report_path: TP1_DRILLDOWN_PATH,
    live_flow_report_path: LIVE_FLOW_PATH,
    quarantine_report_path: QUARANTINE_PATH,
  };
}

function buildLivePolicyQuarantineOverride(report = {}, {
  previousOverride = null,
  exitIntegritySummary = null,
  tp1DrilldownReport = null,
  liveFlowReport = null,
} = {}) {
  const evidencePaths = buildEvidencePaths();
  const candidates = Array.isArray(report.quarantine_candidates) ? report.quarantine_candidates : [];
  const candidateRows = candidates
    .filter((row) => row && row.quarantine_recommended === true)
    .map((row) => ({
      market: String(row.symbol || "").trim().toUpperCase() || null,
      quarantine_reasons: [String(row.reason || "TP1_FAIL_CLOSED_REPEAT_QUARANTINE").trim().toUpperCase() || "TP1_FAIL_CLOSED_REPEAT_QUARANTINE"],
      quarantine_reason: String(row.reason || "TP1_FAIL_CLOSED_REPEAT_QUARANTINE").trim().toUpperCase() || "TP1_FAIL_CLOSED_REPEAT_QUARANTINE",
      quarantine_severity: String(row.severity || "HIGH").trim().toUpperCase() || "HIGH",
      recommended_action: "WATCH_ONLY_NO_EXCLUDE",
      release_action: "CLEAR_AFTER_TP1_FAIL_CLOSED_RECOVERS",
      learning_epoch_active: false,
      quarantine_recommended: true,
      trigger_count: Number(row.count) || 0,
      trigger_threshold: Number(row.threshold) || REPEAT_SYMBOL_THRESHOLD,
      source: "TP1_FAIL_CLOSED",
      source_report: "tp1_fail_closed_events_latest.json",
      action: row.action || null,
      ...evidencePaths,
    }))
    .filter((row) => row.market);
  const currentCountBySymbol = new Map(
    (Array.isArray(report.top_symbols) ? report.top_symbols : []).map((row) => [
      String(row && row.symbol || "").trim().toUpperCase(),
      Number(row && row.count) || 0,
    ])
  );
  const previousRows = Array.isArray(readSummary(previousOverride).by_market)
    ? readSummary(previousOverride).by_market
    : [];
  const merged = new Map();
  for (const row of candidateRows) {
    merged.set(row.market, {
      ...row,
      release_ready: false,
      release_blockers: ["CURRENT_FAIL_CLOSED_PRESENT"],
      release_checked_at: report.generated_at || nowIso(),
    });
  }
  const releasedMarkets = [];
  const releaseBlockedMarkets = [];
  const releaseReadyMarkets = [];
  for (const prev of previousRows) {
    const market = String(prev && prev.market || "").trim().toUpperCase();
    if (!market || merged.has(market) === true) continue;
    const release = evaluateQuarantineRelease({
      symbol: market,
      currentFailClosedCount: currentCountBySymbol.get(market) || 0,
      exitIntegritySummary,
      tp1DrilldownReport,
      liveFlowReport,
    });
    if (release.release_ready) {
      releasedMarkets.push(market);
      releaseReadyMarkets.push(market);
      continue;
    }
    releaseBlockedMarkets.push({
      market,
      release_blockers: release.release_blockers,
    });
    merged.set(market, {
      ...prev,
      market,
      source: String(prev && prev.source || "TP1_FAIL_CLOSED").trim().toUpperCase() || "TP1_FAIL_CLOSED",
      ...evidencePaths,
      release_ready: false,
      release_blockers: release.release_blockers,
      release_checked_at: report.generated_at || nowIso(),
    });
  }
  const rows = Array.from(merged.values())
    .sort((a, b) => Number(b.trigger_count || 0) - Number(a.trigger_count || 0) || String(a.market).localeCompare(String(b.market)));
  const top = rows[0] || null;
  return {
    generated_at: report.generated_at || nowIso(),
    source_path: report.source_path || RUNTIME_PATH,
    status: rows.length ? "TP1_FAIL_CLOSED_QUARANTINE_ACTIVE" : "TP1_FAIL_CLOSED_QUARANTINE_CLEAR",
    enforced: rows.length > 0,
    source: "TP1_FAIL_CLOSED",
    evidence_paths: evidencePaths,
    quarantine_market_n: rows.length,
    top_quarantine_market: top ? top.market : null,
    top_quarantine_reason: top ? top.quarantine_reason : null,
    top_quarantine_severity: top ? top.quarantine_severity : null,
    release_ready_market_n: releaseReadyMarkets.length,
    release_ready_markets: releaseReadyMarkets,
    released_market_n: releasedMarkets.length,
    released_markets: releasedMarkets,
    release_blocked_market_n: releaseBlockedMarkets.length,
    release_blocked_markets: releaseBlockedMarkets,
    top_watch_markets: rows.slice(0, 8).map((row) => ({
      market: row.market,
      quarantine_reason: row.quarantine_reason,
      quarantine_severity: row.quarantine_severity,
      recommended_action: row.recommended_action,
      trigger_count: row.trigger_count,
      release_blockers: Array.isArray(row.release_blockers) ? row.release_blockers : [],
    })),
    by_market: rows,
  };
}

function summarizeTp1FailClosedRows(rows = [], {
  nowMs = Date.now(),
  lookbackHours = LOOKBACK_HOURS,
} = {}) {
  const lookbackMs = Math.max(1, Number(lookbackHours)) * 60 * 60 * 1000;
  const sinceMs = Number(nowMs) - lookbackMs;
  const allowedEvents = new Set([
    "tick_exit_tp1_native_gap_fail_closed",
    "tick_exit_tp1_meta_sync_fail_closed",
  ]);
  const filtered = (Array.isArray(rows) ? rows : [])
    .filter((row) => allowedEvents.has(String(row && row.event || "").trim()))
    .map((row) => ({
      event: String(row && row.event || "").trim(),
      ts: row && row.ts ? String(row.ts) : null,
      ts_ms: toMs(row && row.ts),
      symbol: String(row && row.symbol || "").trim().toUpperCase() || null,
      tf: String(row && row.tf || "").trim() || null,
      issue_codes: Array.isArray(row && row.issue_codes) ? row.issue_codes.slice() : [],
      request_id: row && row.request_id ? String(row.request_id) : null,
      repair_reason: row && row.repair_reason ? String(row.repair_reason) : null,
      dispatch_ok: row && row.dispatch_ok === true,
    }))
    .filter((row) => Number.isFinite(row.ts_ms) && row.ts_ms >= sinceMs)
    .sort((a, b) => Number(b.ts_ms || 0) - Number(a.ts_ms || 0));
  const symbolCounts = new Map();
  for (const row of filtered) {
    const key = row.symbol || "UNKNOWN";
    symbolCounts.set(key, (symbolCounts.get(key) || 0) + 1);
  }
  const sortedSymbols = Array.from(symbolCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const quarantineCandidates = buildQuarantineCandidates(sortedSymbols, REPEAT_SYMBOL_THRESHOLD);
  return {
    generated_at: nowIso(),
    lookback_hours: Math.round(lookbackMs / (60 * 60 * 1000)),
    repeat_symbol_threshold: REPEAT_SYMBOL_THRESHOLD,
    source_path: RUNTIME_PATH,
    total_fail_closed_n: filtered.length,
    tp1_native_gap_fail_closed_n: filtered.filter((row) => row.event === "tick_exit_tp1_native_gap_fail_closed").length,
    tp1_meta_sync_fail_closed_n: filtered.filter((row) => row.event === "tick_exit_tp1_meta_sync_fail_closed").length,
    dispatch_fail_n: filtered.filter((row) => row.dispatch_ok !== true).length,
    max_symbol_fail_closed_n: sortedSymbols.length ? Number(sortedSymbols[0][1]) : 0,
    top_symbols: sortedSymbols
      .slice(0, 10)
      .map(([symbol, count]) => ({ symbol, count })),
    repeat_symbol_n: sortedSymbols.filter(([, count]) => Number(count) >= REPEAT_SYMBOL_THRESHOLD).length,
    repeat_symbols: sortedSymbols
      .filter(([, count]) => Number(count) >= REPEAT_SYMBOL_THRESHOLD)
      .slice(0, 10)
      .map(([symbol, count]) => ({ symbol, count })),
    quarantine_candidate_n: quarantineCandidates.length,
    quarantine_candidates: quarantineCandidates,
    recent_rows: filtered.slice(0, 20),
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  lines.push("# TP1 Fail-Closed Events");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- lookback_hours: ${report.lookback_hours ?? "N/A"}`);
  lines.push(`- total_fail_closed_n: ${report.total_fail_closed_n ?? 0}`);
  lines.push(`- tp1_native_gap_fail_closed_n: ${report.tp1_native_gap_fail_closed_n ?? 0}`);
  lines.push(`- tp1_meta_sync_fail_closed_n: ${report.tp1_meta_sync_fail_closed_n ?? 0}`);
  lines.push(`- dispatch_fail_n: ${report.dispatch_fail_n ?? 0}`);
  lines.push(`- repeat_symbol_threshold: ${report.repeat_symbol_threshold ?? REPEAT_SYMBOL_THRESHOLD}`);
  lines.push(`- repeat_symbol_n: ${report.repeat_symbol_n ?? 0}`);
  lines.push(`- max_symbol_fail_closed_n: ${report.max_symbol_fail_closed_n ?? 0}`);
  lines.push(`- quarantine_candidate_n: ${report.quarantine_candidate_n ?? 0}`);
  lines.push("");
  if (Array.isArray(report.top_symbols) && report.top_symbols.length) {
    lines.push("## Top Symbols");
    for (const row of report.top_symbols) {
      lines.push(`- ${row.symbol}: ${row.count}`);
    }
    lines.push("");
  }
  if (Array.isArray(report.repeat_symbols) && report.repeat_symbols.length) {
    lines.push("## Repeat Symbols");
    for (const row of report.repeat_symbols) {
      lines.push(`- ${row.symbol}: ${row.count}`);
    }
    lines.push("");
  }
  if (Array.isArray(report.quarantine_candidates) && report.quarantine_candidates.length) {
    lines.push("## Quarantine Candidates");
    for (const row of report.quarantine_candidates) {
      lines.push(`- ${row.symbol}: ${row.count} severity=${row.severity} recommended=${row.quarantine_recommended ? "1" : "0"} action=${row.action}`);
    }
    lines.push("");
  }
  lines.push("## Recent Rows");
  if (Array.isArray(report.recent_rows) && report.recent_rows.length) {
    for (const row of report.recent_rows) {
      lines.push(`- ${row.ts || "N/A"} ${row.symbol || "UNKNOWN"} ${row.event} dispatch_ok=${row.dispatch_ok === true ? "1" : "0"} issues=${Array.isArray(row.issue_codes) && row.issue_codes.length ? row.issue_codes.join(",") : "NONE"}`);
    }
  } else {
    lines.push("- none");
  }
  return `${lines.join("\n")}\n`;
}

function buildOverrideMarkdown(report = {}) {
  const lines = [];
  lines.push("# TP1 Fail-Closed Quarantine Override");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- status: ${report.status || "N/A"}`);
  lines.push(`- quarantine_market_n: ${report.quarantine_market_n ?? 0}`);
  lines.push(`- release_ready_market_n: ${report.release_ready_market_n ?? 0}`);
  lines.push(`- released_market_n: ${report.released_market_n ?? 0}`);
  lines.push(`- release_blocked_market_n: ${report.release_blocked_market_n ?? 0}`);
  lines.push("");
  if (Array.isArray(report.by_market) && report.by_market.length) {
    lines.push("## Active Quarantine Markets");
    for (const row of report.by_market) {
      lines.push(`- ${row.market}: reason=${row.quarantine_reason || "N/A"} severity=${row.quarantine_severity || "N/A"} trigger=${row.trigger_count ?? "N/A"}/${row.trigger_threshold ?? "N/A"} blockers=${Array.isArray(row.release_blockers) && row.release_blockers.length ? row.release_blockers.join(",") : "NONE"}`);
    }
    lines.push("");
  }
  if (report.evidence_paths && typeof report.evidence_paths === "object") {
    lines.push("## Evidence Paths");
    lines.push(`- tp1_fail_closed_report_path: ${report.evidence_paths.tp1_fail_closed_report_path || "N/A"}`);
    lines.push(`- exit_integrity_report_path: ${report.evidence_paths.exit_integrity_report_path || "N/A"}`);
    lines.push(`- tp1_drilldown_report_path: ${report.evidence_paths.tp1_drilldown_report_path || "N/A"}`);
    lines.push(`- live_flow_report_path: ${report.evidence_paths.live_flow_report_path || "N/A"}`);
    lines.push(`- quarantine_report_path: ${report.evidence_paths.quarantine_report_path || "N/A"}`);
    lines.push("");
  }
  if (Array.isArray(report.released_markets) && report.released_markets.length) {
    lines.push("## Released Markets");
    for (const market of report.released_markets) lines.push(`- ${market}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const rows = readJsonl(RUNTIME_PATH);
  const report = summarizeTp1FailClosedRows(rows);
  const previousOverride = readJsonSafe(QUARANTINE_PATH, null);
  const exitIntegritySummary = readJsonSafe(EXIT_INTEGRITY_PATH, null);
  const tp1DrilldownReport = readJsonSafe(TP1_DRILLDOWN_PATH, null);
  const liveFlowReport = readJsonSafe(LIVE_FLOW_PATH, null);
  const quarantineOverride = buildLivePolicyQuarantineOverride(report, {
    previousOverride,
    exitIntegritySummary,
    tp1DrilldownReport,
    liveFlowReport,
  });
  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const latestJson = path.join(outDir, "tp1_fail_closed_events_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_tp1_fail_closed_events.md`);
  const quarantineLatestJson = path.join(outDir, "tp1_fail_closed_quarantine_latest.json");
  const quarantineLatestMd = path.join(outDir, "tp1_fail_closed_quarantine_latest.md");
  fs.writeFileSync(latestJson, `${JSON.stringify({ summary: report }, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMd, buildMarkdown(report), "utf8");
  fs.writeFileSync(quarantineLatestJson, `${JSON.stringify({ summary: quarantineOverride }, null, 2)}\n`, "utf8");
  fs.writeFileSync(quarantineLatestMd, buildOverrideMarkdown(quarantineOverride), "utf8");
  console.log(JSON.stringify({
    ok: true,
    total_fail_closed_n: report.total_fail_closed_n,
    tp1_native_gap_fail_closed_n: report.tp1_native_gap_fail_closed_n,
    tp1_meta_sync_fail_closed_n: report.tp1_meta_sync_fail_closed_n,
    dispatch_fail_n: report.dispatch_fail_n,
    repeat_symbol_n: report.repeat_symbol_n,
    max_symbol_fail_closed_n: report.max_symbol_fail_closed_n,
    quarantine_candidate_n: report.quarantine_candidate_n,
    output_json: latestJson,
    output_md: datedMd,
    quarantine_output_json: quarantineLatestJson,
    quarantine_market_n: quarantineOverride.quarantine_market_n,
    released_market_n: quarantineOverride.released_market_n,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_TP1_FAIL_CLOSED_EVENTS_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      readJsonl,
      readJsonSafe,
      buildIssueCodeMap,
      evaluateQuarantineRelease,
      buildQuarantineCandidates,
      buildLivePolicyQuarantineOverride,
      summarizeTp1FailClosedRows,
      buildMarkdown,
      buildOverrideMarkdown,
    },
  };
}
