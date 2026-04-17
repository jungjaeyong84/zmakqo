#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");
const { parseErrorCount } = require("./lib/report-metrics");
const { fetchRuntimeErrorSummary24h } = require("./lib/runtime-error-counter");
const { recordOperationalRuntimeState } = require("../src/storage/operationalRuntimeStates");
const { listExchangePositionReadViews } = require("../src/services/positionReadModel");

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function pct(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value / base) * 100;
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, data: JSON.parse(raw), raw };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      data: null,
      raw: "",
    };
  }
}

function isLearningEpochActive(summary = {}) {
  if (!summary || typeof summary !== "object") return false;
  if (summary.active === true) return true;
  const status = String(summary.status || "").trim().toUpperCase();
  return status.includes("EPOCH_ACTIVE");
}

function resolveRelaxedCostLimitPct({
  repoRoot,
  baseCostLimitPct,
} = {}) {
  const out = {
    cost_limit_pct: baseCostLimitPct,
    relaxed: false,
    learning_epoch_active: false,
    microstructure_active: false,
    reason: "BASE_LIMIT",
  };
  const objectiveRetrospective = readJsonSafe(path.join(repoRoot, "ops", "daily", "objective_retrospective_latest.json"));
  const learningEpoch = readJsonSafe(path.join(repoRoot, "ops", "daily", "best_self_evolution_server_primary_learning_epoch_latest.json"));
  const display = objectiveRetrospective.ok && objectiveRetrospective.data && objectiveRetrospective.data.display && typeof objectiveRetrospective.data.display === "object"
    ? objectiveRetrospective.data.display
    : {};
  const daily = display.periods && display.periods.DAILY && typeof display.periods.DAILY === "object"
    ? display.periods.DAILY
    : {};
  const micro = daily.execution_microstructure && typeof daily.execution_microstructure === "object"
    ? daily.execution_microstructure
    : (display.execution_microstructure && typeof display.execution_microstructure === "object" ? display.execution_microstructure : {});
  const tp0HitRate = toNum(micro.tp0_hit_rate, null);
  const learningSummary = learningEpoch.ok && learningEpoch.data && typeof learningEpoch.data === "object"
    ? (learningEpoch.data.summary && typeof learningEpoch.data.summary === "object" ? learningEpoch.data.summary : learningEpoch.data)
    : {};
  const learningEpochActive = isLearningEpochActive(learningSummary);
  const microstructureActive = Number.isFinite(tp0HitRate) && tp0HitRate >= toNum(process.env.DAILY_COST_LIMIT_RELAX_TP0_HIT_RATE_MIN, 0.75);
  if (!learningEpochActive || !microstructureActive) {
    out.learning_epoch_active = learningEpochActive;
    out.microstructure_active = microstructureActive;
    out.reason = learningEpochActive ? "MICROSTRUCTURE_NOT_READY" : "LEARNING_EPOCH_INACTIVE";
    return out;
  }
  const relaxedLimit = toNum(process.env.DAILY_COST_LIMIT_PCT_LEARNING_EPOCH, 0.4);
  out.learning_epoch_active = true;
  out.microstructure_active = true;
  out.relaxed = Number.isFinite(relaxedLimit) && relaxedLimit > baseCostLimitPct;
  out.cost_limit_pct = out.relaxed ? relaxedLimit : baseCostLimitPct;
  out.reason = out.relaxed ? "LEARNING_EPOCH_MICROSTRUCTURE_RELAX" : "BASE_LIMIT";
  return out;
}

function pickDocs(input) {
  if (Array.isArray(input)) return input.slice();
  if (input && Array.isArray(input.docs)) return input.docs.slice();
  if (input && Array.isArray(input.rows)) return input.rows.slice();
  if (input && Array.isArray(input.data)) return input.data.slice();
  return [];
}

function docDateKey(row) {
  const candidates = [
    row && row.created_at,
    row && row.updated_at,
    row && row.closed_at,
    row && row.bar_close_time_utc_ms,
  ];
  for (const value of candidates) {
    const key = kstDateKey(value);
    if (key) return key;
  }
  return null;
}

function countDocsForDate(input, dateKey, predicate = null) {
  let count = 0;
  for (const row of pickDocs(input)) {
    if (docDateKey(row) !== dateKey) continue;
    if (typeof predicate === "function" && !predicate(row)) continue;
    count += 1;
  }
  return count;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickLatestCycleFile(dirPath, regex) {
  if (!fs.existsSync(dirPath)) return null;
  const names = fs.readdirSync(dirPath);
  let best = null;
  for (const name of names) {
    const match = String(name).match(regex);
    if (!match) continue;
    const cycle = Number(match[1]);
    if (!Number.isFinite(cycle)) continue;
    if (!best || cycle > best.cycle || (cycle === best.cycle && name > best.name)) {
      best = { name, cycle };
    }
  }
  return best ? path.join(dirPath, best.name) : null;
}

function findPairCount(pairs, key) {
  for (const row of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (String(row[0]) === key) return toNum(row[1], 0);
  }
  return 0;
}

function sumPairPrefix(pairs, prefix) {
  let total = 0;
  for (const row of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (String(row[0]).startsWith(prefix)) total += toNum(row[1], 0);
  }
  return total;
}

function loadExecutionHealth({ repoRoot, dateKey }) {
  const dailyDir = path.join(repoRoot, "ops", "daily");
  const recentDir = path.join(dailyDir, "cache", "firestore_recent");
  const escapedDate = escapeRegex(dateKey);
  const signalsPath = pickLatestCycleFile(
    dailyDir,
    new RegExp(`^${escapedDate}_tp1_trailing_signals_check_cycle(\\d+)\\.json$`)
  );
  const auditPath = pickLatestCycleFile(
    dailyDir,
    new RegExp(`^${escapedDate}_fill_signal_audit_cycle(\\d+)_binancefut\\.json$`)
  );

  const out = {
    available: false,
    signals_source_path: signalsPath || null,
    audit_source_path: auditPath || null,
    recent_signals_source_path: path.join(recentDir, "signals.json"),
    recent_intents_source_path: path.join(recentDir, "order_intents_paper.json"),
    recent_fills_source_path: path.join(recentDir, "fills_paper.json"),
    recent_trades_source_path: path.join(recentDir, "trades_paper.json"),
    firestore_dns_ok: null,
    firestore_dns_host: null,
    signals_count: null,
    drops_count: null,
    drop_tp1_pending_count: null,
    tp1_signal_count: null,
    trailing_signal_count: null,
    intents_count: null,
    fills_count: null,
    trades_count: null,
    audit_issue_count: null,
    qty_pct_non_positive_count: null,
    duplicate_signal_fill_count: null,
  };

  if (signalsPath) {
    const signalsRead = readJsonSafe(signalsPath);
    if (signalsRead.ok && signalsRead.data && typeof signalsRead.data === "object") {
      const s = signalsRead.data;
      out.available = true;
      out.firestore_dns_ok = s.dns_precheck && typeof s.dns_precheck === "object"
        ? s.dns_precheck.ok === true
        : null;
      out.firestore_dns_host = s.dns_precheck && s.dns_precheck.host
        ? String(s.dns_precheck.host)
        : null;
      out.signals_count = toNum(s.signals, null);
      out.drops_count = toNum(s.drops, null);
      out.drop_tp1_pending_count = findPairCount(s.drop_reasons, "DROP_TP_P1_PENDING");
      out.tp1_signal_count = sumPairPrefix(s.events, "EXIT_TP_P1");
      out.trailing_signal_count = sumPairPrefix(s.events, "EXIT_TRAIL");
    }
  }

  if (auditPath) {
    const auditRead = readJsonSafe(auditPath);
    if (auditRead.ok && auditRead.data && typeof auditRead.data === "object") {
      const summary = auditRead.data.summary && typeof auditRead.data.summary === "object"
        ? auditRead.data.summary
        : {};
      out.available = true;
      out.fills_count = toNum(summary.fills_count, null);
      out.audit_issue_count = toNum(summary.issue_count, null);
      out.qty_pct_non_positive_count = toNum(summary.qty_pct_non_positive_count, null);
      out.duplicate_signal_fill_count = toNum(summary.duplicate_signal_fill_count, null);
    }
  }

  const recentSignalsRead = readJsonSafe(out.recent_signals_source_path);
  const recentIntentsRead = readJsonSafe(out.recent_intents_source_path);
  const recentFillsRead = readJsonSafe(out.recent_fills_source_path);
  const recentTradesRead = readJsonSafe(out.recent_trades_source_path);
  const recentSignalsCount = recentSignalsRead.ok ? countDocsForDate(recentSignalsRead.data, dateKey) : null;
  const recentIntentsCount = recentIntentsRead.ok ? countDocsForDate(recentIntentsRead.data, dateKey) : null;
  const recentFillsCount = recentFillsRead.ok ? countDocsForDate(recentFillsRead.data, dateKey) : null;
  const recentTradesCount = recentTradesRead.ok ? countDocsForDate(recentTradesRead.data, dateKey) : null;

  if (
    Number.isFinite(recentSignalsCount)
    || Number.isFinite(recentIntentsCount)
    || Number.isFinite(recentFillsCount)
    || Number.isFinite(recentTradesCount)
  ) {
    out.available = true;
    if (!Number.isFinite(out.signals_count)) out.signals_count = recentSignalsCount;
    if (!Number.isFinite(out.intents_count)) out.intents_count = recentIntentsCount;
    if (!Number.isFinite(out.fills_count)) out.fills_count = recentFillsCount;
    if (!Number.isFinite(out.trades_count)) out.trades_count = recentTradesCount;
  }

  return out;
}

function loadPositionReadModelCutoverHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "position_read_model_cutover_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      latest_ready: false,
      dominant_status: "MISSING",
      query_blockers: ["ARTIFACT_MISSING"],
    };
  }
  const summary = read.data.summary && typeof read.data.summary === "object"
    ? read.data.summary
    : {};
  return {
    available: true,
    source_path: latestPath,
    latest_ready: summary.latest_ready === true,
    dominant_status: String(summary.dominant_status || "").trim().toUpperCase() || "UNKNOWN",
    query_blockers: Array.isArray(summary.query_blockers) ? summary.query_blockers.slice() : [],
    latest_count: toNum(summary.position_read_model_latest_count, null),
    positions_count: toNum(summary.positions_paper_count, null),
    events_count: toNum(summary.position_events_count, null),
    timeline_count: toNum(summary.unified_position_timeline_count, null),
    latest_coverage_pct: toNum(summary.latest_coverage_pct, null),
    timeline_coverage_pct: toNum(summary.timeline_coverage_pct, null),
  };
}

function loadFillSyncAlertDuplicationHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "fill_sync_alert_duplication_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      duplicate_group_n: null,
      suppressed_alert_estimate_n: null,
      raw_external_exit_fill_n: null,
      top_duplicate_groups: [],
    };
  }
  return {
    available: true,
    source_path: latestPath,
    duplicate_group_n: toNum(read.data.duplicate_group_n, null),
    suppressed_alert_estimate_n: toNum(read.data.suppressed_alert_estimate_n, null),
    raw_external_exit_fill_n: toNum(read.data.raw_external_exit_fill_n, null),
    top_duplicate_groups: Array.isArray(read.data.top_duplicate_groups) ? read.data.top_duplicate_groups.slice(0, 10) : [],
  };
}

function loadFillSyncAlertEventConsistencyHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "fill_sync_alert_event_consistency_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      scanned_fill_n: null,
      issue_fill_n: null,
      issue_n: null,
      top_issue_codes: [],
      top_symbols: [],
    };
  }
  return {
    available: true,
    source_path: latestPath,
    scanned_fill_n: toNum(read.data.scanned_fill_n, null),
    issue_fill_n: toNum(read.data.issue_fill_n, null),
    issue_n: toNum(read.data.issue_n, null),
    top_issue_codes: Array.isArray(read.data.top_issue_codes) ? read.data.top_issue_codes.slice(0, 10) : [],
    top_symbols: Array.isArray(read.data.top_symbols) ? read.data.top_symbols.slice(0, 10) : [],
  };
}

function loadTradeExecutionAlertCrossAuditHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "trade_execution_alert_cross_audit_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      coverage_ready: false,
      fill_n: null,
      matched_fill_n: null,
      missing_alert_fill_n: null,
      unmatched_alert_n: null,
      telegram_trade_alert_row_n: null,
      audit_trade_alert_row_n: null,
    };
  }
  return {
    available: true,
    source_path: latestPath,
    coverage_ready: read.data.coverage_ready === true,
    fill_n: toNum(read.data.fill_n, null),
    matched_fill_n: toNum(read.data.matched_fill_n, null),
    missing_alert_fill_n: toNum(read.data.missing_alert_fill_n, null),
    unmatched_alert_n: toNum(read.data.unmatched_alert_n, null),
    telegram_trade_alert_row_n: toNum(read.data.telegram_trade_alert_row_n, null),
    audit_trade_alert_row_n: toNum(read.data.audit_trade_alert_row_n, null),
  };
}

function loadActiveExitWatchdogHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "binance_active_exit_watchdog_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      issue_symbol_n: null,
      repaired_symbol_n: null,
      issue_symbols: [],
      status: "MISSING",
    };
  }
  return {
    available: true,
    source_path: latestPath,
    issue_symbol_n: toNum(read.data.issue_symbol_n, null),
    repaired_symbol_n: toNum(read.data.repaired_symbol_n, null),
    issue_symbols: Array.isArray(read.data.issue_symbols) ? read.data.issue_symbols.slice(0, 20) : [],
    status: String(read.data.status || "").trim().toUpperCase() || "UNKNOWN",
  };
}

function loadTrailRunnerFloorAuditHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "trail_runner_floor_audit_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      violation_n: null,
      violation_total_n: null,
      live_bar_runner_violation_n: null,
      live_bar_runner_violation_total_n: null,
      top_violations_all: [],
      top_violations: [],
    };
  }
  return {
    available: true,
    source_path: latestPath,
    violation_n: toNum(read.data.violation_n, null),
    violation_total_n: toNum(read.data.violation_total_n, null),
    live_bar_runner_violation_n: toNum(read.data.live_bar_runner_violation_n, null),
    live_bar_runner_violation_total_n: toNum(read.data.live_bar_runner_violation_total_n, null),
    top_violations_all: Array.isArray(read.data.top_violations_all) ? read.data.top_violations_all.slice(0, 10) : [],
    top_violations: Array.isArray(read.data.top_violations) ? read.data.top_violations.slice(0, 10) : [],
  };
}

function loadTrailRunnerFloorLiveSeparationHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "trail_runner_floor_live_separation_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      live_violation_n: null,
      historical_backfilled_violation_n: null,
      overlap_symbols: [],
      live_symbols: [],
      historical_backfilled_symbols: [],
    };
  }
  return {
    available: true,
    source_path: latestPath,
    live_violation_n: toNum(read.data.live_violation_n, null),
    live_violation_total_n: toNum(read.data.live_violation_total_n, null),
    historical_backfilled_violation_n: toNum(read.data.historical_backfilled_violation_n, null),
    overlap_symbols: Array.isArray(read.data.overlap_symbols) ? read.data.overlap_symbols.slice(0, 10) : [],
    live_symbols: Array.isArray(read.data.live_symbols) ? read.data.live_symbols.slice(0, 10) : [],
    historical_backfilled_symbols: Array.isArray(read.data.historical_backfilled_symbols) ? read.data.historical_backfilled_symbols.slice(0, 10) : [],
  };
}

function loadBinanceExitQtyContractAuditHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "binance_exit_qty_contract_audit_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      fill_count: null,
      chain_count: null,
      issue_chain_count: null,
      issue_code_counts: {},
      top_symbols: [],
      top_issues: [],
    };
  }
  const issueCodeCounts = Array.isArray(read.data.issue_code_counts)
    ? read.data.issue_code_counts
        .filter((row) => row && typeof row === "object")
        .reduce((acc, row) => {
          const code = String(row.code || "").trim();
          if (!code) return acc;
          acc[code] = toNum(row.count, 0);
          return acc;
        }, {})
    : (read.data.issue_code_counts && typeof read.data.issue_code_counts === "object"
      ? { ...read.data.issue_code_counts }
      : {});
  return {
    available: true,
    source_path: latestPath,
    fill_count: toNum(read.data.fill_count, null),
    chain_count: toNum(read.data.chain_count, null),
    issue_chain_total_n: toNum(read.data.issue_chain_total_n, null),
    issue_chain_backfilled_n: toNum(read.data.issue_chain_backfilled_n, null),
    issue_chain_count: toNum(read.data.issue_chain_count, null),
    issue_code_counts: issueCodeCounts,
    issue_code_total_counts: Array.isArray(read.data.issue_code_total_counts)
      ? read.data.issue_code_total_counts
          .filter((row) => row && typeof row === "object")
          .reduce((acc, row) => {
            const code = String(row.code || "").trim();
            if (!code) return acc;
            acc[code] = toNum(row.count, 0);
            return acc;
          }, {})
      : (read.data.issue_code_total_counts && typeof read.data.issue_code_total_counts === "object"
        ? { ...read.data.issue_code_total_counts }
        : {}),
    top_symbols: Array.isArray(read.data.top_symbols) ? read.data.top_symbols.slice(0, 10) : [],
    top_symbols_total: Array.isArray(read.data.top_symbols_total) ? read.data.top_symbols_total.slice(0, 10) : [],
    top_issues: Array.isArray(read.data.top_issues) ? read.data.top_issues.slice(0, 10) : [],
  };
}

function loadBinanceExitQtyLiveSeparationHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "binance_exit_qty_live_separation_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      live_issue_chain_n: null,
      historical_backfilled_issue_chain_n: null,
      overlap_symbols: [],
      live_symbols: [],
      historical_backfilled_symbols: [],
    };
  }
  return {
    available: true,
    source_path: latestPath,
    live_issue_chain_n: toNum(read.data.live_issue_chain_n, null),
    historical_backfilled_issue_chain_n: toNum(read.data.historical_backfilled_issue_chain_n, null),
    overlap_symbols: Array.isArray(read.data.overlap_symbols) ? read.data.overlap_symbols.slice(0, 10) : [],
    live_symbols: Array.isArray(read.data.live_symbols) ? read.data.live_symbols.slice(0, 10) : [],
    historical_backfilled_symbols: Array.isArray(read.data.historical_backfilled_symbols) ? read.data.historical_backfilled_symbols.slice(0, 10) : [],
  };
}

function loadRegimeLineageGapHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "regime_lineage_gap_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      signals_missing_n: null,
      signals_missing_rate: null,
      intents_missing_n: null,
      intents_missing_rate: null,
      fills_missing_n: null,
      fills_missing_rate: null,
    };
  }
  const signals = read.data.signals && typeof read.data.signals === "object" ? read.data.signals : {};
  const intents = read.data.intents && typeof read.data.intents === "object" ? read.data.intents : {};
  const fills = read.data.fills && typeof read.data.fills === "object" ? read.data.fills : {};
  return {
    available: true,
    source_path: latestPath,
    signals_missing_n: toNum(signals.missing_n, null),
    signals_missing_rate: toNum(signals.missing_rate, null),
    intents_missing_n: toNum(intents.missing_n, null),
    intents_missing_rate: toNum(intents.missing_rate, null),
    fills_missing_n: toNum(fills.missing_n, null),
    fills_missing_rate: toNum(fills.missing_rate, null),
  };
}

function loadNativeTrailProtectionGapHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "native_trail_protection_gap_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      gap_count: null,
      active_position_count: null,
      top_symbols: [],
      rows: [],
    };
  }
  const summary = read.data.summary && typeof read.data.summary === "object"
    ? read.data.summary
    : read.data;
  return {
    available: true,
    source_path: latestPath,
    gap_count: toNum(summary.gap_count, null),
    active_position_count: toNum(summary.active_position_count, null),
    top_symbols: Array.isArray(summary.top_symbols) ? summary.top_symbols.slice(0, 10) : [],
    rows: Array.isArray(summary.rows) ? summary.rows.slice(0, 20) : [],
  };
}

function loadExitIntegrityHealth({ repoRoot } = {}) {
  const latestPath = path.join(repoRoot, "ops", "daily", "binance_exit_integrity_cycle_latest.json");
  const read = readJsonSafe(latestPath);
  if (!read.ok || !read.data || typeof read.data !== "object") {
    return {
      available: false,
      source_path: latestPath,
      status: "MISSING",
      live_gate_blocked: null,
      live_issue_count: null,
      tp1_meta_sync_gap_n: null,
      tp1_meta_sync_gate: null,
      reasons: [],
    };
  }
  const summary = read.data.summary && typeof read.data.summary === "object"
    ? read.data.summary
    : read.data;
  return {
    available: true,
    source_path: latestPath,
    status: String(summary.status || "").trim().toUpperCase() || "UNKNOWN",
    live_gate_blocked: summary.live_gate_blocked === true,
    live_issue_count: toNum(summary.live_issue_count, null),
    tp1_meta_sync_gap_n: toNum(summary.tp1_meta_sync_gap_n, null),
    tp1_meta_sync_gate: String(summary.tp1_meta_sync_gate || "").trim().toUpperCase() || null,
    reasons: Array.isArray(summary.reasons) ? summary.reasons.slice(0, 20) : [],
  };
}

