#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  loadLocalEnv,
  writeJson,
} = require("./lib/automation-utils");
const { createRun, finishRun } = require("../src/storage/runLedger");
const { getMultiExchangesSettings } = require("../src/utils/exchangeSettings");
const { pickTf, runOneMarket } = require("../src/scheduler/marketRunner");
const { runAnalyticsLocalCacheRefresh } = require("../src/scheduler/analyticsLocalCacheRunner");
const { main: reportServerSignalAuthority } = require("./report-server-signal-authority");
const { main: reportServerSignalQuality } = require("./report-server-signal-quality");
const { main: reportServerSignalRuntime } = require("./report-server-signal-runtime");
const { main: reportServerSignalCutoverReadiness } = require("./report-server-signal-cutover-readiness");
const { main: reportServerSignalObservation24h } = require("./report-server-signal-observation-24h");

loadLocalEnv();

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function compactTail(values = [], maxItems = 3) {
  return (Array.isArray(values) ? values : [])
    .map((value) => trimOrNull(value))
    .filter(Boolean)
    .slice(-maxItems);
}

function summarizeAnalyticsRefreshReason(analytics = null) {
  if (!analytics || typeof analytics !== "object") return "ANALYTICS_LOCAL_CACHE_NO_RESULT";
  const directReason = trimOrNull(analytics.reason);
  if (directReason) return directReason;
  const failedReports = analytics.parsed && Array.isArray(analytics.parsed.dependent_reports)
    ? analytics.parsed.dependent_reports.filter((row) => row && row.status === "FAIL")
    : [];
  if (failedReports.length > 0) {
    const first = failedReports[0];
    return `DEPENDENT_REPORT_FAILED:${trimOrNull(first.script) || "UNKNOWN"}`;
  }
  const stderrTail = compactTail(analytics.stderr_tail, 5).join(" | ");
  if (/heap out of memory/i.test(stderrTail)) return "ANALYTICS_LOCAL_CACHE_OOM";
  if (stderrTail) return stderrTail.slice(0, 240);
  if (analytics.exit_code != null) return `ANALYTICS_LOCAL_CACHE_EXIT_${analytics.exit_code}`;
  return "ANALYTICS_LOCAL_CACHE_FAILED";
}

function toBool(value, fallback = false) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function resolveOutputFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_FILE);
  return explicit || path.join(OPS_DAILY_DIR, "openclaw_server_primary_tick_latest.json");
}

function resolveHistoryFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_HISTORY_FILE);
  return explicit || path.join(OPS_DAILY_DIR, "openclaw_server_primary_tick_history.jsonl");
}