function hasExecutionFlowCoverage(health) {
  if (!health || health.available !== true) return false;
  const hasSignalSide = (
    Number.isFinite(health.signals_count)
    || Number.isFinite(health.tp1_signal_count)
    || Number.isFinite(health.trailing_signal_count)
    || Number.isFinite(health.drop_tp1_pending_count)
  );
  const hasFillSide = (
    Number.isFinite(health.fills_count)
    || Number.isFinite(health.intents_count)
    || Number.isFinite(health.trades_count)
    || Number.isFinite(health.audit_issue_count)
    || Number.isFinite(health.qty_pct_non_positive_count)
    || Number.isFinite(health.duplicate_signal_fill_count)
  );
  return hasSignalSide && hasFillSide;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toTimeMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolvePositionReadViewSymbol(row = {}) {
  return upper(row.symbol || row.symbol_or_pair_id || row.market || null);
}

function resolvePositionReadViewCommitMs(row = {}) {
  return (
    toTimeMs(row.read_model_event_ts_ms)
    || toTimeMs(row.writer_committed_at)
    || toTimeMs(row.updated_at)
    || toTimeMs(row.external_synced_at)
    || toTimeMs(row.meta && row.meta.external_synced_at)
    || null
  );
}

function hasHealthySupersedingPositionView(family = {}, positionRows = []) {
  const familyName = upper(family.family);
  if (familyName !== "POSITION_WRITE_TOKEN_MISMATCH") return false;
  const familyLatestMs = toTimeMs(family.latest_at);
  if (!Number.isFinite(familyLatestMs)) return false;
  const symbols = Array.isArray(family.symbols)
    ? family.symbols.map((row) => upper(row)).filter(Boolean)
    : [];
  if (!symbols.length) return false;
  const rowsBySymbol = new Map();
  for (const row of positionRows || []) {
    const symbol = resolvePositionReadViewSymbol(row);
    if (!symbol || rowsBySymbol.has(symbol)) continue;
    rowsBySymbol.set(symbol, row);
  }
  return symbols.every((symbol) => {
    const row = rowsBySymbol.get(symbol);
    if (!row) return false;
    const commitMs = resolvePositionReadViewCommitMs(row);
    if (!Number.isFinite(commitMs) || commitMs <= familyLatestMs) return false;
    const meta = row && typeof row.meta === "object" ? row.meta : {};
    const projectionInSync = meta.exchange_projection_in_sync;
    const protectionOk = upper(meta.native_protection_refresh_status || "");
    return projectionInSync === true && (!protectionOk || protectionOk === "OK");
  });
}

function filterSupersededActiveErrorFamilies(activeFamilies = [], positionRows = []) {
  const active = Array.isArray(activeFamilies) ? activeFamilies : [];
  const superseded = [];
  const effective = [];
  for (const family of active) {
    if (hasHealthySupersedingPositionView(family, positionRows)) superseded.push(family);
    else effective.push(family);
  }
  return { effective, superseded };
}

function decideStatus({
  netPnlPct,
  costRatioPct,
  errorCount,
  activeErrorCount = null,
  activeErrorFamilies = [],
  costLimitPct,
  lossStopPct,
  stopErrorCount,
  executionHealth,
  fillSyncAlertDuplication,
  fillSyncAlertEventConsistency,
  tradeExecutionAlertCrossAudit,
  activeExitWatchdog,
  trailRunnerFloorAudit,
  binanceExitQtyContractAudit,
  nativeTrailProtectionGap,
  exitIntegrity,
  positionReadModelCutover,
  activePositionCount = null,
}) {
  const reasons = [];
  let status = "진행";
  const writerAuthorityOnlyWithoutActivePositions = Number(activePositionCount) === 0
    && Array.isArray(activeErrorFamilies)
    && activeErrorFamilies.length > 0
    && activeErrorFamilies.every((item) => String(item && item.family || "").trim().toUpperCase().startsWith("POSITION_WRITE_"));
  const effectiveStopErrorCount = writerAuthorityOnlyWithoutActivePositions
    ? 0
    : (Number.isFinite(activeErrorCount) ? activeErrorCount : errorCount);
  const effectiveHoldErrorCount = writerAuthorityOnlyWithoutActivePositions
    ? 0
    : (Number.isFinite(activeErrorCount) ? activeErrorCount : errorCount);

  if (Number.isFinite(netPnlPct) && netPnlPct <= lossStopPct) {
    status = "중단";
    reasons.push(`일 손실률 ${fmt(netPnlPct)}% <= ${fmt(lossStopPct)}%`);
  }

  if (Number.isFinite(effectiveStopErrorCount) && effectiveStopErrorCount >= stopErrorCount) {
    status = "중단";
    if (Number.isFinite(activeErrorCount)) reasons.push(`활성 핵심 오류 ${activeErrorCount}건 >= ${stopErrorCount}건`);
    else reasons.push(`핵심 오류 ${errorCount}건 >= ${stopErrorCount}건`);
  }

  if (status !== "중단") {
    if (Number.isFinite(costRatioPct) && costRatioPct > costLimitPct) {
      status = "보류";
      reasons.push(`비용 비율 ${fmt(costRatioPct)}% > ${fmt(costLimitPct)}%`);
    }
    if (Number.isFinite(effectiveHoldErrorCount) && effectiveHoldErrorCount >= 1) {
      if (status === "진행") status = "보류";
      if (Number.isFinite(activeErrorCount)) reasons.push(`활성 핵심 오류 ${activeErrorCount}건`);
      else reasons.push(`24시간 오류 ${errorCount}건`);
    }
    if (!hasExecutionFlowCoverage(executionHealth)) {
      if (status === "진행") status = "보류";
      reasons.push("신호→주문→체결 감사 데이터 미수집");
    }
    if (!positionReadModelCutover || positionReadModelCutover.available !== true) {
      if (status === "진행") status = "보류";
      reasons.push("position read-model cutover 증적 미수집");
    } else if (positionReadModelCutover.latest_ready !== true) {
      if (status === "진행") status = "보류";
      reasons.push(`position read-model 미준비 (${positionReadModelCutover.dominant_status || "UNKNOWN"})`);
    }
    if (executionHealth && executionHealth.available) {
      if (executionHealth.firestore_dns_ok === false) {
        if (status === "진행") status = "보류";
        reasons.push("Firestore DNS 사전점검 실패");
      }
      if (Number.isFinite(executionHealth.drop_tp1_pending_count) && executionHealth.drop_tp1_pending_count >= 500) {
        if (status === "진행") status = "보류";
        reasons.push(`DROP_TP_P1_PENDING ${executionHealth.drop_tp1_pending_count}건`);
      }
      if (Number.isFinite(executionHealth.qty_pct_non_positive_count) && executionHealth.qty_pct_non_positive_count >= 1) {
        if (status === "진행") status = "보류";
        reasons.push(`체결 수량 비율 이상치 ${executionHealth.qty_pct_non_positive_count}건`);
      }
    }
    if (
      fillSyncAlertDuplication
      && fillSyncAlertDuplication.available === true
      && Number.isFinite(fillSyncAlertDuplication.duplicate_group_n)
      && fillSyncAlertDuplication.duplicate_group_n >= Math.max(1, Number(process.env.FILL_SYNC_ALERT_DUPLICATION_HOLD_GROUPS || 5))
    ) {
      if (status === "진행") status = "보류";
      reasons.push(`fill sync 중복 알림 그룹 ${fillSyncAlertDuplication.duplicate_group_n}건`);
    }
    if (
      fillSyncAlertEventConsistency
      && fillSyncAlertEventConsistency.available === true
      && Number.isFinite(fillSyncAlertEventConsistency.issue_n)
      && fillSyncAlertEventConsistency.issue_n >= 1
    ) {
      if (status === "진행") status = "보류";
      reasons.push(`fill sync alert event mismatch ${fillSyncAlertEventConsistency.issue_n}건`);
    }
    if (
      tradeExecutionAlertCrossAudit
      && tradeExecutionAlertCrossAudit.available === true
      && tradeExecutionAlertCrossAudit.coverage_ready === true
      && Number.isFinite(tradeExecutionAlertCrossAudit.missing_alert_fill_n)
      && tradeExecutionAlertCrossAudit.missing_alert_fill_n >= 1
    ) {
      if (status === "진행") status = "보류";
      reasons.push(`trade execution alert missing fill ${tradeExecutionAlertCrossAudit.missing_alert_fill_n}건`);
    }
    if (
      activeExitWatchdog
      && activeExitWatchdog.available === true
      && Number.isFinite(activeExitWatchdog.issue_symbol_n)
      && activeExitWatchdog.issue_symbol_n >= 1
    ) {
      if (status === "진행") status = "보류";
      reasons.push(`active exit watchdog issue ${activeExitWatchdog.issue_symbol_n}건`);
    }
    if (
      trailRunnerFloorAudit
      && trailRunnerFloorAudit.available === true
      && Number.isFinite(trailRunnerFloorAudit.violation_n)
      && trailRunnerFloorAudit.violation_n >= Math.max(1, Number(process.env.TRAIL_RUNNER_FLOOR_HOLD_VIOLATIONS || 1))
    ) {
      if (status === "진행") status = "보류";
      reasons.push(`trailing floor 미해결 위반 ${trailRunnerFloorAudit.violation_n}건`);
    }
    if (
      nativeTrailProtectionGap
      && nativeTrailProtectionGap.available === true
      && Number.isFinite(nativeTrailProtectionGap.gap_count)
      && nativeTrailProtectionGap.gap_count >= 1
    ) {
      if (status === "진행") status = "보류";
      reasons.push(`trailing native stop 공백 ${nativeTrailProtectionGap.gap_count}건`);
    }
    if (
      exitIntegrity
      && exitIntegrity.available === true
      && Number.isFinite(exitIntegrity.tp1_meta_sync_gap_n)
      && exitIntegrity.tp1_meta_sync_gap_n >= 1
    ) {
      if (status === "진행") status = "보류";
      reasons.push(`TP1 meta sync gap ${exitIntegrity.tp1_meta_sync_gap_n}건`);
    }
    if (
      binanceExitQtyContractAudit
      && binanceExitQtyContractAudit.available !== true
    ) {
      if (status === "진행") status = "보류";
      reasons.push("binance exit 수량 계약 감사 미수집");
    }
  }

  if (!reasons.length) reasons.push("핵심 리스크 신호 없음");
  return { status, reasons };
}

function buildIssueLines(summary) {
  const lines = [];
  const health = summary.execution_health || {};
  const cutover = summary.position_read_model_cutover || {};
  const duplication = summary.fill_sync_alert_duplication || {};
  const consistency = summary.fill_sync_alert_event_consistency || {};
  const tradeAlertCrossAudit = summary.trade_execution_alert_cross_audit || {};
  const activeExitWatchdog = summary.active_exit_watchdog || {};
  const trailFloor = summary.trail_runner_floor_audit || {};
  const trailFloorLiveSeparation = summary.trail_runner_floor_live_separation || {};
  const exitQtyAudit = summary.binance_exit_qty_contract_audit || {};
  const exitQtyLiveSeparation = summary.binance_exit_qty_live_separation || {};
  const nativeTrailProtectionGap = summary.native_trail_protection_gap || {};
  const exitIntegrity = summary.exit_integrity || {};
  const regimeLineageGap = summary.regime_lineage_gap || {};
  const flowCoverageReady = hasExecutionFlowCoverage(health);
  const writerAuthority = summary.position_writer_authority_24h && typeof summary.position_writer_authority_24h === "object"
    ? summary.position_writer_authority_24h
    : {};

  if (Number.isFinite(summary.cost_ratio_pct) && Number.isFinite(summary.cost_limit_pct) && summary.cost_ratio_pct > summary.cost_limit_pct) {
    lines.push(`[ISSUE] H | 비용 비율 ${fmt(summary.cost_ratio_pct)}%로 상한 ${fmt(summary.cost_limit_pct)}% 초과 | 신규 진입 확대 금지 유지`);
  } else {
    lines.push("[ISSUE] L | 비용 비율 상한 내 유지 | 현재 비용 차단 규칙 유지");
  }

  if (Number.isFinite(summary.active_error_count)) {
    if (summary.active_error_count >= 1) {
      lines.push(`[ISSUE] M | 활성 핵심 오류 ${summary.active_error_count}건 존재 | 동일 오류 재발 방지 2건 실행 필요`);
    } else if (Number.isFinite(summary.error_count) && summary.error_count >= 1) {
      lines.push(`[ISSUE] L | 최근 24시간 오류 ${summary.error_count}건은 있으나 현재 활성 오류는 없음 | 동일 오류 재발 모니터링 유지`);
    } else {
      lines.push("[ISSUE] L | 최근 24시간 핵심 오류 없음 | 현재 장애 복구 플랜 유지");
    }
  } else if (Number.isFinite(summary.error_count) && summary.error_count >= 1) {
    lines.push(`[ISSUE] M | 최근 24시간 오류 ${summary.error_count}건 존재 | 동일 오류 재발 방지 2건 실행 필요`);
  } else {
    lines.push("[ISSUE] L | 최근 24시간 핵심 오류 없음 | 현재 장애 복구 플랜 유지");
  }

  if (Number.isFinite(writerAuthority.occurrence_count) && writerAuthority.occurrence_count >= 1) {
    const topSymbols = Array.isArray(writerAuthority.top_symbols) && writerAuthority.top_symbols.length
      ? writerAuthority.top_symbols.map((row) => `${row.symbol}(${row.count})`).join(", ")
      : "UNKNOWN";
    lines.push(`[ISSUE] M | positions_paper writer authority 경합 ${writerAuthority.occurrence_count}건 | 상위 심볼 ${topSymbols} 우선 점검 필요`);
  }

  if (Number.isFinite(summary.net_pnl_pct) && Number.isFinite(summary.gap_pct) && summary.gap_pct < 0) {
    lines.push(`[ISSUE] M | 순손익 ${fmt(summary.net_pnl_pct)}%로 월 목표 일평균 대비 ${fmt(summary.gap_pct)}%p 미달 | 고비용 구간 진입 억제 적용 필요`);
  }
  if (Number.isFinite(activeExitWatchdog.issue_symbol_n) && activeExitWatchdog.issue_symbol_n >= 1) {
    const symbols = Array.isArray(activeExitWatchdog.issue_symbols) && activeExitWatchdog.issue_symbols.length
      ? activeExitWatchdog.issue_symbols.join(", ")
      : "UNKNOWN";
    lines.push(`[ISSUE] H | active exit watchdog 이슈 ${activeExitWatchdog.issue_symbol_n}건 | 심볼 ${symbols} 즉시 정합 필요`);
  }

  if (health.available) {
    if (health.firestore_dns_ok === false) {
      lines.push("[ISSUE] H | Firestore DNS 사전점검 실패 | DNS/네트워크 복구 전 원본 검증 보류");
    }
    if (Number.isFinite(health.drop_tp1_pending_count) && health.drop_tp1_pending_count >= 500) {
      lines.push(`[ISSUE] M | DROP_TP_P1_PENDING ${health.drop_tp1_pending_count}건 누적 | TP1 대기 잠금 해제 조건 원인 분류 필요`);
    }
    if (Number.isFinite(health.qty_pct_non_positive_count) && health.qty_pct_non_positive_count >= 1) {
      lines.push(`[ISSUE] M | 체결 수량 비율 이상치 ${health.qty_pct_non_positive_count}건 | 수량 비율 필드 누락 방지 규칙 점검 필요`);
    }
    if (Number.isFinite(health.duplicate_signal_fill_count) && health.duplicate_signal_fill_count >= 5) {
      lines.push(`[ISSUE] M | 동일 신호 다중 체결 ${health.duplicate_signal_fill_count}건 | 중복 체결 허용 범위 재검토 필요`);
    }
    if (!flowCoverageReady) {
      lines.push("[ISSUE] H | 신호/체결 한쪽 데이터가 비어 전체 흐름 점검 불가 | 데이터 수집 복구 전 수익 확대 금지");
    }
  } else {
    lines.push("[ISSUE] H | 주문 경로 감사 파일 미수집 | 신호/체결 점검 스크립트 재실행 및 수집 경로 복구 필요");
  }

  if (trailFloor.available === true) {
    if (trailFloorLiveSeparation.available === true && Number.isFinite(trailFloorLiveSeparation.live_violation_n) && trailFloorLiveSeparation.live_violation_n >= 1) {
      lines.push(`[ISSUE] M | trailing floor live unresolved ${trailFloorLiveSeparation.live_violation_n}건 | historical backfilled ${fmt(trailFloorLiveSeparation.historical_backfilled_violation_n, 0)}건과 분리, 현재 심볼 ${trailFloorLiveSeparation.live_symbols.join(", ") || "UNKNOWN"} 즉시 점검 필요`);
    } else if (Number.isFinite(trailFloor.violation_n) && trailFloor.violation_n >= 1) {
      lines.push(`[ISSUE] M | trailing floor 미해결 위반 ${trailFloor.violation_n}건 | bar-runner synthetic trail 재발 여부 즉시 점검 필요`);
    } else if (Number.isFinite(trailFloor.violation_total_n) && trailFloor.violation_total_n >= 1) {
      lines.push(`[ISSUE] L | trailing floor 과거 위반 ${trailFloor.violation_total_n}건은 backfill 정리됨 | 신규 unresolved 위반만 모니터링`);
    } else {
      lines.push("[ISSUE] L | trailing floor 위반 없음 | 현재 trail authority 구조 유지");
    }
  } else {
    lines.push("[ISSUE] M | trailing floor 감사 리포트 미수집 | runner floor 위반 재발 감시 필요");
  }

  if (nativeTrailProtectionGap.available === true) {
    if (Number.isFinite(nativeTrailProtectionGap.gap_count) && nativeTrailProtectionGap.gap_count >= 1) {
      const topSymbol = Array.isArray(nativeTrailProtectionGap.top_symbols) && nativeTrailProtectionGap.top_symbols.length
        ? `${nativeTrailProtectionGap.top_symbols[0].symbol}(${nativeTrailProtectionGap.top_symbols[0].count})`
        : "UNKNOWN";
      lines.push(`[ISSUE] H | trail_active인데 native stop 누락 ${nativeTrailProtectionGap.gap_count}건 | 상위 심볼 ${topSymbol}, 거래소 보호주문 공백 즉시 정리 필요`);
    } else {
      lines.push("[ISSUE] L | trail_active native stop 공백 없음 | 거래소 보호주문 공백 가드 유지");
    }
  } else {
    lines.push("[ISSUE] M | native trail protection gap 리포트 미수집 | live trail 보호주문 공백 감시 필요");
  }

  if (exitIntegrity.available === true) {
    if (Number.isFinite(exitIntegrity.tp1_meta_sync_gap_n) && exitIntegrity.tp1_meta_sync_gap_n >= 1) {
      lines.push(`[ISSUE] H | TP1 meta sync gap ${exitIntegrity.tp1_meta_sync_gap_n}건 | native TP1 ACK 대비 position meta/order id 동기화 실패, 신규 확대 및 배포 보류 유지`);
    } else {
      lines.push("[ISSUE] L | TP1 meta sync gap 없음 | V2 TP1 arm/meta sync gate 유지");
    }
  } else {
    lines.push("[ISSUE] M | exit integrity cycle 리포트 미수집 | TP1 meta sync gate 산출물 확인 필요");
  }

  if (exitQtyAudit.available === true) {
    if (exitQtyLiveSeparation.available === true && Number.isFinite(exitQtyLiveSeparation.live_issue_chain_n) && exitQtyLiveSeparation.live_issue_chain_n >= 1) {
      const overlap = Array.isArray(exitQtyLiveSeparation.overlap_symbols) && exitQtyLiveSeparation.overlap_symbols.length
        ? exitQtyLiveSeparation.overlap_symbols.join(", ")
        : "none";
      lines.push(`[ISSUE] M | Binance exit 수량 계약 live unresolved ${exitQtyLiveSeparation.live_issue_chain_n}건 | historical backfilled ${fmt(exitQtyLiveSeparation.historical_backfilled_issue_chain_n, 0)}건과 분리, overlap ${overlap}`);
    } else if (Number.isFinite(exitQtyAudit.issue_chain_count) && exitQtyAudit.issue_chain_count >= 1) {
      const topCode = Object.entries(exitQtyAudit.issue_code_counts || {})
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
      const topSymbol = Array.isArray(exitQtyAudit.top_symbols) && exitQtyAudit.top_symbols.length
        ? `${exitQtyAudit.top_symbols[0].symbol}(${exitQtyAudit.top_symbols[0].count})`
        : "UNKNOWN";
      lines.push(`[ISSUE] M | Binance exit 수량 계약 위반 chain ${exitQtyAudit.issue_chain_count}건 | 최다 코드 ${topCode ? `${topCode[0]}(${topCode[1]})` : "N/A"}, 상위 심볼 ${topSymbol}, 과거 누적 이슈 분리 정리 필요`);
    } else if (Number.isFinite(exitQtyAudit.issue_chain_total_n) && exitQtyAudit.issue_chain_total_n >= 1) {
      const topCode = Object.entries(exitQtyAudit.issue_code_total_counts || {})
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
      const topSymbol = Array.isArray(exitQtyAudit.top_symbols_total) && exitQtyAudit.top_symbols_total.length
        ? `${exitQtyAudit.top_symbols_total[0].symbol}(${exitQtyAudit.top_symbols_total[0].count})`
        : "UNKNOWN";
      lines.push(`[ISSUE] L | Binance exit 수량 계약 과거 위반 ${exitQtyAudit.issue_chain_total_n}건은 backfill 정리됨 | 최다 코드 ${topCode ? `${topCode[0]}(${topCode[1]})` : "N/A"}, 상위 심볼 ${topSymbol}, 신규 unresolved chain만 모니터링`);
    } else {
      lines.push("[ISSUE] L | Binance exit 수량 계약 위반 없음 | TP0/TP1/TRAIL 수량 계약 유지");
    }
  } else {
    lines.push("[ISSUE] M | Binance exit 수량 계약 감사 리포트 미수집 | TP 단계 수량 계약 재발 감시 필요");
  }

  if (regimeLineageGap.available === true) {
    if (Number.isFinite(regimeLineageGap.signals_missing_n) && regimeLineageGap.signals_missing_n >= 1) {
      lines.push(`[ISSUE] M | signal regime missing ${regimeLineageGap.signals_missing_n}건 (${fmt((regimeLineageGap.signals_missing_rate || 0) * 100)}%) | signal lineage/backfill 보강 필요`);
    }
    if (Number.isFinite(regimeLineageGap.intents_missing_n) && regimeLineageGap.intents_missing_n >= 1) {
      lines.push(`[ISSUE] M | intent regime missing ${regimeLineageGap.intents_missing_n}건 (${fmt((regimeLineageGap.intents_missing_rate || 0) * 100)}%) | signal->intent regime 상속/보강 backfill 필요`);
    }
  } else {
    lines.push("[ISSUE] L | regime lineage gap 리포트 미수집 | signal/intent regime 누락률 추적 필요");
  }

  if (duplication.available === true) {
    if (Number.isFinite(duplication.duplicate_group_n) && duplication.duplicate_group_n >= 1) {
      lines.push(`[ISSUE] M | fill sync 중복 알림 그룹 ${duplication.duplicate_group_n}건, 예상 억제 가능 알림 ${fmt(duplication.suppressed_alert_estimate_n, 0)}건 | duplicate alert backfill 및 aggregation 재발 점검 필요`);
    } else {
      lines.push("[ISSUE] L | fill sync 중복 알림 그룹 없음 | 현재 aggregation guard 유지");
    }
  } else {
    lines.push("[ISSUE] M | fill sync duplication 리포트 미수집 | duplication report 재생성 및 gate 확인 필요");
  }

  if (consistency.available === true) {
    if (Number.isFinite(consistency.issue_n) && consistency.issue_n >= 1) {
      const topCode = Array.isArray(consistency.top_issue_codes) && consistency.top_issue_codes.length
        ? `${consistency.top_issue_codes[0].code}(${consistency.top_issue_codes[0].count})`
        : "N/A";
      const topSymbol = Array.isArray(consistency.top_symbols) && consistency.top_symbols.length
        ? `${consistency.top_symbols[0].symbol}(${consistency.top_symbols[0].count})`
        : "UNKNOWN";
      lines.push(`[ISSUE] M | fill sync alert-event mismatch ${consistency.issue_n}건 | 최다 코드 ${topCode}, 상위 심볼 ${topSymbol}, alert stage 재오염 즉시 점검 필요`);
    } else {
      lines.push("[ISSUE] L | fill sync alert-event mismatch 없음 | alert event consistency guard 유지");
    }
  } else {
    lines.push("[ISSUE] M | fill sync alert-event consistency 리포트 미수집 | stage mismatch 감사 리포트 재생성 필요");
  }

  if (tradeAlertCrossAudit.available === true) {
    if (tradeAlertCrossAudit.coverage_ready !== true) {
      lines.push("[ISSUE] L | trade execution alert cross audit bootstrap 구간 | audit log 누적 후 미발송 감시 활성화");
    } else if (Number.isFinite(tradeAlertCrossAudit.missing_alert_fill_n) && tradeAlertCrossAudit.missing_alert_fill_n >= 1) {
      lines.push(`[ISSUE] M | trade execution alert 미발송 추정 fill ${tradeAlertCrossAudit.missing_alert_fill_n}건 | audit row ${fmt(tradeAlertCrossAudit.audit_trade_alert_row_n, 0)}건, telegram row ${fmt(tradeAlertCrossAudit.telegram_trade_alert_row_n, 0)}건 기준 교차점검 필요`);
    } else {
      lines.push("[ISSUE] L | trade execution alert cross audit 기준 미발송 fill 없음 | alert delivery audit 유지");
    }
  } else {
    lines.push("[ISSUE] M | trade execution alert cross audit 리포트 미수집 | telegram/audit log 교차감사 리포트 재생성 필요");
  }

  if (cutover.available !== true) {
    lines.push("[ISSUE] H | position read-model cutover 증적 미수집 | cutover 리포트 재생성 및 운영 gate 재확인 필요");
  } else if (cutover.latest_ready !== true) {
    const blockers = Array.isArray(cutover.query_blockers) && cutover.query_blockers.length
      ? cutover.query_blockers.join(", ")
      : "none";
    lines.push(`[ISSUE] H | position read-model cutover 미준비 (${cutover.dominant_status || "UNKNOWN"}) | blocker=${blockers}`);
  } else {
    lines.push("[ISSUE] L | position read-model cutover 준비 완료 | latest index 기준 운영 read 유지");
  }

  return lines;
}

function buildWriterAuthorityRemediationCandidates(writerAuthority = {}) {
  const topSymbols = Array.isArray(writerAuthority && writerAuthority.top_symbols)
    ? writerAuthority.top_symbols
    : [];
  return topSymbols
    .filter((row) => Number.isFinite(Number(row && row.count)) && Number(row.count) > 0)
    .slice(0, 5)
    .map((row, idx) => {
      const count = Number(row.count);
      const symbol = String(row.symbol || "").trim().toUpperCase() || "UNKNOWN";
      const severity = count >= 5 ? "HIGH" : (count >= 3 ? "MEDIUM" : "LOW");
      const priority = idx + 1;
      const action = count >= 5
        ? "WEBHOOK/FILL_SYNC 동시 경합 구간 재검토 및 즉시 writer trace 확인"
        : (count >= 3
          ? "해당 심볼의 webhook immediate + external fill reconcile 로그 재검토"
          : "재발 여부 모니터링 및 다음 발생 시 trace 수집");
      return {
        symbol,
        count,
        priority,
        severity,
        action,
      };
    });
}

function buildMarkdown({
  dateKey,
  generatedAtKst,
  snapshotPath,
  reportPath,
  executionHealth,
  summary,
  outputJsonPath,
}) {
  const mode = summary.status === "진행" ? "수익 확대 가능" : "비용 차단";
  const statusLine = `${summary.status} (${summary.reasons.join(" / ")})`;
  const executionCheckDone = executionHealth && executionHealth.available;
  const health = executionHealth || {};
  const cutover = summary.position_read_model_cutover || {};
  const exitIntegrity = summary.exit_integrity || {};
  const issueLines = buildIssueLines(summary);
  const approvalLines = (Array.isArray(summary.approvals) ? summary.approvals : [])
    .map((item) =>
      `[USER_APPROVAL_REQUIRED] ${item.title} | ${item.reason} | ${item.action}`
    )
    .join("\n");
  const approvalSection = approvalLines
    ? `\n- 승인 필요사항\n${approvalLines}`
    : "\n- 승인 필요사항: 없음";

  return `# ${dateKey} 시스템 일일 운영 가드 보고 (시스템 개발 담당)

기준 시각: ${summary.snapshot_end_kst || generatedAtKst}
생성 시각: ${generatedAtKst}
기준 데이터: \`${snapshotPath}\`, \`${reportPath}\`

## 시스템 설계
- 신호→주문→체결 흐름에서 \`비용 비율\`, \`순손익\`, \`오류 건수\` 3개 지표로 오늘 상태를 자동 판정합니다.
- 주문 경로 건강도(\`DNS\`, \`TP1/트레일링 신호\`, \`신호-체결 감사 이슈\`)를 같은 보고서에 결합해 장애 조기 감지를 강화합니다.
- 상태가 \`보류\` 또는 \`중단\`이면 신규 진입 확대를 막고, 운영 가드 모드를 자동으로 \`비용 차단\`으로 고정합니다.
- API 안전장치는 \`중복주문 방지 키\`, \`재시도 상한\`, \`오류 로그 추적\` 3개를 기본으로 유지합니다.

## 구현 태스크
1. \`scripts/daily-system-ops-check.js\` 실행: 스냅샷/리포트 읽기, 수치 계산, 상태 판정, 결과 저장.
2. 자동 산출물 생성: \`${outputJsonPath}\` (기계 점검용 JSON), 일일 보고서(현재 문서).
3. 오늘 수치 계산 완료
   - 비용 비율: \`${fmt(summary.cost_ratio_pct)}%\` (상한 \`${fmt(summary.cost_limit_pct)}%\`)
   - 순손익: \`${fmt(summary.net_pnl_usdt)} USDT\` (\`${fmt(summary.net_pnl_pct)}%\`)
   - 월 5% 기준 일평균 필요치: \`${fmt(summary.required_daily_pct)}%\`, 오늘 격차: \`${fmt(summary.gap_pct)}%p\`
   - 오류(24h): \`${summary.error_count == null ? "N/A" : summary.error_count}\`건
4. 주문 경로 건강도 점검 완료
   - Firestore DNS: \`${health.firestore_dns_ok === null ? "N/A" : (health.firestore_dns_ok ? "정상" : "실패")}\` (${health.firestore_dns_host || "host N/A"})
   - 신호/인텐트/체결/트레이드: \`${health.signals_count == null ? "N/A" : health.signals_count}\` / \`${health.intents_count == null ? "N/A" : health.intents_count}\` / \`${health.fills_count == null ? "N/A" : health.fills_count}\` / \`${health.trades_count == null ? "N/A" : health.trades_count}\`
   - TP1/트레일링 신호: \`${health.tp1_signal_count == null ? "N/A" : health.tp1_signal_count}\` / \`${health.trailing_signal_count == null ? "N/A" : health.trailing_signal_count}\`
   - DROP_TP_P1_PENDING: \`${health.drop_tp1_pending_count == null ? "N/A" : health.drop_tp1_pending_count}\`건
   - 감사 이슈/중복체결: \`${health.audit_issue_count == null ? "N/A" : health.audit_issue_count}\`건 / \`${health.duplicate_signal_fill_count == null ? "N/A" : health.duplicate_signal_fill_count}\`건
   - TP1 meta sync gap/gate: \`${exitIntegrity.tp1_meta_sync_gap_n == null ? "N/A" : exitIntegrity.tp1_meta_sync_gap_n}\`건 / \`${exitIntegrity.tp1_meta_sync_gate || "N/A"}\`
5. position read-model cutover 점검 완료
   - latest_ready: \`${cutover.available !== true ? "N/A" : (cutover.latest_ready ? "yes" : "no")}\`
   - dominant_status: \`${cutover.dominant_status || "N/A"}\`
   - coverage/latest/events/timeline: \`${cutover.latest_coverage_pct == null ? "N/A" : fmt(cutover.latest_coverage_pct * 100)}%\` / \`${cutover.latest_count == null ? "N/A" : cutover.latest_count}\` / \`${cutover.events_count == null ? "N/A" : cutover.events_count}\` / \`${cutover.timeline_count == null ? "N/A" : cutover.timeline_count}\`
   - query_blockers: \`${Array.isArray(cutover.query_blockers) && cutover.query_blockers.length ? cutover.query_blockers.join(", ") : "none"}\`
6. 24시간 runtime error family 요약
   - family 수: \`${summary.error_count == null ? "N/A" : summary.error_count}\`
   - occurrence 수: \`${summary.error_occurrence_count == null ? "N/A" : summary.error_occurrence_count}\`
   - 최근 family: \`${Array.isArray(summary.error_families_24h) && summary.error_families_24h.length ? summary.error_families_24h.map((item) => `${item.family}(${item.count})`).join(", ") : "없음"}\`
   - writer authority: \`${summary.position_writer_authority_24h && Number.isFinite(summary.position_writer_authority_24h.occurrence_count) ? summary.position_writer_authority_24h.occurrence_count : 0}\`건 / 상위 심볼 \`${summary.position_writer_authority_24h && Array.isArray(summary.position_writer_authority_24h.top_symbols) && summary.position_writer_authority_24h.top_symbols.length ? summary.position_writer_authority_24h.top_symbols.map((item) => `${item.symbol}(${item.count})`).join(", ") : "없음"}\`
   - remediation 후보: \`${summary.position_writer_authority_24h && Array.isArray(summary.position_writer_authority_24h.remediation_candidates) && summary.position_writer_authority_24h.remediation_candidates.length ? summary.position_writer_authority_24h.remediation_candidates.map((item) => `${item.symbol}:${item.action}`).join(" | ") : "없음"}\`
7. 오늘 운영 가드 모드 확정: \`${mode}\`

## 장애/보안 리스크
${issueLines.join("\n")}

## 운영 체크리스트
- [x] 기준 데이터 시각 확인 (${summary.snapshot_end_kst || "N/A"})
- [x] 비용/손익/오류 3개 지표 재계산
- ${executionCheckDone ? "[x]" : "[ ]"} 주문 경로 건강도 점검 (${executionCheckDone ? "완료" : "파일 미수집"})
- [${cutover.available === true && cutover.latest_ready === true ? "x" : " "}] position read-model cutover 확인 (${cutover.dominant_status || "미수집"})
- [x] 상태 판정 (${statusLine})
- [x] 비용 초과 시 운영 가드 모드 \`비용 차단\` 고정
- [ ] 20:30 KST까지 오류 재발방지 액션 2건 확정
- [ ] 21:30 KST 최종 보고용 수치 재검증

## 대표 보고 요약
- 오늘 운영 가드 판정은 \`${summary.status}\`입니다.
- 이유: ${summary.reasons.join(", ")}
- 독립 실행안: 비용 초과 경보 자동화 + 오류 재발방지 2건 제출 + 21:30 재검증 자동 실행.
- 지혜 의사결정 요청: 비용 비율 0.20% 복귀 전 \`신규 진입 확대 금지\` 유지 여부 최종 확정.
- 지혜 의사결정 요청(승인): 아래 승인 항목 확인 필요
- 지혜를 통한 협업 요청
  - 성과분석: 수수료 상위 원인 3개와 절감효과(20/30%) 수치 전달 요청
  - 퀀트: 고비용 시간대 회피 A/B안의 검증 우선순위 전달 요청
  - 품질: 21:30 보고 전 손익/비용/자산 정합성 재확인 요청
[EVOLUTION] 수동 계산 위주 운영에서 자동 판정 스크립트 기반으로 전환 | 보고 속도와 수치 일관성 개선${approvalSection}
`;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const snapshotPath = process.argv[2] || path.join(repoRoot, "noye", "binance_snapshot_latest.json");
  const reportPath = process.argv[3] || path.join(repoRoot, "noye", "report.md");

  const snapshotRaw = fs.readFileSync(snapshotPath, "utf8");
  const reportRaw = fs.readFileSync(reportPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw);

  const baseCostLimitPct = toNum(process.env.DAILY_COST_LIMIT_PCT, 0.20);
  const costLimitDecision = resolveRelaxedCostLimitPct({
    repoRoot,
    baseCostLimitPct,
  });
  const costLimitPct = toNum(costLimitDecision.cost_limit_pct, baseCostLimitPct);
  const lossStopPct = toNum(process.env.DAILY_LOSS_STOP_PCT, -1.5);
  const monthlyTargetPct = toNum(process.env.MONTHLY_TARGET_PCT, 5.0);
  const stopErrorCount = toNum(process.env.STOP_ERROR_COUNT, 2);

  const equity = toNum(snapshot.total_equity, 0);
  const realizedPnl = toNum(snapshot.realized_pnl, 0);
  const commission = toNum(snapshot.commission, 0);
  const funding = toNum(snapshot.funding, 0);

  const costTotalSigned = commission + funding;
  const costTotalAbs = Math.abs(costTotalSigned);
  const costRatioPct = pct(costTotalAbs, equity);

  const netPnlUsdt = realizedPnl + costTotalSigned;
  const netPnlPct = pct(netPnlUsdt, equity);

  const requiredDailyPct = monthlyTargetPct / 30;
  const gapPct = Number.isFinite(netPnlPct) ? (netPnlPct - requiredDailyPct) : null;

  const runtimeErrorSummary = await fetchRuntimeErrorSummary24h({}).catch(() => null);
  const runtimeErrorCount = toNum(runtimeErrorSummary && runtimeErrorSummary.error_count_24h, null);
  const runtimeErrorOccurrenceCount = toNum(runtimeErrorSummary && runtimeErrorSummary.error_occurrence_count_24h, null);
  const runtimeErrorFamilies = Array.isArray(runtimeErrorSummary && runtimeErrorSummary.error_families_24h)
    ? runtimeErrorSummary.error_families_24h
    : [];
  const runtimeActiveErrorCount = toNum(runtimeErrorSummary && runtimeErrorSummary.active_error_count_24h, null);
  const runtimeActiveErrorOccurrenceCount = toNum(runtimeErrorSummary && runtimeErrorSummary.active_error_occurrence_count_24h, null);
  const runtimeActiveErrorFamilies = Array.isArray(runtimeErrorSummary && runtimeErrorSummary.active_error_families_24h)
    ? runtimeErrorSummary.active_error_families_24h
    : [];
  const writerAuthorityFamilies = runtimeErrorFamilies.filter((item) =>
    String(item && item.family || "").startsWith("POSITION_WRITE_")
  );
  const writerAuthoritySymbolCounts = new Map();
  for (const item of writerAuthorityFamilies) {
    for (const symbol of Array.isArray(item && item.symbols) ? item.symbols : []) {
      const key = String(symbol || "").trim().toUpperCase();
      if (!key) continue;
      writerAuthoritySymbolCounts.set(key, Number(writerAuthoritySymbolCounts.get(key) || 0) + Number(item.count || 0));
    }
  }
  const writerAuthorityTopSymbols = Array.from(writerAuthoritySymbolCounts.entries())
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.symbol).localeCompare(String(b.symbol));
    })
    .slice(0, 5);
  const writerAuthorityRemediationCandidates = buildWriterAuthorityRemediationCandidates({
    top_symbols: writerAuthorityTopSymbols,
  });
  const snapshotErrorCount = toNum(snapshot && snapshot.derived && snapshot.derived.error_count_24h, null);
  const reportErrorCount = parseErrorCount(reportRaw);
  const errorCount = Number.isFinite(runtimeErrorCount)
    ? runtimeErrorCount
    : (Number.isFinite(snapshotErrorCount) ? snapshotErrorCount : reportErrorCount);

  const nowIso = new Date().toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(snapshot.end_kst || nowIso) || kstDateKey(nowIso) || "unknown-date";
  const executionHealth = loadExecutionHealth({ repoRoot, dateKey });
  const positionReadModelCutover = loadPositionReadModelCutoverHealth({ repoRoot });
  const fillSyncAlertDuplication = loadFillSyncAlertDuplicationHealth({ repoRoot });
  const fillSyncAlertEventConsistency = loadFillSyncAlertEventConsistencyHealth({ repoRoot });
  const tradeExecutionAlertCrossAudit = loadTradeExecutionAlertCrossAuditHealth({ repoRoot });
  const activeExitWatchdog = loadActiveExitWatchdogHealth({ repoRoot });
  const trailRunnerFloorAudit = loadTrailRunnerFloorAuditHealth({ repoRoot });
  const trailRunnerFloorLiveSeparation = loadTrailRunnerFloorLiveSeparationHealth({ repoRoot });
  const binanceExitQtyContractAudit = loadBinanceExitQtyContractAuditHealth({ repoRoot });
  const binanceExitQtyLiveSeparation = loadBinanceExitQtyLiveSeparationHealth({ repoRoot });
  const nativeTrailProtectionGap = loadNativeTrailProtectionGapHealth({ repoRoot });
  const exitIntegrity = loadExitIntegrityHealth({ repoRoot });
  const regimeLineageGap = loadRegimeLineageGapHealth({ repoRoot });
  const positionReadViews = await listExchangePositionReadViews({ exchange: "BINANCEFUT", limit: 200 }).catch(() => []);
  const activePositionCount = Array.isArray(positionReadViews)
    ? positionReadViews.filter((row) => Number(row && row.size_pct) > 0 && String(row && row.state || "").toUpperCase() !== "FLAT").length
    : null;
  const runtimeActiveFamilyResolution = filterSupersededActiveErrorFamilies(runtimeActiveErrorFamilies, positionReadViews);
  const effectiveRuntimeActiveErrorFamilies = runtimeActiveFamilyResolution.effective;
  const supersededRuntimeActiveErrorFamilies = runtimeActiveFamilyResolution.superseded;
  const effectiveRuntimeActiveErrorCount = effectiveRuntimeActiveErrorFamilies.length;
  const effectiveRuntimeActiveErrorOccurrenceCount = effectiveRuntimeActiveErrorFamilies.reduce((acc, item) => acc + Number(item.count || 0), 0);

  const summary = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    snapshot_end_kst: toKstString(snapshot.end_kst, { fallbackToString: true }),
    status: "진행",
    reasons: [],
    total_equity_usdt: round(equity, 8),
    realized_pnl_usdt: round(realizedPnl, 8),
    commission_usdt: round(commission, 8),
    funding_usdt: round(funding, 8),
    cost_total_usdt: round(costTotalSigned, 8),
    cost_ratio_pct: round(costRatioPct, 4),
    net_pnl_usdt: round(netPnlUsdt, 8),
    net_pnl_pct: round(netPnlPct, 4),
    monthly_target_pct: round(monthlyTargetPct, 4),
    required_daily_pct: round(requiredDailyPct, 4),
    gap_pct: round(gapPct, 4),
    cost_limit_pct: round(costLimitPct, 4),
    cost_limit_base_pct: round(baseCostLimitPct, 4),
    cost_limit_relaxed: costLimitDecision.relaxed === true,
    cost_limit_reason: costLimitDecision.reason,
    learning_epoch_active: costLimitDecision.learning_epoch_active,
    microstructure_cost_relax_ready: costLimitDecision.microstructure_active,
    loss_stop_pct: round(lossStopPct, 4),
    stop_error_count: stopErrorCount,
    error_count: Number.isFinite(errorCount) ? errorCount : null,
    error_occurrence_count: Number.isFinite(runtimeErrorOccurrenceCount) ? runtimeErrorOccurrenceCount : null,
    active_error_count: effectiveRuntimeActiveErrorCount,
    active_error_occurrence_count: effectiveRuntimeActiveErrorOccurrenceCount,
    error_count_source: Number.isFinite(runtimeErrorCount)
      ? "runtime_error_counter"
      : (Number.isFinite(snapshotErrorCount) ? "snapshot.derived.error_count_24h" : (Number.isFinite(reportErrorCount) ? "report_parse" : "unresolved")),
    error_families_24h: runtimeErrorFamilies,
    active_error_families_24h: effectiveRuntimeActiveErrorFamilies,
    active_error_families_superseded_24h: supersededRuntimeActiveErrorFamilies,
    position_writer_authority_24h: {
      family_count: writerAuthorityFamilies.length,
      occurrence_count: writerAuthorityFamilies.reduce((acc, item) => acc + Number(item.count || 0), 0),
      families: writerAuthorityFamilies,
      top_symbols: writerAuthorityTopSymbols,
      remediation_candidates: writerAuthorityRemediationCandidates,
    },
    mode: "수익 확대 가능",
    execution_health: executionHealth,
    fill_sync_alert_duplication: fillSyncAlertDuplication,
    fill_sync_alert_event_consistency: fillSyncAlertEventConsistency,
    trade_execution_alert_cross_audit: tradeExecutionAlertCrossAudit,
    active_exit_watchdog: activeExitWatchdog,
    trail_runner_floor_audit: trailRunnerFloorAudit,
    trail_runner_floor_live_separation: trailRunnerFloorLiveSeparation,
    binance_exit_qty_contract_audit: binanceExitQtyContractAudit,
    binance_exit_qty_live_separation: binanceExitQtyLiveSeparation,
    native_trail_protection_gap: nativeTrailProtectionGap,
    exit_integrity: exitIntegrity,
    regime_lineage_gap: regimeLineageGap,
    position_read_model_cutover: positionReadModelCutover,
    approvals: [],
  };

  const statusResultWithHealth = decideStatus({
    netPnlPct,
    costRatioPct,
    errorCount,
    activeErrorCount: effectiveRuntimeActiveErrorCount,
    activeErrorFamilies: effectiveRuntimeActiveErrorFamilies,
    costLimitPct,
    lossStopPct,
    stopErrorCount,
    executionHealth,
    fillSyncAlertDuplication,
    fillSyncAlertEventConsistency,
    tradeExecutionAlertCrossAudit,
    activeExitWatchdog,
    trailRunnerFloorAudit,
    binanceExitQtyContractAudit,
    nativeTrailProtectionGap,
    exitIntegrity,
    positionReadModelCutover,
    activePositionCount,
  });
  summary.status = statusResultWithHealth.status;
  summary.reasons = statusResultWithHealth.reasons;
  summary.mode = summary.status === "진행" ? "수익 확대 가능" : "비용 차단";

  if (Number.isFinite(costRatioPct) && costRatioPct > costLimitPct) {
    summary.approvals.push({
      title: "72시간 신규 진입 규모 30% 축소",
      reason: `비용 비율 ${fmt(costRatioPct)}%가 상한 ${fmt(costLimitPct)}%를 초과한 상태에서 추가 비용 누수를 막기 위해`,
      action: "승인 시 72시간 동안 신규 진입 수량 상한을 현재 대비 30% 낮춰 적용",
    });
  }

  const outputJsonPath = path.join(repoRoot, "ops", "daily", "system_ops_check_latest.json");
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const outputMdPath = path.join(repoRoot, "ops", "daily", `${dateKey}_system_auto_execution_jihye.md`);
  const md = buildMarkdown({
    dateKey,
    generatedAtKst,
    snapshotPath,
    reportPath,
    executionHealth,
    summary,
    outputJsonPath,
  });
  fs.writeFileSync(outputMdPath, md, "utf8");

  let firestoreStateWritten = false;
  try {
    const writes = await Promise.allSettled([
      recordOperationalRuntimeState({
        exchange: null,
        generatedAt: summary.generated_at_iso || null,
        state: summary,
        source: "DAILY_SYSTEM_OPS_CHECK",
        artifacts: {
          latest_json: outputJsonPath,
          latest_md: outputMdPath,
        },
      }),
      recordOperationalRuntimeState({
        exchange: "BINANCEFUT",
        generatedAt: summary.generated_at_iso || null,
        state: summary,
        source: "DAILY_SYSTEM_OPS_CHECK",
        artifacts: {
          latest_json: outputJsonPath,
          latest_md: outputMdPath,
        },
      }),
    ]);
    firestoreStateWritten = writes.some((row) => row.status === "fulfilled");
  } catch (_) {}

  console.log(JSON.stringify({
    ok: true,
    output_json: outputJsonPath,
    output_md: outputMdPath,
    status: summary.status,
    mode: summary.mode,
    cost_ratio_pct: summary.cost_ratio_pct,
    net_pnl_pct: summary.net_pnl_pct,
    error_count: summary.error_count,
    active_error_count: summary.active_error_count,
    position_writer_authority_occurrence_count: summary.position_writer_authority_24h
      ? summary.position_writer_authority_24h.occurrence_count
      : null,
    execution_health_available: executionHealth.available,
    position_read_model_cutover_ready: positionReadModelCutover.latest_ready === true,
    position_read_model_cutover_status: positionReadModelCutover.dominant_status || null,
    fill_sync_alert_duplicate_group_n: fillSyncAlertDuplication.duplicate_group_n,
    fill_sync_alert_event_issue_n: fillSyncAlertEventConsistency.issue_n,
    trade_execution_alert_missing_fill_n: tradeExecutionAlertCrossAudit.missing_alert_fill_n,
    active_exit_watchdog_issue_symbol_n: activeExitWatchdog.issue_symbol_n,
    fill_sync_alert_suppressed_estimate_n: fillSyncAlertDuplication.suppressed_alert_estimate_n,
    trail_runner_floor_violation_n: trailRunnerFloorAudit.violation_n,
    trail_runner_floor_violation_total_n: trailRunnerFloorAudit.violation_total_n,
    binance_exit_qty_contract_issue_chain_count: binanceExitQtyContractAudit.issue_chain_count,
    binance_exit_qty_contract_issue_chain_total_n: binanceExitQtyContractAudit.issue_chain_total_n,
    binance_exit_qty_contract_issue_chain_backfilled_n: binanceExitQtyContractAudit.issue_chain_backfilled_n,
    native_trail_protection_gap_count: nativeTrailProtectionGap.gap_count,
    exit_integrity_live_issue_count: exitIntegrity.live_issue_count,
    exit_integrity_tp1_meta_sync_gap_n: exitIntegrity.tp1_meta_sync_gap_n,
    exit_integrity_tp1_meta_sync_gate: exitIntegrity.tp1_meta_sync_gate,
    binance_exit_qty_contract_top_code: Object.entries(binanceExitQtyContractAudit.issue_code_counts || {})
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .map((row) => row[0])[0] || null,
    drop_tp1_pending_count: executionHealth.drop_tp1_pending_count,
    qty_pct_non_positive_count: executionHealth.qty_pct_non_positive_count,
    firestore_state_written: firestoreStateWritten,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("daily-system-ops-check failed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    pickDocs,
    docDateKey,
    countDocsForDate,
    loadExecutionHealth,
    loadPositionReadModelCutoverHealth,
    loadTrailRunnerFloorAuditHealth,
    loadTrailRunnerFloorLiveSeparationHealth,
    loadBinanceExitQtyContractAuditHealth,
    loadBinanceExitQtyLiveSeparationHealth,
    loadNativeTrailProtectionGapHealth,
    loadExitIntegrityHealth,
    loadRegimeLineageGapHealth,
    hasExecutionFlowCoverage,
    hasHealthySupersedingPositionView,
    filterSupersededActiveErrorFamilies,
    decideStatus,
    buildIssueLines,
    buildWriterAuthorityRemediationCandidates,
    isLearningEpochActive,
    resolveRelaxedCostLimitPct,
  },
};