function appendJsonl(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function summarizeDropReasons(rows = []) {
  const counts = {};
  for (const row of rows) {
    const reason = trimOrNull(row && row.signal_trace && row.signal_trace.top_signal_drop_reason);
    if (!reason) continue;
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return Object.freeze(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => Object.freeze({ reason, count }))
  );
}

function summarizeResults(results = []) {
  const rows = Array.isArray(results) ? results : [];
  let oldestBarCloseMs = null;
  let newestBarCloseMs = null;
  let signalSeenN = 0;
  let signalInternalN = 0;
  let intentCreatedN = 0;
  let serverSignalCreatedN = 0;
  let marketErrorN = 0;
  let snapshotRefreshFailN = 0;
  let signalSnapshotRefreshFailN = 0;
  const statusCounts = {};
  const failedMarkets = [];

  for (const row of rows) {
    const trace = row && row.signal_trace && typeof row.signal_trace === "object" ? row.signal_trace : {};
    const barCloseMs = Number(row && row.bar_close_time_utc_ms);
    if (Number.isFinite(barCloseMs)) {
      if (oldestBarCloseMs == null || barCloseMs < oldestBarCloseMs) oldestBarCloseMs = barCloseMs;
      if (newestBarCloseMs == null || barCloseMs > newestBarCloseMs) newestBarCloseMs = barCloseMs;
    }
    signalSeenN += Number(trace.signals_seen || 0);
    signalInternalN += Number(trace.signals_internal || 0);
    intentCreatedN += Number(trace.intents_created || 0);
    if (trace.status === "SERVER_SIGNAL_CREATED") serverSignalCreatedN += 1;
    const status = trimOrNull(trace.status) || "UNKNOWN";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (row && row.error) {
      marketErrorN += 1;
      failedMarkets.push(Object.freeze({
        exchange: trimOrNull(row.exchange),
        market: trimOrNull(row.market || row.symbol_or_pair_id),
        error: trimOrNull(row.error),
      }));
    }
    if (row && row.snapshot_refresh && row.snapshot_refresh.ok === false && row.snapshot_refresh.skipped !== true) {
      snapshotRefreshFailN += 1;
    }
    if (row && row.snapshot_refresh_signal && row.snapshot_refresh_signal.ok === false && row.snapshot_refresh_signal.skipped !== true) {
      signalSnapshotRefreshFailN += 1;
    }
  }

  return Object.freeze({
    market_n: rows.length,
    server_signal_created_n: serverSignalCreatedN,
    signals_seen_n: signalSeenN,
    signals_internal_n: signalInternalN,
    intents_created_n: intentCreatedN,
    market_error_n: marketErrorN,
    snapshot_refresh_fail_n: snapshotRefreshFailN,
    snapshot_refresh_signal_fail_n: signalSnapshotRefreshFailN,
    oldest_bar_close_time_utc_ms: oldestBarCloseMs,
    newest_bar_close_time_utc_ms: newestBarCloseMs,
    signal_status_counts: statusCounts,
    top_signal_drop_reasons: summarizeDropReasons(rows).slice(0, 10),
    failed_markets: failedMarkets.slice(0, 20),
  });
}

async function refreshDerivedArtifacts({
  analyticsRunner = runAnalyticsLocalCacheRefresh,
  reportAuthority = reportServerSignalAuthority,
  reportQuality = reportServerSignalQuality,
  reportRuntime = reportServerSignalRuntime,
  reportCutover = reportServerSignalCutoverReadiness,
  reportObservation = reportServerSignalObservation24h,
} = {}) {
  const steps = [];
  const analytics = analyticsRunner({
    trigger: "openclaw_server_primary_tick",
    force: true,
    skipDependentReports: true,
  });
  steps.push(Object.freeze({
    id: "analytics_local_cache",
    ok: analytics && analytics.ok === true,
    skipped: analytics && analytics.skipped === true,
    reason: analytics && analytics.ok === true
      ? (trimOrNull(analytics.reason) || null)
      : summarizeAnalyticsRefreshReason(analytics),
    exit_code: analytics && analytics.exit_code != null ? analytics.exit_code : null,
  }));
  if (!(analytics && analytics.ok === true)) {
    return Object.freeze({
      ok: false,
      steps,
    });
  }

  const reportSpecs = [
    { id: "server_signal_authority", fn: async () => reportAuthority() },
    { id: "server_signal_quality", fn: async () => reportQuality() },
    { id: "server_signal_runtime", fn: async () => reportRuntime() },
    { id: "server_signal_cutover_readiness", fn: async () => reportCutover() },
    { id: "server_signal_observation_24h", fn: async () => reportObservation() },
  ];

  for (const spec of reportSpecs) {
    try {
      const result = await spec.fn();
      steps.push(Object.freeze({
        id: spec.id,
        ok: true,
        skipped: false,
        reason: trimOrNull(result && result.reason) || null,
      }));
    } catch (error) {
      steps.push(Object.freeze({
        id: spec.id,
        ok: false,
        skipped: false,
        reason: trimOrNull(error && error.message) || String(error),
      }));
    }
  }

  return Object.freeze({
    ok: steps.every((step) => step.ok === true || step.skipped === true),
    steps,
  });
}

async function executeServerPrimaryTick({
  env = process.env,
  nowMs = Date.now(),
  getMultiExchangesSettingsFn = getMultiExchangesSettings,
  runOneMarketFn = runOneMarket,
  allowReplaySameBar = false,
  runId = null,
} = {}) {
  const multi = await getMultiExchangesSettingsFn(5000);
  const exchanges = Array.isArray(multi && multi.exchanges) ? multi.exchanges : [];
  const results = [];

  for (const exCfg of exchanges) {
    if (!exCfg || exCfg.enabled === false) continue;
    const exchange = String(exCfg.provider || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
    const signalTf = pickTf({ stateTf: exCfg.exec_tf, tfAllowlist: exCfg.tf_allowlist });
    const execTf = trimOrNull(exCfg.exec_tf) || signalTf;
    const markets = Array.isArray(exCfg.markets) ? exCfg.markets : [];
    // 2026-04-28 F2 Phase 5 — executionMode now env-driven so V2
    // server-native ENTRY signals can take the V2 discovery canary
    // bridge path (which requires LIVE mode in
    // evaluateV2DiscoveryCanaryLiveBridge). Default stays PAPER for
    // backward compatibility. V1 paperBinanceRunner exchange writers
    // remain blocked by legacy_runtime_disabled regardless of mode, so
    // flipping to LIVE does NOT resurrect V1 trading.
    const tickExecutionMode = (function() {
      const raw = String(env.DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_EXECUTION_MODE || "PAPER").trim().toUpperCase();
      return raw === "LIVE" ? "LIVE" : "PAPER";
    })();
    for (const market of markets) {
      const row = await runOneMarketFn({
        exchange,
        market,
        signalTf,
        execTf,
        nowMs,
        runIdHint: runId,
        executionEnabled: true,
        executionMode: tickExecutionMode,
        allowReplaySameBar,
      });
      results.push(row);
    }
  }

  return Object.freeze({
    ok: true,
    mode: trimOrNull(multi && multi.mode) || "single",
    exchange_n: exchanges.length,
    results,
  });
}

async function main({
  env = process.env,
  nowMs = Date.now(),
  createRunFn = createRun,
  finishRunFn = finishRun,
  getMultiExchangesSettingsFn = getMultiExchangesSettings,
  runOneMarketFn = runOneMarket,
  analyticsRunner = runAnalyticsLocalCacheRefresh,
  reportAuthority = reportServerSignalAuthority,
  reportQuality = reportServerSignalQuality,
  reportRuntime = reportServerSignalRuntime,
  reportCutover = reportServerSignalCutoverReadiness,
  reportObservation = reportServerSignalObservation24h,
  writeJsonFn = writeJson,
  appendJsonlFn = appendJsonl,
  setProcessExitCode = require.main === module,
} = {}) {
  const outputFile = resolveOutputFile(env);
  const historyFile = resolveHistoryFile(env);
  const allowReplaySameBar = toBool(env.DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_ALLOW_REPLAY, false);
  const run = await createRunFn({
    engineVersion: "openclaw_server_primary_tick_v1",
    runtimeMode: "openclaw_cron",
    meta: {
      source: "OPENCLAW_SERVER_PRIMARY_TICK",
      execution_mode: "PAPER",
    },
  });
  const runId = trimOrNull(run && run.run_id) || `OPENCLAW_SERVER_PRIMARY_TICK__${nowMs}`;

  let artifact;
  try {
    const tick = await executeServerPrimaryTick({
      env,
      nowMs,
      getMultiExchangesSettingsFn,
      runOneMarketFn,
      allowReplaySameBar,
      runId,
    });
    const summary = summarizeResults(tick.results);
    const derivedArtifacts = await refreshDerivedArtifacts({
      analyticsRunner,
      reportAuthority,
      reportQuality,
      reportRuntime,
      reportCutover,
      reportObservation,
    });
    const primaryOk = summary.market_error_n === 0
      && summary.snapshot_refresh_fail_n === 0
      && summary.snapshot_refresh_signal_fail_n === 0;
    const derivedArtifactFailN = derivedArtifacts.steps.filter((step) => step.ok !== true && step.skipped !== true).length;
    const ok = primaryOk;
    const reason = ok
      ? (derivedArtifacts.ok === true
        ? "OPENCLAW_SERVER_PRIMARY_TICK_PASS"
        : "OPENCLAW_SERVER_PRIMARY_TICK_PASS_WITH_DERIVED_ARTIFACT_WARNINGS")
      : "OPENCLAW_SERVER_PRIMARY_TICK_BLOCKED";
    artifact = Object.freeze({
      ok,
      reason,
      generated_at: new Date(nowMs).toISOString(),
      run_id: runId,
      output_file: outputFile,
      history_file: historyFile,
      scheduler_sot: "OPENCLAW_CRON",
      execution_mode: "PAPER",
      allow_replay_same_bar: allowReplaySameBar,
      exchange_n: tick.exchange_n,
      mode: tick.mode,
      summary,
      derived_artifacts: derivedArtifacts,
      warnings: derivedArtifacts.ok === true
        ? []
        : derivedArtifacts.steps.filter((step) => step.ok !== true && step.skipped !== true),
    });
    writeJsonFn(outputFile, artifact);
    appendJsonlFn(historyFile, artifact);
    await finishRunFn(runId, ok ? "PASS" : "FAIL", {
      meta: {
        source: "OPENCLAW_SERVER_PRIMARY_TICK",
        output_file: outputFile,
      },
      server_signal_created_n: summary.server_signal_created_n,
      signals_seen_n: summary.signals_seen_n,
      intents_created_n: summary.intents_created_n,
      derived_artifact_fail_n: derivedArtifactFailN,
    });
    console.log(JSON.stringify({
      ok: artifact.ok,
      reason: artifact.reason,
      output_file: artifact.output_file,
      history_file: artifact.history_file,
      market_n: artifact.summary.market_n,
      server_signal_created_n: artifact.summary.server_signal_created_n,
      signals_seen_n: artifact.summary.signals_seen_n,
      intents_created_n: artifact.summary.intents_created_n,
      oldest_bar_close_time_utc_ms: artifact.summary.oldest_bar_close_time_utc_ms,
      newest_bar_close_time_utc_ms: artifact.summary.newest_bar_close_time_utc_ms,
      market_error_n: artifact.summary.market_error_n,
      snapshot_refresh_fail_n: artifact.summary.snapshot_refresh_fail_n,
      derived_artifact_fail_n: derivedArtifactFailN,
    }));
    if (!artifact.ok && setProcessExitCode) process.exitCode = 1;
    return artifact;
  } catch (error) {
    const message = trimOrNull(error && error.message) || String(error);
    artifact = Object.freeze({
      ok: false,
      reason: "OPENCLAW_SERVER_PRIMARY_TICK_EXCEPTION",
      generated_at: new Date(nowMs).toISOString(),
      run_id: runId,
      output_file: outputFile,
      history_file: historyFile,
      error: {
        message,
      },
    });
    writeJsonFn(outputFile, artifact);
    appendJsonlFn(historyFile, artifact);
    await finishRunFn(runId, "FAIL", {
      error_message: message,
      meta: {
        source: "OPENCLAW_SERVER_PRIMARY_TICK",
        output_file: outputFile,
      },
    });
    console.error(message);
    if (setProcessExitCode) process.exitCode = 1;
    return artifact;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  __test: {
    resolveOutputFile,
    resolveHistoryFile,
    appendJsonl,
    summarizeResults,
    summarizeDropReasons,
    refreshDerivedArtifacts,
    executeServerPrimaryTick,
  },
};
